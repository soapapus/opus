import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/main/index.ts') } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [
      react(),
      {
        // Chromium은 woff2만 있으면 되므로 용량이 큰 woff 사본은 앱에 넣지 않는다
        name: 'fonts-woff2-only',
        enforce: 'pre',
        transform(code: string, id: string) {
          if (id.includes('@fontsource') && id.includes('.css')) {
            return { code: code.replace(/,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g, ''), map: null }
          }
          return null
        }
      }
    ],
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    }
  }
})
