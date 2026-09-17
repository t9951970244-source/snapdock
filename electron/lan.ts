import dgram from 'node:dgram'
import net from 'node:net'
import os from 'node:os'
import { randomBytes } from 'node:crypto'

/**
 * Поиск соседей в домашней сети.
 *
 * Если оба компьютера подключены к одному роутеру, посредник им не нужен вовсе:
 * каждый экземпляр каждые две секунды кричит в локальную сеть «я здесь», а
 * остальные слушают и составляют список. Дальше описание связи уходит напрямую
 * по обычному соединению между двумя машинами — ни сервера, ни кодов руками.
 *
 * За пределы роутера ничего не уходит: широковещательные пакеты им не
 * пропускаются по самому устройству сети.
 */

const PORT = 41234
const MAGIC = 'SNAPDOCK-LAN-1'
const EVERY = 2000          // как часто объявляем о себе
const FORGET = 7000         // через сколько считаем соседа ушедшим

export type LanPeer = { id: string; name: string; host: string; port: number; seen: number }

const myId = randomBytes(8).toString('hex')
const myName = os.hostname().replace(/\.local$/i, '')
let tcpPort = 0

let udp: dgram.Socket | null = null
let beat: NodeJS.Timeout | null = null
const peers = new Map<string, LanPeer>()

/* Входящие приглашения ждут ответа от окна — держим их по метке. */
const waiting = new Map<string, net.Socket>()
let onOffer: ((token: string, offer: string, from: string, fromId: string) => void) | null = null

function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      // вычисляем широковещательный адрес подсети: так надёжнее общего 255.255.255.255
      const ip = ni.address.split('.').map(Number)
      const mask = ni.netmask.split('.').map(Number)
      out.add(ip.map((v, i) => (v & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return [...out]
}

/** Приём описания связи от соседа и отправка ответа обратно. */
function startServer(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      let buf = ''
      sock.setEncoding('utf8')
      sock.on('data', (chunk: string) => {
        buf += chunk
        const i = buf.indexOf('\n')
        if (i < 0) return
        try {
          const msg = JSON.parse(buf.slice(0, i))
          if (msg?.t !== 'offer' || !msg.offer) { sock.end(); return }
          const token = randomBytes(6).toString('hex')
          waiting.set(token, sock)
          onOffer?.(token, msg.offer, String(msg.name ?? '—'), String(msg.id ?? ''))
          setTimeout(() => {                     // окно не ответило — не держим соединение
            if (waiting.delete(token)) sock.end()
          }, 45000)
        } catch { sock.end() }
      })
      sock.on('error', () => {})
    })
    srv.listen(0, '0.0.0.0', () => resolve((srv.address() as net.AddressInfo).port))
  })
}

export async function lanStart(handler: (token: string, offer: string, from: string, fromId: string) => void) {
  if (udp) return { id: myId, name: myName }
  onOffer = handler
  tcpPort = await startServer()

  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  udp.on('message', (raw, rinfo) => {
    try {
      const m = JSON.parse(raw.toString())
      if (m?.magic !== MAGIC || m.id === myId) return
      peers.set(m.id, { id: m.id, name: String(m.name).slice(0, 40), host: rinfo.address, port: m.port, seen: Date.now() })
    } catch { /* чужой пакет */ }
  })
  udp.on('error', () => { udp?.close(); udp = null })
  udp.bind(PORT, () => {
    udp!.setBroadcast(true)
    const hello = () => {
      const packet = Buffer.from(JSON.stringify({ magic: MAGIC, id: myId, name: myName, port: tcpPort }))
      for (const addr of broadcastAddresses()) udp?.send(packet, PORT, addr, () => {})
      for (const [id, p] of peers) if (Date.now() - p.seen > FORGET) peers.delete(id)
    }
    hello()
    beat = setInterval(hello, EVERY)
  })

  return { id: myId, name: myName }
}

export function lanPeers(): LanPeer[] {
  const now = Date.now()
  return [...peers.values()].filter((p) => now - p.seen <= FORGET).sort((a, b) => a.name.localeCompare(b.name))
}

/** Отправляем соседу приглашение и ждём его ответ. */
export function lanInvite(peerId: string, offer: string): Promise<string | null> {
  const p = peers.get(peerId)
  if (!p) return Promise.resolve(null)
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: p.host, port: p.port }, () => {
      sock.write(JSON.stringify({ t: 'offer', offer, name: myName, id: myId }) + '\n')
    })
    let buf = ''
    let done = false
    const finish = (v: string | null) => { if (!done) { done = true; sock.end(); resolve(v) } }
    sock.setEncoding('utf8')
    sock.on('data', (chunk: string) => {
      buf += chunk
      const i = buf.indexOf('\n')
      if (i < 0) return
      try {
        const msg = JSON.parse(buf.slice(0, i))
        finish(msg?.t === 'answer' && msg.answer ? String(msg.answer) : null)
      } catch { finish(null) }
    })
    sock.on('error', () => finish(null))
    setTimeout(() => finish(null), 45000)
  })
}

/** Окно подготовило ответ — отдаём его тому, кто позвал. */
export function lanAnswer(token: string, answer: string) {
  const sock = waiting.get(token)
  if (!sock) return false
  waiting.delete(token)
  sock.write(JSON.stringify({ t: 'answer', answer }) + '\n')
  setTimeout(() => sock.end(), 500)
  return true
}

export function lanStop() {
  if (beat) { clearInterval(beat); beat = null }
  udp?.close(); udp = null
  peers.clear()
  waiting.forEach((s) => s.end()); waiting.clear()
}
