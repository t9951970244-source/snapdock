import { AnimatePresence, motion } from 'framer-motion'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { VolumeHud, spring, useHoverBridge } from './ui'
import { IGrip } from './icons'
import { clamp } from '@/lib/format'

/**
 * Стеклянная оболочка виджета.
 *  • тащится за любое место стекла, кроме кнопок и ползунков;
 *  • встаёт туда, куда принесли: прилипания к краю нет, только защита от улёта;
 *  • колесо над стеклом крутит общую громкость, как в строке меню macOS;
 *  • панель под шапкой растёт пружиной, окно подстраивает высоту под содержимое.
 * Самопрятание за край убрано: содержимое обрезалось границей окна и виджет
 * пропадал совсем. Скрывать и показывать — Ctrl+Shift+D.
 */
export function Dock({
  children, panel, master, onMaster,
}: {
  children: ReactNode
  panel: ReactNode | null
  master: number
  onMaster: (v: number) => void
}) {
  const hover = useHoverBridge()
  const [hud, setHud] = useState(false)
  const hudTimer = useRef<number>(0)

  /* колесо -> общая громкость */
  const onWheel = (e: React.WheelEvent) => {
    onMaster(clamp(master - Math.sign(e.deltaY) * 0.04))
    setHud(true)
    clearTimeout(hudTimer.current)
    hudTimer.current = window.setTimeout(() => setHud(false), 900)
  }

  return (
    <div className="flex h-full w-full flex-col justify-start">
      <motion.div ref={hover} className="relative" onWheel={onWheel}>
        <VolumeHud value={master} show={hud} />

        <motion.div
          layout
          transition={spring}
          className="glass relative m-[10px] cursor-grab overflow-hidden rounded-dock active:cursor-grabbing"
          onPointerDown={(e) => {
            // Кнопки, ползунки и поля помечены no-drag — на них перетаскивание не начинаем
            if ((e.target as HTMLElement).closest('.no-drag')) return
            e.currentTarget.setPointerCapture(e.pointerId)
            window.snap?.dragStart()
          }}
          onPointerUp={() => { window.snap?.dragEnd(); window.snap?.settle() }}
          onPointerCancel={() => { window.snap?.dragEnd(); window.snap?.settle() }}
        >
          <div className="ambient" />

          {/* ручка перетаскивания: окно ведёт за курсором главный процесс */}
          {/* Полоска слева осталась подсказкой: тянуть можно за любое место стекла */}
          <div className="pointer-events-none absolute left-0 top-0 z-20 flex h-full w-[14px] items-center justify-center">
            <IGrip style={{ color: 'rgb(var(--ink-3))' }} />
          </div>

          <div className="relative z-10 py-2 pl-[18px] pr-[10px]">
            {children}
            <AnimatePresence initial={false}>
              {panel && (
                <motion.div
                  key="panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring}
                  className="relative overflow-hidden"
                >
                  <div className="my-2 h-px" style={{ background: 'rgb(var(--ink-3) / 0.5)' }} />
                  {panel}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}
