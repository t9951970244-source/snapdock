/**
 * Доминанта обложки для ambient-подсветки стекла.
 * Считаем по сетке 16x16 с отбросом серого и пересветов — иначе чёрные обложки
 * дают грязно-серый ореол. Возвращаем «RR GG BB» под CSS-переменную.
 */
export function dominantColor(img: HTMLImageElement | HTMLCanvasElement): string {
  const N = 16
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  try { ctx.drawImage(img as CanvasImageSource, 0, 0, N, N) } catch { return '255 255 255' }
  const { data } = ctx.getImageData(0, 0, N, N)

  let br = 0, bg = 0, bb = 0, best = -1
  let ar = 0, ag = 0, ab = 0, n = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const lum = (max + min) / 2
    if (lum < 18 || lum > 244) continue
    const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255))
    const score = sat * 1.4 + (1 - Math.abs(lum - 150) / 150) * 0.6
    if (score > best) { best = score; br = r; bg = g; bb = b }
    ar += r; ag += g; ab += b; n++
  }
  if (best < 0) return n ? `${(ar / n) | 0} ${(ag / n) | 0} ${(ab / n) | 0}` : '255 255 255'

  // подтягиваем светлоту в зону, где цвет читается и на светлом, и на тёмном стекле
  const f = 190 / Math.max(60, (br + bg + bb) / 3)
  const fix = (v: number) => Math.round(Math.max(0, Math.min(255, v * f)))
  return `${fix(br)} ${fix(bg)} ${fix(bb)}`
}

export function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}
