import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import '../../src/index.css'
import { prefersDark } from '../../src/lib/color'
import { initLang, setLang, t, useLang } from '../../src/lib/i18n'
import { useClipboardKeys } from '../../src/lib/clipboard'

type Tool = 'crop' | 'arrow' | 'text' | 'blur'
type Shape =
  | { t: 'arrow'; x1: number; y1: number; x2: number; y2: number; c: string }
  | { t: 'text'; x: number; y: number; v: string; c: string }
  | { t: 'blur'; x: number; y: number; w: number; h: number }

const COLORS = ['#FF3B30', '#FF9500', '#34C759', '#0A84FF', '#FFFFFF', '#1C1C1E']

function Editor() {
  const [src, setSrc] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState(COLORS[0])
  const [shapes, setShapes] = useState<Shape[]>([])
  const [draft, setDraft] = useState<Shape | null>(null)
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)

  useLang()
  useClipboardKeys()
  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    return window.snap?.onLang(setLang)
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('theme-dark', prefersDark())
    window.snap?.onEditorImage((d) => {
      const i = new Image()
      i.onload = () => { img.current = i; setShapes([]); setCrop(null); setSrc(d) }
      i.src = d
    })
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.snap?.closeEditor()
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') setShapes((s) => s.slice(0, -1))
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') copy()
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  /* отрисовка */
  useEffect(() => {
    const c = cv.current, i = img.current
    if (!c || !i) return
    c.width = i.width; c.height = i.height
    const ctx = c.getContext('2d')!
    ctx.drawImage(i, 0, 0)

    const all = draft ? [...shapes, draft] : shapes
    for (const s of all) {
      if (s.t === 'blur') {
        // копируем область через даунскейл — это и есть «пикселизация/размытие»
        const tmp = document.createElement('canvas')
        const f = 14
        tmp.width = Math.max(1, s.w / f); tmp.height = Math.max(1, s.h / f)
        tmp.getContext('2d')!.drawImage(c, s.x, s.y, s.w, s.h, 0, 0, tmp.width, tmp.height)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, s.x, s.y, s.w, s.h)
        ctx.imageSmoothingEnabled = true
      }
      if (s.t === 'arrow') {
        const head = Math.max(12, Math.hypot(s.x2 - s.x1, s.y2 - s.y1) * 0.18)
        const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1)
        ctx.strokeStyle = s.c; ctx.fillStyle = s.c
        ctx.lineWidth = Math.max(3, c.width / 400); ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(s.x1, s.y1)
        ctx.lineTo(s.x2 - Math.cos(a) * head * 0.7, s.y2 - Math.sin(a) * head * 0.7); ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(s.x2, s.y2)
        ctx.lineTo(s.x2 - Math.cos(a - 0.4) * head, s.y2 - Math.sin(a - 0.4) * head)
        ctx.lineTo(s.x2 - Math.cos(a + 0.4) * head, s.y2 - Math.sin(a + 0.4) * head)
        ctx.closePath(); ctx.fill()
      }
      if (s.t === 'text' && s.v) {
        const size = Math.max(18, c.width / 46)
        ctx.font = `600 ${size}px -apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif`
        ctx.textBaseline = 'top'
        ctx.lineWidth = size / 6; ctx.strokeStyle = 'rgba(0,0,0,.5)'
        ctx.strokeText(s.v, s.x, s.y)
        ctx.fillStyle = s.c; ctx.fillText(s.v, s.x, s.y)
      }
    }
  }, [src, shapes, draft])

  const toImage = () => {
    const c = cv.current!
    if (!crop) return c.toDataURL('image/png')
    const o = document.createElement('canvas')
    o.width = crop.w; o.height = crop.h
    o.getContext('2d')!.drawImage(c, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h)
    return o.toDataURL('image/png')
  }
  const copy = async () => { await window.snap?.copyShot(toImage()); setSaved(t('copied')); setTimeout(() => setSaved(null), 1600) }
  const save = async () => { const f = await window.snap?.saveShot(toImage()); setSaved(t('saved')); setTimeout(() => setSaved(null), 1600); if (f) window.snap?.revealShot(f) }

  const toCanvas = (e: React.PointerEvent) => {
    const r = (e.target as HTMLElement).getBoundingClientRect()
    const c = cv.current!
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  const tools: { id: Tool; label: string }[] = [
    { id: 'crop', label: t('crop') }, { id: 'arrow', label: t('arrow') },
    { id: 'text', label: t('text') }, { id: 'blur', label: t('blur') },
  ]

  return (
    <div className="surface flex h-screen w-screen flex-col gap-3 p-4 rounded-[18px]">
      <div className="glass flex items-center gap-2 rounded-[18px] px-3 py-2" style={{ color: 'rgb(var(--ink))' }}>
        {tools.map((t) => (
          <button key={t.id} onClick={() => setTool(t.id)}
            className="rounded-[11px] px-3 py-1.5 text-[12.5px] font-medium"
            style={{ background: tool === t.id ? 'rgb(var(--accent) / 0.22)' : 'rgb(var(--fill))' }}>
            {t.label}
          </button>
        ))}
        <div className="mx-1 h-5 w-px" style={{ background: 'rgb(var(--ink-3))' }} />
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} aria-label={`Цвет ${c}`}
            className="h-5 w-5 rounded-full"
            style={{ background: c, boxShadow: color === c ? '0 0 0 2px rgb(var(--ink) / .7)' : '0 0 0 1px rgb(0 0 0 /.2)' }} />
        ))}
        <div className="flex-1" />
        {saved && <span className="text-[12px]" style={{ color: 'rgb(var(--ink-2))' }}>{saved}</span>}
        <button onClick={() => setShapes((s) => s.slice(0, -1))}
                className="rounded-[11px] px-3 py-1.5 text-[12.5px]" style={{ background: 'rgb(var(--fill))' }}>{t('undo')}</button>
        <button onClick={copy} className="rounded-[11px] px-3 py-1.5 text-[12.5px] font-medium"
                style={{ background: 'rgb(var(--fill))' }}>{t('doCopy')}</button>
        <button onClick={save} className="rounded-[11px] px-3.5 py-1.5 text-[12.5px] font-semibold"
                style={{ background: 'rgb(var(--accent) / 0.28)' }}>{t('doSave')}</button>
        <button onClick={() => window.snap?.closeEditor()} className="px-2 text-[15px]" aria-label={t('close')}>✕</button>
      </div>

      <div className="glass relative flex flex-1 items-center justify-center overflow-hidden rounded-[20px] p-3">
        <div className="relative">
          <canvas ref={cv} className="max-h-[68vh] max-w-full rounded-[10px]"
            style={{ boxShadow: '0 10px 40px rgb(0 0 0 / .28)' }}
            onPointerDown={(e) => {
              const p = toCanvas(e); start.current = p
              if (tool === 'text') {
                const v = prompt(t('textPrompt'))
                if (v) setShapes((s) => [...s, { t: 'text', x: p.x, y: p.y, v, c: color }])
                start.current = null
              }
            }}
            onPointerMove={(e) => {
              if (!start.current) return
              const p = toCanvas(e); const s0 = start.current
              if (tool === 'arrow') setDraft({ t: 'arrow', x1: s0.x, y1: s0.y, x2: p.x, y2: p.y, c: color })
              if (tool === 'blur') setDraft({ t: 'blur', x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) })
              if (tool === 'crop') setCrop({ x: Math.min(s0.x, p.x), y: Math.min(s0.y, p.y), w: Math.abs(p.x - s0.x), h: Math.abs(p.y - s0.y) })
            }}
            onPointerUp={() => { if (draft) setShapes((s) => [...s, draft]); setDraft(null); start.current = null }}
          />
          {crop && (
            <div className="pointer-events-none absolute border-2 border-white"
                 style={{
                   left: `${(crop.x / (cv.current?.width || 1)) * 100}%`,
                   top: `${(crop.y / (cv.current?.height || 1)) * 100}%`,
                   width: `${(crop.w / (cv.current?.width || 1)) * 100}%`,
                   height: `${(crop.h / (cv.current?.height || 1)) * 100}%`,
                   boxShadow: '0 0 0 9999px rgba(0,0,0,.42)',
                 }} />
          )}
        </div>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Editor />)
