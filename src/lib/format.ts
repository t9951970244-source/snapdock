export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v))

export function time(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function bytes(n: number) {
  if (n < 1024) return `${n} Б`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1048576).toFixed(1)} МБ`
}

/** Короткое имя процесса: «chrome.exe» -> «Chrome», «com.spotify.client» -> «Spotify». */
export function appLabel(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? raw
  const stem = base.replace(/\.(exe|app)$/i, '').split('.').pop() ?? base
  return stem.charAt(0).toUpperCase() + stem.slice(1)
}
