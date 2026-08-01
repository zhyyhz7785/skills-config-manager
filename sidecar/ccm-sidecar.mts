/**
 * CCM Node sidecar — HTTP JSON IPC for Tauri migration (M0+).
 * POST /invoke  body: { method, args? }  → IpcEnvelope
 */
import http from 'node:http'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { headlessElectron } from '../electron/headlessElectron.ts'

const require = createRequire(import.meta.url)
const Module = require('module') as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
const originalLoad = Module._load
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'electron') return headlessElectron
  return originalLoad(request, parent, isMain)
}

const PORT = Number(process.env.CCM_SIDECAR_PORT || 17832)
const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')
process.env.CCM_SETTINGS_PATH =
  process.env.CCM_SETTINGS_PATH ?? path.join(APPDATA, 'CCM-Tauri2', 'settings.json')
process.env.CCM_DEFAULT_LIBRARY_ROOT =
  process.env.CCM_DEFAULT_LIBRARY_ROOT?.trim() || 'C:\\CursorSkills-Tauri2Spike'

const { AppController } = await import('../electron/appController.ts')
const controller = new AppController()

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, port: PORT }))
    return
  }
  if (req.method !== 'POST' || req.url !== '/invoke') {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  let body: { method?: string; args?: Record<string, unknown> }
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, message: 'invalid JSON' }))
    return
  }
  const method = body.method
  if (!method || typeof method !== 'string') {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, message: 'missing method' }))
    return
  }
  try {
    const envelope = await controller.handle(method as never, body.args ?? {})
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(envelope))
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: false, message }))
  }
})

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[ccm-sidecar] port ${PORT} in use — if health ok, another sidecar is already running (reuse it).`,
    )
    // Exit 0 so parent stack can continue when we detect reuse externally;
    // hard fail only if this process was supposed to own the port alone.
    process.exit(0)
  }
  console.error('[ccm-sidecar] listen error', err)
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    `[ccm-sidecar] http://127.0.0.1:${PORT} settings=${process.env.CCM_SETTINGS_PATH}`,
  )
})
