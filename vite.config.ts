import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import type { PluginOption } from 'vite'

/** Milkdown ctx 切片按模块单例身份识别；Vite 开发态若拆出多份 @milkdown/*，
 *  第二个编辑器会报 Context "nodes" not found。生产打包只有一份故无此问题。 */
const MILKDOWN_DEDUPE = [
  '@milkdown/ctx',
  '@milkdown/core',
  '@milkdown/utils',
  '@milkdown/prose',
  '@milkdown/transformer',
  '@milkdown/kit',
  '@milkdown/crepe',
  '@milkdown/preset-commonmark',
  '@milkdown/preset-gfm',
  '@milkdown/components',
  '@milkdown/plugin-listener',
]

const host = process.env.TAURI_DEV_HOST

export default defineConfig(({ mode, command: _command }) => {
  const isBrowser = mode === 'browser'
  const isTauriUi = mode === 'tauri' || process.env.VITE_CCM_P0_SHELL === '1'

  const plugins: PluginOption[] = [react()]

  if (isTauriUi) {
    plugins.push({
      name: 'ccm-tauri-index-rename',
      closeBundle() {
        const from = path.resolve(__dirname, 'dist/index.tauri.html')
        const to = path.resolve(__dirname, 'dist/index.html')
        if (fs.existsSync(from)) {
          fs.renameSync(from, to)
        }
      },
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/' || req.url === '/index.html') {
            req.url = '/index.tauri.html'
          }
          next()
        })
      },
    })
  }

  return {
    plugins,
    clearScreen: false,
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    ...(isTauriUi
      ? {
          root: '.',
          build: {
            rollupOptions: {
              input: path.resolve(__dirname, 'index.tauri.html'),
            },
            target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
            minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
            sourcemap: !!process.env.TAURI_ENV_DEBUG,
            chunkSizeWarningLimit: 2000,
          },
        }
      : {}),
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, 'shared'),
      },
      dedupe: MILKDOWN_DEDUPE,
    },
    optimizeDeps: {
      include: [
        ...MILKDOWN_DEDUPE,
        '@milkdown/kit/core',
        '@milkdown/kit/utils',
        '@milkdown/kit/prose',
        '@milkdown/kit/prose/state',
        '@milkdown/kit/prose/view',
        '@milkdown/kit/prose/model',
        '@milkdown/kit/prose/commands',
        '@milkdown/kit/prose/gapcursor',
        '@milkdown/crepe/theme/common/style.css',
      ],
    },
    server: isTauriUi
      ? {
          port: 1420,
          strictPort: true,
          host: host || false,
          open: false,
          hmr: host
            ? {
                protocol: 'ws',
                host,
                port: 1421,
              }
            : undefined,
          watch: {
            ignored: ['**/src-tauri/**'],
          },
        }
      : {
          port: isBrowser ? 5180 : 5173,
          strictPort: isBrowser,
        },
  }
})
