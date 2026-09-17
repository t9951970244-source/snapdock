import { contextBridge, ipcRenderer } from 'electron'

const api = {
  /* окно */
  reportHeight: (h: number) => ipcRenderer.send('dock:height', h),
  dragStart: () => ipcRenderer.send('dock:dragStart'),
  dragEnd: () => ipcRenderer.send('dock:dragEnd'),
  settle: () => ipcRenderer.invoke('dock:settle'),
  quit: () => ipcRenderer.send('app:quit'),

  /* снимки */
  shotRegion: () => ipcRenderer.invoke('shot:region'),
  shotFullscreen: () => ipcRenderer.invoke('shot:fullscreen'),
  copyShot: (d: string) => ipcRenderer.invoke('shot:copy', d),
  copyText: (t: string) => ipcRenderer.invoke('clip:text', t),
  readText: () => ipcRenderer.invoke('clip:read') as Promise<string>,
  shotPermission: () => ipcRenderer.invoke('shot:permission') as Promise<string>,
  openScreenSettings: () => ipcRenderer.send('shot:openSettings'),
  openCameraSettings: () => ipcRenderer.send('cam:openSettings'),
  askCamera: () => ipcRenderer.invoke('cam:ask') as Promise<string>,
  saveShot: (d: string) => ipcRenderer.invoke('shot:save', d) as Promise<string>,
  revealShot: (f: string) => ipcRenderer.send('shot:reveal', f),
  dragShot: (d: string) => ipcRenderer.send('shot:drag', d),

  /* звук */
  sessions: () => ipcRenderer.invoke('audio:sessions'),
  setSessionVolume: (id: string, v: number) => ipcRenderer.invoke('audio:setVolume', id, v),
  setSessionMute: (id: string, m: boolean) => ipcRenderer.invoke('audio:setMute', id, m),
  autoDuck: (on: boolean) => ipcRenderer.invoke('audio:autoDuck', on),
  solo: (id: string) => ipcRenderer.invoke('audio:solo', id),
  master: (v?: number) => ipcRenderer.invoke('audio:master', v) as Promise<number>,
  masterMute: (m: boolean) => ipcRenderer.invoke('audio:mute', m),
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
  lanStart: () => ipcRenderer.invoke('lan:start') as Promise<{ id: string; name: string }>,
  lanPeers: () => ipcRenderer.invoke('lan:peers') as Promise<any[]>,
  lanInvite: (id: string, offer: string) => ipcRenderer.invoke('lan:invite', id, offer) as Promise<string | null>,
  lanAnswer: (token: string, answer: string) => ipcRenderer.invoke('lan:answer', token, answer),
  onLanOffer: (cb: (d: { token: string; offer: string; from: string }) => void) => {
    const h = (_e: unknown, d: any) => cb(d)
    ipcRenderer.on('lan:offer', h)
    return () => ipcRenderer.removeListener('lan:offer', h)
  },
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
