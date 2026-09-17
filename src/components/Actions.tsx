import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import { Tooltip, spring } from './ui'
import { IChat, IClose, ICopy, IRec, IRegion, ISave, IScreen, IStop } from './icons'
import { useState } from 'react'
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

export function Actions({ onRegion, onScreen, onCopy, onSave, onChat, onQuit,
                          recOn, recClock, onRec, onRecStop, busy, chatOpen, hasShot }: {
  onRegion: () => void; onScreen: () => void; onCopy: () => void; onSave: () => void
  onChat: () => void; onQuit: () => void
  recOn?: boolean; recClock?: string
  onRec: (sound: 'none' | 'system' | 'both') => void; onRecStop: () => void
  busy?: boolean; chatOpen?: boolean; hasShot?: boolean
}) {
  useLang()
  const [menu, setMenu] = useState(false)
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

      {/* Запись экрана: нажатие открывает выбор звука, потом сразу пишет */}
      <span className="relative flex flex-1">
        <Action icon={recOn ? <IStop /> : <IRec />}
                label={recOn ? (recClock ?? '') : t('rec')}
                active={recOn}
                onClick={() => (recOn ? onRecStop() : setMenu((v) => !v))}
                hint={recOn ? t('recStop') : t('tipRec')} />
        {menu && !recOn && (
          <span className="absolute bottom-[calc(100%+8px)] left-1/2 z-50 flex w-[178px] -translate-x-1/2 flex-col gap-0.5 rounded-[12px] p-1"
                style={{ background: 'rgb(var(--glass))', backdropFilter: 'blur(20px) saturate(180%)',
                         border: '1px solid rgb(var(--glass-edge))', boxShadow: 'var(--shadow)' }}>
            {([['none', t('recNone')], ['system', t('recSystem')], ['both', t('recBoth')]] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setMenu(false); onRec(k) }}
                      className="no-drag rounded-[9px] px-2.5 py-1.5 text-left text-[11.5px]"
                      style={{ color: 'rgb(var(--ink))' }}>
                {label}
              </button>
            ))}
          </span>
        )}
      </span>

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
