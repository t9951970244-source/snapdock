import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'node:path'

// Необязательные нативные модули: их может не быть в системе.
// Без external Rollup падает с «could not resolve» ещё до запуска.
const OPTIONAL = ['@coooookies/windows-smtc-monitor', 'native-sound-mixer']

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: { build: { rollupOptions: { external: OPTIONAL } } },
      },
      preload: { input: resolve(__dirname, 'electron/preload.ts') },
    }),
    renderer(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        overlay: resolve(__dirname, 'windows/overlay/index.html'),
        editor: resolve(__dirname, 'windows/editor/index.html'),
        chat: resolve(__dirname, 'windows/chat/index.html'),
      },
    },
  },
})
