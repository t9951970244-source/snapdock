import {
  app, BrowserWindow, ipcMain, desktopCapturer, screen, nativeImage,
  clipboard, globalShortcut, session, Tray, Menu, shell, dialog, systemPreferences, nativeTheme,
} from 'electron'
import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { startMediaWatcher, mediaCommand, seekTo } from './media'
import { listSessions, setSessionVolume, setSessionMute, setMasterVolume, getMasterVolume, setAutoDuck, setMasterMute } from './mixer'
import { lanStart, lanPeers, lanInvite, lanAnswer, lanStop } from './lan'

const DEV = !!process.env.VITE_DEV_SERVER_URL
const DOCK_W = 380
const DOCK_H = 140
const PAD = 24          // поля вокруг стекла внутри окна

let win: BrowserWindow | null = null
let overlay: BrowserWindow | null = null
let editor: BrowserWindow | null = null
let tray: Tray | null = null
let interactive = false
let lang: 'ru' | 'en' = 'ru'

const M = {
  ru: { show: 'Показать виджет', area: 'Снять область', screen: 'Снять экран', lang: 'Язык', quit: 'Выйти' },
  en: { show: 'Show widget', area: 'Capture area', screen: 'Capture screen', lang: 'Language', quit: 'Quit' },
}

const CTX = {
  ru: { cut: 'Вырезать', copy: 'Копировать', paste: 'Вставить', all: 'Выделить всё', quit: 'Закрыть SnapDock' },
  en: { cut: 'Cut', copy: 'Copy', paste: 'Paste', all: 'Select all', quit: 'Quit SnapDock' },
}

/**
 * Меню по правой кнопке — как в любой другой программе.
 * Команды зовём напрямую у окна, а не ролями меню: у программы без значка
 * в доке роли могут не срабатывать, а прямые вызовы работают всегда.
 */
function attachContextMenu(w: BrowserWindow, withQuit = false) {
  w.webContents.on('context-menu', (_e, p) => {
    const m = CTX[lang]
    const wc = w.webContents
    const items: Electron.MenuItemConstructorOptions[] = [
      { label: m.cut, enabled: p.isEditable && !!p.selectionText, click: () => wc.cut() },
      { label: m.copy, enabled: !!p.selectionText, click: () => wc.copy() },
      { label: m.paste, enabled: p.isEditable, click: () => wc.paste() },
      { type: 'separator' },
      { label: m.all, enabled: p.isEditable || !!p.selectionText, click: () => wc.selectAll() },
    ]
    if (withQuit) items.push({ type: 'separator' }, { label: m.quit, click: () => app.quit() })
    Menu.buildFromTemplate(items).popup({ window: w })
  })
}

function broadcastLang() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('lang', lang)
  createTray()   // подписи в трее тоже меняются
}
ipcMain.handle('lang:get', () => lang)
ipcMain.on('lang:set', (_e, l: 'ru' | 'en') => { lang = l; broadcastLang() })

type Page = 'index' | 'overlay' | 'editor' | 'chat'

function pageUrl(name: Page) {
  if (DEV) {
    const base = process.env.VITE_DEV_SERVER_URL!
    return name === 'index' ? base : `${base}windows/${name}/index.html`
  }
  return name === 'index'
    ? join(__dirname, '../dist/index.html')
    : join(__dirname, `../dist/windows/${name}/index.html`)
}
function load(w: BrowserWindow, name: Page) {
  const u = pageUrl(name)
  return u.startsWith('http') ? w.loadURL(u) : w.loadFile(u)
}

