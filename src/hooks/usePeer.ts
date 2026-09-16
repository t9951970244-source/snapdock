import { useCallback, useEffect, useRef, useState } from 'react'
import Peer, { DataConnection, MediaConnection } from 'peerjs'
import { bytes } from '@/lib/format'
import { t } from '@/lib/i18n'
import {
  deriveKey, seal, unseal, sealBin, unsealBin, nonce, sameBytes, suggestPassword, type Sealed,
} from '@/lib/crypto'

const CHUNK = 32 * 1024          // 32 KiB — ниже порога фрагментации SCTP
export const MAX_PEERS = 8       // предел прямой связи каждый-с-каждым

/** Чем больше людей, тем меньше кадр: 8 участников — это 56 потоков сразу. */
function videoProfile(n: number) {
  if (n <= 2) return { width: 640, height: 480, frameRate: 30 }
  if (n <= 4) return { width: 480, height: 360, frameRate: 24 }
  if (n <= 6) return { width: 320, height: 240, frameRate: 20 }
  return { width: 240, height: 180, frameRate: 15 }
}

export type ChatItem =
  | { kind: 'text'; id: string; from: string; text: string; at: number; mine: boolean }
  | { kind: 'file'; id: string; from: string; name: string; size: number; url?: string; progress: number; mine: boolean }

export type Member = { id: string; stream?: MediaStream; muted: boolean }

const rid = () => Math.random().toString(36).slice(2, 6)

/* Открытым текстом по сети идут только эти служебные конверты. */
type Wire =
  | { t: 'hello'; n: ArrayBuffer }
  | { t: 'proof'; iv: ArrayBuffer; ct: ArrayBuffer }
  | { t: 'bad' }
  | { t: 'enc'; iv: ArrayBuffer; ct: ArrayBuffer }
  | { t: 'chunk'; id: string; iv: ArrayBuffer; ct: ArrayBuffer }

