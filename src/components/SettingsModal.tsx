/**
 * 设置：永久库 / 网络库、一行扫描、台账存取、独立回厂。
 */
import { useEffect, useMemo, useState } from 'react'
import type { AppSnapshot, ScanExtraRootDto, WorkspaceDto } from '../../shared/ipc'
import { useI18n, type Locale } from '../i18n'
import { usePointerListReorder } from '../lib/usePointerListReorder'
import { WorkspaceToolIcon } from './WorkspaceToolIcon'

export type SettingsReorderOpts = {
  direction?: 'up' | 'down' | 'top' | 'bottom'
  toIndex?: number
  peerIds?: string[]
}

function normPathKey(p: string): string {
  return p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
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
    projectScanRoots: string[]
    projectScanMaxDepth: number
    autoScanProjectsOnStartup: boolean
    scanSkipWorkspaceIds: string[]
    scanExtraRoots: ScanExtraRootDto[]
  }) => Promise<boolean>
  onResetCatalog: (deleteNetworkCache: boolean) => Promise<boolean>
  onExportCatalog: () => Promise<boolean>
  onImportCatalog: () => Promise<boolean>
  onReorderScanRoot?: (path: string, opts: SettingsReorderOpts) => Promise<boolean>
  onCleanupNetworkCache?: () => Promise<void>
  hideMirrors: boolean
  onHideMirrorsChange: (on: boolean) => void
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
  onExportCatalog,
  onImportCatalog,
  onReorderScanRoot,
  onCleanupNetworkCache,
  hideMirrors,
  onHideMirrorsChange,
}: SettingsModalProps) {
  const { locale, t, setLocale } = useI18n()
  const defaults = useMemo(
    () => (snap.defaultProjectScanRoots?.length ? snap.defaultProjectScanRoots : []).map((p) =>
      p.replace(/\//g, '\\'),
    ),
    [snap.defaultProjectScanRoots],
  )
  const defaultKeys = useMemo(() => new Set(defaults.map(normPathKey)), [defaults])

  const [enabledDefaults, setEnabledDefaults] = useState<Set<string>>(() => new Set())
  const [customRoots, setCustomRoots] = useState<string[]>([])
  const [skipWorkspaceIds, setSkipWorkspaceIds] = useState<Set<string>>(() => new Set())
  const [extraRoots, setExtraRoots] = useState<ScanExtraRootDto[]>([])
  const [scanDepth, setScanDepth] = useState(snap.projectScanMaxDepth ?? 5)
  const [autoScan, setAutoScan] = useState(Boolean(snap.autoScanProjectsOnStartup))
  const [scanPickerOpen, setScanPickerOpen] = useState(false)
  const [deleteNetworkCache, setDeleteNetworkCache] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { rowPropsWithLabel, dragGhost } = usePointerListReorder({
    disabled: busy,
    getPeers: (section) => {
      if (section === 'scan') return customRoots
      return []
    },
    onDrop: async ({ id, sourceSection, targetSection, toIndex }) => {
      if (sourceSection !== targetSection) return
      if (sourceSection === 'scan') {
        setCustomRoots((prev) => {
          const from = prev.indexOf(id)
          if (from < 0) return prev
          const next = prev.slice()
          const [item] = next.splice(from, 1)
          const dest = Math.max(0, Math.min(toIndex, next.length))
          next.splice(dest, 0, item)
          return next
        })
      }
    },
  })

  const hydrateFromSnap = () => {
    setScanDepth(snap.projectScanMaxDepth ?? 5)
    setAutoScan(Boolean(snap.autoScanProjectsOnStartup))
    const configured = (snap.projectScanRoots ?? []).map((p) => p.replace(/\//g, '\\'))
    if (configured.length === 0) {
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
    const skip = new Set<string>()
    for (const id of snap.scanSkipWorkspaceIds ?? []) {
      const t = id.trim().toLowerCase()
      if (t) skip.add(t)
    }
    setSkipWorkspaceIds(skip)
    setExtraRoots(
      (snap.scanExtraRoots ?? [])
        .map((r) => ({
          path: (r.path || '').replace(/\//g, '\\').trim(),
          tool: (r.tool || 'cursor').trim() || 'cursor',
        }))
        .filter((r) => r.path),
    )
  }

  useEffect(() => {
    hydrateFromSnap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const allDefaultsOn =
    defaults.length > 0 && defaults.every((d) => enabledDefaults.has(normPathKey(d)))
  const isAllDrives = allDefaultsOn && customRoots.length === 0

  const workspaces: WorkspaceDto[] = snap.workspaces ?? []
  const wsOnCount = workspaces.filter((w) => !skipWorkspaceIds.has(w.id.trim().toLowerCase())).length
  const wsCheckedTotal = wsOnCount + extraRoots.length
  const wsListedTotal = workspaces.length + extraRoots.length
  const allWsOn =
    workspaces.length > 0 && workspaces.every((w) => !skipWorkspaceIds.has(w.id.trim().toLowerCase()))

  const driveSummary = (() => {
    if (defaults.length === 0 && customRoots.length === 0) return t('settings.noDrivesShort')
    if (isAllDrives) return t('settings.allDrives')
    const drives = defaults.filter((d) => enabledDefaults.has(normPathKey(d)))
    const parts = [...drives, ...customRoots]
    if (parts.length === 0) return t('settings.noProjectRoot')
    if (parts.length <= 3) return parts.join(' · ')
    return t('settings.moreItems', { head: parts.slice(0, 2).join(' · '), n: parts.length - 2 })
  })()
  const scanSummary = t('settings.scanSummary', {
    wsChecked: wsCheckedTotal,
    wsTotal: wsListedTotal,
    drive: driveSummary,
  })

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
    const path = await onPickFolder(t('settings.pickCustomScan'))
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

  const addExtraScanRoot = async () => {
    const path = await onPickFolder(t('settings.pickExtraScan'))
    if (!path?.trim()) return
    const display = path.replace(/\//g, '\\').trim()
    const k = normPathKey(display)
    const hit = workspaces.find((w) => normPathKey(w.containerRoot || '') === k)
    if (hit) {
      const id = hit.id.trim().toLowerCase()
      setSkipWorkspaceIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setError(null)
      return
    }
    const tool = (snap.selectedGlobalTool || 'cursor').trim() || 'cursor'
    setExtraRoots((prev) => (prev.some((r) => normPathKey(r.path) === k) ? prev : [...prev, { path: display, tool }]))
    setError(null)
  }

  const toggleWorkspace = (id: string) => {
    const k = id.trim().toLowerCase()
    if (!k) return
    setSkipWorkspaceIds((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
    setError(null)
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
    const roots = isAllDrives ? [] : buildEnabledRoots()
    const noProject = !isAllDrives && roots.length === 0
    if (noProject && wsCheckedTotal === 0) {
      setError(t('settings.needScanRoot'))
      return
    }
    const depth = Number.isFinite(scanDepth) ? Math.min(20, Math.max(0, Math.floor(scanDepth))) : 5
    const ok = await onSave({
      projectScanRoots: roots,
      projectScanMaxDepth: depth,
      autoScanProjectsOnStartup: autoScan,
      scanSkipWorkspaceIds: Array.from(skipWorkspaceIds),
      scanExtraRoots: extraRoots,
    })
    if (ok) onClose()
  }

  const resetCatalog = async () => {
    const cacheLine = deleteNetworkCache
      ? t('settings.resetConfirmCache')
      : t('settings.resetConfirmKeep')
    const okConfirm = window.confirm(t('settings.resetConfirm', { cacheLine }))
    if (!okConfirm) return
    await onResetCatalog(deleteNetworkCache)
  }

  const libOk = Boolean(snap.libraryRootDisplay) && !snap.libraryRootDisplay.includes('未配置')
  const netOk =
    Boolean(snap.networkLibraryRootDisplay) && !snap.networkLibraryRootDisplay.includes('未配置')
  const libDisplay = snap.libraryRootDisplay?.includes('未配置')
    ? t('settings.unconfigured')
    : snap.libraryRootDisplay || t('settings.unconfigured')
  const netDisplay = snap.networkLibraryRootDisplay?.includes('未配置')
    ? t('settings.unconfigured')
    : snap.networkLibraryRootDisplay || t('settings.unconfigured')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-settings" onClick={(e) => e.stopPropagation()}>
        <h3>{t('settings.title')}</h3>
        <p className="sub" style={{ marginTop: 0 }}>
          {t('settings.subtitle')}
        </p>
        <label className="settings-field">
          <span className="settings-label">{t('settings.language')}</span>
          <div className="settings-row">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
              aria-label={t('settings.language')}
            >
              <option value="zh-CN">{t('locale.zh')}</option>
              <option value="en">{t('locale.en')}</option>
            </select>
            <span className="settings-hint">{t('settings.languageHint')}</span>
          </div>
        </label>

        <div className="settings-form">
          <section className="settings-paths" aria-label={t('settings.paths')}>
            <label className="settings-field">
              <span className="settings-label">{t('settings.library')}</span>
              <div className="settings-row">
                <input type="text" readOnly value={libDisplay} title={snap.libraryRootDisplay} />
                <button type="button" disabled={busy} onClick={() => void onPickLibrary()}>
                  {t('settings.browse')}
                </button>
                <button
                  type="button"
                  disabled={busy || !libOk}
                  onClick={() => void onOpenPath(snap.libraryRootDisplay)}
                >
                  {t('settings.open')}
                </button>
              </div>
              <p className="settings-hint">{t('settings.libraryHint')}</p>
            </label>

            <div className="settings-field">
              <span className="settings-label">{t('settings.network')}</span>
              <div className="settings-row">
                <input
                  type="text"
                  readOnly
                  value={netDisplay}
                  title={snap.networkLibraryRootDisplay}
                />
                <button
                  type="button"
                  disabled={busy || !onPickNetworkLibrary}
                  onClick={() => void onPickNetworkLibrary?.()}
                >
                  {t('settings.browse')}
                </button>
                <button
                  type="button"
                  disabled={busy || !netOk}
                  onClick={() => void onOpenPath(snap.networkLibraryRootDisplay)}
                >
                  {t('settings.open')}
                </button>
                <button
                  type="button"
                  disabled={busy || !onCleanupNetworkCache}
                  onClick={() => void onCleanupNetworkCache?.()}
                >
                  {t('settings.cleanupCache')}
                </button>
              </div>
              <p className="settings-hint">{t('settings.networkHint')}</p>
              <label className="settings-check">
                <input
                  type="checkbox"
                  checked={hideMirrors}
                  disabled={busy}
                  onChange={(e) => onHideMirrorsChange(e.target.checked)}
                />
                <span>{t('funnel.hideMirrors')}</span>
              </label>
              <p className="settings-hint">{t('settings.hideMirrorsHint')}</p>
            </div>
          </section>

          <div className="settings-field">
            <span className="settings-label">{t('settings.scan')}</span>
            <div className="settings-scan-line">
              <span className="settings-scan-summary" title={scanSummary}>
                {scanSummary}
              </span>
              <button
                type="button"
                disabled={busy}
                aria-expanded={scanPickerOpen}
                onClick={() => setScanPickerOpen((v) => !v)}
              >
                {t('settings.scanOpen')}
              </button>
              <label className="settings-scan-depth">
                <span>{t('settings.depth')}</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={scanDepth}
                  disabled={busy}
                  title={t('settings.depthTitle')}
                  onChange={(e) => setScanDepth(Number(e.target.value))}
                />
              </label>
              <label className="settings-check settings-scan-auto">
                <input
                  type="checkbox"
                  checked={autoScan}
                  disabled={busy}
                  onChange={(e) => setAutoScan(e.target.checked)}
                />
                <span>{t('settings.autoScan')}</span>
              </label>
            </div>
            {scanPickerOpen ? (
              <div className="settings-scan-picker" aria-label={t('settings.scanPicker')}>
                <div className="settings-label-row">
                  <span className="settings-label">{t('settings.workspaceRoots')}</span>
                  <span className="settings-hint">
                    {t('settings.wsChecked', { checked: wsCheckedTotal, total: wsListedTotal })}
                  </span>
                </div>
                <div className="settings-hint">{t('settings.wsHint')}</div>
                <div className="settings-ws-scan-head">
                  <label className="settings-check">
                    <input
                      type="checkbox"
                      checked={allWsOn}
                      disabled={busy || workspaces.length === 0}
                      onChange={(e) => {
                        const on = e.target.checked
                        setSkipWorkspaceIds(
                          on
                            ? new Set()
                            : new Set(workspaces.map((w) => w.id.trim().toLowerCase()).filter(Boolean)),
                        )
                        setError(null)
                      }}
                    />
                    <span>{t('settings.selectAllWorkspaces')}</span>
                  </label>
                  <button type="button" disabled={busy} onClick={() => void addExtraScanRoot()}>
                    {t('settings.addFolder')}
                  </button>
                </div>
                <div className="settings-ws-scan-list">
                  {workspaces.length === 0 && extraRoots.length === 0 ? (
                    <div className="settings-empty">{t('settings.noWorkspaceDirs')}</div>
                  ) : (
                    <>
                      {workspaces.map((w) => {
                        const id = w.id.trim().toLowerCase()
                        const on = !skipWorkspaceIds.has(id)
                        return (
                          <label className="scan-row" key={`ws:${w.id}`}>
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={busy}
                              onChange={() => toggleWorkspace(w.id)}
                            />
                            <div>
                              <div className="list-item-name-row">
                                <WorkspaceToolIcon id={w.id} />
                                <span className="list-item-title">{w.displayName || w.id}</span>
                              </div>
                              <div className="settings-hint">
                                {w.containerRoot || t('settings.unconfiguredPath')}
                              </div>
                            </div>
                          </label>
                        )
                      })}
                      {extraRoots.map((r) => (
                        <label className="scan-row" key={`extra:${normPathKey(r.path)}`}>
                          <input type="checkbox" checked readOnly disabled={busy} />
                          <div>
                            <div className="list-item-name-row">
                              <WorkspaceToolIcon id={r.tool} />
                              <span className="list-item-title">
                                {t('settings.customTool', { tool: r.tool })}
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={(e) => {
                                  e.preventDefault()
                                  const k = normPathKey(r.path)
                                  setExtraRoots((prev) => prev.filter((x) => normPathKey(x.path) !== k))
                                  setError(null)
                                }}
                              >
                                {t('settings.remove')}
                              </button>
                            </div>
                            <div className="settings-hint">{r.path}</div>
                          </div>
                        </label>
                      ))}
                    </>
                  )}
                </div>
                <div className="settings-label-row">
                  <span className="settings-label">{t('settings.projectScanRoots')}</span>
                </div>
                <div className="settings-hint">{t('settings.driveHint')}</div>
                {defaults.length === 0 ? (
                  <div className="settings-empty">{t('settings.noDrives')}</div>
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
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="settings-label-row">
                  <span className="settings-label">{t('settings.customScanRoots')}</span>
                  <button type="button" disabled={busy} onClick={() => void addCustomRoot()}>
                    {t('settings.addEllipsis')}
                  </button>
                </div>
                {customRoots.length === 0 ? (
                  <div className="settings-empty">{t('settings.noCustomRoots')}</div>
                ) : (
                  <ul className="settings-scan-roots">
                    {customRoots.map((p, pi) => {
                      const drag = onReorderScanRoot ? rowPropsWithLabel(p, 'scan', p) : {}
                      return (
                        <li
                          key={normPathKey(p)}
                          {...drag}
                          title={onReorderScanRoot ? t('settings.dragSort') : undefined}
                        >
                          <code title={p}>{p}</code>
                          <div className="settings-root-actions">
                            {onReorderScanRoot ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy || pi === 0}
                                  title={t('settings.moveUp')}
                                  onClick={() => {
                                    setCustomRoots((prev) => {
                                      if (pi === 0) return prev
                                      const next = prev.slice()
                                      ;[next[pi - 1], next[pi]] = [next[pi], next[pi - 1]]
                                      return next
                                    })
                                  }}
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={busy || pi >= customRoots.length - 1}
                                  title={t('settings.moveDown')}
                                  onClick={() => {
                                    setCustomRoots((prev) => {
                                      if (pi >= prev.length - 1) return prev
                                      const next = prev.slice()
                                      ;[next[pi], next[pi + 1]] = [next[pi + 1], next[pi]]
                                      return next
                                    })
                                  }}
                                >
                                  ↓
                                </button>
                              </>
                            ) : null}
                            <button type="button" disabled={busy} onClick={() => void onOpenPath(p)}>
                              {t('settings.open')}
                            </button>
                            <button type="button" disabled={busy} onClick={() => removeCustomRoot(p)}>
                              {t('settings.delete')}
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          <div className="settings-field">
            <span className="settings-label">{t('settings.catalog')}</span>
            <div className="settings-inline-actions">
              <button type="button" disabled={busy} onClick={() => void onExportCatalog()}>
                {t('settings.export')}
              </button>
              <button type="button" disabled={busy} onClick={() => void onImportCatalog()}>
                {t('settings.import')}
              </button>
            </div>
            <p className="settings-hint">{t('settings.catalogHint')}</p>
          </div>

          <section className="settings-danger" aria-label={t('settings.factoryReset')}>
            <h4 className="settings-section-title">{t('settings.factoryReset')}</h4>
            <label className="settings-check">
              <input
                type="checkbox"
                checked={deleteNetworkCache}
                disabled={busy}
                onChange={(e) => setDeleteNetworkCache(e.target.checked)}
              />
              <span>{t('settings.deleteNetworkCache')}</span>
            </label>
            <p className="settings-hint">{t('settings.factoryHint')}</p>
            <button type="button" disabled={busy} className="danger" onClick={() => void resetCatalog()}>
              {t('settings.factoryResetBtn')}
            </button>
          </section>

          {error ? <div className="settings-error">{error}</div> : null}
        </div>

        <div className="actions">
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {t('settings.save')}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            {t('settings.cancel')}
          </button>
        </div>
      </div>
      {dragGhost}
    </div>
  )
}