/* ------------------------------------------------------------------ */
/* Главное окно виджета                                                */
/* ------------------------------------------------------------------ */
function createDock() {
  const area = screen.getPrimaryDisplay().workArea

  win = new BrowserWindow({
    width: DOCK_W,
    height: DOCK_H + PAD,
    x: area.x + area.width - DOCK_W - 24,
    y: area.y + area.height - DOCK_H - PAD - 24,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,          // тень рисует CSS, иначе двойная рамка на Windows
    resizable: false,
    movable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    acceptFirstMouse: true,
    roundedCorners: true,
    vibrancy: process.platform === 'darwin' ? 'hud' : undefined,   // настоящее размытие фона
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,   // EQ не должен замирать в фоне
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')          // выше полноэкранных приложений
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setIgnoreMouseEvents(true, { forward: true }) // клики проходят насквозь, пока мышь не над стеклом

  attachContextMenu(win, true)
  load(win, 'index')
  win.on('closed', () => { win = null })
  return win
}

/**
 * Клики проходят насквозь, пока курсор не над стеклом.
 * Позицию курсора спрашиваем у системы, а не ловим mousemove в окне:
 * на macOS forward-режим события в окно не доставляет, и виджет стал бы мёртвым.
 */
let dockHeight = DOCK_H
ipcMain.on('dock:height', (_e, h: number) => {
  dockHeight = Math.max(60, Math.round(h))
  if (!win || win.isDestroyed() || dragging) return
  const b = win.getBounds()
  const target = dockHeight + PAD
  if (Math.abs(b.height - target) < 2) return
  const wa = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y }).workArea
  // если панель выросла и не влезает вниз — поднимаем окно, а не обрезаем содержимое
  const y = Math.min(b.y, wa.y + wa.height - target - 8)
  win.setBounds({ x: b.x, y: Math.max(wa.y, y), width: DOCK_W, height: target }, false)
})

/** Перетаскивание ведём по курсору в главном процессе: так нет дрейфа и рывков. */
let dragging = false
let grabOff = { x: 0, y: 0 }
ipcMain.on('dock:dragStart', () => {
  if (!win) return
  const p = screen.getCursorScreenPoint()
  const b = win.getBounds()
  grabOff = { x: p.x - b.x, y: p.y - b.y }
  dragging = true
  const step = () => {
    if (!dragging || !win || win.isDestroyed()) return
    const c = screen.getCursorScreenPoint()
    win.setPosition(c.x - grabOff.x, c.y - grabOff.y, false)
    setTimeout(step, 16)
  }
  step()
})
ipcMain.on('dock:dragEnd', () => { dragging = false })
ipcMain.on('app:quit', () => app.quit())

function watchCursor() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const p = screen.getCursorScreenPoint()
    const b = win.getBounds()
    const on = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height
    if (on === interactive) return
    interactive = on
    win.setIgnoreMouseEvents(!on, { forward: process.platform === 'win32' })
  }, 90)
}

/**
 * Отпустили — оставляем ровно там, куда принесли.
 * Прилипания к краю больше нет: следим только за тем, чтобы виджет
 * не уехал за границу экрана целиком и его можно было поймать обратно.
 */
ipcMain.handle('dock:settle', () => {
  if (!win) return null
  const b = win.getBounds()
  const d = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + 40 }).workArea
  const keep = 80                                   // столько всегда остаётся на виду
  const x = Math.max(d.x - b.width + keep, Math.min(b.x, d.x + d.width - keep))
  const y = Math.max(d.y, Math.min(b.y, d.y + d.height - 40))
  if (x !== b.x || y !== b.y) win.setPosition(Math.round(x), Math.round(y), true)
  return null
})

/* ------------------------------------------------------------------ */
/* 1. Скриншот без системного попапа                                   */
/* ------------------------------------------------------------------ */
/**
 * Никакого getDisplayMedia и окна «Чем поделиться».
 * Прячем виджет -> ждём кадр композитора -> снимаем desktopCapturer -> показываем.
 * 250 мс хватает DWM/Quartz, чтобы окно реально исчезло из кадра.
 */
async function grabScreen(displayId?: number) {
  const hidden = !!win && win.isVisible()
  if (hidden) win!.hide()
  if (overlay?.isVisible()) overlay.hide()

  let src
  let target = screen.getPrimaryDisplay()
  let scale = 1
  try {
    await new Promise((r) => setTimeout(r, 250))
    target = screen.getAllDisplays().find((d) => d.id === displayId) ?? target
    scale = target.scaleFactor || 1
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(target.size.width * scale),
        height: Math.round(target.size.height * scale),
      },
      fetchWindowIcons: false,
    })
    src = sources.find((s) => String(s.display_id) === String(target.id)) ?? sources[0]
  } finally {
    // Окно возвращаем всегда, даже если съёмка упала.
    // Без finally виджет прятался и не появлялся больше никогда.
    if (hidden) win!.show()
  }
  if (!src) throw new Error('NO_SCREEN')

  return {
    dataUrl: src.thumbnail.toDataURL(),
    width: src.thumbnail.getSize().width,
    height: src.thumbnail.getSize().height,
    scale,
    display: { id: target.id, ...target.bounds },
  }
}

