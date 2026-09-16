import { useCallback, useRef, useState } from 'react'
import { deriveKey, seal, unseal, sealBin, unsealBin, packSealed, unpackSealed, toB64, fromB64 } from '@/lib/crypto'
import { bytes } from '@/lib/format'
import { t } from '@/lib/i18n'
import type { ChatItem } from './usePeer'

/**
 * Прямое соединение двух компьютеров без единого сервера.
 *
 * Обычно двум машинам нужен посредник, чтобы обменяться описанием связи.
 * Здесь посредника нет: описание превращается в текстовый код, который человек
 * отправляет собеседнику сам — в мессенджере, почтой, голосом. Собеседник
 * вставляет его и присылает ответный код. После этого связь прямая.
 *
 * Работает всегда, когда работает сеть. Но только для двоих: на восьмерых
 * пришлось бы обменяться пятьюдесятью шестью кодами руками.
 */

const CHUNK = 16 * 1024          // для сырого канала берём вдвое меньше: буфер жёстче
const STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type Phase = 'idle' | 'madeOffer' | 'madeAnswer' | 'connecting' | 'live' | 'failed'

const rid = () => Math.random().toString(36).slice(2, 6)
const MARK = 'SD1'

/**
 * Описание связи — это несколько килобайт очень однообразного текста.
 * Сжатие уменьшает его в четыре-пять раз, поэтому код влезает в одно сообщение.
 */
