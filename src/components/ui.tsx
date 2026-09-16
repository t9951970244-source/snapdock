import { AnimatePresence, motion } from 'framer-motion'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { clamp } from '@/lib/format'

export const spring = { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.9 }
export const springSoft = { type: 'spring' as const, stiffness: 260, damping: 30 }

/* ---------------- Tooltip ---------------- */
export function Tooltip({ label, children, delay = 380 }: { label: ReactNode; children: ReactNode; delay?: number }) {
  const [on, setOn] = useState(false)
  const t = useRef<number>(0)
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => { t.current = window.setTimeout(() => setOn(true), delay) }}
      onPointerLeave={() => { clearTimeout(t.current); setOn(false) }}
    >
      {children}
      <AnimatePresence>
        {on && (
          <motion.span
            initial={{ opacity: 0, y: 4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={spring}
            className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 w-max max-w-[240px]
                       -translate-x-1/2 rounded-[10px] px-2.5 py-1.5 text-[11px] leading-snug"
            style={{
              background: 'rgb(var(--glass))',
              backdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgb(var(--glass-edge))',
              color: 'rgb(var(--ink))',
              boxShadow: 'var(--shadow)',
            }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

/* ---------------- Slider ---------------- */
export function Slider({
  value, onChange, accent = true, height = 4, className = '', label,
}: { value: number; onChange: (v: number) => void; accent?: boolean; height?: number; className?: string; label?: string }) {
  const el = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)

  const pick = (clientX: number) => {
    const r = el.current!.getBoundingClientRect()
    onChange(clamp((clientX - r.left) / r.width))
  }
  return (
    <div
      ref={el}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`no-drag group relative flex cursor-pointer items-center ${className}`}
      style={{ height: 18 }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag(true); pick(e.clientX) }}
      onPointerMove={(e) => drag && pick(e.clientX)}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') onChange(clamp(value + 0.05))
        if (e.key === 'ArrowLeft') onChange(clamp(value - 0.05))
      }}
    >
      <div className="relative w-full overflow-hidden rounded-pill transition-[height] duration-200"
           style={{ height: drag ? height + 3 : height, background: 'rgb(var(--fill))' }}>
        <motion.div
          className="absolute inset-y-0 left-0 rounded-pill"
          style={{ background: accent ? 'rgb(var(--accent))' : 'rgb(var(--ink) / 0.75)' }}
          animate={{ width: `${value * 100}%` }}
          transition={drag ? { duration: 0 } : spring}
        />
      </div>
      <motion.div
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white"
        style={{ boxShadow: '0 1px 4px rgb(0 0 0 / 0.28)', left: `calc(${value * 100}% - 6px)` }}
        animate={{ scale: drag ? 1.25 : 0, opacity: drag ? 1 : 0 }}
        transition={spring}
      />
    </div>
  )
}

/* ---------------- Кнопка-иконка ---------------- */
export function IconButton({
  children, onClick, label, active, size = 28,
}: { children: ReactNode; onClick?: () => void; label: string; active?: boolean; size?: number }) {
  return (
    <motion.button
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.08 }}
      transition={spring}
      className="no-drag grid place-items-center rounded-full"
      style={{
        width: size, height: size,
        color: active ? 'rgb(var(--accent))' : 'rgb(var(--ink))',
        background: active ? 'rgb(var(--accent) / 0.16)' : 'transparent',
      }}
    >
      {children}
    </motion.button>
  )
}

/* ---------------- HUD громкости (колесо над виджетом) ---------------- */
export function VolumeHud({ value, show }: { value: number; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 6 }}
          transition={spring}
          className="pointer-events-none absolute -top-16 left-1/2 z-50 flex w-[168px] -translate-x-1/2
                     flex-col items-center gap-2 rounded-[18px] px-4 py-3 glass"
        >
          <div className="text-[13px] font-medium tabular-nums" style={{ color: 'rgb(var(--ink))' }}>
            {Math.round(value * 100)}%
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-pill" style={{ background: 'rgb(var(--fill))' }}>
            <motion.div className="h-full rounded-pill"
              style={{ background: 'rgb(var(--accent))' }}
              animate={{ width: `${value * 100}%` }} transition={spring} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ---------------- Хук: сообщаем главному процессу высоту стекла ---------------- */
export function useHoverBridge() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const send = () => window.snap?.reportHeight(el.getBoundingClientRect().height)
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return ref
}
