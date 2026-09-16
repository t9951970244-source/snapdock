/**
 * Шифрование комнаты.
 *
 * Пароль по сети не ходит ни в каком виде. Из него выводится ключ AES-GCM,
 * и всё — сообщения, имена файлов, куски файлов — шифруется до отправки.
 * Подслушивающий видит только случайные байты, а посторонний, узнавший код
 * комнаты, не проходит проверку и отсекается до того, как получит видео.
 *
 * Соль привязана к коду комнаты: одинаковый пароль в разных комнатах даёт
 * разные ключи, поэтому подобранный однажды ключ не подходит к другой комнате.
 */

export type Sealed = { iv: ArrayBuffer; ct: ArrayBuffer }

const enc = new TextEncoder()
const dec = new TextDecoder()

export async function deriveKey(password: string, room: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(`snapdock|${room}`),
      iterations: 150_000,          // ощутимо тормозит перебор, но у нас разовая операция
      hash: 'SHA-256',
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encrypt(key: CryptoKey, data: BufferSource): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { iv: iv.buffer, ct }
}

/** Вернёт null, если пароль не тот: GCM сам ловит подмену и битые данные. */
async function decrypt(key: CryptoKey, s: Sealed): Promise<ArrayBuffer | null> {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(s.iv) }, key, s.ct)
  } catch { return null }
}

export const sealBin = (key: CryptoKey, buf: ArrayBuffer) => encrypt(key, buf)
export const unsealBin = (key: CryptoKey, s: Sealed) => decrypt(key, s)

export const seal = (key: CryptoKey, obj: unknown) => encrypt(key, enc.encode(JSON.stringify(obj)))

export async function unseal<T>(key: CryptoKey, s: Sealed): Promise<T | null> {
  const buf = await decrypt(key, s)
  if (!buf) return null
  try { return JSON.parse(dec.decode(buf)) as T } catch { return null }
}

export const nonce = () => crypto.getRandomValues(new Uint8Array(16))

/** Сырой канал передаёт текст, поэтому байты кодируем в base64. */
export function toB64(b: ArrayBuffer): string {
  const u = new Uint8Array(b)
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromB64(s: string): ArrayBuffer {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u.buffer
}
export const packSealed = (s: Sealed) => ({ iv: toB64(s.iv), ct: toB64(s.ct) })
export const unpackSealed = (o: { iv: string; ct: string }): Sealed => ({ iv: fromB64(o.iv), ct: fromB64(o.ct) })

/** Сравнение без ранних выходов — чтобы по времени ответа нельзя было подбирать. */
export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const x = new Uint8Array(a), y = new Uint8Array(b)
  if (x.length !== y.length) return false
  let diff = 0
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]
  return diff === 0
}

/** Читаемый пароль: без похожих символов, чтобы диктовать голосом. */
export function suggestPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789'
  const r = crypto.getRandomValues(new Uint8Array(10))
  return Array.from(r, (v) => abc[v % abc.length]).join('').replace(/(.{5})/, '$1-')
}
