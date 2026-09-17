import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Комната через свой сервер.
 *
 * Сервер всегда на месте, поэтому связь предсказуема: он сводит участников,
 * пересылает сообщения и файлы и помогает договориться о видео. Обрыв интернета
 * не требует ничего вводить заново — страница подключается сама.
 *
 * Тот же самый обмен, что и на веб-странице комнаты, поэтому виджет и телефон
 * оказываются в одной комнате и видят друг друга.
 */

const CHUNK = 64 * 1024

export type ChatItem =
  | { kind: 'text'; id: string; from: string; text: string; mine: boolean }
  | { kind: 'file'; id: string; from: string; name: string; size: number; url?: string; progress: number; mine: boolean }
  | { kind: 'sys'; id: string; text: string }

export type Member = { id: string; name: string; stream?: MediaStream }
export type RoomState = 'idle' | 'connecting' | 'live' | 'failed'

const rid = () => Math.random().toString(36).slice(2, 8)
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * Метка комнаты = отпечаток от номера и пароля вместе.
 * Серверу уходит только она: он не знает ни номера, ни пароля, а человек с
 * неверным паролем попадает в другую, пустую комнату и никого не видит.
 */
async function roomKey(num: string, pass: string) {
  const data = new TextEncoder().encode(`snapdock|${num.trim()}|${pass.trim()}`)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 32)
}

/** Номер комнаты: шесть цифр, легко продиктовать. */
export const newRoomNumber = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)

/** Пароль: без похожих символов, чтобы не путать ноль с буквой. */
export function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(r, (v) => abc[v % abc.length]).join('').replace(/(.{4})/, '$1-')
}

