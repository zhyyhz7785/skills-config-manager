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
    networkUpdateCheckIntervalMinutes: number
    skillsShApiToken: string
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
  /** Plan/05：漂移报告 / 部署配方 */
  onPreviewDrift?: () => Promise<{
    message: string
    items: Array<{ entryId: string; workspaceId: string; reason: string }>
  } | null>
  onListRecipes?: () => Promise<Array<{ id: string; name: string; entryIds: string[]; workspaceId: string }>>
  onSaveRecipe?: (recipe: {
    id: string
    name: string
    entryIds: string[]
    workspaceId: string
  }) => Promise<boolean>
  onApplyRecipe?: (id: string) => Promise<boolean>
  onDeleteRecipe?: (id: string) => Promise<boolean>
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
  onPreviewDrift,
  onListRecipes,
  onSaveRecipe,
  onApplyRecipe,
  onDeleteRecipe,
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
  const [netCheckMins, setNetCheckMins] = useState(snap.networkUpdateCheckIntervalMinutes ?? 0)
  const [skillsToken, setSkillsToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [driftMsg, setDriftMsg] = useState<string | null>(null)
  const [driftItems, setDriftItems] = useState<
    Array<{ entryId: string; workspaceId: string; reason: string }>
  >([])
  const [recipes, setRecipes] = useState<
    Array<{ id: string; name: string; entryIds: string[]; workspaceId: string }>
  >([])
  const [recipeName, setRecipeName] = useState('')
  const [showFirstTip, setShowFirstTip] = useState(() => {
    try {
      return localStorage.getItem('ccm.firstTip') !== '0'
    } catch {
      return true
    }
  })
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
    setNetCheckMins(snap.networkUpdateCheckIntervalMinutes ?? 0)
    setSkillsToken('')
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
    snap.networkUpdateCheckIntervalMinutes,
    snap.skillsShConfigured,
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
      networkUpdateCheckIntervalMinutes: netCheckMins,
      skillsShApiToken: skillsToken,
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
                ：Cursor / Claude / Codex / Gemini / OpenCode 等常用工具各绑独立容器根；下方可勾选显示、改路径与默认。
              </li>
            </ol>
            <label className="settings-check" style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <input
                type="checkbox"
                checked={showFirstTip}
                disabled={busy}
                onChange={(e) => {
                  const on = e.target.checked
                  setShowFirstTip(on)
                  try {
                    localStorage.setItem('ccm.firstTip', on ? '1' : '0')
                  } catch {
                    /* ignore */
                  }
                }}
              />
              <span>显示首次提示（帮助见 Docs/06 五分钟路径）</span>
            </label>
          </section>

          <section className="settings-workspaces" aria-label="全局工作区">
            <h4 className="settings-section-title">全局工作区</h4>
            <p className="sub" style={{ marginTop: 0, marginBottom: 8 }}>
              勾选「显示」后侧栏与列表出现对应容器分区；「默认」决定首次焦点；部署写入当前焦点工作区。内置探测含 Cursor / Claude / Codex / Gemini CLI / OpenCode / Windsurf / Continue。
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

          <section className="settings-drift" aria-label="漂移报告">
            <h4 className="settings-section-title">漂移报告</h4>
            <p className="sub" style={{ marginTop: 0, marginBottom: 8 }}>
              对比可见工作区/当前项目容器副本与永久库哈希；列出「与库不一致」项（只读报告，不自动覆盖）。
            </p>
            <button
              type="button"
              disabled={busy || !onPreviewDrift}
              onClick={() => {
                void (async () => {
                  const r = await onPreviewDrift?.()
                  if (!r) {
                    setDriftMsg('无法生成报告')
                    setDriftItems([])
                    return
                  }
                  setDriftMsg(r.message)
                  setDriftItems(r.items)
                })()
              }}
            >
              生成漂移报告
            </button>
            {driftMsg ? <p className="sub">{driftMsg}</p> : null}
            {driftItems.length > 0 ? (
              <ul className="settings-drift-list">
                {driftItems.map((it) => (
                  <li key={`${it.entryId}:${it.workspaceId}`}>
                    [{it.workspaceId}] {it.entryId} — {it.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="settings-recipes" aria-label="部署配方">
            <h4 className="settings-section-title">部署配方</h4>
            <p className="sub" style={{ marginTop: 0, marginBottom: 8 }}>
              配方 = 永久库条目列表 + 目标焦点工作区；一次复制部署，不做 live sync。网络库条目不可入配方。
            </p>
            <div className="settings-row" style={{ marginBottom: 8 }}>
              <input
                type="text"
                placeholder="配方名称"
                value={recipeName}
                disabled={busy}
                onChange={(e) => setRecipeName(e.target.value)}
              />
              <button
                type="button"
                disabled={busy || !onSaveRecipe || !recipeName.trim() || !(snap.selectedEntryIds?.length)}
                onClick={() => {
                  void (async () => {
                    const ok = await onSaveRecipe?.({
                      id: '',
                      name: recipeName.trim(),
                      entryIds: [...(snap.selectedEntryIds ?? [])],
                      workspaceId: snap.selectedGlobalTool || '',
                    })
                    if (ok) {
                      setRecipeName('')
                      const list = (await onListRecipes?.()) ?? []
                      setRecipes(list)
                    }
                  })()
                }}
              >
                用当前选中保存
              </button>
              <button
                type="button"
                disabled={busy || !onListRecipes}
                onClick={() => {
                  void (async () => setRecipes((await onListRecipes?.()) ?? []))()
                }}
              >
                刷新列表
              </button>
            </div>
            {recipes.length > 0 ? (
              <ul className="settings-recipe-list">
                {recipes.map((r) => (
                  <li key={r.id}>
                    <span>
                      {r.name}（{r.entryIds.length} 项
                      {r.workspaceId ? ` → ${r.workspaceId}` : ''}）
                    </span>
                    <button
                      type="button"
                      disabled={busy || !onApplyRecipe}
                      onClick={() => void onApplyRecipe?.(r.id)}
                    >
                      一键部署
                    </button>
                    <button
                      type="button"
                      disabled={busy || !onDeleteRecipe}
                      onClick={() => {
                        void (async () => {
                          if (await onDeleteRecipe?.(r.id)) {
                            setRecipes((await onListRecipes?.()) ?? [])
                          }
                        })()
                      }}
                    >
                      删除
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub">暂无配方；先在列表选中永久库条目再保存。</p>
            )}
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
            <span className="settings-label">网络更新检查间隔</span>
            <select
              value={netCheckMins}
              disabled={busy}
              onChange={(e) => setNetCheckMins(Number(e.target.value) || 0)}
            >
              <option value={0}>关闭（默认）</option>
              <option value={60}>60 分钟</option>
              <option value={360}>6 小时</option>
              <option value={1440}>24 小时</option>
            </select>
            <p className="settings-hint">
              仅在网络货架挂载时定时调用「检查更新」并标记 updateAvailable；不会自动覆盖缓存或写入永久库。
            </p>
          </label>

          <label className="settings-field">
            <span className="settings-label">skills.sh API Key（可选）</span>
            <input
              type="password"
              autoComplete="off"
              placeholder={
                snap.skillsShConfigured
                  ? '已配置（留空保存则清空）'
                  : '空=禁用；需自行申请 Bearer'
              }
              value={skillsToken}
              disabled={busy}
              onChange={(e) => setSkillsToken(e.target.value)}
            />
            <p className="settings-hint">
              无密钥时侧栏搜索会提示降级，继续使用固化「GitHub 热门」清单；不爬网页、不写进 git。
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
