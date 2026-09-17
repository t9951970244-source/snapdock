import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Комната через обычный хостинг.
 *
 * Обмен идёт простыми запросами — так же, как страница для телефона. Постоянное
 * соединение не используется: на обычном хостинге его нет, и именно поэтому
 * виджет раньше висел на «Устанавливаю связь».
 *
 * Сервер только сводит участников. Видео, звук и файлы идут между компьютерами
 * напрямую, минуя хостинг.
 */

export type ChatItem =
  | { kind: 'text'; id: string; from: string; text: string; mine: boolean }
  | { kind: 'file'; id: string; from: string; name: string; size: number; url?: string; progress: number; mine: boolean }
  | { kind: 'sys'; id: string; text: string }

export type Member = { id: string; name: string; stream?: MediaStream }
export type RoomState = 'idle' | 'connecting' | 'live' | 'failed'

const CHUNK = 16 * 1024
const rid = () => Math.random().toString(36).slice(2, 8)
const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Метка комнаты = отпечаток номера и пароля. Считается так же на странице для телефона. */
async function roomKey(num: string, pass: string) {
  const data = new TextEncoder().encode(`snapdock|${num.trim()}|${pass.trim()}`)
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))).slice(0, 32)
}

/** Постоянный знак этого компьютера: при повторном входе не появляется двойник. */
function deviceId() {
  let v = localStorage.getItem('snapdock-uid')
  if (!v) { v = hex(crypto.getRandomValues(new Uint8Array(8))); localStorage.setItem('snapdock-uid', v) }
  return v
}

export const newRoomNumber = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 900000 + 100000)
export function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(r, (v) => abc[v % abc.length]).join('').replace(/(.{4})/, '$1-')
}

