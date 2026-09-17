import { useCallback, useRef, useState } from 'react'
import { systemAudioTrack } from '@/lib/system-audio'

/**
 * Запись экрана.
 *
 * Картинку и системный звук берём тем же способом, что и снимки: главный процесс
 * перехватывает запрос, поэтому окно «Чем поделиться» не появляется. Микрофон,
 * если он нужен, подмешивается к системному звуку в одну дорожку.
 *
 * Пишем в mp4, когда движок умеет — такой файл открывается на Mac штатным
 * проигрывателем. Если не умеет, остаётся webm.
 */

export type Sound = 'none' | 'system' | 'both'

function pickFormat() {
  const want = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]
  for (const t of want) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}

export function useRecorder() {
  const [on, setOn] = useState(false)
  const [secs, setSecs] = useState(0)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warn, setWarn] = useState<'' | 'sys' | 'mic' | 'none'>('')

  const rec = useRef<MediaRecorder | null>(null)
  const parts = useRef<Blob[]>([])
  const streams = useRef<MediaStream[]>([])
  const ctx = useRef<AudioContext | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const cleanup = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    streams.current = []
    ctx.current?.close().catch(() => {})
    ctx.current = null
    rec.current = null
  }

  const start = useCallback(async (sound: Sound) => {
    setError(null); setSaved(null); setWarn('')
    try {
      // Картинку берём отдельно от звука: звук в приложении общий, второй
      // захват система не даёт — из-за этого запись раньше выходила немой
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 } as MediaTrackConstraints,
        audio: false,
      })
      streams.current.push(screen)

      const video = screen.getVideoTracks()[0]
      if (!video) throw new Error('нет картинки')

      let audio: MediaStreamTrack | null = null
      const sys = sound === 'none' ? null : await systemAudioTrack()
      if (sound !== 'none' && !sys) setWarn('sys')      // звука компьютера нет — скажем прямо

      if (sound === 'both') {
        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false },
        }).catch(() => null)
        if (mic) streams.current.push(mic)
        else setWarn('mic')

        if (sys || mic) {
          // Сводим системный звук и микрофон в одну дорожку
          const ac = new AudioContext()
          ctx.current = ac
          const dest = ac.createMediaStreamDestination()
          if (sys) ac.createMediaStreamSource(new MediaStream([sys])).connect(dest)
          if (mic) ac.createMediaStreamSource(mic).connect(dest)
          audio = dest.stream.getAudioTracks()[0] ?? null
        }
      } else if (sound === 'system') {
        audio = sys
      }

      if (sound !== 'none' && !audio) setWarn('none')

      const mix = new MediaStream(audio ? [video, audio] : [video])
      const type = pickFormat()
      const r = new MediaRecorder(mix, type ? { mimeType: type, videoBitsPerSecond: 6_000_000 } : undefined)
      parts.current = []
      r.ondataavailable = (e) => { if (e.data.size) parts.current.push(e.data) }
      r.onstop = async () => {
        const blob = new Blob(parts.current, { type: r.mimeType })
        cleanup()
        setOn(false)
        try {
          const buf = await blob.arrayBuffer()
          const ext = r.mimeType.includes('mp4') ? 'mp4' : 'webm'
          const file = await window.snap?.saveRecording(buf, ext)
          setSaved(file ?? null)
          setTimeout(() => setSaved(null), 5000)
        } catch { setError('Не удалось сохранить запись') }
      }

      // Остановили показ из системы — запись тоже завершаем
      video.onended = () => { try { r.stop() } catch { /* уже остановлен */ } }

      r.start(1000)
      rec.current = r
      setOn(true); setSecs(0)
      timer.current = setInterval(() => setSecs((n) => n + 1), 1000)
    } catch (err: any) {
      cleanup()
      setOn(false)
      setError(String(err?.message ?? err))
    }
  }, [])

  const stop = useCallback(() => {
    try { rec.current?.stop() } catch { cleanup(); setOn(false) }
  }, [])

  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

  return { on, secs, clock, saved, error, warn, start, stop }
}
