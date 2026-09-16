import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { createRequire } from 'node:module'

// Загружаем необязательный нативный модуль в рантайме.
// Прямой require() Rollup пытается разрешить на этапе сборки и падает.
const optionalRequire = (name: string) => {
  try { return createRequire(__filename)(name) } catch { return null }
}

const run = promisify(execFile)

export type MediaState = {
  source: string          // 'Spotify', 'Chrome', 'Системный звук'
  title: string
  artist: string
  album: string
  artwork: string | null  // data:image/...
  playing: boolean
  position: number        // сек
  duration: number        // сек
  canSeek: boolean
}

// Пустое состояние размечаем ключами — подписи подставит интерфейс на своём языке
const EMPTY: MediaState = {
  source: '@sysAudio', title: '@nothing', artist: '',
  album: '', artwork: null, playing: false, position: 0, duration: 0, canSeek: false,
}

function helper(name: string) {
  const p = app.isPackaged
    ? join(process.resourcesPath, name)
    : join(app.getAppPath(), 'resources', name)
  return existsSync(p) ? p : null
}

/* ---------------- Windows: SMTC ---------------- */
/**
 * Универсальный доступ к транспорту любого плеера (Spotify, браузер, VLC, Zoom)
 * даёт только WinRT GlobalSystemMediaTransportControlsSessionManager.
 * Два рабочих пути, в порядке приоритета:
 *   1) resources/smtc.exe — крошечный C#-хелпер, печатает JSON в stdout раз в секунду;
 *   2) npm-пакет NodeRT (windows.media.control), если он установлен в системе.
 * Если ни того ни другого нет — остаётся loopback-звук и EQ, транспорт выключен.
 */
async function readWindows(): Promise<MediaState | null> {
  const exe = helper('smtc.exe')
  if (exe) {
    try {
      const { stdout } = await run(exe, ['--once'], { windowsHide: true, maxBuffer: 8 << 20 })
      return normalize(JSON.parse(stdout))
    } catch { /* падаем в NodeRT */ }
  }
  try {
    const mod = optionalRequire('@coooookies/windows-smtc-monitor')
    if (mod?.SMTCMonitor) {
      const s = mod.SMTCMonitor.getMediaSession?.()
      if (s) return normalize({
        source: s.sourceAppId ?? s.appId, title: s.title, artist: s.artist, album: s.albumTitle,
        artwork: s.thumbnail ?? null, playing: s.playbackStatus === 'playing' || s.isPlaying,
        position: (s.position ?? 0) / 1000, duration: (s.duration ?? 0) / 1000, canSeek: true,
      })
    }
    const { GlobalSystemMediaTransportControlsSessionManager: M } = optionalRequire('@nodert-win11-22h2/windows.media.control') ?? {}
    if (!M) return null
    const mgr = await new Promise<any>((res, rej) =>
      M.requestAsync((e: any, r: any) => (e ? rej(e) : res(r))))
    const s = mgr.getCurrentSession()
    if (!s) return null
    const props = await new Promise<any>((res, rej) =>
      s.tryGetMediaPropertiesAsync((e: any, r: any) => (e ? rej(e) : res(r))))
    const t = s.getTimelineProperties()
    const pb = s.getPlaybackInfo()
    return normalize({
      source: s.sourceAppUserModelId,
      title: props.title, artist: props.artist, album: props.albumTitle,
      playing: pb.playbackStatus === 4,
      position: t.position / 1e7, duration: t.endTime / 1e7, canSeek: true,
    })
  } catch { return null }
}
let winSession: any = null
export async function winCommand(cmd: string) {
  const exe = helper('smtc.exe')
  if (exe) { await run(exe, ['--cmd', cmd], { windowsHide: true }).catch(() => {}); return }
  try {
    if (!winSession) {
      const mod = optionalRequire('@coooookies/windows-smtc-monitor')
      if (mod?.SMTCMonitor) {
        const map: Record<string, string> = { play: 'Play', pause: 'Pause', toggle: 'PlayPauseToggle', next: 'Next', prev: 'Previous' }
        mod.SMTCMonitor.sendMediaCommand?.(map[cmd]); return
      }
      const { GlobalSystemMediaTransportControlsSessionManager: M } = optionalRequire('@nodert-win11-22h2/windows.media.control') ?? {}
      if (!M) return
      const mgr = await new Promise<any>((res, rej) => M.requestAsync((e: any, r: any) => (e ? rej(e) : res(r))))
      winSession = mgr.getCurrentSession()
    }
    const map: Record<string, string> = {
      play: 'tryPlayAsync', pause: 'tryPauseAsync', toggle: 'tryTogglePlayPauseAsync',
      next: 'trySkipNextAsync', prev: 'trySkipPreviousAsync',
    }
    winSession?.[map[cmd]]?.(() => {})
  } catch { /* нет моста — команда молча игнорируется */ }
}