export function useRoom() {
  const [state, setState] = useState<RoomState>('idle')
  const [shown, setShown] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [chat, setChat] = useState<ChatItem[]>([])
  const [mine, setMine] = useState<MediaStream | null>(null)
  const [noCam, setNoCam] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [volume, setVol] = useState(1)
  const [speaking, setSpeaking] = useState<Set<string>>(new Set())
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const base = useRef('')           // адрес room.php
  const key = useRef('')            // метка комнаты
  const me = useRef('')
  const myName = useRef('')
  const since = useRef(0)
  const alive = useRef(false)
  const local = useRef<MediaStream | null>(null)
  const camTrack = useRef<MediaStreamTrack | null>(null)
  const pcs = useRef(new Map<string, RTCPeerConnection>())
  const chans = useRef(new Map<string, RTCDataChannel>())
  const incoming = useRef(new Map<string, { name: string; size: number; parts: ArrayBuffer[]; got: number }>())
  const meters = useRef(new Map<string, { ctx: AudioContext; an: AnalyserNode; buf: Uint8Array }>())
  const ice = useRef<RTCIceServer[]>([
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ])
  const abort = useRef<AbortController | null>(null)

  const push = (i: ChatItem) => setChat((c) => [...c.slice(-200), i])

  /* ---------------- обмен с хостингом ---------------- */
  const api = useCallback(async (action: string, params: Record<string, string> = {}, body?: unknown) => {
    const q = new URLSearchParams({ a: action, room: key.current, ...params })
    const ctl = new AbortController()
    abort.current = ctl
    const res = await fetch(`${base.current}?${q}`, body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal }
      : { signal: ctl.signal })
    return res.json()
  }, [])

  const tell = useCallback((obj: unknown) => {
    if (me.current) api('send', { id: me.current }, obj).catch(() => {})
  }, [api])

  /* ---------------- видео ---------------- */
  const tile = useCallback((id: string, name: string, stream?: MediaStream) => {
    setMembers((m) => (m.some((x) => x.id === id)
      ? m.map((x) => (x.id === id ? { ...x, name: name || x.name, stream: stream ?? x.stream } : x))
      : [...m, { id, name, stream }]))
  }, [])

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
      setSpeaking((prev) => (prev.size === loud.size && [...loud].every((x) => prev.has(x)) ? prev : loud))
    }, 350)
    return () => clearInterval(timer)
  }, [])

  const bindChannel = useCallback((id: string, ch: RTCDataChannel) => {
    ch.binaryType = 'arraybuffer'
    ch.onopen = () => chans.current.set(id, ch)
    ch.onclose = () => chans.current.delete(id)
    ch.onmessage = (e) => {
      const buf = e.data as ArrayBuffer
      const u = new Uint8Array(buf)
      const fid = hex(u.slice(0, 8))
      const f = incoming.current.get(fid)
      if (!f) return
      f.parts.push(buf.slice(12))
      f.got += buf.byteLength - 12
      const p = Math.min(1, f.got / f.size)
      setChat((cs) => cs.map((i) => (i.id === fid && i.kind === 'file' ? { ...i, progress: p } : i)))
      if (f.got >= f.size) {
        const url = URL.createObjectURL(new Blob(f.parts))
        setChat((cs) => cs.map((i) => (i.id === fid && i.kind === 'file' ? { ...i, progress: 1, url } : i)))
        incoming.current.delete(fid)
      }
    }
  }, [])

  const peer = useCallback((id: string, name: string) => {
    let pc = pcs.current.get(id)
    if (pc) return pc
    pc = new RTCPeerConnection({ iceServers: ice.current, iceCandidatePoolSize: 4 })
    pcs.current.set(id, pc)

    if (local.current) local.current.getTracks().forEach((tr) => pc!.addTrack(tr, local.current!))
    else {
      try { pc.addTransceiver('video', { direction: 'recvonly' }); pc.addTransceiver('audio', { direction: 'recvonly' }) } catch { /* движок не дал */ }
    }
    bindChannel(id, pc.createDataChannel('files', { ordered: true }))
    pc.ondatachannel = (e) => bindChannel(id, e.channel)
    pc.onicecandidate = (e) => { if (e.candidate) tell({ t: 'signal', to: id, ice: e.candidate }) }
    pc.ontrack = (e) => { tile(id, name, e.streams[0]); watchVoice(id, e.streams[0]) }
    pc.onconnectionstatechange = () => {
      if (pc!.connectionState === 'failed') { try { pc!.restartIce() } catch { /* не поддержано */ } }
    }
    return pc
  }, [bindChannel, tell, tile, watchVoice])

  const call = useCallback(async (id: string, name: string) => {
    const pc = peer(id, name)
    await pc.setLocalDescription(await pc.createOffer())
    tell({ t: 'signal', to: id, sdp: pc.localDescription })
  }, [peer, tell])

  const roster = useCallback((peers: Record<string, { name: string }>) => {
    const list = Object.entries(peers || {}).map(([id, p]) => ({ id, name: p.name }))
    const ids = new Set(list.map((p) => p.id))
    setMembers((cur) => cur.filter((x) => ids.has(x.id)))
    for (const [id, pc] of pcs.current) if (!ids.has(id)) { pc.close(); pcs.current.delete(id) }
    for (const p of list) {
      if (p.id === me.current) continue
      tile(p.id, p.name)
      // Звонит тот, чья метка больше: иначе оба звонят одновременно
      if (!pcs.current.has(p.id) && me.current > p.id) call(p.id, p.name)
    }
  }, [call, tile])

  const handle = useCallback(async (m: any) => {
    if (m.t === 'chat') return push({ kind: 'text', id: rid(), from: m.name ?? '', text: String(m.text).slice(0, 4000), mine: false })
    if (m.t === 'fmeta') {
      incoming.current.set(m.id, { name: m.fname, size: m.size, parts: [], got: 0 })
      return push({ kind: 'file', id: m.id, from: m.name ?? '', name: m.fname, size: m.size, progress: 0, mine: false })
    }
    if (m.t === 'left') {
      pcs.current.get(m.from)?.close(); pcs.current.delete(m.from)
      setMembers((cur) => cur.filter((x) => x.id !== m.from))
      return
    }
    if (m.t === 'signal' && m.to === me.current) {
      const pc = peer(m.from, m.name ?? '')
      if (m.sdp) {
        await pc.setRemoteDescription(m.sdp)
        if (m.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer())
          tell({ t: 'signal', to: m.from, sdp: pc.localDescription })
        }
      } else if (m.ice) {
        try { await pc.addIceCandidate(m.ice) } catch { /* поздний путь */ }
      }
    }
  }, [peer, tell])

  /** Ожидание нового: сервер держит запрос до двадцати пяти секунд. */
  const loop = useCallback(async () => {
    while (alive.current) {
      try {
        const j = await api('poll', { id: me.current, since: String(since.current) })
        setState('live'); setError(null)
        if (typeof j.seq === 'number') since.current = Math.max(since.current, j.seq)
        if (j.peers) roster(j.peers)
        for (const m of j.msgs || []) await handle(m)
      } catch {
        if (!alive.current) return
        setState('connecting')
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
  }, [api, handle, roster])

  /* ---------------- вход ---------------- */
  const join = useCallback(async (url: string, num: string, name: string, pass = '') => {
    base.current = url.replace(/\/+$/, '') + '/room.php'
    key.current = await roomKey(num, pass)
    myName.current = name.trim() || 'Гость'
    setShown(num.trim()); setChat([]); setError(null); setState('connecting')

    try {
      const r = await fetch(url.replace(/\/+$/, '') + '/ice.json')
      const j = await r.json()
      if (Array.isArray(j) && j.length) ice.current = j
    } catch { /* останутся значения по умолчанию */ }

    await window.snap?.askCamera()
    /* Камеру и микрофон просим по отдельности: отказ в одном не должен
       лишать второго. Раньше запрет микрофона оставлял человека и без звука,
       и без картинки. */
    const tracks: MediaStreamTrack[] = []
    let gotCam = false
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } })
      tracks.push(...cam.getVideoTracks()); gotCam = true
    } catch { /* без камеры */ }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      tracks.push(...mic.getAudioTracks())
    } catch { /* без микрофона */ }
    local.current = tracks.length ? new MediaStream(tracks) : null
    setMine(local.current); setNoCam(!gotCam)

    try {
      const j = await api('join', { name: myName.current, uid: deviceId() })
      if (!j?.id) throw new Error('сервер не ответил')
      me.current = j.id
      since.current = j.since || 0
      alive.current = true
      setState('live')
      if (j.peers) roster(j.peers)
      loop()
    } catch (e: any) {
      setState('failed')
      setError(`Комната не отвечает. Проверьте адрес. ${String(e?.message ?? e)}`)
    }
  }, [api, loop, roster])

  const leave = useCallback(() => {
    alive.current = false
    abort.current?.abort()
    if (me.current) api('leave', { id: me.current }).catch(() => {})
    pcs.current.forEach((p) => p.close()); pcs.current.clear()
    chans.current.clear()
    meters.current.forEach((m) => m.ctx.close().catch(() => {})); meters.current.clear()
    local.current?.getTracks().forEach((t) => t.stop()); local.current = null
    me.current = ''
    setMine(null); setMembers([]); setChat([]); setState('idle'); setShown(''); setNoCam(false)
    setCamOn(true); setMicOn(true); setSharing(false); setSpeaking(new Set())
  }, [api])

  useEffect(() => {
    const bye = () => { if (me.current) navigator.sendBeacon?.(`${base.current}?a=leave&room=${key.current}&id=${me.current}`) }
    window.addEventListener('beforeunload', bye)
    return () => { window.removeEventListener('beforeunload', bye); leave() }
  }, [leave])

  /* ---------------- действия ---------------- */
  const send = useCallback((text: string) => {
    if (!text.trim() || !me.current) return
    tell({ t: 'chat', text })
    push({ kind: 'text', id: rid(), from: 'me', text, mine: true })
  }, [tell])

  const sendFile = useCallback(async (file: File) => {
    const open = [...chans.current.values()].filter((c) => c.readyState === 'open')
    if (!open.length) { push({ kind: 'sys', id: rid(), text: 'Файлы пойдут, когда установится связь с собеседником' }); return }

    const idBytes = crypto.getRandomValues(new Uint8Array(8))
    const id = hex(idBytes)
    tell({ t: 'fmeta', id, fname: file.name, size: file.size })
    push({ kind: 'file', id, from: 'me', name: file.name, size: file.size, progress: 0, mine: true })

    const buf = await file.arrayBuffer()
    for (let off = 0, n = 0; off < buf.byteLength; off += CHUNK, n++) {
      const part = buf.slice(off, off + CHUNK)
      const out = new Uint8Array(12 + part.byteLength)
      out.set(idBytes, 0)
      new DataView(out.buffer).setUint32(8, n)
      out.set(new Uint8Array(part), 12)
      for (const c of open) {
        while (c.bufferedAmount > 1 << 20) await new Promise((r) => setTimeout(r, 30))
        c.send(out.buffer)
      }
      const p = Math.min(1, (off + CHUNK) / buf.byteLength)
      setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: p } : i)))
    }
  }, [tell])

  const toggle = useCallback((kind: 'video' | 'audio') => {
    const tracks = kind === 'video' ? local.current?.getVideoTracks() : local.current?.getAudioTracks()
    let on = true
    tracks?.forEach((t) => { t.enabled = !t.enabled; on = t.enabled })
    kind === 'video' ? setCamOn(on) : setMicOn(on)
    return on
  }, [])

  const share = useCallback(async () => {
    if (sharing) {
      const back = camTrack.current
      for (const pc of pcs.current.values()) {
        const s = pc.getSenders().find((x) => x.track?.kind === 'video')
        if (s && back) await s.replaceTrack(back)
      }
      if (back) setMine(new MediaStream([back, ...(local.current?.getAudioTracks() ?? [])]))
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
      track.onended = () => share()
      setSharing(true)
    } catch { /* отказались */ }
  }, [sharing])

  const listDevices = useCallback(async () => {
    try { setDevices(await navigator.mediaDevices.enumerateDevices()) } catch { /* нет доступа */ }
  }, [])

  const useDevice = useCallback(async (kind: 'videoinput' | 'audioinput', deviceId2: string) => {
    try {
      const st = await navigator.mediaDevices.getUserMedia(
        kind === 'videoinput' ? { video: { deviceId: { exact: deviceId2 } } } : { audio: { deviceId: { exact: deviceId2 } } })
      const track = kind === 'videoinput' ? st.getVideoTracks()[0] : st.getAudioTracks()[0]
      if (!track) return
      const want = kind === 'videoinput' ? 'video' : 'audio'
      for (const pc of pcs.current.values()) {
        const s = pc.getSenders().find((x) => x.track?.kind === want)
        if (s) await s.replaceTrack(track)
      }
      const keep = local.current ? local.current.getTracks().filter((t) => t.kind !== want) : []
      local.current?.getTracks().filter((t) => t.kind === want).forEach((t) => t.stop())
      local.current = new MediaStream([track, ...keep])
      setMine(local.current)
    } catch { /* устройство занято */ }
  }, [])

  const autoJoin = useCallback(async () => false, [])

  return {
    state, room: shown, members, chat, mine, noCam, error,
    camOn, micOn, sharing, volume, speaking, devices,
    join, autoJoin, leave, send, sendFile, toggle, share, listDevices, useDevice,
    setVolume: setVol, sys: (t: string) => push({ kind: 'sys', id: rid(), text: t }),
  }
}
