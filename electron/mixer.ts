import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { createRequire } from 'node:module'
import { winSessions, winGetMaster, winSetMaster, winSetMasterMute, winSetApp, winMuteApp } from './win-audio'

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
async function winSessionList(): Promise<AudioSession[]> {
  const viaPs = await winSessions()
  if (viaPs.length) return viaPs
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
  if (await winSetApp(id, v)) return true
  const mixer = nsm()
  if (mixer?.SoundMixer?.getDefaultDevice) {
    const s = mixer.SoundMixer.getDefaultDevice(0, 0)?.sessions?.find((x: any) => String(x.appName) === id)
    if (s) { s.volume = v; return true }
  }
  const exe = helper('svcl.exe'); if (!exe) return false
  await run(exe, ['/SetVolume', id, String(Math.round(v * 100))], { windowsHide: true }); return true
}
const winMute = async (id: string, m: boolean) => {
  if (await winMuteApp(id, m)) return true
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

/* ---------------- macOS: громкость плееров без драйвера ---------------- */
/**
 * Общей громкости по программам в macOS нет, и без системного расширения не будет.
 * Но сами плееры умеют отдавать свою громкость наружу. Для музыки это закрывает
 * ровно тот случай, ради которого микшер и открывают: приглушить музыку, не трогая
 * остальное. Браузеры так не умеют — там остаётся общая громкость.
 */
const MAC_APPS = [
  { app: 'Spotify', name: 'Spotify', get: 'sound volume', scale: 100 },
  { app: 'Music', name: 'Music', get: 'sound volume', scale: 100 },
  { app: 'VLC', name: 'VLC', get: 'audio volume', scale: 512 },
  { app: 'IINA', name: 'IINA', get: 'volume', scale: 100 },
  { app: 'Vox', name: 'VOX', get: 'player volume', scale: 1 },
]

/**
 * Браузеры своей громкости наружу не отдают, но умеют выполнять команды на странице.
 * Через этот вход выставляем громкость всем плеерам во всех вкладках — получается
 * настоящая громкость браузера без всякого драйвера.
 *
 * Требует одной разовой настройки у пользователя:
 *   Chrome  — Вид → Для разработчиков → Разрешить JavaScript из Apple Events
 *   Safari  — Разработка → Разрешить JavaScript из Apple Events
 * Пока она выключена, браузер в списке не появляется.
 */
const MAC_BROWSERS = [
  { app: 'Google Chrome', name: 'Chrome', family: 'chrome' },
  { app: 'Yandex', name: 'Яндекс.Браузер', family: 'chrome' },
  { app: 'Microsoft Edge', name: 'Edge', family: 'chrome' },
  { app: 'Brave Browser', name: 'Brave', family: 'chrome' },
  { app: 'Safari', name: 'Safari', family: 'safari' },
] as const

const JS_GET = 'var m=document.querySelectorAll("video,audio");m.length?m[0].volume:-1'
const JS_CMD: Record<string, string> = {
  toggle: 'var m=document.querySelector("video,audio");if(m){m.paused?m.play():m.pause()};1',
  play:   'var m=document.querySelector("video,audio");if(m)m.play();1',
  pause:  'var m=document.querySelector("video,audio");if(m)m.pause();1',
  next:   'var m=document.querySelector("video,audio");if(m)m.currentTime=Math.min(m.duration,m.currentTime+15);1',
  prev:   'var m=document.querySelector("video,audio");if(m)m.currentTime=Math.max(0,m.currentTime-15);1',
}

/** Управление роликом в браузере, когда обычный плеер молчит. */
export async function macBrowserCommand(cmd: string) {
  const js = JS_CMD[cmd]
  if (!js) return false
  for (const b of MAC_BROWSERS) {
    if (!(await macRunning(b.app))) continue
    if ((await browserJs(b, js)) !== null) return true
  }
  return false
}
const JS_SET = (v: number) =>
  `document.querySelectorAll("video,audio").forEach(function(e){e.volume=${v.toFixed(3)}});1`

async function browserJs(b: (typeof MAC_BROWSERS)[number], js: string): Promise<string | null> {
  const script = b.family === 'safari'
    ? `tell application "Safari" to do JavaScript "${js.replace(/"/g, '\\"')}" in front document`
    : `tell application "${b.app}"
         set r to -1
         repeat with w in windows
           repeat with tb in tabs of w
             try
               set r to (execute tb javascript "${js.replace(/"/g, '\\"')}")
             end try
           end repeat
         end repeat
         return r
       end tell`
  try {
    const { stdout } = await run('osascript', ['-e', script], { timeout: 4000 })
    return stdout.trim()
  } catch { return null }
}

async function macRunning(app: string) {
  try {
    const { stdout } = await run('osascript', ['-e', `application "${app}" is running`])
    return stdout.trim() === 'true'
  } catch { return false }
}

async function macSessions(): Promise<AudioSession[]> {
  const out: AudioSession[] = []

  for (const b of MAC_BROWSERS) {
    if (!(await macRunning(b.app))) continue
    const got = await browserJs(b, JS_GET)
    const v = Number(got)
    if (!Number.isFinite(v) || v < 0) continue      // нет плееров или доступ не разрешён
    out.push({
      id: `browser:${b.app}`, name: b.name, process: b.app,
      volume: Math.max(0, Math.min(1, v)), muted: v === 0, active: true, icon: null,
    })
  }

  for (const a of MAC_APPS) {
    if (!(await macRunning(a.app))) continue
    try {
      const { stdout } = await run('osascript', ['-e', `tell application "${a.app}" to ${a.get}`])
      const raw = Number(stdout.trim())
      if (!Number.isFinite(raw)) continue
      out.push({
        id: a.app, name: a.name, process: a.app,
        volume: Math.max(0, Math.min(1, raw / a.scale)),
        muted: raw === 0, active: true, icon: null,
      })
    } catch { /* плеер не отвечает — пропускаем */ }
  }
  return out
}

const macSet = async (id: string, v: number) => {
  if (id.startsWith('browser:')) {
    const b = MAC_BROWSERS.find((x) => x.app === id.slice(8))
    if (!b) return false
    return (await browserJs(b, JS_SET(v))) !== null
  }
  const a = MAC_APPS.find((x) => x.app === id)
  if (!a) return false
  try {
    await run('osascript', ['-e', `tell application "${a.app}" to set ${a.get} to ${Math.round(v * a.scale)}`])
    return true
  } catch { return false }
}

const macMuteMemory = new Map<string, number>()
const macMute = async (id: string, m: boolean) => {
  if (id.startsWith('browser:')) {
    if (m) { macMuteMemory.set(id, 0.6); return macSet(id, 0) }
    return macSet(id, macMuteMemory.get(id) ?? 0.6)
  }
  const a = MAC_APPS.find((x) => x.app === id)
  if (!a) return false
  if (m) {
    try {
      const { stdout } = await run('osascript', ['-e', `tell application "${a.app}" to ${a.get}`])
      macMuteMemory.set(id, Number(stdout.trim()) || a.scale / 2)
    } catch { /* запомнить не вышло — вернём половину */ }
    return macSet(id, 0)
  }
  return macSet(id, (macMuteMemory.get(id) ?? a.scale / 2) / a.scale)
}

/* ---------------- Публичный API ---------------- */
export async function listSessions(): Promise<AudioSession[]> {
  try {
    if (process.platform === 'win32') return await winSessionList()
    if (process.platform === 'linux') return await linuxSessions()
    if (process.platform === 'darwin') return await macSessions()
    return []
  } catch { return [] }
}
export async function setSessionVolume(id: string, v: number) {
  try {
    if (process.platform === 'win32') return await winSet(id, v)
    if (process.platform === 'linux') return await linuxSet(id, v)
    if (process.platform === 'darwin') return await macSet(id, v)
  } catch { /* ignore */ }
  return false
}
export async function setSessionMute(id: string, m: boolean) {
  try {
    if (process.platform === 'win32') return await winMute(id, m)
    if (process.platform === 'linux') return await linuxMute(id, m)
    if (process.platform === 'darwin') return await macMute(id, m)
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
    const w = await winGetMaster()
    if (w !== null) return w
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
    else await winSetMaster(masterCache)
  } catch { /* ignore */ }
}


/* ---------------- Автоприглушение под созвон ---------------- */
/**
 * Виджет присматривает за звуком и сам убирает музыку, когда начинается разговор.
 * Это то, ради чего микшер обычно и открывают, — только руками лезть не нужно.
 */
const TALK = /zoom|teams|discord|skype|webex|telegram|whatsapp|slack|facetime/i
const DUCK = 0.2                     // до скольки приглушаем
const before = new Map<string, number>()
let ducking = false
let duckTimer: NodeJS.Timeout | null = null

export async function setMasterMute(m: boolean) {
  try {
    if (process.platform === 'win32') return await winSetMasterMute(m)
    if (process.platform === 'darwin') {
      await run('osascript', ['-e', `set volume ${m ? 'with' : 'without'} output muted`])
      return true
    }
    if (process.platform === 'linux') {
      await run('pactl', ['set-sink-mute', '@DEFAULT_SINK@', m ? '1' : '0'])
      return true
    }
  } catch { /* ignore */ }
  return false
}

export function setAutoDuck(on: boolean) {
  if (duckTimer) { clearInterval(duckTimer); duckTimer = null }
  if (!on) { restoreAll(); return }
  duckTimer = setInterval(tick, 2000)
  tick()
}

async function restoreAll() {
  for (const [id, v] of before) await setSessionVolume(id, v)
  before.clear()
  ducking = false
}

async function tick() {
  const list = await listSessions()
  const talking = list.some((s) => s.active && !s.muted && TALK.test(s.name + ' ' + s.process))

  if (talking && !ducking) {
    ducking = true
    for (const s of list) {
      if (TALK.test(s.name + ' ' + s.process)) continue
      if (s.volume <= DUCK) continue
      before.set(s.id, s.volume)
      await setSessionVolume(s.id, DUCK)
    }
    return
  }
  if (!talking && ducking) await restoreAll()
}

export function isDucking() { return ducking }