ipcMain.handle('shot:permission', () => {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen')
})
ipcMain.on('cam:openSettings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
})
ipcMain.handle('cam:ask', async () => {
  if (process.platform !== 'darwin') return 'granted'
  // Спрашиваем явно: без этого окно разрешения у неподписанной программы часто не всплывает
  const cam = await systemPreferences.askForMediaAccess('camera').catch(() => false)
  await systemPreferences.askForMediaAccess('microphone').catch(() => false)
  return cam ? 'granted' : systemPreferences.getMediaAccessStatus('camera')
})

ipcMain.on('shot:openSettings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
})

ipcMain.handle('shot:fullscreen', async () => {
  const shot = await grabScreen()
  openEditor(shot.dataUrl)
  return shot
})

ipcMain.handle('shot:region', async () => {
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const shot = await grabScreen(display.id)

  if (overlay) overlay.destroy()
  overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    enableLargerThanScreen: true,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  })
  overlay.setAlwaysOnTop(true, 'screen-saver')
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  await load(overlay, 'overlay')
  overlay.webContents.send('overlay:image', shot)
  overlay.show()
  overlay.focus()

  return new Promise<null | { dataUrl: string }>((resolve) => {
    const done = (_e: unknown, rect: { x: number; y: number; w: number; h: number } | null) => {
      ipcMain.removeListener('overlay:done', done)
      overlay?.destroy()
      overlay = null
      if (!rect || rect.w < 2 || rect.h < 2) return resolve(null)
      const img = nativeImage.createFromDataURL(shot.dataUrl).crop({
        x: Math.round(rect.x * shot.scale),
        y: Math.round(rect.y * shot.scale),
        width: Math.round(rect.w * shot.scale),
        height: Math.round(rect.h * shot.scale),
      })
      const dataUrl = img.toDataURL()
      openEditor(dataUrl)
      resolve({ dataUrl })
    }
    ipcMain.on('overlay:done', done)
  })
})

/* ------------------------------------------------------------------ */
/* Редактор: обрезка, стрелки, текст, размытие                         */
/* ------------------------------------------------------------------ */
function openEditor(dataUrl: string) {
  if (editor && !editor.isDestroyed()) {
    editor.webContents.send('editor:image', dataUrl)
    editor.show(); editor.focus()
    return
  }
  const wa = screen.getPrimaryDisplay().workArea
  editor = new BrowserWindow({
    width: Math.min(1180, wa.width - 80),
    height: Math.min(760, wa.height - 80),
    frame: false,
    transparent: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#ececed',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    roundedCorners: true,
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  })
  attachContextMenu(editor)
  load(editor, 'editor').then(() => {
    editor!.webContents.send('editor:image', dataUrl)
    editor!.show()
  })
  editor.on('closed', () => { editor = null })
}
ipcMain.on('editor:close', () => editor?.close())

/* Комната живёт в своём окне: его можно растянуть, а виджет остаётся маленьким. */
let chat: BrowserWindow | null = null
ipcMain.on('chat:open', () => {
  if (chat && !chat.isDestroyed()) { chat.show(); chat.focus(); return }
  const darkNow = nativeTheme.shouldUseDarkColors
  chat = new BrowserWindow({
    width: 760, height: 560, minWidth: 420, minHeight: 380,
    title: 'SnapDock — комната',
    frame: false,
    transparent: false,
    backgroundColor: darkNow ? '#1c1c1e' : '#f2f2f5',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    roundedCorners: true,
    resizable: true, show: false,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false },
  })
  attachContextMenu(chat)
  load(chat, 'chat').then(() => chat!.show())
  chat.on('closed', () => { chat = null })
})
ipcMain.on('chat:close', () => chat?.close())

/* ---------------- Соседи в домашней сети ---------------- */
ipcMain.handle('lan:start', () =>
  lanStart((token, offer, from) => chat?.webContents.send('lan:offer', { token, offer, from })))
