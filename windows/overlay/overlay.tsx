import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import '../../src/index.css'
import { initLang, setLang, t } from '../../src/lib/i18n'

type Shot = { dataUrl: string; width: number; height: number; scale: number }
type Rect = { x: number; y: number; w: number; h: number }

const MAG = 2          // увеличение лупы
const MAG_SIZE = 132   // сторона окошка лупы в CSS-пикселях

function Overlay() {
  const [shot, setShot] = useState<Shot | null>(null)
  const [pt, setPt] = useState({ x: 0, y: 0 })
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const mag = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    window.snap?.onOverlayImage((s: Shot) => {
      const i = new Image()
      i.onload = () => { img.current = i; setShot(s) }
      i.src = s.dataUrl
    })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.snap?.overlayDone(null)
      if (e.key === 'Enter' && rect) window.snap?.overlayDone(rect)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [rect])

  /* лупа: рисуем кусок оригинала вокруг курсора в масштабе x2 */
  useEffect(() => {
    const c = mag.current, i = img.current, s = shot
    if (!c || !i || !s) return
    const ctx = c.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    c.width = MAG_SIZE * dpr; c.height = MAG_SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.imageSmoothingEnabled = false

    const src = MAG_SIZE / MAG                     // сколько CSS-пикселей экрана попадает в лупу
    const sx = (pt.x - src / 2) * s.scale
    const sy = (pt.y - src / 2) * s.scale
    ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE)
    ctx.drawImage(i, sx, sy, src * s.scale, src * s.scale, 0, 0, MAG_SIZE, MAG_SIZE)

    ctx.strokeStyle = 'rgba(255,255,255,.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(MAG_SIZE / 2, 0); ctx.lineTo(MAG_SIZE / 2, MAG_SIZE)
    ctx.moveTo(0, MAG_SIZE / 2); ctx.lineTo(MAG_SIZE, MAG_SIZE / 2)
    ctx.stroke()
    ctx.strokeStyle = 'rgba(0,0,0,.45)'
    ctx.strokeRect(MAG_SIZE / 2 - MAG, MAG_SIZE / 2 - MAG, MAG * 2, MAG * 2)
  }, [pt, shot])

  if (!shot) return null

  const flipX = pt.x > window.innerWidth - MAG_SIZE - 40
  const flipY = pt.y > window.innerHeight - MAG_SIZE - 70

  return (
    <div
      className="fixed inset-0"
      style={{ backgroundImage: `url(${shot.dataUrl})`, backgroundSize: 'cover', cursor: 'none' }}
      onPointerMove={(e) => {
        setPt({ x: e.clientX, y: e.clientY })
        if (start) setRect({
          x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY),
          w: Math.abs(e.clientX - start.x), h: Math.abs(e.clientY - start.y),
        })
      }}
      onPointerDown={(e) => { setStart({ x: e.clientX, y: e.clientY }); setRect(null) }}
      onPointerUp={() => { setStart(null); if (rect && rect.w > 2 && rect.h > 2) window.snap?.overlayDone(rect) }}
      onContextMenu={(e) => { e.preventDefault(); window.snap?.overlayDone(null) }}
    >
      {/* затемнение с вырезом */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <mask id="hole">
            <rect width="100%" height="100%" fill="white" />
            {rect && <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.42)" mask="url(#hole)" />
        {rect && (
          <>
            <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h}
                  fill="none" stroke="#fff" strokeWidth="1.5" />
            {[[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]]
              .map(([cx, cy], k) => <circle key={k} cx={cx} cy={cy} r="3.5" fill="#fff" />)}
          </>
        )}
        {/* направляющие */}
        <line x1={pt.x} y1="0" x2={pt.x} y2="100%" stroke="rgba(255,255,255,.35)" strokeWidth="1" />
        <line x1="0" y1={pt.y} x2="100%" y2={pt.y} stroke="rgba(255,255,255,.35)" strokeWidth="1" />
      </svg>

      {/* лупа + размер */}
      <div
        className="pointer-events-none absolute"
        style={{
          left: flipX ? pt.x - MAG_SIZE - 20 : pt.x + 20,
          top: flipY ? pt.y - MAG_SIZE - 44 : pt.y + 20,
        }}
      >
        <canvas ref={mag} width={MAG_SIZE} height={MAG_SIZE}
                className="rounded-[14px]"
                style={{ width: MAG_SIZE, height: MAG_SIZE, boxShadow: '0 8px 32px rgba(0,0,0,.4)', border: '1px solid rgba(255,255,255,.45)' }} />
        <div className="mt-1.5 rounded-[9px] px-2 py-1 text-center text-[11px] font-medium tabular-nums text-white"
             style={{ background: 'rgba(0,0,0,.62)', backdropFilter: 'blur(12px)' }}>
          {rect ? `${Math.round(rect.w)} × ${Math.round(rect.h)}` : `${Math.round(pt.x)}, ${Math.round(pt.y)}`}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-6 text-center text-[12px] text-white/85">
        {t('overlayHint')}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Overlay />)
