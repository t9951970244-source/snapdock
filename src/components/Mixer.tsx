import { motion } from 'framer-motion'
import { Slider, IconButton, spring } from './ui'
import { IMuted, IVolume } from './icons'
import { appLabel } from '@/lib/format'
import type { Session } from '@/hooks/useMixer'
import { useState } from 'react'
import { t, useLang } from '@/lib/i18n'

/** Микшер в логике One UI: мастер сверху, ниже — каждое приложение своей строкой. */
export function Mixer({
  sessions, master, masterMuted, setVolume, setMute, setMasterVolume, toggleMasterMute,
}: {
  sessions: Session[]; master: number; masterMuted: boolean
  setVolume: (id: string, v: number) => void; setMute: (id: string, m: boolean) => void
  setMasterVolume: (v: number) => void; toggleMasterMute: () => void
}) {
  useLang()
  const [duck, setDuck] = useState(false)
  const playing = [...sessions].sort((a, b) => Number(b.active) - Number(a.active))

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 rounded-[14px] px-2.5 py-2"
           style={{ background: 'rgb(var(--accent) / 0.12)' }}>
        <IconButton label={masterMuted ? t('unmute') : t('mute')} onClick={toggleMasterMute}>
          {masterMuted ? <IMuted /> : <IVolume level={master} />}
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-baseline justify-between">
            <span className="text-[11.5px] font-semibold" style={{ color: 'rgb(var(--ink))' }}>{t('masterVol')}</span>
            <span className="text-[10px] tabular-nums" style={{ color: 'rgb(var(--ink-2))' }}>
              {Math.round((masterMuted ? 0 : master) * 100)}%
            </span>
          </div>
          <Slider value={masterMuted ? 0 : master} onChange={setMasterVolume} label={t('masterVol')} />
        </div>
      </div>

      {/* Пульт: виджет сам следит за звуком, лезть руками не нужно */}
      <button onClick={() => { const n = !duck; setDuck(n); window.snap?.autoDuck(n) }}
              className="no-drag flex items-center gap-2.5 rounded-[12px] px-2.5 py-2 text-left"
              style={{ background: duck ? 'rgb(var(--accent) / 0.18)' : 'rgb(var(--fill))' }}>
        <span className="grid h-5 w-9 shrink-0 items-center rounded-pill px-0.5"
              style={{ background: duck ? 'rgb(var(--accent) / 0.75)' : 'rgb(var(--ink-3))' }}>
          <span className="h-4 w-4 rounded-full bg-white transition-transform duration-200"
                style={{ transform: duck ? 'translateX(16px)' : 'none' }} />
        </span>
        <span className="text-[11.5px] font-medium" style={{ color: 'rgb(var(--ink))' }}>
          {t('autoDuck')}
        </span>
      </button>

      <div className="max-h-[188px] overflow-y-auto pr-1">
        {playing.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ink-2))' }}>
            {t(window.snap?.platform === 'darwin' ? 'macNoMixer' : 'noApps')
              .split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
            {window.snap?.platform === 'darwin' && (
              <span className="mt-2 block" style={{ color: 'rgb(var(--ink-3))' }}>{t('browserHint')}</span>
            )}
          </div>
        ) : (
          playing.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...spring, delay: Math.min(i * 0.025, 0.2) }}
              className="flex items-center gap-2.5 rounded-[12px] px-2.5 py-1.5"
            >
              <button
                aria-label={`${s.muted ? t('unmute') : t('mute')} — ${s.name}`}
                onClick={() => setMute(s.id, !s.muted)}
                className="no-drag grid h-8 w-8 shrink-0 place-items-center rounded-[9px] text-[11px] font-semibold"
                style={{
                  background: s.muted ? 'rgb(var(--fill))' : 'rgb(var(--accent) / 0.22)',
                  color: s.muted ? 'rgb(var(--ink-3))' : 'rgb(var(--ink))',
                }}
              >
                {s.icon ? <img src={s.icon} alt="" className="h-5 w-5" /> : appLabel(s.name).slice(0, 2)}
              </button>
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-baseline justify-between gap-2">
                  <span className="truncate text-[11.5px] font-medium" style={{ color: 'rgb(var(--ink))' }}>
                    {appLabel(s.name)}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: 'rgb(var(--ink-2))' }}>
                    {s.muted ? t('muted') : `${Math.round(s.volume * 100)}%`}
                  </span>
                </div>
                <Slider value={s.muted ? 0 : s.volume} onChange={(v) => setVolume(s.id, v)} label={s.name} />
              </div>
              <button onClick={() => window.snap?.solo(s.id)} title={t('solo')}
                      aria-label={t('solo')}
                      className="no-drag grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-[11px]"
                      style={{ background: 'rgb(var(--fill))', color: 'rgb(var(--ink-2))' }}>
                ★
              </button>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
