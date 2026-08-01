/**
 * 核心路径类设置：扫描原则 + 默认盘符勾选 + 自定义根 + 程序目录 + 重置台账 + 五槽备份。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSnapshot, CatalogBackupInfo } from '../../shared/ipc'

function normPathKey(p: string): string {
  return p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function formatBackupTime(unix: number): string {
  if (!Number.isFinite(unix) || unix <= 0) return '（未知时间）'
  try {
    return new Date(unix * 1000).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(unix)
  }
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatKindSummary(bak: CatalogBackupInfo): string {
  if (bak.label?.trim()) return bak.label.trim()
  const counts = bak.kindCounts ?? {}
  const order = ['skill', 'rule', 'agent', 'command', 'hook']
  const parts: string[] = []
  const seen = new Set<string>()
  for (const k of order) {
    const n = counts[k]
    if (typeof n === 'number' && n > 0) {
      parts.push(`${k}×${n}`)
      seen.add(k)
    }
  }
  for (const [k, n] of Object.entries(counts)) {
    if (seen.has(k) || !(n > 0)) continue
    parts.push(`${k}×${n}`)
  }
  return parts.length > 0 ? parts.join(' · ') : '空台账'
}

export type SettingsModalProps = {
  snap: AppSnapshot
  busy: boolean
  onClose: () => void
  onPickLibrary: () => Promise<void>
  onPickNetworkLibrary?: () => Promise<void>
  onPickFolder: (title: string) => Promise<string | null>
  onOpenPath: (path: string) => Promise<void>
  onSave: (patch: {
    backupRoot: string
    projectScanRoots: string[]
    projectScanMaxDepth: number
    autoScanProjectsOnStartup: boolean
  }) => Promise<boolean>
  onResetCatalog: () => Promise<boolean>
  onListCatalogBackups: () => Promise<CatalogBackupInfo[]>
  onRestoreCatalogBackup: (id: string) => Promise<boolean>
  /** Plan/04 工作区可见性（多选） */
  onSetWorkspaceVisibility?: (ids: string[]) => Promise<boolean>
  onSetDefaultWorkspace?: (id: string) => Promise<boolean>
  onUpdateWorkspaceConfig?: (patch: {
    id: string
    enabled?: boolean
    displayName?: string
    containerRoot?: string
  }) => Promise<boolean>
}

