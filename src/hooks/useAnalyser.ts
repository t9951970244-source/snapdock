import { useEffect, useRef, useState } from 'react'
import { systemAudioTrack } from '@/lib/system-audio'

export type Bands = { levels: Float32Array; peaks: Float32Array; rms: number }

/**
 * Настоящий системный звук в Web Audio.
 *
 * getDisplayMedia в Electron перехвачен setDisplayMediaRequestHandler, который сразу
 * отдаёт { video: screen0, audio: 'loopback' } — окно «Чем поделиться» не появляется.
 * Видеодорожку глушим немедленно, остаётся только петля вывода: всё, что слышно
 * в колонках, приходит в AnalyserNode. EQ показывает реальный звук, а не анимацию.
 *
 * Fallback для браузера и Linux: микрофон, а если и его нет — тихий ноль.
 */
export function useAnalyser(bars = 32) {
  const levels = useRef(new Float32Array(bars))
  const peaks = useRef(new Float32Array(bars))
  const rms = useRef(0)
  const [source, setSource] = useState<'loopback' | 'mic' | 'none'>('none')

  useEffect(() => {
    let ctx: AudioContext | null = null
    let stream: MediaStream | null = null
    let raf = 0
    let dead = false

    const start = async () => {
      try {
        // Общий захват на всё приложение: иначе запись экрана остаётся без звука
        const track = await systemAudioTrack()
        if (!track) throw new Error('no loopback audio')
        stream = new MediaStream([track])
        setSource('loopback')
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          })
          setSource('mic')
        } catch { setSource('none'); return }
      }
      if (dead) { stream?.getTracks().forEach((t) => t.stop()); return }

      ctx = new AudioContext({ latencyHint: 'interactive' })
      const node = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.72
      analyser.minDecibels = -78
      analyser.maxDecibels = -12
      node.connect(analyser)

      const bins = new Uint8Array(analyser.frequencyBinCount)
      const nyquist = ctx.sampleRate / 2

      // логарифмическая раскладка 40 Гц .. 16 кГц: бас не съедает все полосы
      const edges = new Int32Array(bars + 1)
      for (let i = 0; i <= bars; i++) {
        const hz = 40 * Math.pow(16000 / 40, i / bars)
        edges[i] = Math.min(bins.length - 1, Math.round((hz / nyquist) * bins.length))
      }

      const loop = () => {
        analyser.getByteFrequencyData(bins)
        let sum = 0
        for (let i = 0; i < bars; i++) {
          const a = edges[i]
          const b = Math.max(edges[i + 1], a + 1)
          let peak = 0
          for (let j = a; j < b; j++) if (bins[j] > peak) peak = bins[j]
          // компенсация спада розового шума — верхние полосы иначе всегда пустые
          const tilt = 1 + (i / bars) * 0.85
          const v = Math.min(1, (peak / 255) * tilt)
          levels.current[i] += (v - levels.current[i]) * (v > levels.current[i] ? 0.55 : 0.14)
          peaks.current[i] = Math.max(levels.current[i], peaks.current[i] - 0.012)
          sum += levels.current[i]
        }
        rms.current = sum / bars
        raf = requestAnimationFrame(loop)
      }
      loop()
    }

    const boot = setTimeout(start, 1200)   // окно рисуется мгновенно, звук подхватывается следом
    return () => {
      clearTimeout(boot)
      dead = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      ctx?.close()
    }
  }, [bars])

  return { levels, peaks, rms, source }
}
