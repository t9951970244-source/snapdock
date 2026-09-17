import { useCallback, useEffect, useState } from 'react'
import { Dock } from './components/Dock'
import { NowPlaying } from './components/NowPlaying'
import { Actions } from './components/Actions'
import { Mixer } from './components/Mixer'
import { ShotTray, type Shot } from './components/ShotTray'
import { useAnalyser } from './hooks/useAnalyser'
import { useNowPlaying } from './hooks/useNowPlaying'
import { useMixer } from './hooks/useMixer'
import { useRecorder } from './hooks/useRecorder'
import { prefersDark } from './lib/color'
import { initLang, setLang, t, useLang } from './lib/i18n'

type Panel = null | 'mixer'

export default function App() {
  const [panel, setPanel] = useState<Panel>(null)
  const [shots, setShots] = useState<Shot[]>([])
  const [current, setCurrent] = useState<Shot | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useLang()
  const { levels, peaks, source: audioSource } = useAnalyser(32)

  /* язык берём у главного процесса и слушаем переключение из трея */
  useEffect(() => {
    window.snap?.getLang().then((l) => (l ? setLang(l) : initLang()))
    return window.snap?.onLang(setLang)
  }, [])
  const { media, toggle, next, prev, seek } = useNowPlaying()
  const mix = useMixer(panel === 'mixer')
  const recorder = useRecorder()

  /* тема следует за системой */
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle('theme-dark', prefersDark())
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const note = (t: string) => { setToast(t); setTimeout(() => setToast(null), 2800) }

  // Один раз честно сообщаем, откуда берётся звук для эквалайзера
  useEffect(() => {
    if (audioSource === 'none') note(t('noAudio'))
    if (audioSource === 'mic') note(t('micAudio'))
  }, [audioSource])

  const addShot = useCallback((dataUrl: string) => {
    const s = { id: Math.random().toString(36).slice(2), dataUrl, at: Date.now() }
    setShots((l) => [s, ...l].slice(0, 5))
    setCurrent(s)
    return s
  }, [])

  // macOS без разрешения на запись экрана отдаёт пустой список — снимок молча не выходит
  const ensurePermission = useCallback(async () => {
    const st = await window.snap?.shotPermission()
    if (st === 'granted' || st === undefined) return true
    note(t('needPerm'))
    setTimeout(() => window.snap?.openScreenSettings(), 900)
    return false
  }, [])

  const region = useCallback(async () => {
    if (!(await ensurePermission())) return
    setBusy(true)
    try {
      const r = await window.snap?.shotRegion()
      if (r?.dataUrl) addShot(r.dataUrl)
    } catch { note(t('shotFailed')) }
    finally { setBusy(false) }
  }, [addShot, ensurePermission])

  const fullscreen = useCallback(async () => {
    if (!(await ensurePermission())) return
    setBusy(true)
    try {
      const r = await window.snap?.shotFullscreen()
      if (r?.dataUrl) addShot(r.dataUrl)
    } catch { note(t('shotFailed')) }
    finally { setBusy(false) }
  }, [addShot, ensurePermission])

  const copy = useCallback(async () => {
    if (!current) return note(t('needShot'))
    await window.snap?.copyShot(current.dataUrl)
    note(t('copied'))
  }, [current])

  const save = useCallback(async () => {
    if (!current) return note(t('needShot'))
    const file = await window.snap?.saveShot(current.dataUrl)
    note(t('saved'))
    if (file) setTimeout(() => window.snap?.revealShot(file), 900)
  }, [current])

  /* горячие клавиши приходят из главного процесса */
  /* Запись сохранилась или сорвалась — говорим об этом */
  useEffect(() => { if (recorder.saved) note(t('recSaved')) }, [recorder.saved])
  useEffect(() => { if (recorder.error) note(t('recFailed')) }, [recorder.error])

  useEffect(() => window.snap?.onHotkey((k) => {
    if (k === 'region') region()
    if (k === 'fullscreen') fullscreen()
    if (k === 'playpause') toggle()
    if (k === 'mixer') setPanel((p) => (p === 'mixer' ? null : 'mixer'))
    if (k === 'record') recorder.on ? recorder.stop() : recorder.start('system')
  }), [region, fullscreen, toggle])

  return (
    <Dock panel={panel === 'mixer' ? <Mixer {...mix} /> : null}
          master={mix.master} onMaster={mix.setMasterVolume}>
      <NowPlaying
        media={media} levels={levels} peaks={peaks}
        onToggle={toggle} onNext={next} onPrev={prev} onSeek={seek}
        onMixer={() => setPanel((p) => (p === 'mixer' ? null : 'mixer'))}
        mixerOpen={panel === 'mixer'} master={mix.master} audioSource={audioSource}
      />

      <div className="mt-2">
        <ShotTray
          shots={shots}
          active={current?.id}
          onPick={setCurrent}
          onDrop={(id) => {
            setShots((l) => l.filter((s) => s.id !== id))
            setCurrent((c) => (c?.id === id ? null : c))
          }}
        />
      </div>

      <div className="mt-2">
        <Actions
          onRegion={region} onScreen={fullscreen} onCopy={copy} onSave={save}
          onChat={() => window.snap?.openChat()}
          onQuit={() => window.snap?.quit()}
          recOn={recorder.on} recClock={recorder.clock}
          onRec={recorder.start} onRecStop={recorder.stop}
          busy={busy} hasShot={!!current}
        />
      </div>

      {toast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10.5px]"
             style={{ color: 'rgb(var(--ink-2))' }}>
          {toast}
        </div>
      )}
    </Dock>
  )
}