ipcMain.handle('lan:peers', () => lanPeers())
ipcMain.handle('lan:invite', (_e, id: string, offer: string) => lanInvite(id, offer))
ipcMain.handle('lan:answer', (_e, token: string, answer: string) => lanAnswer(token, answer))

ipcMain.handle('clip:text', (_e, text: string) => { clipboard.writeText(text); return true })
ipcMain.handle('clip:read', () => clipboard.readText())

ipcMain.handle('shot:copy', (_e, dataUrl: string) => {
  clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  return true
})

ipcMain.handle('shot:save', async (_e, dataUrl: string) => {
  const dir = join(app.getPath('pictures'), 'SnapDock')
  await mkdir(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(dir, `SnapDock ${ts}.png`)
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return file
})

ipcMain.on('shot:reveal', (_e, file: string) => shell.showItemInFolder(file))

/** Перетаскивание снимка прямо из виджета в Telegram/Figma/письмо. */
ipcMain.on('shot:drag', async (e, dataUrl: string) => {
  const dir = join(app.getPath('temp'), 'snapdock')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `snapdock-${Date.now()}.png`)
  await writeFile(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
  const icon = nativeImage.createFromDataURL(dataUrl).resize({ width: 128 })
  e.sender.startDrag({ file, icon })
})

/* ------------------------------------------------------------------ */
/* 2. Звук: системный loopback в AnalyserNode + микшер                  */
/* ------------------------------------------------------------------ */
/**
 * Тот же desktopCapturer, но с audio:'loopback' — окно выбора не всплывает.
 * Это даёт настоящий системный звук в Web Audio: EQ показывает то, что реально
 * играет (Spotify, YouTube, VLC, Zoom), а не синтетическую анимацию.
 * Windows: работает. macOS: нужен Electron >= 31 (ScreenCaptureKit). Linux: нет.
 */
function installLoopbackHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      if (!sources.length) return callback({})   // иначе TypeError: video must be a DesktopCapturerSource
      callback({ video: sources[0], audio: 'loopback' })
    },
  )
}

ipcMain.handle('audio:sessions', () => listSessions())
ipcMain.handle('audio:autoDuck', (_e, on: boolean) => { setAutoDuck(on); return on })
ipcMain.handle('audio:solo', async (_e, keepId: string) => {
  const list = await listSessions()
  for (const s of list) await setSessionVolume(s.id, s.id === keepId ? Math.max(s.volume, 0.8) : 0.1)
  return true
})
ipcMain.handle('audio:setVolume', (_e, id: string, v: number) => setSessionVolume(id, v))
ipcMain.handle('audio:setMute', (_e, id: string, m: boolean) => setSessionMute(id, m))
ipcMain.handle('audio:mute', (_e, m: boolean) => setMasterMute(m))
ipcMain.handle('audio:master', (_e, v?: number) =>
  typeof v === 'number' ? setMasterVolume(v) : getMasterVolume())

ipcMain.handle('media:command', (_e, cmd: string) => mediaCommand(cmd as never))
ipcMain.handle('media:seek', (_e, sec: number) => seekTo(sec))

/* ------------------------------------------------------------------ */
/* Горячие клавиши и трей                                              */
/* ------------------------------------------------------------------ */
function registerHotkeys() {
  const map: Record<string, () => void> = {
    'CommandOrControl+Shift+1': () => win?.webContents.send('hotkey', 'region'),
    'CommandOrControl+Shift+2': () => win?.webContents.send('hotkey', 'fullscreen'),
    'CommandOrControl+Shift+Space': () => win?.webContents.send('hotkey', 'playpause'),
    'CommandOrControl+Shift+M': () => win?.webContents.send('hotkey', 'mixer'),
    'CommandOrControl+Shift+D': () => toggleDock(),
    'CommandOrControl+Shift+Q': () => app.quit(),
  }
  for (const [k, fn] of Object.entries(map)) globalShortcut.register(k, fn)
}
function toggleDock() {
  if (!win) return createDock()
  win.isVisible() ? win.hide() : win.show()
}
const TRAY_FALLBACK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABDElEQVR42mNgGAWYgA2IDYA4AIiTgTiTQpwMNcsAajZeYAbEBUDcQyNcALUDKwhAVlxWVrZx9erVJ3fv3n2REgwyA2QWmkMCcFre2dm58/3795//UxmAzASZjc0RZjBBkGv/0xiA7EByBDg6CmA+R1d8+fLl+5RGAcgMdHORQgJkN8Q1yMH+/Pnzt0FBQUuolfhAZoHMRI4OJHlIgkN2IZLlrVTIhq0wRyDbgZQwUeMeFGRIlqtSoVxRhTkCOTqQ0gJDDyiuYBIgNlQik4qFWyYee8h3AEzPqAPQ+VgcRbkDsBk+6oBRBwwfBwx4UTzgldFAV8cD3iAZ8CbZgDdKB0WzfFB0TAZF12zkAQD/lPUUjvghwAAAAABJRU5ErkJggg=='

