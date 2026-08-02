/**
 * Plan/04 #4/#5：对本机 settings.json 做「改容器根 + 默认工作区」落盘，
 * 供重启 GUI 后核对仍保持。用法见文件尾注释。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const settingsPath = path.join(process.env.APPDATA || '', 'CCM-Tauri2', 'settings.json')
const bakPath = settingsPath + '.bak-plan04'
const customRoot = path.join(os.tmpdir(), 'ccm-plan04-claude-root')
const mode = process.argv[2] || 'apply'

function readJson(p) {
  let raw = fs.readFileSync(p, 'utf8')
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
  return JSON.parse(raw)
}

if (mode === 'apply') {
  if (!fs.existsSync(settingsPath)) {
    console.error('missing settings', settingsPath)
    process.exit(1)
  }
  fs.mkdirSync(customRoot, { recursive: true })
  fs.copyFileSync(settingsPath, bakPath)
  const s = readJson(settingsPath)
  s.DefaultWorkspaceId = 'claude'
  s.VisibleWorkspaceIds = ['cursor', 'claude']
  s.SelectedGlobalTool = 'claude'
  if (!Array.isArray(s.Workspaces)) s.Workspaces = []
  let claude = s.Workspaces.find((w) => String(w.Id).toLowerCase() === 'claude')
  if (!claude) {
    claude = { Id: 'claude', DisplayName: 'Claude', Enabled: true, ContainerRoot: customRoot }
    s.Workspaces.push(claude)
  } else {
    claude.Enabled = true
    claude.ContainerRoot = customRoot
  }
  let cursor = s.Workspaces.find((w) => String(w.Id).toLowerCase() === 'cursor')
  if (cursor) cursor.Enabled = true
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2), 'utf8')
  console.log(
    JSON.stringify({
      ok: true,
      mode: 'apply',
      bakPath,
      customRoot,
      DefaultWorkspaceId: s.DefaultWorkspaceId,
      ClaudeRoot: claude.ContainerRoot,
    }),
  )
} else if (mode === 'verify') {
  const s = readJson(settingsPath)
  const claude = (s.Workspaces || []).find((w) => String(w.Id).toLowerCase() === 'claude')
  const root = claude?.ContainerRoot || ''
  const ok =
    s.DefaultWorkspaceId === 'claude' &&
    root.toLowerCase() === customRoot.toLowerCase() &&
    (s.VisibleWorkspaceIds || []).map((x) => String(x).toLowerCase()).includes('claude')
  console.log(
    JSON.stringify({
      ok,
      DefaultWorkspaceId: s.DefaultWorkspaceId,
      ClaudeRoot: root,
      expectedRoot: customRoot,
      VisibleWorkspaceIds: s.VisibleWorkspaceIds,
    }),
  )
  process.exit(ok ? 0 : 1)
} else if (mode === 'restore') {
  if (!fs.existsSync(bakPath)) {
    console.error('missing bak', bakPath)
    process.exit(1)
  }
  fs.copyFileSync(bakPath, settingsPath)
  fs.unlinkSync(bakPath)
  console.log(JSON.stringify({ ok: true, mode: 'restore', settingsPath }))
} else {
  console.error('usage: node plan04-workspace-handtest.mjs apply|verify|restore')
  process.exit(2)
}
