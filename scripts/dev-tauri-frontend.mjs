#!/usr/bin/env node
/**
 * Dev frontend for tauri beforeDevCommand：只起 Vite（端口 1430）。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const VITE_PORT = Number(process.env.CCM_VITE_PORT || 1430)

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

async function viteUp() {
  return httpOk(`http://127.0.0.1:${VITE_PORT}/`)
}

function run(script) {
  const child = spawn(npm, ['run', script], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
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

const uiOk = await viteUp()
if (uiOk) {
  console.log(`[dev-tauri-frontend] reuse Vite :${VITE_PORT}`)
} else {
  run('dev:tauri-ui')
}
