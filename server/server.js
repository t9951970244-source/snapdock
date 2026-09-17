/**
 * SnapDock — сервер комнат.
 *
 * Одна программа, один порт. Делает три вещи:
 *   1. отдаёт веб-страницу комнаты — она открывается на любом устройстве;
 *   2. пересылает сообщения и файлы между участниками комнаты;
 *   3. помогает участникам договориться о видеосвязи.
 *
 * Ничего не хранит: всё живёт в памяти, пока люди в комнате. Вышли все —
 * комната исчезает.
 *
 * Запуск:  node server.js            (порт 8080 по умолчанию)
 *          PORT=3000 node server.js
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const { WebSocketServer } = require('ws')

const PORT = Number(process.env.PORT) || 8080
const ROOT = path.join(__dirname, 'public')

/* ---------------- Веб-страница ---------------- */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/* Ретранслятор задаётся переменной окружения и раздаётся странице. */
const ICE = (() => {
  const t = process.env.TURN          // turn:адрес:3478?user=имя&pass=секрет
  const base = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }]
  if (!t) return base
  const [addr, q] = t.split('?')
  const p = new URLSearchParams(q || '')
  return [...base, { urls: addr, username: p.get('user') || undefined, credential: p.get('pass') || undefined }]
})()

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/ice') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ICE))
    return
  }
  let file = url.pathname === '/' ? '/index.html' : url.pathname
  const full = path.join(ROOT, path.normalize(file).replace(/^(\.\.[/\\])+/, ''))
  fs.readFile(full, (err, data) => {
    if (err) {
      // Любой неизвестный путь — это код комнаты, отдаём ту же страницу
      fs.readFile(path.join(ROOT, 'index.html'), (e2, page) => {
        if (e2) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200, { 'content-type': TYPES['.html'] })
        res.end(page)
      })
      return
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' })
    res.end(data)
  })
})

/* ---------------- Комнаты ---------------- */
const wss = new WebSocketServer({ server })
const rooms = new Map()        // имя комнаты -> Set соединений

const send = (ws, obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)) }

function roster(room) {
  const set = rooms.get(room)
  if (!set) return
  const list = [...set].map((c) => ({ id: c.id, name: c.name }))
  for (const c of set) send(c, { t: 'roster', list, you: c.id })
}

function leave(ws) {
  const set = rooms.get(ws.room)
  if (!set) return
  set.delete(ws)
  if (!set.size) rooms.delete(ws.room)
  else {
    for (const c of set) send(c, { t: 'left', id: ws.id })
    roster(ws.room)
  }
}

let seq = 0

wss.on('connection', (ws) => {
  ws.id = (++seq).toString(36) + Math.random().toString(36).slice(2, 6)
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })

  ws.on('message', (raw, isBinary) => {
    /* Двоичные пакеты — куски файлов. Разбирать их не нужно, просто раздаём. */
    if (isBinary) {
      const set = rooms.get(ws.room)
      if (!set) return
      for (const c of set) if (c !== ws && c.readyState === 1) c.send(raw, { binary: true })
      return
    }

    let m
    try { m = JSON.parse(raw.toString()) } catch { return }

    if (m.t === 'join') {
      leave(ws)
      ws.room = String(m.room || 'main').slice(0, 64)
      ws.name = String(m.name || 'Гость').slice(0, 40)
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set())
      const set = rooms.get(ws.room)
      if (set.size >= 16) { send(ws, { t: 'full' }); return }
      set.add(ws)
      send(ws, { t: 'joined', id: ws.id, room: ws.room })
      roster(ws.room)
      return
    }

    const set = rooms.get(ws.room)
    if (!set) return

    /* Личное сообщение одному участнику: договор о видеосвязи. */
    if (m.t === 'signal' && m.to) {
      for (const c of set) if (c.id === m.to) send(c, { ...m, from: ws.id })
      return
    }

    /* Всё остальное видят все в комнате. */
    for (const c of set) if (c !== ws) send(c, { ...m, from: ws.id, fromName: ws.name })
  })

  ws.on('close', () => leave(ws))
  ws.on('error', () => leave(ws))
})

/* Тихие соединения отсекаем, чтобы список участников не врал. */
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { leave(ws); ws.terminate(); continue }
    ws.isAlive = false
    try { ws.ping() } catch { /* уже закрыт */ }
  }
}, 25000)

server.listen(PORT, () => {
  console.log(`SnapDock room server: http://localhost:${PORT}`)
})
