import { AnimatePresence, motion } from 'framer-motion'
import type { MutableRefObject } from 'react'
import { useRef, useState } from 'react'
import { Equalizer } from './Equalizer'
import { IconButton, Tooltip, spring } from './ui'
import { INext, IPause, IPlay, IPrev, IMixer, IVolume } from './icons'
import { time, clamp } from '@/lib/format'
import type { Media } from '@/hooks/useNowPlaying'
import { t, useLang, type Key } from '@/lib/i18n'

export function NowPlaying({
  media, levels, peaks, onToggle, onNext, onPrev, onSeek, onMixer, mixerOpen, master, audioSource,
}: {
  media: Media
  levels: MutableRefObject<Float32Array>
  peaks: MutableRefObject<Float32Array>
  onToggle: () => void; onNext: () => void; onPrev: () => void
  onSeek: (s: number) => void; onMixer: () => void; mixerOpen: boolean; master: number
  audioSource?: 'loopback' | 'mic' | 'none'
}) {
  useLang()
  // главный процесс шлёт ключи вида @nothing — подставляем их на текущем языке
  const tr = (s: string) => (s.startsWith('@') ? t(s.slice(1) as Key) : s)
  const bar = useRef<HTMLDivElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)
  const pos = scrub ?? media.position
  const pct = media.duration ? clamp(pos / media.duration) : 0

  const pick = (x: number) => {
    const r = bar.current!.getBoundingClientRect()
    return clamp((x - r.left) / r.width) * media.duration
  }

  return (
    <div className="relative">
      <Equalizer levels={levels} peaks={peaks} height={38} dim={media.playing ? 0.6 : 0.18} />

      <div className="relative flex items-center gap-2.5">
        {/* обложка */}
        <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-[11px]"
             style={{ background: 'rgb(var(--fill))', boxShadow: '0 2px 10px rgb(0 0 0 / 0.16)' }}>
          <AnimatePresence mode="popLayout">
            {media.artwork ? (
              <motion.img
                key={media.artwork}
                src={media.artwork}
                alt=""
                initial={{ opacity: 0, scale: 1.06 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={spring}
                className="h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <motion.div key="ph" className="grid h-full w-full place-items-center"
                          style={{ color: 'rgb(var(--ink-3))' }}>
                <IVolume level={master} />
              </motion.div>
            )}
          </AnimatePresence>
          {media.playing && (
            <motion.span
              className="absolute inset-0 rounded-[11px]"
              style={{ boxShadow: 'inset 0 0 0 1.5px rgb(var(--accent) / 0.55)' }}
              animate={{ opacity: [0.35, 0.9, 0.35] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>

        {/* название и артист */}
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={media.title}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={spring}
            >
              <div className="truncate text-[13px] font-semibold leading-tight tracking-[-0.01em]"
                   style={{ color: 'rgb(var(--ink))' }}>
                {tr(media.title)}
              </div>
              <div className="truncate text-[11px] leading-tight" style={{ color: 'rgb(var(--ink-2))' }}>
                {media.artist
                  || (audioSource === 'mic' ? t('micSource')
                    : audioSource === 'none' ? t('noSource')
                    : tr(media.source))}
                {audioSource === 'none' && (
                  <button
                    onClick={() => window.snap?.openScreenSettings()}
                    className="no-drag ml-1.5 underline"
                    style={{ color: 'rgb(var(--accent))' }}
                  >
                    {t('fixPerm')}
                  </button>
                )}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* транспорт */}
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label={t('prev')} onClick={onPrev}><IPrev /></IconButton>
          <IconButton label={media.playing ? t('pause') : t('play')} onClick={onToggle} size={32}>
            {media.playing ? <IPause /> : <IPlay />}
          </IconButton>
          <IconButton label={t('next')} onClick={onNext}><INext /></IconButton>
          <Tooltip label={t('tipMixer')}>
            <IconButton label={t('mixer')} onClick={onMixer} active={mixerOpen}><IMixer /></IconButton>
          </Tooltip>
        </div>
      </div>

      {/* прогресс — тянется мышью */}
      <div className="mt-1.5 flex items-center gap-2">
        <div
          ref={bar}
          className="no-drag group relative h-3 flex-1 cursor-pointer"
          onPointerDown={(e) => {
            if (!media.duration) return
            e.currentTarget.setPointerCapture(e.pointerId)
            setScrub(pick(e.clientX))
          }}
          onPointerMove={(e) => scrub !== null && setScrub(pick(e.clientX))}
          onPointerUp={() => { if (scrub !== null) { onSeek(scrub); setScrub(null) } }}
        >
          <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 overflow-hidden rounded-pill
                          transition-[height] duration-200 group-hover:h-[5px]"
               style={{ background: 'rgb(var(--fill))' }}>
            <div className="h-full rounded-pill"
                 style={{ width: `${pct * 100}%`, background: 'rgb(var(--accent))' }} />
          </div>
          <div className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-white opacity-0
                          transition-opacity group-hover:opacity-100"
               style={{ left: `calc(${pct * 100}% - 5px)`, boxShadow: '0 1px 4px rgb(0 0 0 / 0.3)' }} />
        </div>
        <div className="shrink-0 text-[10px] tabular-nums" style={{ color: 'rgb(var(--ink-2))' }}>
          {time(pos)} / {media.duration ? time(media.duration) : '—:—'}
        </div>
      </div>
    </div>
  )
}
