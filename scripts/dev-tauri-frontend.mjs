#!/usr/bin/env node
/**
 * Dev frontend for tauri beforeDevCommand.
 * Default: Vite only (no Node sidecar).
 * Optional: CCM_USE_SIDECAR=1 → also start sidecar (or reuse healthy :17832).
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const SIDECAR_PORT = Number(process.env.CCM_SIDECAR_PORT || 17832)
const VITE_PORT = Number(process.env.CCM_VITE_PORT || 1420)
const wantSidecar =
  process.env.CCM_USE_SIDECAR === '1' || process.env.VITE_CCM_USE_SIDECAR === '1'

const kids = []

function httpOk(url, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume()
      resolve(res.statusCode != null && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function sidecarHealthy() {
  return httpOk(`http://127.0.0.1:${SIDECAR_PORT}/health`)
}

async function viteUp() {
  return httpOk(`http://127.0.0.1:${VITE_PORT}/`)
}

function run(script, extraEnv = {}) {
  const child = spawn(npm, ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  })
  kids.push(child)
  child.on('exit', (code) => {
    if (code && code !== 0) {
      for (const k of kids) {
        if (k !== child && !k.killed) k.kill()
      }
      process.exit(code)
    }
  })
  return child
}

function shutdown() {
  for (const k of kids) {
    if (!k.killed) k.kill()
  }
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (wantSidecar) {
  const sideOk = await sidecarHealthy()
  if (sideOk) {
    console.log(`[dev-tauri-frontend] reuse sidecar :${SIDECAR_PORT}`)
  } else {
    console.log(`[dev-tauri-frontend] starting sidecar (CCM_USE_SIDECAR=1)`)
    run('sidecar')
    for (let i = 0; i < 40; i++) {
      if (await sidecarHealthy()) break
      await new Promise((r) => setTimeout(r, 250))
    }
  }
} else {
  console.log('[dev-tauri-frontend] sidecar skipped (set CCM_USE_SIDECAR=1 to enable)')
}

const uiOk = await viteUp()
if (uiOk) {
  console.log(`[dev-tauri-frontend] reuse Vite :${VITE_PORT}`)
} else {
  run('dev:tauri-ui', wantSidecar ? { VITE_CCM_USE_SIDECAR: '1' } : {})
}