export function SettingsModal({
  snap,
  busy,
  onClose,
  onPickLibrary,
  onPickNetworkLibrary,
  onPickFolder,
  onOpenPath,
  onSave,
  onResetCatalog,
  onListCatalogBackups,
  onRestoreCatalogBackup,
  onSetWorkspaceVisibility,
  onSetDefaultWorkspace,
  onUpdateWorkspaceConfig,
}: SettingsModalProps) {
  const defaults = useMemo(
    () => (snap.defaultProjectScanRoots?.length ? snap.defaultProjectScanRoots : []).map((p) =>
      p.replace(/\//g, '\\'),
    ),
    [snap.defaultProjectScanRoots],
  )
  const defaultKeys = useMemo(() => new Set(defaults.map(normPathKey)), [defaults])

  const [backupRoot, setBackupRoot] = useState(snap.disabledStorageDisplay || '')
  const [enabledDefaults, setEnabledDefaults] = useState<Set<string>>(() => new Set())
  const [customRoots, setCustomRoots] = useState<string[]>([])
  const [scanDepth, setScanDepth] = useState(snap.projectScanMaxDepth ?? 5)
  const [autoScan, setAutoScan] = useState(Boolean(snap.autoScanProjectsOnStartup))
  const [error, setError] = useState<string | null>(null)
  const [catalogBackups, setCatalogBackups] = useState<CatalogBackupInfo[]>([])
  const [selectedBackupId, setSelectedBackupId] = useState<string | null>(null)
  const [backupsLoading, setBackupsLoading] = useState(false)

  const refreshBackups = useCallback(async () => {
    setBackupsLoading(true)
    try {
      const list = await onListCatalogBackups()
      setCatalogBackups(Array.isArray(list) ? list : [])
    } catch {
      setCatalogBackups([])
    } finally {
      setBackupsLoading(false)
    }
  }, [onListCatalogBackups])

  const hydrateFromSnap = () => {
    setBackupRoot(snap.disabledStorageDisplay || '')
    setScanDepth(snap.projectScanMaxDepth ?? 5)
    setAutoScan(Boolean(snap.autoScanProjectsOnStartup))
    const configured = (snap.projectScanRoots ?? []).map((p) => p.replace(/\//g, '\\'))
    if (configured.length === 0) {
      // 空配置 = 全部默认盘符已勾选、无自定义
      setEnabledDefaults(new Set(defaults.map(normPathKey)))
      setCustomRoots([])
    } else {
      const enabled = new Set<string>()
      const custom: string[] = []
      for (const p of configured) {
        const k = normPathKey(p)
        if (defaultKeys.has(k)) enabled.add(k)
        else custom.push(p)
      }
      setEnabledDefaults(enabled)
      setCustomRoots(custom)
    }
  }

  useEffect(() => {
    hydrateFromSnap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snap.disabledStorageDisplay,
    snap.projectScanRoots,
    snap.projectScanMaxDepth,
    snap.autoScanProjectsOnStartup,
    snap.defaultProjectScanRoots,
  ])

  useEffect(() => {
    void refreshBackups()
  }, [refreshBackups])

  const toggleDefault = (path: string) => {
    const k = normPathKey(path)
    setEnabledDefaults((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
    setError(null)
  }

  const addCustomRoot = async () => {
    const path = await onPickFolder('选择自定义项目扫描根')
    if (!path) return
    const display = path.replace(/\//g, '\\')
    const k = normPathKey(display)
    if (defaultKeys.has(k)) {
      setEnabledDefaults((prev) => new Set(prev).add(k))
      setError(null)
      return
    }
    setCustomRoots((prev) => (prev.some((p) => normPathKey(p) === k) ? prev : [...prev, display]))
    setError(null)
  }

  const removeCustomRoot = (path: string) => {
    const k = normPathKey(path)
    setCustomRoots((prev) => prev.filter((p) => normPathKey(p) !== k))
    setError(null)
  }

  const pickBackup = async () => {
    const path = await onPickFolder('选择备份根目录')
    if (!path) return
    setBackupRoot(path.replace(/\//g, '\\'))
  }

  const buildEnabledRoots = (): string[] => {
    const out: string[] = []
    const seen = new Set<string>()
    for (const d of defaults) {
      const k = normPathKey(d)
      if (!enabledDefaults.has(k)) continue
      if (seen.has(k)) continue
      seen.add(k)
      out.push(d)
    }
    for (const c of customRoots) {
      const k = normPathKey(c)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(c)
    }
    return out
  }

  const save = async () => {
    const roots = buildEnabledRoots()
    if (roots.length === 0) {
      setError('请至少启用一个扫描根（默认盘符或自定义）')
      return
    }
    const depth = Number.isFinite(scanDepth) ? Math.min(20, Math.max(0, Math.floor(scanDepth))) : 5
    const ok = await onSave({
      backupRoot: backupRoot.trim(),
      projectScanRoots: roots,
      projectScanMaxDepth: depth,
      autoScanProjectsOnStartup: autoScan,
    })
    if (ok) onClose()
  }

  const resetCatalog = async () => {
    const okConfirm = window.confirm(
      '确定重置永久库台账 catalog.json？\n\n只会清空条目与项目登记，不会删除库内 skills/rules 等文件。\n当前台账会先写入 catalog-backups/（最多保留 5 份）。',
    )
    if (!okConfirm) return
    const ok = await onResetCatalog()
    if (ok) await refreshBackups()
  }

  const restoreBackup = async (bak: CatalogBackupInfo) => {
    const when = formatBackupTime(bak.createdAtUnix)
    const kinds = formatKindSummary(bak)
    const samples = (bak.sampleEntryIds ?? []).slice(0, 4).join(', ') || '（无样例条目）'
    const okConfirm = window.confirm(
      `确定调入此台账备份？\n\n时间：${when}\n构成：${kinds}\n条目：${bak.entryCount} · 项目：${bak.projectCount}\n样例：${samples}\n\n会先备份当前 catalog.json，再覆盖为所选备份。`,
    )
    if (!okConfirm) return
    const ok = await onRestoreCatalogBackup(bak.id)
    if (ok) await refreshBackups()
  }

  const selected = catalogBackups.find((b) => b.id === selectedBackupId) ?? null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        <h3>设置</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          配置永久库、扫描范围与程序目录。筛选勾选仍在主界面顶栏。
        </p>

        <div className="settings-form">
          <section className="settings-principles" aria-label="扫描原则">
            <h4 className="settings-section-title">扫描原则</h4>
            <ol>
              <li>
                <strong>扫什么</strong>
                ：在启用的扫描根下按深度 walk，发现带{' '}
                <code>.cursor</code> / <code>.claude</code> / <code>.codex</code> /{' '}
                <code>.agents</code> 的项目；并扫用户级全局容器与备份根下 skills。
              </li>
              <li>
                <strong>根从哪来</strong>
                ：默认盘符（勾选启用，不可删）∪ 自定义目录（可增删）；保存写入 ProjectScanRoots。
              </li>
              <li>
                <strong>深度</strong>
                ：限制嵌套 <code>.cursor</code> 搜索层数。
              </li>
              <li>
                <strong>入库</strong>
                ：同名冲突需决议；台账在永久库 <code>catalog.json</code>。
              </li>
              <li>
                <strong>全局工作区</strong>
                ：Cursor / Claude / Codex 各绑独立容器根；下方可勾选显示、改路径与默认。
              </li>
            </ol>
          </section>

          <section className="settings-workspaces" aria-label="全局工作区">
            <h4 className="settings-section-title">全局工作区</h4>
            <p className="sub" style={{ marginTop: 0, marginBottom: 8 }}>
              勾选「显示」后侧栏与列表出现对应容器分区；「默认」决定首次焦点；部署写入当前焦点工作区。
            </p>
            <table className="settings-ws-table">
              <thead>
                <tr>
                  <th>启用</th>
                  <th>显示</th>
                  <th>默认</th>
                  <th>名称</th>
                  <th>容器根</th>
                </tr>
              </thead>
              <tbody>
                {(snap.workspaces ?? []).map((w) => (
                  <tr key={w.id} className={w.isFocused ? 'is-focused' : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={w.enabled}
                        disabled={busy || !onUpdateWorkspaceConfig}
                        title="未启用则不出现在侧栏候选"
                        onChange={(e) =>
                          void onUpdateWorkspaceConfig?.({ id: w.id, enabled: e.target.checked })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={w.isVisible}
                        disabled={busy || !w.enabled || !onSetWorkspaceVisibility}
                        title="显示在侧栏与列表分区"
                        onChange={(e) => {
                          const cur = new Set(snap.visibleWorkspaceIds ?? [])
                          if (e.target.checked) cur.add(w.id)
                          else cur.delete(w.id)
                          void onSetWorkspaceVisibility?.([...cur])
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="radio"
                        name="default-workspace"
                        checked={w.isDefault}
                        disabled={busy || !w.enabled || !onSetDefaultWorkspace}
                        title="设为默认工作区"
                        onChange={() => void onSetDefaultWorkspace?.(w.id)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="settings-ws-name"
                        defaultValue={w.displayName}
                        disabled={busy || !onUpdateWorkspaceConfig}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v && v !== w.displayName) {
                            void onUpdateWorkspaceConfig?.({ id: w.id, displayName: v })
                          }
                        }}
                      />
                    </td>
                    <td>
                      <div className="settings-row settings-ws-root">
                        <input
                          type="text"
                          readOnly
                          value={w.containerRoot || '（默认）'}
                          title={w.containerRoot}
                        />
                        <button
                          type="button"
                          disabled={busy || !onUpdateWorkspaceConfig}
                          onClick={() => {
                            void (async () => {
                              const path = await onPickFolder(`选择 ${w.displayName} 容器根`)
                              if (!path) return
                              await onUpdateWorkspaceConfig?.({
                                id: w.id,
                                containerRoot: path.replace(/\//g, '\\'),
                              })
                            })()
                          }}
                        >
                          浏览…
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <label className="settings-field">
            <span className="settings-label">永久库</span>
            <div className="settings-row">
              <input
                type="text"
                readOnly
                value={snap.libraryRootDisplay || '（未配置）'}
                title={snap.libraryRootDisplay}
              />
              <button type="button" disabled={busy} onClick={() => void onPickLibrary()}>
                浏览…
              </button>
              <button
                type="button"
                disabled={busy || !snap.libraryRootDisplay || snap.libraryRootDisplay.includes('未配置')}
                onClick={() => void onOpenPath(snap.libraryRootDisplay)}
              >
                打开
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span className="settings-label">网络库（开源橱窗）</span>
            <div className="settings-row">
              <input
                type="text"
                readOnly
                value={snap.networkLibraryRootDisplay || '（未配置）'}
                title={snap.networkLibraryRootDisplay}
              />
              <button
                type="button"
                disabled={busy || !onPickNetworkLibrary}
                onClick={() => void onPickNetworkLibrary?.()}
              >
                浏览…
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  !snap.networkLibraryRootDisplay ||
                  snap.networkLibraryRootDisplay.includes('未配置')
                }
                onClick={() => void onOpenPath(snap.networkLibraryRootDisplay)}
              >
                打开
              </button>
            </div>
            <p className="settings-hint">
              与永久库隔离的只读缓存根；默认在用户目录下 CCM-NetworkLibrary。禁止与永久库同路径。
            </p>
          </label>

          <label className="settings-field">
            <span className="settings-label">备份根</span>
            <div className="settings-row">
              <input
                type="text"
                readOnly
                value={backupRoot || '（空则回落 E:\\cursorBf）'}
                title={backupRoot}
              />
              <button type="button" disabled={busy} onClick={() => void pickBackup()}>
                浏览…
              </button>
              <button
                type="button"
                disabled={busy || !backupRoot.trim()}
                onClick={() => void onOpenPath(backupRoot.trim())}
              >
                打开
              </button>
            </div>
          </label>

          <div className="settings-field">
            <span className="settings-label">默认扫描盘符</span>
            <span className="settings-hint">勾选启用；可打开；不可删除</span>
            {defaults.length === 0 ? (
              <div className="settings-empty">（未检测到可用盘符）</div>
            ) : (
              <ul className="settings-scan-roots">
                {defaults.map((p) => {
                  const k = normPathKey(p)
                  const on = enabledDefaults.has(k)
                  return (
                    <li key={k}>
                      <label className="settings-root-check">
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy}
                          onChange={() => toggleDefault(p)}
                        />
                        <code title={p}>{p}</code>
                      </label>
                      <button type="button" disabled={busy} onClick={() => void onOpenPath(p)}>
                        打开
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div className="settings-field">
            <div className="settings-label-row">
              <span className="settings-label">自定义扫描根</span>
              <button type="button" disabled={busy} onClick={() => void addCustomRoot()}>
                添加…
              </button>
            </div>
            {customRoots.length === 0 ? (
              <div className="settings-empty">（无自定义根；可添加工作区等目录）</div>
            ) : (
              <ul className="settings-scan-roots">
                {customRoots.map((p) => (
                  <li key={normPathKey(p)}>
                    <code title={p}>{p}</code>
                    <div className="settings-root-actions">
                      <button type="button" disabled={busy} onClick={() => void onOpenPath(p)}>
                        打开
                      </button>
                      <button type="button" disabled={busy} onClick={() => removeCustomRoot(p)}>
                        删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="settings-field">
            <span className="settings-label">扫描深度</span>
            <input
              type="number"
              min={0}
              max={20}
              value={scanDepth}
              disabled={busy}
              onChange={(e) => setScanDepth(Number(e.target.value))}
            />
            <span className="settings-hint">0–20；嵌套 .cursor 搜索深度</span>
          </label>

          <label className="settings-field settings-check">
            <input
              type="checkbox"
              checked={autoScan}
              disabled={busy}
              onChange={(e) => setAutoScan(e.target.checked)}
            />
            <span>启动时自动扫描</span>
          </label>

          <label className="settings-field">
            <span className="settings-label">程序设置目录</span>
            <div className="settings-row">
              <input
                type="text"
                readOnly
                value={snap.appSettingsDirDisplay || '（未知）'}
                title={snap.appSettingsDirDisplay}
              />
              <button
                type="button"
                disabled={busy || !snap.appSettingsDirDisplay}
                onClick={() => void onOpenPath(snap.appSettingsDirDisplay)}
              >
                打开
              </button>
            </div>
            <span className="settings-hint">内含 settings.json（应用配置落盘）</span>
          </label>

          <section className="settings-danger" aria-label="危险操作">
            <h4 className="settings-section-title">危险操作</h4>
            <p className="settings-hint">
              重置台账只清空 catalog.json 中的条目与项目登记，不删除永久库磁盘上的文件；会先写入
              catalog-backups/（最多 5 份）。
            </p>
            <button type="button" disabled={busy} className="danger" onClick={() => void resetCatalog()}>
              重置台账 catalog.json…
            </button>

            <div className="settings-catalog-backups">
              <div className="settings-label-row">
                <span className="settings-label">台账备份（最多 5）</span>
                <button type="button" disabled={busy || backupsLoading} onClick={() => void refreshBackups()}>
                  刷新
                </button>
              </div>
              {backupsLoading && catalogBackups.length === 0 ? (
                <div className="settings-empty">加载中…</div>
              ) : catalogBackups.length === 0 ? (
                <div className="settings-empty">（尚无备份；重置或调入时会自动写入）</div>
              ) : (
                <ul className="settings-backup-list">
                  {catalogBackups.map((b) => {
                    const active = b.id === selectedBackupId
                    return (
                      <li key={b.id} className={active ? 'is-selected' : undefined}>
                        <button
                          type="button"
                          className="settings-backup-row"
                          disabled={busy}
                          onClick={() => setSelectedBackupId(active ? null : b.id)}
                        >
                          <span className="settings-backup-time">{formatBackupTime(b.createdAtUnix)}</span>
                          <span className="settings-backup-kinds">{formatKindSummary(b)}</span>
                          <span className="settings-backup-meta">
                            条目 {b.entryCount} · 项目 {b.projectCount} · {formatBytes(b.fileSizeBytes)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {selected ? (
                <div className="settings-backup-detail">
                  <div>
                    <strong>详情</strong>
                  </div>
                  <div>
                    时间：{formatBackupTime(selected.createdAtUnix)}（unix {selected.createdAtUnix}）
                  </div>
                  <div>构成：{formatKindSummary(selected)}</div>
                  <div>
                    条目 {selected.entryCount} · 项目 {selected.projectCount} ·{' '}
                    {formatBytes(selected.fileSizeBytes)}
                  </div>
                  <div>
                    样例条目：
                    {(selected.sampleEntryIds ?? []).length > 0
                      ? (selected.sampleEntryIds ?? []).join(', ')
                      : '（无）'}
                  </div>
                  <div>
                    样例项目：
                    {(selected.sampleProjectNames ?? []).length > 0
                      ? (selected.sampleProjectNames ?? []).join(', ')
                      : '（无）'}
                  </div>
                  <div className="settings-backup-path" title={selected.path}>
                    路径：{selected.path}
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className="danger"
                    onClick={() => void restoreBackup(selected)}
                  >
                    调入此台账…
                  </button>
                </div>
              ) : null}
            </div>
          </section>

          {error ? <div className="settings-error">{error}</div> : null}
        </div>

        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            保存
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  )
}
