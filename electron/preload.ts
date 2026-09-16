import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /* окно */
  reportHeight: (h: number) => ipcRenderer.send('dock:height', h),
  dragStart: () => ipcRenderer.send('dock:dragStart'),
  dragEnd: () => ipcRenderer.send('dock:dragEnd'),
  snapToEdge: () => ipcRenderer.invoke('dock:snapToEdge') as Promise<'left' | 'right'>,
  quit: () => ipcRenderer.send('app:quit'),

  /* снимки */
  shotRegion: () => ipcRenderer.invoke('shot:region'),
  shotFullscreen: () => ipcRenderer.invoke('shot:fullscreen'),
  copyShot: (d: string) => ipcRenderer.invoke('shot:copy', d),
  copyText: (t: string) => ipcRenderer.invoke('clip:text', t),
  shotPermission: () => ipcRenderer.invoke('shot:permission') as Promise<string>,
  openScreenSettings: () => ipcRenderer.send('shot:openSettings'),
  saveShot: (d: string) => ipcRenderer.invoke('shot:save', d) as Promise<string>,
  revealShot: (f: string) => ipcRenderer.send('shot:reveal', f),
  dragShot: (d: string) => ipcRenderer.send('shot:drag', d),

  /* звук */
  sessions: () => ipcRenderer.invoke('audio:sessions'),
  setSessionVolume: (id: string, v: number) => ipcRenderer.invoke('audio:setVolume', id, v),
  setSessionMute: (id: string, m: boolean) => ipcRenderer.invoke('audio:setMute', id, m),
  master: (v?: number) => ipcRenderer.invoke('audio:master', v) as Promise<number>,
  mediaCommand: (c: 'play' | 'pause' | 'toggle' | 'next' | 'prev') => ipcRenderer.invoke('media:command', c),
  mediaSeek: (sec: number) => ipcRenderer.invoke('media:seek', sec),
  onMedia: (cb: (s: unknown) => void) => {
    const h = (_e: unknown, s: unknown) => cb(s)
    ipcRenderer.on('media:state', h)
    return () => ipcRenderer.removeListener('media:state', h)
  },
  onHotkey: (cb: (k: string) => void) => {
    const h = (_e: unknown, k: string) => cb(k)
    ipcRenderer.on('hotkey', h)
    return () => ipcRenderer.removeListener('hotkey', h)
  },

  /* окна-помощники */
  onOverlayImage: (cb: (s: any) => void) => ipcRenderer.on('overlay:image', (_e, s) => cb(s)),
  overlayDone: (rect: { x: number; y: number; w: number; h: number } | null) =>
    ipcRenderer.send('overlay:done', rect),
  onEditorImage: (cb: (d: string) => void) => ipcRenderer.on('editor:image', (_e, d) => cb(d)),
  closeEditor: () => ipcRenderer.send('editor:close'),
  openChat: () => ipcRenderer.send('chat:open'),
  closeChat: () => ipcRenderer.send('chat:close'),

  getLang: () => ipcRenderer.invoke('lang:get') as Promise<'ru' | 'en'>,
  setLang: (l: 'ru' | 'en') => ipcRenderer.send('lang:set', l),
  onLang: (cb: (l: 'ru' | 'en') => void) => {
    const h = (_e: unknown, l: 'ru' | 'en') => cb(l)
    ipcRenderer.on('lang', h)
    return () => ipcRenderer.removeListener('lang', h)
  },

  platform: process.platform,
}

contextBridge.exposeInMainWorld('snap', api)
export type SnapApi = typeof api
