import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import { Tooltip, spring } from './ui'
import { IChat, IClose, ICopy, IRegion, ISave, IScreen } from './icons'
import { t, useLang } from '@/lib/i18n'

function Action({ icon, label, hint, onClick, busy, active }: {
  icon: ReactNode; label: string; hint: ReactNode; onClick: () => void; busy?: boolean; active?: boolean
}) {
  return (
    <Tooltip label={hint}>
      <motion.button
        onClick={onClick}
        whileTap={{ scale: 0.92 }}
        whileHover={{ y: -1 }}
        transition={spring}
        className="no-drag flex h-[42px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] rounded-[13px]"
        style={{
          background: active ? 'rgb(var(--accent) / 0.18)' : 'rgb(var(--fill))',
          color: 'rgb(var(--ink))',
          opacity: busy ? 0.5 : 1,
        }}
      >
        <span className="grid h-[19px] place-items-center">{icon}</span>
        <span className="text-[9.5px] font-medium leading-none tracking-[-0.005em]">{label}</span>
      </motion.button>
    </Tooltip>
  )
}

export function Actions({ onRegion, onScreen, onCopy, onSave, onChat, onQuit, busy, chatOpen, hasShot }: {
  onRegion: () => void; onScreen: () => void; onCopy: () => void; onSave: () => void
  onChat: () => void; onQuit: () => void
  busy?: boolean; chatOpen?: boolean; hasShot?: boolean
}) {
  useLang()
  return (
    <div className="flex items-stretch gap-1.5">
      <Action icon={<IRegion />} label={t('area')} busy={busy} onClick={onRegion}
              hint={<>{t('tipArea')} {t('hideNote')}. <b>Ctrl+Shift+1</b></>} />
      <Action icon={<IScreen />} label={t('screen')} busy={busy} onClick={onScreen}
              hint={<>{t('tipScreen')} {t('hideNote')}. <b>Ctrl+Shift+2</b></>} />
      <Action icon={<ICopy />} label={t('copy')} onClick={onCopy}
              hint={hasShot ? t('tipCopy') : t('tipNoShot')} />
      <Action icon={<ISave />} label={t('save')} onClick={onSave}
              hint={hasShot ? t('tipSave') : t('tipNoShot')} />
      <Action icon={<IChat />} label={t('room')} onClick={onChat} active={chatOpen}
              hint={t('tipRoom')} />

      {/* Выход: без него виджет нечем закрыть — в доке и меню его нет */}
      <Tooltip label={t('tipQuit')}>
        <motion.button
          onClick={onQuit}
          whileTap={{ scale: 0.9 }}
          transition={spring}
          aria-label={t('tipQuit')}
          className="no-drag grid h-[42px] w-[30px] shrink-0 place-items-center rounded-[13px]"
          style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink-2))' }}
        >
          <IClose />
        </motion.button>
      </Tooltip>
    </div>
  )
}
