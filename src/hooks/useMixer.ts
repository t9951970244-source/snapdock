import { useCallback, useEffect, useState } from 'react'

export type Session = {
  id: string; name: string; process: string
  volume: number; muted: boolean; active: boolean; icon: string | null
}

export function useMixer(open: boolean) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [master, setMaster] = useState(0.7)
  const [masterMuted, setMasterMuted] = useState(false)

  const refresh = useCallback(async () => {
    const [s, m] = await Promise.all([window.snap?.sessions(), window.snap?.master()])
    if (Array.isArray(s)) setSessions(s as Session[])
    if (typeof m === 'number') setMaster(m)
  }, [])

  // Опрашиваем только пока микшер открыт — фоновый опрос процессов зря греет CPU.
  useEffect(() => {
    if (!open) return
    refresh()
    const t = setInterval(refresh, 1500)
    return () => clearInterval(t)
  }, [open, refresh])

  const setVolume = (id: string, v: number) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, volume: v } : s)))
    window.snap?.setSessionVolume(id, v)
  }
  const setMute = (id: string, m: boolean) => {
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, muted: m } : s)))
    window.snap?.setSessionMute(id, m)
  }
  const setMasterVolume = (v: number) => { setMaster(v); window.snap?.master(v) }
  const toggleMasterMute = () => {
    const next = !masterMuted
    setMasterMuted(next)
    window.snap?.master(next ? 0 : master || 0.5)
  }

  return { sessions, master, masterMuted, setVolume, setMute, setMasterVolume, toggleMasterMute, refresh }
}