export function useRoom() {
  const [state, setState] = useState<RoomState>('idle')
  const [room, setRoom] = useState('')
  const [shown, setShown] = useState('')      // номер, который видит человек
  const [members, setMembers] = useState<Member[]>([])
  const [chat, setChat] = useState<ChatItem[]>([])
  const [mine, setMine] = useState<MediaStream | null>(null)
  const [noCam, setNoCam] = useState(false)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [volume, setVol] = useState(1)
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  const ws = useRef<WebSocket | null>(null)
  const me = useRef('')
  const myName = useRef('')
  const local = useRef<MediaStream | null>(null)
  const pcs = useRef(new Map<string, RTCPeerConnection>())
  const ice = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ])
  const incoming = useRef(new Map<string, { name: string; size: number; parts: ArrayBuffer[]; got: number }>())
  const alive = useRef(false)          // человек ещё в комнате — значит переподключаемся
  const camTrack = useRef<MediaStreamTrack | null>(null)   // своя камера, пока идёт показ экрана
  const meters = useRef(new Map<string, { ctx: AudioContext; an: AnalyserNode; buf: Uint8Array }>())
  const target = useRef({ url: '', room: '', name: '' })

  const push = (i: ChatItem) => setChat((c) => [...c.slice(-200), i])

  /** Подсветка говорящего — как в обычных видеочатах. */
  const watchVoice = useCallback((id: string, stream: MediaStream) => {
    if (meters.current.has(id) || !stream.getAudioTracks().length) return
    try {
      const ctx = new AudioContext()
      const an = ctx.createAnalyser()
      an.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(an)
      meters.current.set(id, { ctx, an, buf: new Uint8Array(an.frequencyBinCount) })
    } catch { /* звука нет */ }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      const loud = new Set<string>()
      for (const [id, m] of meters.current) {
        m.an.getByteFrequencyData(m.buf)
        let sum = 0
        for (const v of m.buf) sum += v
        if (sum / m.buf.length > 14) loud.add(id)
      }
      setSpeaking((prev) => {
        if (prev.size === loud.size && [...loud].every((x) => prev.has(x))) return prev
        return loud
      })
    }, 350)
    return () => clearInterval(timer)
  }, [])
  const sys = (text: string) => push({ kind: 'sys', id: rid(), text })

  /* ---------------- видео ---------------- */
  const tile = useCallback((id: string, name: string, stream?: MediaStream) => {
    setMembers((m) => {
      const had = m.find((x) => x.id === id)
      if (!had) return [...m, { id, name, stream }]
      return m.map((x) => (x.id === id ? { ...x, name: name || x.name, stream: stream ?? x.stream } : x))
    })
  }, [])

  const peer = useCallback((id: string, name: string) => {
    let pc = pcs.current.get(id)
    if (pc) return pc
    pc = new RTCPeerConnection({ iceServers: ice.current, iceCandidatePoolSize: 4 })
    pcs.current.set(id, pc)

    if (local.current) local.current.getTracks().forEach((tr) => pc!.addTrack(tr, local.current!))
    else {
      // Без камеры всё равно должны видеть остальных
      try { pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' }) } catch { /* движок не дал */ }
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.current?.send(JSON.stringify({ t: 'signal', to: id, ice: e.candidate }))
    }
    pc.ontrack = (e) => { tile(id, name, e.streams[0]); watchVoice(id, e.streams[0]) }
    pc.onconnectionstatechange = () => {
      // Путь потерян — сервер на месте, просим движок найти новый
      if (pc!.connectionState === 'failed') { try { pc!.restartIce() } catch { /* не поддержано */ } }
    }
    return pc
  }, [tile])

  const call = useCallback(async (id: string, name: string) => {
    const pc = peer(id, name)
    await pc.setLocalDescription(await pc.createOffer())
    ws.current?.send(JSON.stringify({ t: 'signal', to: id, sdp: pc.localDescription }))
  }, [peer])

  /* ---------------- файлы ---------------- */
  const onBinary = useCallback((buf: ArrayBuffer) => {
    const u = new Uint8Array(buf)
    const id = hex(u.slice(0, 8))
    const f = incoming.current.get(id)
    if (!f) return
    f.parts.push(buf.slice(12))
    f.got += buf.byteLength - 12
    const p = Math.min(1, f.got / f.size)
    setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: p } : i)))
    if (f.got >= f.size) {
      const url = URL.createObjectURL(new Blob(f.parts))
      setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: 1, url } : i)))
      incoming.current.delete(id)
    }
  }, [])

  const sendFile = useCallback(async (file: File) => {
    const sock = ws.current
    if (!sock || sock.readyState !== 1) return
    const idBytes = crypto.getRandomValues(new Uint8Array(8))
    const id = hex(idBytes)
    sock.send(JSON.stringify({ t: 'fmeta', id, name: file.name, size: file.size }))
    push({ kind: 'file', id, from: 'me', name: file.name, size: file.size, progress: 0, mine: true })

    const buf = await file.arrayBuffer()
    for (let off = 0, n = 0; off < buf.byteLength; off += CHUNK, n++) {
      // Не переполняем канал, иначе он рвётся на больших файлах
      while (sock.bufferedAmount > 4 << 20) await new Promise((r) => setTimeout(r, 40))
      const part = buf.slice(off, off + CHUNK)
      const out = new Uint8Array(12 + part.byteLength)
      out.set(idBytes, 0)
      new DataView(out.buffer).setUint32(8, n)
      out.set(new Uint8Array(part), 12)
      sock.send(out.buffer)
      const p = Math.min(1, (off + CHUNK) / buf.byteLength)
      setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: p } : i)))
    }
  }, [])

  /* ---------------- подключение ---------------- */
  const open = useCallback(() => {
    const { url, room: r, name } = target.current
    if (!url) return
    let sock: WebSocket
    try {
      const u = new URL(url.includes('://') ? url : `https://${url}`)
      sock = new WebSocket(`${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${u.pathname.replace(/\/$/, '')}`)
    } catch { setState('failed'); setError('Адрес сервера не распознан'); return }

    ws.current = sock
    sock.binaryType = 'arraybuffer'
    setState('connecting')

    sock.onopen = () => {
      setState('live'); setError(null)
      sock.send(JSON.stringify({ t: 'join', room: r, name }))
    }
    sock.onclose = () => {
      pcs.current.forEach((p) => p.close()); pcs.current.clear()
      setMembers([])
      if (!alive.current) { setState('idle'); return }
      setState('connecting')
      setTimeout(open, 1500)          // сервер на месте — просто подключаемся заново
    }
    sock.onerror = () => { /* onclose доделает */ }

    sock.onmessage = async (e) => {
      if (typeof e.data !== 'string') return onBinary(e.data as ArrayBuffer)
      let m: any
      try { m = JSON.parse(e.data) } catch { return }

      if (m.t === 'joined') { me.current = m.id; setRoom(m.room); return }
      if (m.t === 'full') { setError('В комнате уже максимум участников'); return }

      if (m.t === 'roster') {
        const list: { id: string; name: string }[] = m.list
        const ids = new Set(list.map((p) => p.id))
        setMembers((cur) => cur.filter((x) => ids.has(x.id)))
        for (const p of list) {
          if (p.id === me.current) continue
          tile(p.id, p.name)
          // Звонит тот, чья метка больше: иначе оба звонят одновременно
          if (!pcs.current.has(p.id) && me.current > p.id) call(p.id, p.name)
        }
        return
      }
      if (m.t === 'left') {
        pcs.current.get(m.id)?.close(); pcs.current.delete(m.id)
        setMembers((cur) => cur.filter((x) => x.id !== m.id))
        return
      }
      if (m.t === 'chat') return push({ kind: 'text', id: rid(), from: m.fromName ?? '', text: String(m.text).slice(0, 4000), mine: false })
      if (m.t === 'fmeta') {
        incoming.current.set(m.id, { name: m.name, size: m.size, parts: [], got: 0 })
        return push({ kind: 'file', id: m.id, from: m.fromName ?? '', name: m.name, size: m.size, progress: 0, mine: false })
      }
      if (m.t === 'signal') {
        const pc = peer(m.from, m.fromName ?? '')
        if (m.sdp) {
          await pc.setRemoteDescription(m.sdp)
          if (m.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer())
            sock.send(JSON.stringify({ t: 'signal', to: m.from, sdp: pc.localDescription }))
          }
        } else if (m.ice) {
          try { await pc.addIceCandidate(m.ice) } catch { /* поздний путь */ }
        }
      }
    }
  }, [call, onBinary, peer, tile])

  const join = useCallback(async (url: string, r: string, name: string, pass = '') => {
    const key = await roomKey(r, pass)
    target.current = { url, room: key, name: name.trim() || 'Гость' }
    setShown(r.trim())
    myName.current = target.current.name
    alive.current = true
    setChat([]); setError(null)

    // Ретрансляторы сервер отдаёт сам — участникам ничего вводить не нужно
    try {
      const base = url.includes('://') ? url : `https://${url}`
      const r2 = await fetch(new URL('/ice', base).toString())
      const j = await r2.json()
      if (Array.isArray(j) && j.length) ice.current = j
    } catch { /* останутся значения по умолчанию */ }

    await window.snap?.askCamera()
    try {
      local.current = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      setMine(local.current); setNoCam(false)
    } catch { local.current = null; setMine(null); setNoCam(true) }

    open()
  }, [open])

  /** Возврат в последнюю комнату — если человек её не закрывал. */
  const autoJoin = useCallback(async (url: string, num: string, pass: string, name: string) => {
    if (!url || !num) return false
    await join(url, num, name, pass)
    return true
  }, [])


  const leave = useCallback(() => {
    alive.current = false
    ws.current?.close(); ws.current = null
    pcs.current.forEach((p) => p.close()); pcs.current.clear()
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null
    meters.current.forEach((m) => m.ctx.close().catch(() => {})); meters.current.clear()
    setMine(null); setMembers([]); setChat([]); setState('idle'); setRoom(''); setShown(''); setNoCam(false)
    setCamOn(true); setMicOn(true); setSharing(false); setSpeaking(new Set())
  }, [])

  const send = useCallback((text: string) => {
    if (!text.trim() || ws.current?.readyState !== 1) return
    ws.current.send(JSON.stringify({ t: 'chat', text }))
    push({ kind: 'text', id: rid(), from: 'me', text, mine: true })
  }, [])

  const toggle = useCallback((kind: 'video' | 'audio') => {
    const tracks = kind === 'video' ? local.current?.getVideoTracks() : local.current?.getAudioTracks()
    let on = true
    tracks?.forEach((t) => { t.enabled = !t.enabled; on = t.enabled })
    kind === 'video' ? setCamOn(on) : setMicOn(on)
    return on
  }, [])

  /** Показ экрана: подменяем дорожку камеры, собеседники ничего не переподключают. */
  const share = useCallback(async () => {
    if (sharing) {
      const back = camTrack.current
      for (const pc of pcs.current.values()) {
        const s = pc.getSenders().find((x) => x.track?.kind === 'video')
        if (s && back) await s.replaceTrack(back)
      }
      if (back && local.current) {
        local.current.getVideoTracks().forEach((t) => { if (t !== back) t.stop() })
        setMine(new MediaStream([back, ...local.current.getAudioTracks()]))
      }
      setSharing(false)
      return
    }
    try {
      const st = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const track = st.getVideoTracks()[0]
      if (!track) return
      camTrack.current = local.current?.getVideoTracks()[0] ?? null
      for (const pc of pcs.current.values()) {
        const s = pc.getSenders().find((x) => x.track?.kind === 'video')
        if (s) await s.replaceTrack(track)
      }
      setMine(new MediaStream([track, ...(local.current?.getAudioTracks() ?? [])]))
      track.onended = () => share()          // остановили из системы — вернём камеру
      setSharing(true)
    } catch { /* отказались */ }
  }, [sharing])

  /** Список камер и микрофонов. */
  const listDevices = useCallback(async () => {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()) } catch { /* нет доступа */ }
  }, [])

  /** Переключение камеры или микрофона на лету. */
  const useDevice = useCallback(async (kind: 'videoinput' | 'audioinput', deviceId: string) => {
    try {
      const st = await navigator.mediaDevices.getUserMedia(
        kind === 'videoinput' ? { video: { deviceId: { exact: deviceId } } } : { audio: { deviceId: { exact: deviceId } } })
      const track = kind === 'videoinput' ? st.getVideoTracks()[0] : st.getAudioTracks()[0]
      if (!track) return
      const want = kind === 'videoinput' ? 'video' : 'audio'
      for (const pc of pcs.current.values()) {
        const s = pc.getSenders().find((x) => x.track?.kind === want)
        if (s) await s.replaceTrack(track)
      }
      const old = local.current
      const keep = old ? old.getTracks().filter((t) => t.kind !== want) : []
      old?.getTracks().filter((t) => t.kind === want).forEach((t) => t.stop())
      local.current = new MediaStream([track, ...keep])
      setMine(local.current)
    } catch { /* устройство занято */ }
  }, [])

  useEffect(() => leave, [leave])

  return {
    state, room: shown, members, chat, mine, noCam, error,
    camOn, micOn, sharing, volume, speaking, devices,
    join, autoJoin, leave, send, sendFile, toggle, share, listDevices, useDevice,
    setVolume: setVol, sys,
  }
}
