import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { createRequire } from 'node:module'

const optionalRequire = (name: string) => {
  try { return createRequire(__filename)(name) } catch { return null }
}
// native-sound-mixer даёт per-app громкость без внешних exe. Если его нет — падаем на svcl.exe.
const nsm = () => optionalRequire('native-sound-mixer')?.default ?? optionalRequire('native-sound-mixer')

const run = promisify(execFile)

export type AudioSession = {
  id: string
  name: string       // «Spotify», «Google Chrome»
  process: string
  volume: number     // 0..1
  muted: boolean
  active: boolean    // прямо сейчас что-то выводит
  icon: string | null
}

/**
 * Громкость каждого приложения отдельно — это WASAPI IAudioSessionManager2 на Windows
 * и PulseAudio/PipeWire sink-inputs на Linux. Из чистого JS ни то ни другое недоступно,
 * поэтому здесь адаптер с тремя реализациями:
 *
 *   Windows — resources/svcl.exe (NirSoft SoundVolumeView CLI) или свой C#/N-API хелпер.
 *             Положить файл в resources/ и пересобрать. Без него остаётся мастер-громкость.
 *   Linux   — pactl, есть из коробки почти везде. Работает полностью.
 *   macOS   — per-app микшера в системе нет вообще. Только мастер через osascript.
 */
function helper(name: string) {
  const p = app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
  return existsSync(p) ? p : null
}

/* ---------------- Windows ---------------- */
async function winSessions(): Promise<AudioSession[]> {
  const mixer = nsm()
  if (mixer?.SoundMixer?.getDefaultDevice) {
    const dev = mixer.SoundMixer.getDefaultDevice(0, 0)
    return (dev?.sessions ?? []).map((s: any, i: number) => ({
      id: String(s.appName ?? i), name: s.appName ?? 'Приложение', process: s.appName ?? '',
      volume: s.volume ?? 1, muted: !!s.mute, active: true, icon: null,
    }))
  }
  const exe = helper('svcl.exe')
  if (!exe) return []
  const { stdout } = await run(exe, ['/scomma', '', '/Columns', 'Name,Type,Process Path,Volume Percent,Muted,Process ID'],
    { windowsHide: true, maxBuffer: 8 << 20 })
  return stdout.split(/\r?\n/).slice(1).filter(Boolean)
    .map((line) => line.split(','))
    .filter((c) => /^application/i.test(c[1] || ''))   // колонка Type: отсекаем устройства
    .map((c) => ({
      id: c[5] || c[0],
      name: c[0],
      process: c[2] || '',
      volume: Math.min(1, (parseFloat(c[3]) || 0) / 100),
      muted: /yes|true/i.test(c[4] || ''),
      active: true,
      icon: null as string | null,
    }))
}
const winSet = async (id: string, v: number) => {
  const mixer = nsm()
  if (mixer?.SoundMixer?.getDefaultDevice) {
    const s = mixer.SoundMixer.getDefaultDevice(0, 0)?.sessions?.find((x: any) => String(x.appName) === id)
    if (s) { s.volume = v; return true }
  }
  const exe = helper('svcl.exe'); if (!exe) return false
  await run(exe, ['/SetVolume', id, String(Math.round(v * 100))], { windowsHide: true }); return true
}
const winMute = async (id: string, m: boolean) => {
  const mixer = nsm()
  if (mixer?.SoundMixer?.getDefaultDevice) {
    const s = mixer.SoundMixer.getDefaultDevice(0, 0)?.sessions?.find((x: any) => String(x.appName) === id)
    if (s) { s.mute = m; return true }
  }
  const exe = helper('svcl.exe'); if (!exe) return false
  await run(exe, [m ? '/Mute' : '/Unmute', id], { windowsHide: true }); return true
}

/* ---------------- Linux (PulseAudio / PipeWire) ---------------- */
async function linuxSessions(): Promise<AudioSession[]> {
  const { stdout } = await run('pactl', ['list', 'sink-inputs'])
  const out: AudioSession[] = []
  for (const block of stdout.split(/Sink Input #/).slice(1)) {
    const id = block.slice(0, block.indexOf('\n')).trim()
    const name = /application\.name = "(.*?)"/.exec(block)?.[1] ?? 'Приложение'
    const proc = /application\.process\.binary = "(.*?)"/.exec(block)?.[1] ?? ''
    const vol = /Volume:.*?(\d+)%/s.exec(block)?.[1] ?? '100'
    out.push({
      id, name, process: proc,
      volume: Number(vol) / 100,
      muted: /Mute: yes/.test(block),
      active: !/Corked: yes/.test(block),
      icon: null,
    })
  }
  return out
}
const linuxSet = async (id: string, v: number) => {
  await run('pactl', ['set-sink-input-volume', id, `${Math.round(v * 100)}%`]); return true
}
const linuxMute = async (id: string, m: boolean) => {
  await run('pactl', ['set-sink-input-mute', id, m ? '1' : '0']); return true
}

/* ---------------- Публичный API ---------------- */
export async function listSessions(): Promise<AudioSession[]> {
  try {
    if (process.platform === 'win32') return await winSessions()
    if (process.platform === 'linux') return await linuxSessions()
    return []
  } catch { return [] }
}
export async function setSessionVolume(id: string, v: number) {
  try {
    if (process.platform === 'win32') return await winSet(id, v)
    if (process.platform === 'linux') return await linuxSet(id, v)
  } catch { /* ignore */ }
  return false
}
export async function setSessionMute(id: string, m: boolean) {
  try {
    if (process.platform === 'win32') return await winMute(id, m)
    if (process.platform === 'linux') return await linuxMute(id, m)
  } catch { /* ignore */ }
  return false
}

let masterCache = 0.7
export async function getMasterVolume() {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('osascript', ['-e', 'output volume of (get volume settings)'])
      return Number(stdout.trim()) / 100
    }
    if (process.platform === 'linux') {
      const { stdout } = await run('pactl', ['get-sink-volume', '@DEFAULT_SINK@'])
      return Number(/(\d+)%/.exec(stdout)?.[1] ?? 70) / 100
    }
    const exe = helper('svcl.exe')
    if (exe) {
      const { stdout } = await run(exe, ['/stdout', '/scomma', '', '/Columns', 'Name,Volume Percent'], { windowsHide: true })
      const line = stdout.split(/\r?\n/).find((l) => /Speakers|Headphones|Динамик/i.test(l))
      if (line) return Number(line.split(',')[1]) / 100
    }
  } catch { /* ignore */ }
  return masterCache
}
let volTimer: NodeJS.Timeout | null = null
export async function setMasterVolume(v: number) {
  masterCache = Math.max(0, Math.min(1, v))
  // Системе отдаём не чаще раза в 120 мс: osascript/pactl — это запуск процесса,
  // на каждый щелчок колеса он давал задержку почти в секунду.
  if (volTimer) return masterCache
  volTimer = setTimeout(() => { volTimer = null; applyMaster() }, 120)
  return masterCache
}
async function applyMaster() {
  const pct = Math.round(masterCache * 100)
  try {
    if (process.platform === 'darwin') await run('osascript', ['-e', `set volume output volume ${pct}`])
    else if (process.platform === 'linux') await run('pactl', ['set-sink-volume', '@DEFAULT_SINK@', `${pct}%`])
    else {
      const exe = helper('svcl.exe')
      if (exe) await run(exe, ['/SetVolume', 'DefaultRenderDevice', String(pct)], { windowsHide: true })
    }
  } catch { /* ignore */ }
}
