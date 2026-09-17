import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

/**
 * Настройки связи: адреса служб, которые помогают компьютерам найти друг друга.
 *
 * STUN — подсказывает компьютеру его внешний адрес. Бесплатные общедоступные.
 * TURN — ретранслятор. Оба компьютера подключаются к нему исходящим соединением
 *        со своей стороны, поэтому не нужны ни открытые порты, ни настройки
 *        роутера, ни разрешения брандмауэра. Если прямой путь оборвался,
 *        разговор продолжается через ретранслятор и не прерывается.
 *        Ретранслятор перекладывает зашифрованные байты и прочитать их не может.
 */

export type Ice = { urls: string; username?: string; credential?: string }
export type Settings = {
  ice: Ice[]
  peerHost?: string        // свой сервер знакомства вместо общего
  peerPort?: number
  peerPath?: string
  peerSecure?: boolean
  roomUrl?: string         // адрес своего сервера комнат
  nick?: string
  lastRoom?: string
  lastPass?: string
}

const DEFAULTS: Settings = {
  ice: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
}

function file() { return join(app.getPath('userData'), 'settings.json') }

let cache: Settings | null = null

export function getSettings(): Settings {
  if (cache) return cache
  try {
    const raw = JSON.parse(readFileSync(file(), 'utf8'))
    cache = { ...DEFAULTS, ...raw, ice: Array.isArray(raw.ice) && raw.ice.length ? raw.ice : DEFAULTS.ice }
  } catch { cache = { ...DEFAULTS } }
  return cache!
}

export function saveSettings(next: Partial<Settings>): Settings {
  const merged = { ...getSettings(), ...next }
  cache = merged
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(merged, null, 2), 'utf8')
  } catch { /* не записалось — работаем на том, что в памяти */ }
  return merged
}

/**
 * Разбирает строку вида
 *   turn:my.server.ru:3478?user=snapdock&pass=секрет
 * или несколько строк подряд. Так человеку проще, чем заполнять три поля.
 */
export function parseIce(text: string): Ice[] {
  const out: Ice[] = []
  for (const line of text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
    const [addr, query] = line.split('?')
    if (!/^(stun|turn|turns):/i.test(addr)) continue
    const p = new URLSearchParams(query ?? '')
    const user = p.get('user') ?? p.get('username') ?? undefined
    const pass = p.get('pass') ?? p.get('credential') ?? undefined
    out.push(user ? { urls: addr, username: user, credential: pass } : { urls: addr })
  }
  return out
}

export function iceToText(ice: Ice[]): string {
  return ice.map((s) => s.username
    ? `${s.urls}?user=${s.username}&pass=${s.credential ?? ''}`
    : s.urls).join('\n')
}
