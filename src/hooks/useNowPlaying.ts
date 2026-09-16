import { useEffect, useRef, useState } from 'react'
import { dominantColor } from '@/lib/color'

export type Media = {
  source: string; title: string; artist: string; album: string
  artwork: string | null; playing: boolean; position: number; duration: number; canSeek: boolean
}

const IDLE: Media = {
  source: 'Системный звук', title: 'Ничего не играет', artist: '',
  album: '', artwork: null, playing: false, position: 0, duration: 0, canSeek: false,
}

export function useNowPlaying() {
  const [media, setMedia] = useState<Media>(IDLE)
  const [accent, setAccent] = useState('255 255 255')
  const tick = useRef<number>(0)

  useEffect(() => window.snap?.onMedia((s) => setMedia(s as Media)), [])

  // Между опросами позицию двигаем сами — иначе прогресс дёргается раз в секунду.
  useEffect(() => {
    if (!media.playing || !media.duration) return
    tick.current = window.setInterval(
      () => setMedia((m) => ({ ...m, position: Math.min(m.duration, m.position + 0.25) })), 250)
    return () => clearInterval(tick.current)
  }, [media.playing, media.duration, media.title])

  // Доминанта обложки -> --accent -> ambient-подсветка стекла и цвет EQ.
  useEffect(() => {
    if (!media.artwork) { setAccent('255 255 255'); return }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setAccent(dominantColor(img))
    img.src = media.artwork
  }, [media.artwork])

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent)
  }, [accent])

  return {
    media, accent,
    toggle: () => window.snap?.mediaCommand('toggle'),
    next: () => window.snap?.mediaCommand('next'),
    prev: () => window.snap?.mediaCommand('prev'),
    seek: (sec: number) => { setMedia((m) => ({ ...m, position: sec })); window.snap?.mediaSeek(sec) },
  }
}