function createTray() {
  if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null }
  const path = app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../resources/tray.png')
  let icon = nativeImage.createFromPath(path)
  if (icon.isEmpty()) icon = nativeImage.createFromDataURL(TRAY_FALLBACK)
  if (icon.isEmpty()) return
  icon = icon.resize({ width: 16, height: 16 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)  // иначе в тёмном меню-баре не видно
  tray = new Tray(icon)
  const m = M[lang]
  tray.setToolTip('SnapDock')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: m.show, click: () => win?.show() },
    { label: m.area, accelerator: 'CommandOrControl+Shift+1', click: () => win?.webContents.send('hotkey', 'region') },
    { label: m.screen, accelerator: 'CommandOrControl+Shift+2', click: () => win?.webContents.send('hotkey', 'fullscreen') },
    { type: 'separator' },
    { label: m.lang, submenu: [
      { label: 'Русский', type: 'radio', checked: lang === 'ru', click: () => { lang = 'ru'; broadcastLang() } },
      { label: 'English', type: 'radio', checked: lang === 'en', click: () => { lang = 'en'; broadcastLang() } },
    ] },
    { type: 'separator' },
    { label: m.quit, accelerator: 'CommandOrControl+Shift+Q', click: () => app.quit() },
  ]))
  tray.on('click', () => toggleDock())
}

/* ------------------------------------------------------------------ */
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')

/**
 * Браузерный движок прячет домашний адрес компьютера за случайным именем ради
 * приватности. Между Mac и Windows в одной домашней сети это имя часто не
 * разрешается — и соседи по роутеру не находят друг друга. Отключаем маскировку:
 * трафик всё равно не выходит за пределы квартиры.
 */
const off = ['WebRtcHideLocalIpsWithMdns']
// macOS < 14.4: новый CoreAudio Tap ломает захват звука без отката на старые права
if (process.platform === 'darwin' && Number(process.getSystemVersion().split('.')[0]) < 15) {
  off.push('MacCatapLoopbackAudioForScreenShare')
}
app.commandLine.appendSwitch('disable-features', off.join(','))
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => win?.show())

app.whenReady().then(() => {
  // Автозапуск: виджет стартует свёрнутым, дальше открывается мгновенно
  if (!DEV) app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })

  // CSP вешаем заголовком и только в сборке: в dev она убивает горячую перезагрузку Vite
  if (!DEV) {
    session.defaultSession.webRequest.onHeadersReceived((d, cb) =>
      cb({ responseHeaders: { ...d.responseHeaders, 'Content-Security-Policy': [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; media-src 'self' blob:; connect-src 'self' ws: wss: https:",
      ] } }))
  }

  lang = app.getLocale().toLowerCase().startsWith('ru') ? 'ru' : 'en'

  // Программа без значка в доке не получает от macOS стандартных сочетаний.
  // Меню правки возвращает Cmd+C, Cmd+V, Cmd+A и Cmd+X во все поля ввода.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'SnapDock', submenu: [{ role: 'quit' }] },
    {
      label: lang === 'ru' ? 'Правка' : 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
  ]))
  installLoopbackHandler()
  createDock()
  createTray()
  registerHotkeys()
  watchCursor()
  if (process.argv.includes('--hidden')) win?.hide()
  startMediaWatcher((state) => win?.webContents.send('media:state', state))
  if (process.platform === 'darwin') app.dock?.hide()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  lanStop()
  import('./win-audio').then((m) => m.winStop()).catch(() => {})
})
process.on('uncaughtException', (err) => {
  if (DEV) dialog.showErrorBox('SnapDock', String(err?.stack ?? err))
  else console.error(err)
})
