import { AnimatePresence, motion } from 'framer-motion'
import { spring } from './ui'
import { IClose } from './icons'
import { t } from '@/lib/i18n'

export type Shot = { id: string; dataUrl: string; at: number }

/**
 * Лента последних снимков. Миниатюру можно тащить мышью прямо в Telegram, Figma
 * или письмо — Electron отдаёт настоящий файл через webContents.startDrag.
 */
export function ShotTray({ shots, onPick, onDrop, active }: {
  shots: Shot[]; onPick: (s: Shot) => void; onDrop: (id: string) => void; active?: string
}) {
  return (
    <AnimatePresence>
      {shots.length > 0 && (
        <motion.div
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={spring}
          className="flex items-center gap-1.5 overflow-hidden"
        >
          {shots.map((s) => (
            <motion.div
              key={s.id} layout
              initial={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.7, opacity: 0 }}
              transition={spring}
              className="group relative h-[34px] w-[52px] shrink-0 cursor-grab overflow-hidden rounded-[8px]"
              style={{
                boxShadow: active === s.id
                  ? '0 0 0 1.5px rgb(var(--accent)), 0 2px 8px rgb(0 0 0 / 0.2)'
                  : '0 1px 4px rgb(0 0 0 / 0.18)',
              }}
              onClick={() => onPick(s)}
            >
              {/* перетаскивание вешаем на обычный div: у motion.div свой onDragStart */}
              <div
                className="h-full w-full"
                draggable
                onDragStart={(e) => { e.preventDefault(); window.snap?.dragShot(s.dataUrl) }}
              >
                <img src={s.dataUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              </div>
              <button
                aria-label={t('close')}
                onClick={(e) => { e.stopPropagation(); onDrop(s.id) }}
                className="no-drag absolute right-0 top-0 grid h-4 w-4 place-items-center rounded-bl-[6px]
                           opacity-0 transition-opacity group-hover:opacity-100"
                style={{ background: 'rgb(0 0 0 / 0.55)', color: '#fff' }}
              >
                <IClose width={10} height={10} />
              </button>
            </motion.div>
          ))}
          <span className="pl-0.5 text-[9.5px] leading-tight" style={{ color: 'rgb(var(--ink-3))' }}>
            {t('dragHint').split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
