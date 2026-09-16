import { useEffect, useRef } from 'react'
import type { MutableRefObject } from 'react'

/**
 * 32 полосы Canvas по данным AnalyserNode. Рисуется подложкой под названием трека:
 * читаемость текста важнее эффекта, поэтому низкая прозрачность и растворение к краям.
 */
export function Equalizer({
  levels, peaks, bars = 32, height = 34, dim = 0.5,
}: {
  levels: MutableRefObject<Float32Array>
  peaks: MutableRefObject<Float32Array>
  bars?: number; height?: number; dim?: number
}) {
  const cv = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = cv.current!
    const ctx = c.getContext('2d')!
    let raf = 0

    const fit = () => {
      const dpr = window.devicePixelRatio || 1
      const w = c.clientWidth, h = c.clientHeight
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    const ro = new ResizeObserver(fit); ro.observe(c)

    const accent = () =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '255 255 255'

    const draw = () => {
      const w = c.clientWidth, h = c.clientHeight
      ctx.clearRect(0, 0, w, h)
      const a = accent()
      const gap = 2
      const bw = (w - gap * (bars - 1)) / bars

      for (let i = 0; i < bars; i++) {
        const v = levels.current[i] ?? 0
        const bh = Math.max(1.5, v * h)
        const x = i * (bw + gap)
        const y = h - bh
        // края растворяются — полоса не обрывается о стекло
        const edge = Math.min(1, Math.min(i, bars - 1 - i) / 4)
        const g = ctx.createLinearGradient(0, h, 0, y)
        g.addColorStop(0, `rgb(${a} / ${0.20 * dim * edge})`)
        g.addColorStop(1, `rgb(${a} / ${0.85 * dim * edge})`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.roundRect(x, y, bw, bh, bw / 2)
        ctx.fill()

        const p = peaks.current[i] ?? 0
        if (p > 0.05) {
          ctx.fillStyle = `rgb(${a} / ${0.55 * dim * edge})`
          ctx.beginPath()
          ctx.roundRect(x, h - p * h - 1.5, bw, 1.5, 1)
          ctx.fill()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [bars, dim, levels, peaks])

  return <canvas ref={cv} className="pointer-events-none absolute inset-x-0 bottom-0 w-full" style={{ height }} />
}