async function squeeze(s: string): Promise<string> {
  const stream = new Blob([new TextEncoder().encode(s)]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'))
  return MARK + toB64(await new Response(stream).arrayBuffer())
}
async function expand(s: string): Promise<string> {
  const stream = new Blob([new Uint8Array(fromB64(s))]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

/** Выбрасываем то, что всё равно не пригодится: занимает место, пользы ноль. */
function slimSdp(sdp: string): string {
  return sdp.split(/\r?\n/).filter((l) => {
    if (l.startsWith('a=candidate:')) {
      if (/ tcptype /.test(l)) return false          // резервные пути по tcp почти не используются
      if (/ typ relay /.test(l)) return false        // ретрансляторов у нас нет
    }
    return l.length > 0
  }).join('\r\n') + '\r\n'
}

const pack = (o: unknown) => squeeze(JSON.stringify(o))

async function unpack<T>(s: string): Promise<T | null> {
  // Мессенджеры переносят длинные строки и добавляют пробелы — вычищаем всё лишнее
  const clean = s.replace(/\s+/g, '')
  try {
    if (clean.startsWith(MARK)) return JSON.parse(await expand(clean.slice(MARK.length))) as T
    return JSON.parse(decodeURIComponent(escape(atob(clean)))) as T   // старый несжатый формат
  } catch { return null }
}

export function useDirect() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [code, setCode] = useState('')            // код для передачи собеседнику
  const [chat, setChat] = useState<ChatItem[]>([])
  const [remote, setRemote] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pc = useRef<RTCPeerConnection | null>(null)
  const dc = useRef<RTCDataChannel | null>(null)
  const local = useRef<MediaStream | null>(null)
  const key = useRef<CryptoKey | null>(null)
  const incoming = useRef(new Map<string, { name: string; size: number; parts: ArrayBuffer[]; got: number }>())

  const push = (i: ChatItem) => setChat((c) => [...c.slice(-80), i])

  /** Ждём, пока браузер соберёт все возможные пути до собеседника. */
  const gathered = (p: RTCPeerConnection) => new Promise<void>((done) => {
    if (p.iceGatheringState === 'complete') return done()
    const check = () => { if (p.iceGatheringState === 'complete') { p.removeEventListener('icegatheringstatechange', check); done() } }
    p.addEventListener('icegatheringstatechange', check)
    setTimeout(done, 3500)   // дольше ждать бессмысленно, хватит найденного
  })

  const handle = useCallback(async (raw: any) => {
    const k = key.current
    if (!k) return
    if (raw?.t === 'enc') {
      const obj = await unseal<any>(k, unpackSealed(raw))
      if (!obj) return
      if (obj.t === 'text') return push({ kind: 'text', id: rid(), from: 'peer', text: obj.text, at: Date.now(), mine: false })
      if (obj.t === 'file:start') {
        incoming.current.set(obj.id, { name: obj.name, size: obj.size, parts: [], got: 0 })
        return push({ kind: 'file', id: obj.id, from: 'peer', name: obj.name, size: obj.size, progress: 0, mine: false })
      }
      return
    }
    if (raw?.t === 'chunk') {
      const f = incoming.current.get(raw.id)
      const buf = await unsealBin(k, unpackSealed(raw))
      if (!f || !buf) return
      f.parts.push(buf); f.got += buf.byteLength
      const p = f.got / f.size
      setChat((cs) => cs.map((i) => (i.id === raw.id && i.kind === 'file' ? { ...i, progress: p } : i)))
      if (f.got >= f.size) {
        const url = URL.createObjectURL(new Blob(f.parts))
        setChat((cs) => cs.map((i) => (i.id === raw.id && i.kind === 'file' ? { ...i, progress: 1, url } : i)))
        incoming.current.delete(raw.id)
      }
    }
  }, [])

  const bindChannel = useCallback((channel: RTCDataChannel) => {
    dc.current = channel
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => { setPhase('live'); setError(null) }
    channel.onclose = () => setPhase('failed')
    channel.onmessage = (e) => {
      try { handle(JSON.parse(e.data)) } catch { /* мусор игнорируем */ }
    }
  }, [handle])

  const makePc = useCallback(async (password: string) => {
    key.current = await deriveKey(password, 'direct')
    const p = new RTCPeerConnection({ iceServers: STUN })
    pc.current = p
    p.onconnectionstatechange = () => {
      if (p.connectionState === 'failed' || p.connectionState === 'disconnected') {
        setPhase('failed'); setError(t('directFailed'))
      }
    }
    p.ontrack = (e) => setRemote(e.streams[0])
    try {
      local.current = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: true })
      local.current.getTracks().forEach((tr) => p.addTrack(tr, local.current!))
    } catch { /* без камеры — только чат и файлы */ }
    return p
  }, [])

  /** Первый участник: создаёт код приглашения. */
  const createOffer = useCallback(async (password: string) => {
    setError(null)
    const p = await makePc(password)
    bindChannel(p.createDataChannel('snapdock', { ordered: true }))
    await p.setLocalDescription(await p.createOffer())
    await gathered(p)
    setCode(await pack({ v: 1, sdp: slimSdp(p.localDescription!.sdp), type: 'offer' }))
    setPhase('madeOffer')
  }, [makePc, bindChannel])

  /** Второй участник: вставляет чужой код, получает свой ответный. */
  const acceptOffer = useCallback(async (password: string, offer: string) => {
    setError(null)
    const o = await unpack<{ sdp: string; type: string }>(offer)
    if (!o?.sdp) { setError(t('badCode')); return }
    if (o.type !== 'offer') { setError(t('wrongHalf')); return }
    try {
      const p = await makePc(password)
      p.ondatachannel = (e) => bindChannel(e.channel)
      await p.setRemoteDescription({ type: 'offer', sdp: o.sdp })
      await p.setLocalDescription(await p.createAnswer())
      await gathered(p)
      setCode(await pack({ v: 1, sdp: slimSdp(p.localDescription!.sdp), type: 'answer' }))
      setPhase('madeAnswer')
    } catch (err: any) {
      setPhase('failed')
      setError(`${t('directFailed')} ${String(err?.message ?? err)}`)
    }
  }, [makePc, bindChannel])

  /** Первый участник: вставляет ответный код — и связь установлена. */
  const acceptAnswer = useCallback(async (answer: string) => {
    const a = await unpack<{ sdp: string; type: string }>(answer)
    if (!a?.sdp) { setError(t('badCode')); return }
    if (a.type !== 'answer') { setError(t('wrongHalf')); return }
    if (!pc.current) { setError(t('badCode')); return }
    try {
      setError(null)
      setPhase('connecting')
      await pc.current.setRemoteDescription({ type: 'answer', sdp: a.sdp })
      // Канал открывается не мгновенно. Если за двадцать секунд не открылся — это отказ.
      setTimeout(() => {
        if (dc.current?.readyState !== 'open') { setPhase('failed'); setError(t('directFailed')) }
      }, 20000)
    } catch (err: any) {
      setPhase('failed')
      setError(`${t('directFailed')} ${String(err?.message ?? err)}`)
    }
  }, [])

  const hangUp = useCallback(() => {
    dc.current?.close(); dc.current = null
    local.current?.getTracks().forEach((tr) => tr.stop()); local.current = null
    pc.current?.close(); pc.current = null
    key.current = null
    setPhase('idle'); setCode(''); setChat([]); setRemote(null); setError(null)
  }, [])

  const send = useCallback(async (text: string) => {
    const k = key.current, c = dc.current
    if (!k || !c || c.readyState !== 'open' || !text.trim()) return
    c.send(JSON.stringify({ t: 'enc', ...packSealed(await seal(k, { t: 'text', text })) }))
    push({ kind: 'text', id: rid(), from: 'me', text, at: Date.now(), mine: true })
  }, [])

  const sendFile = useCallback(async (file: File) => {
    const k = key.current, c = dc.current
    if (!k || !c || c.readyState !== 'open') return
    const id = rid() + rid()
    c.send(JSON.stringify({ t: 'enc', ...packSealed(await seal(k, { t: 'file:start', id, name: file.name, size: file.size })) }))
    push({ kind: 'file', id, from: 'me', name: file.name, size: file.size, progress: 0, mine: true })

    const buf = await file.arrayBuffer()
    for (let off = 0; off < buf.byteLength; off += CHUNK) {
      // Канал переполнять нельзя — иначе он молча рвётся на больших файлах
      while (c.bufferedAmount > 1 << 20) await new Promise((r) => setTimeout(r, 30))
      const packet = packSealed(await sealBin(k, buf.slice(off, off + CHUNK)))
      c.send(JSON.stringify({ t: 'chunk', id, ...packet }))
      const p = Math.min(1, (off + CHUNK) / buf.byteLength)
      setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: p } : i)))
    }
  }, [])

  return {
    phase, code, chat, remote, error, localStream: local,
    createOffer, acceptOffer, acceptAnswer, hangUp, send, sendFile, label: bytes,
  }
}