/* ---------------- Linux: MPRIS через playerctl ---------------- */
async function readLinux(): Promise<MediaState | null> {
  try {
    const fmt = '{{playerName}}\u001f{{title}}\u001f{{artist}}\u001f{{album}}\u001f{{status}}\u001f{{position}}\u001f{{mpris:length}}\u001f{{mpris:artUrl}}'
    const { stdout } = await run('playerctl', ['metadata', '--format', fmt])
    const [source, title, artist, album, status, pos, len, art] = stdout.trim().split('\u001f')
    return normalize({
      source, title, artist, album,
      playing: status === 'Playing',
      position: Number(pos) / 1e6, duration: Number(len) / 1e6,
      artwork: art?.startsWith('file://') ? art : null, canSeek: true,
    })
  } catch { return null }
}

/* ---------------- macOS: NowPlaying ---------------- */
async function readMac(): Promise<MediaState | null> {
  try {
    const { stdout } = await run('nowplaying-cli', ['get', 'title', 'artist', 'album', 'duration', 'elapsedTime', 'playbackRate'])
    const [title, artist, album, duration, elapsed, rate] = stdout.trim().split('\n')
    return normalize({
      source: 'NowPlaying', title, artist, album,
      duration: Number(duration), position: Number(elapsed),
      playing: Number(rate) > 0, canSeek: false,
    })
  } catch { /* дальше — AppleScript по конкретным плеерам */ }
  const SEP = '<|>'   // AppleScript не понимает \u001f — нужен обычный текстовый разделитель
  for (const appName of ['Spotify', 'Music']) {
    try {
      const art = appName === 'Spotify' ? '(artwork url of current track)' : '""'
      const script =
        `tell application "${appName}"\n` +
        `  if it is not running then return ""\n` +
        `  set t to current track\n` +
        `  return (name of t) & "${SEP}" & (artist of t) & "${SEP}" & (album of t) & "${SEP}" & ` +
        `(duration of t) & "${SEP}" & (player position) & "${SEP}" & (player state as string) & "${SEP}" & ${art}\n` +
        `end tell`
      const { stdout } = await run('osascript', ['-e', script])
      const parts = stdout.trim().split(SEP)
      const [title, artist, album, dur, pos, state, artwork] = parts
      if (!title) continue
      return normalize({
        source: appName, title, artist, album,
        duration: Number(dur) > 1000 ? Number(dur) / 1000 : Number(dur),
        position: Number(pos), playing: state === 'playing', canSeek: true,
        artwork: artwork?.startsWith('http') ? artwork : null,
      })
    } catch { /* следующий */ }
  }
  return null
}

function normalize(raw: Partial<MediaState> & Record<string, any>): MediaState {
  return {
    source: raw.source ? String(raw.source).replace(/\.exe$|!.*$/i, '') : EMPTY.source,
    title: raw.title || EMPTY.title,
    artist: raw.artist || '',
    album: raw.album || '',
    artwork: raw.artwork ?? null,
    playing: !!raw.playing,
    position: Number.isFinite(raw.position) ? Math.max(0, raw.position!) : 0,
    duration: Number.isFinite(raw.duration) ? Math.max(0, raw.duration!) : 0,
    canSeek: !!raw.canSeek,
  }
}

export async function readNowPlaying(): Promise<MediaState> {
  const r =
    process.platform === 'win32' ? await readWindows()
    : process.platform === 'darwin' ? await readMac()
    : await readLinux()
  return r ?? EMPTY
}

let timer: NodeJS.Timeout | null = null
let last = ''
export function startMediaWatcher(send: (s: MediaState) => void) {
  const tick = async () => {
    const s = await readNowPlaying()
    // позиция тикает каждую секунду — сравниваем только «смысловую» часть
    const key = `${s.source}|${s.title}|${s.artist}|${s.playing}|${Math.round(s.position)}`
    if (key !== last) { last = key; send(s) }
  }
  tick()
  timer = setInterval(tick, 1000)
  return () => { if (timer) clearInterval(timer) }
}

export async function mediaCommand(cmd: 'play' | 'pause' | 'toggle' | 'next' | 'prev') {
  if (process.platform === 'win32') return winCommand(cmd)
  if (process.platform === 'linux') {
    const map = { play: 'play', pause: 'pause', toggle: 'play-pause', next: 'next', prev: 'previous' }
    return run('playerctl', [map[cmd]]).then(() => {}).catch(() => {})
  }
  const map = { play: 'play', pause: 'pause', toggle: 'playpause', next: 'next track', prev: 'previous track' }
  return run('osascript', ['-e', `tell application "Spotify" to ${map[cmd]}`]).then(() => {}).catch(() => {})
}

export async function seekTo(sec: number) {
  if (process.platform === 'linux') return run('playerctl', ['position', String(sec)]).then(() => {}).catch(() => {})
  if (process.platform === 'darwin') return run('osascript', ['-e', `tell application "Spotify" to set player position to ${sec}`]).then(() => {}).catch(() => {})
  const exe = helper('smtc.exe')
  if (exe) return run(exe, ['--seek', String(sec)], { windowsHide: true }).then(() => {}).catch(() => {})
}