export function usePeer() {
  const [room, setRoom] = useState<string | null>(null)
  const [pass, setPass] = useState<string>('')
  const [me, setMe] = useState<string>('')
  const [members, setMembers] = useState<Member[]>([])
  const [chat, setChat] = useState<ChatItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'signaling' | 'waiting' | 'live' | 'failed'>('idle')
  const openTimer = useRef<number>(0)

  const peer = useRef<Peer | null>(null)
  const conns = useRef(new Map<string, DataConnection>())
  const calls = useRef(new Map<string, MediaConnection>())
  const local = useRef<MediaStream | null>(null)
  const incoming = useRef(new Map<string, { name: string; size: number; parts: ArrayBuffer[]; got: number }>())

  const key = useRef<CryptoKey | null>(null)
  const challenge = useRef(new Map<string, Uint8Array>())   // кому какой вопрос задали
  const ok = useRef(new Set<string>())                      // кто ответил верно
  const roomRef = useRef<string>('')
  const isHostRef = useRef(false)

  const push = (i: ChatItem) => setChat((c) => [...c.slice(-80), i])

  /** Любая полезная нагрузка уходит только в зашифрованном конверте. */
  const sendTo = useCallback(async (c: DataConnection, obj: unknown) => {
    if (!key.current) return
    c.send({ t: 'enc', ...(await seal(key.current, obj)) } as Wire)
  }, [])
  const sendAll = useCallback(async (obj: unknown) => {
    for (const [id, c] of conns.current) if (ok.current.has(id)) await sendTo(c, obj)
  }, [sendTo])

  const connectRef = useRef<(id: string) => void>(() => {})

  const handlePlain = useCallback(async (from: string, raw: any) => {
    if (raw?.t === 'roster') {
      for (const id of raw.ids as string[]) if (id !== peer.current?.id) connectRef.current(id)
      return
    }
    if (raw?.t === 'text') {
      return push({ kind: 'text', id: rid(), from, text: String(raw.text).slice(0, 4000), at: Date.now(), mine: false })
    }
    if (raw?.t === 'file:start') {
      incoming.current.set(raw.id, { name: raw.name, size: raw.size, parts: [], got: 0 })
      return push({ kind: 'file', id: raw.id, from, name: raw.name, size: raw.size, progress: 0, mine: false })
    }
  }, [])

  /** Участник подтвердил пароль: пускаем в список, отдаём ему связи и видео. */
  const promote = useCallback((c: DataConnection) => {
    ok.current.add(c.peer)
    setStatus('live')
    setMembers((m) => (m.some((x) => x.id === c.peer) ? m : [...m, { id: c.peer, muted: false }]))
    if (isHostRef.current) sendTo(c, { t: 'roster', ids: [...ok.current, peer.current?.id].filter(Boolean) })
    const ring = (attempt = 0) => {
      if (!local.current || !peer.current) return
      const call = peer.current.call(c.peer, local.current)
      calls.current.set(c.peer, call)
      let got = false
      call.on('stream', (s) => {
        got = true
        setMembers((m) => m.map((x) => (x.id === c.peer ? { ...x, stream: s } : x)))
      })
      // Вторая попытка через полторы секунды: к этому моменту нас точно проверили
      if (attempt < 2) setTimeout(() => { if (!got) ring(attempt + 1) }, 1500)
    }
    if (!calls.current.has(c.peer)) ring()
  }, [sendTo])

  const wire = useCallback((c: DataConnection) => {
    conns.current.set(c.peer, c)

    // Здороваемся загадкой: собеседник обязан зашифровать наше случайное число
    const n = nonce()
    challenge.current.set(c.peer, n)
    c.send({ t: 'hello', n: n.buffer } as Wire)

    c.on('data', async (msg: any) => {
      const k = key.current
      if (!k) return

      if (msg?.t === 'hello') {
        c.send({ t: 'proof', ...(await sealBin(k, msg.n)) } as Wire)
        return
      }
      if (msg?.t === 'proof') {
        const mine = challenge.current.get(c.peer)
        const plain = await unsealBin(k, msg as Sealed)
        if (!mine || !plain || !sameBytes(plain, mine.buffer as ArrayBuffer)) {
          c.send({ t: 'bad' } as Wire)     // пароль не сошёлся
          setError(t('wrongPass'))
          c.close()
          return
        }
        challenge.current.delete(c.peer)
        promote(c)
        return
      }
      if (msg?.t === 'bad') { setError(t('wrongPass')); c.close(); return }

      if (!ok.current.has(c.peer)) return   // до проверки не слушаем ничего

      if (msg?.t === 'enc') {
        const obj = await unseal<any>(k, msg as Sealed)
        if (obj) handlePlain(c.peer, obj)
        return
      }
      if (msg?.t === 'chunk') {
        const f = incoming.current.get(msg.id)
        const buf = await unsealBin(k, msg as Sealed)
        if (!f || !buf) return
        f.parts.push(buf); f.got += buf.byteLength
        const p = f.got / f.size
        setChat((cs) => cs.map((i) => (i.id === msg.id && i.kind === 'file' ? { ...i, progress: p } : i)))
        if (f.got >= f.size) {
          const url = URL.createObjectURL(new Blob(f.parts))
          setChat((cs) => cs.map((i) => (i.id === msg.id && i.kind === 'file' ? { ...i, progress: 1, url } : i)))
          incoming.current.delete(msg.id)
        }
      }
    })

    c.on('close', () => {
      conns.current.delete(c.peer)
      ok.current.delete(c.peer)
      challenge.current.delete(c.peer)
      setMembers((m) => {
        const left = m.filter((x) => x.id !== c.peer)
        if (!left.length) setStatus('waiting')
        return left
      })
    })
  }, [handlePlain, promote])

  const connect = useCallback((id: string) => {
    if (!peer.current || conns.current.size >= MAX_PEERS || conns.current.has(id)) return
    const c = peer.current.connect(id, { reliable: true })
    c.on('open', () => wire(c))
    // видео ставим только после проверки пароля — см. promote()
  }, [wire])
  connectRef.current = connect

  const join = useCallback(async (code: string | undefined, password: string) => {
    const name = code?.trim() || `snapdock-${rid()}${rid()}`
    const pw = password.trim()
    if (!pw) { setError(t('needPass')); return null }

    roomRef.current = name
    setStatus('signaling')
    key.current = await deriveKey(pw, name)
    setRoom(name); setPass(pw); setError(null)

    try {
      local.current = await navigator.mediaDevices.getUserMedia({ video: videoProfile(1), audio: true })
    } catch { local.current = null }   // без камеры — только чат и файлы

    const boot = (id: string, isHost: boolean) => {
      isHostRef.current = isHost
      const p = new Peer(id, { debug: 0 })
      peer.current = p
      p.on('open', (own) => {
        clearTimeout(openTimer.current)
        setMe(own)
        setStatus(isHost ? 'waiting' : 'signaling')
        if (!isHost) connect(`${name}-host`)
      })
      // Бесплатный брокер PeerJS бывает недоступен. Молчание — тоже ответ, но его надо показать.
      clearTimeout(openTimer.current)
      openTimer.current = window.setTimeout(() => {
        if (status !== 'live') { setStatus('failed'); setError(t('noBroker')) }
      }, 15000)
      p.on('connection', (c) => {
        if (conns.current.size >= MAX_PEERS) { c.close(); return }
        c.on('open', () => wire(c))
      })
      p.on('call', (call) => {
        if (!ok.current.has(call.peer)) { call.close(); return }   // чужих в эфир не пускаем
        if (local.current) call.answer(local.current)
        calls.current.set(call.peer, call)
        call.on('stream', (s) => setMembers((m) =>
          m.some((x) => x.id === call.peer)
            ? m.map((x) => (x.id === call.peer ? { ...x, stream: s } : x))
            : [...m, { id: call.peer, stream: s, muted: false }]))
      })
      p.on('error', (e: any) => {
        if (isHost && e.type === 'unavailable-id') { p.destroy(); boot(`${name}-${rid()}${rid()}`, false); return }
        if (e.type === 'peer-unavailable') {
          // Хозяин комнаты не отвечает: либо код с опечаткой, либо все вышли
          setStatus('failed'); setError(t('noRoom')); return
        }
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') {
          setStatus('failed'); setError(t('noBroker')); return
        }
        setError(t('lostLink'))
      })
    }
    boot(`${name}-host`, true)   // первый занимает -host, остальные падают в гости
    return name
  }, [connect, wire])

  const leave = useCallback(() => {
    conns.current.forEach((c) => c.close()); conns.current.clear()
    calls.current.forEach((c) => c.close()); calls.current.clear()
    local.current?.getTracks().forEach((tr) => tr.stop()); local.current = null
    peer.current?.destroy(); peer.current = null
    key.current = null
    ok.current.clear(); challenge.current.clear()
    clearTimeout(openTimer.current)
    setMembers([]); setChat([]); setRoom(null); setPass(''); setMe(''); setError(null); setStatus('idle')
  }, [])

  const send = useCallback((text: string) => {
    if (!text.trim()) return
    sendAll({ t: 'text', text })
    push({ kind: 'text', id: rid(), from: 'me', text, at: Date.now(), mine: true })
  }, [sendAll])

  const sendFile = useCallback(async (file: File) => {
    const k = key.current
    if (!k) return
    const id = rid() + rid()
    await sendAll({ t: 'file:start', id, name: file.name, size: file.size })
    push({ kind: 'file', id, from: 'me', name: file.name, size: file.size, progress: 0, mine: true })

    const buf = await file.arrayBuffer()
    for (let off = 0; off < buf.byteLength; off += CHUNK) {
      const packet = await sealBin(k, buf.slice(off, off + CHUNK))
      for (const [pid, c] of conns.current) if (ok.current.has(pid)) c.send({ t: 'chunk', id, ...packet } as Wire)
      const p = Math.min(1, (off + CHUNK) / buf.byteLength)
      setChat((cs) => cs.map((i) => (i.id === id && i.kind === 'file' ? { ...i, progress: p } : i)))
      if ((off / CHUNK) % 8 === 7) await new Promise((r) => setTimeout(r, 0))   // не душим поток
    }
  }, [sendAll])

  useEffect(() => leave, [leave])

  return {
    room, pass, me, members, chat, error, status,
    localStream: local, join, leave, send, sendFile,
    suggestPassword, label: bytes,
  }
}
