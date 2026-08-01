import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  APP_DISPLAY_NAME,
  APP_SETTINGS_DIR_NAME,
  DEFAULT_LIBRARY_ROOT,
  DEFAULT_SPIKE_CONTAINER,
} from './isolation'
import { createDefaultMdStyleState } from './lib/mdStylePrefs'
import './components/detailMarkdown.css'
import '@milkdown/crepe/theme/common/style.css'

const DetailMarkdownCrepe = lazy(() =>
  import('./components/DetailMarkdownCrepe').then((m) => ({
    default: m.DetailMarkdownCrepe,
  })),
)

/** Minimal fields from AppSnapshot / LibraryListItemDto (shared/ipc.ts). */
interface LibraryListItemDto {
  entryId: string
  displayName: string
  kindLabel: string
  libraryPathRel?: string | null
  subtitle?: string
  isInActiveUse?: boolean
}

interface AppSnapshotSubset {
  isLibraryConfigured: boolean
  libraryRootDisplay: string
  activeContainerPathDisplay?: string
  statusText: string
  inLibraryOtherItems: LibraryListItemDto[]
  inLibrarySummary?: string
  catalogHealthy?: boolean
  catalogLoadError?: string | null
  pathGuardWarnings?: string[]
}

interface WithdrawResult {
  ok: boolean
  mode: string
  entryId: string
  containerPath: string
  libraryPath: string
  sourceHash?: string | null
  targetHash?: string | null
  message: string
  snapshot?: AppSnapshotSubset | null
}

interface ReadLibraryTextResult {
  entryId: string
  path: string
  content: string
}

interface SaveLibraryFileResult {
  ok: boolean
  unchanged: boolean
  entryId: string
  path: string
  message: string
}

export default function P0Shell() {
  const [pingResult, setPingResult] = useState<string>('尚未调用')
  const [snapshot, setSnapshot] = useState<AppSnapshotSubset | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [withdrawInfo, setWithdrawInfo] = useState<string | null>(null)
  const [conflict, setConflict] = useState<WithdrawResult | null>(null)
  const [detail, setDetail] = useState<ReadLibraryTextResult | null>(null)
  const [detailKey, setDetailKey] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saveInfo, setSaveInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mdStyle = useMemo(() => createDefaultMdStyleState(), [])

  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  async function onPing() {
    await run(async () => {
      const text = await invoke<string>('ping')
      setPingResult(text)
    })
  }

  async function onEnsureDefaultLibrary() {
    await run(async () => {
      const snap = await invoke<AppSnapshotSubset>('ensure_default_library')
      setSnapshot(snap)
      setConflict(null)
      setWithdrawInfo(null)
    })
  }

  async function onRefreshSnapshot() {
    await run(async () => {
      const snap = await invoke<AppSnapshotSubset>('get_snapshot')
      setSnapshot(snap)
    })
  }

  async function onWithdraw() {
    if (!selectedId) {
      setError('请先选中一条条目')
      return
    }
    await run(async () => {
      const result = await invoke<WithdrawResult>('withdraw', { entryId: selectedId })
      if (result.mode === 'contentConflict') {
        setConflict(result)
        setWithdrawInfo(null)
      } else {
        setConflict(null)
        setWithdrawInfo(result.message)
        if (result.snapshot) {
          setSnapshot(result.snapshot)
        }
      }
    })
  }

  async function onLoadDetail() {
    if (!selectedId) {
      setError('请先选中一条条目')
      return
    }
    await run(async () => {
      const r = await invoke<ReadLibraryTextResult>('read_library_text', {
        entryId: selectedId,
      })
      setDetail(r)
      setDetailKey((k) => k + 1)
      setDirty(false)
      setSaveInfo(null)
    })
  }

  const onSaveDetail = useCallback(
    async (fullContent: string): Promise<boolean> => {
      if (!detail?.entryId) return false
      try {
        const r = await invoke<SaveLibraryFileResult>('save_library_file', {
          entryId: detail.entryId,
          content: fullContent,
        })
        setSaveInfo(r.message)
        setDirty(false)
        setDetail((prev) =>
          prev ? { ...prev, content: fullContent } : prev,
        )
        return r.ok
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        return false
      }
    },
    [detail?.entryId],
  )

  const items = snapshot?.inLibraryOtherItems ?? []

  return (
    <main
      style={{
        fontFamily: 'Segoe UI, system-ui, sans-serif',
        maxWidth: 1100,
        margin: '24px auto',
        padding: 24,
        lineHeight: 1.5,
      }}
    >
      <h1 style={{ marginBottom: 8 }}>{APP_DISPLAY_NAME} · P3</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        Crepe 详情闸门：<code>read_library_text</code> / <code>save_library_file</code>
        （库侧路径护栏写回）。
      </p>
      <ul style={{ color: '#333' }}>
        <li>
          settings：<code>{APP_SETTINGS_DIR_NAME}</code>
        </li>
        <li>
          默认永久库：<code>{DEFAULT_LIBRARY_ROOT}</code>
        </li>
        <li>
          隔离容器：<code>{DEFAULT_SPIKE_CONTAINER}</code>
        </li>
      </ul>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <button type="button" onClick={onPing} disabled={busy} style={btnStyle(busy)}>
          Ping Rust
        </button>
        <button
          type="button"
          onClick={onEnsureDefaultLibrary}
          disabled={busy}
          style={btnStyle(busy)}
        >
          确保默认库
        </button>
        <button
          type="button"
          onClick={onRefreshSnapshot}
          disabled={busy}
          style={btnStyle(busy)}
        >
          刷新快照
        </button>
        <button
          type="button"
          onClick={onWithdraw}
          disabled={busy || !selectedId}
          style={btnStyle(busy || !selectedId)}
        >
          撤回所选
        </button>
        <button
          type="button"
          onClick={onLoadDetail}
          disabled={busy || !selectedId}
          style={btnStyle(busy || !selectedId)}
        >
          加载详情
        </button>
      </div>

      <pre style={preStyle}>{pingResult}</pre>

      {snapshot ? (
        <section style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>快照</h2>
          <p style={{ margin: '4px 0' }}>
            已配置：<strong>{snapshot.isLibraryConfigured ? '是' : '否'}</strong>
            {' · '}库根：<code>{snapshot.libraryRootDisplay}</code>
            {' · '}条目数：<strong>{items.length}</strong>
          </p>
          <p style={{ margin: '4px 0', color: '#444' }}>{snapshot.statusText}</p>

          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              marginTop: 12,
              fontSize: 14,
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
                <th style={thTd}>选</th>
                <th style={thTd}>entryId</th>
                <th style={thTd}>kind</th>
                <th style={thTd}>部署</th>
                <th style={thTd}>subtitle</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...thTd, color: '#777' }}>
                    （无在库条目）
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const selected = selectedId === it.entryId
                  return (
                    <tr
                      key={it.entryId || it.libraryPathRel || it.displayName}
                      onClick={() => setSelectedId(it.entryId)}
                      style={{
                        cursor: 'pointer',
                        background: selected ? '#e8f0fe' : undefined,
                      }}
                    >
                      <td style={thTd}>
                        <input
                          type="radio"
                          name="entry"
                          checked={selected}
                          onChange={() => setSelectedId(it.entryId)}
                        />
                      </td>
                      <td style={thTd}>
                        <code>{it.entryId}</code>
                      </td>
                      <td style={thTd}>{it.kindLabel}</td>
                      <td style={thTd}>{it.isInActiveUse ? '是' : '否'}</td>
                      <td style={thTd}>{it.subtitle ?? '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <p style={{ marginTop: 24, color: '#777' }}>尚未拉取快照。</p>
      )}

      {detail ? (
        <section style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>
            详情 Crepe{dirty ? ' · 未保存' : ''}
          </h2>
          <p style={{ margin: '4px 0', fontSize: 13, color: '#555' }}>
            <code>{detail.path}</code>
          </p>
          {saveInfo ? (
            <p style={{ color: '#0a7a2f', margin: '4px 0' }} role="status">
              {saveInfo}
            </p>
          ) : null}
          <div
            className="detail-md-host panel-detail"
            style={{
              marginTop: 8,
              height: 420,
              minHeight: 420,
              border: '1px solid #ddd',
              borderRadius: 8,
              overflow: 'auto',
              background: '#fff',
            }}
          >
            <Suspense fallback={<p style={{ padding: 16 }}>加载 Crepe…</p>}>
              <DetailMarkdownCrepe
                key={`${detail.entryId}:${detailKey}`}
                entryId={detail.entryId}
                fullText={detail.content}
                filePath={detail.path}
                editable
                active
                dirty={dirty}
                mdStyle={mdStyle}
                onDirtyChange={setDirty}
                onSave={onSaveDetail}
              />
            </Suspense>
          </div>
        </section>
      ) : null}

      {withdrawInfo ? (
        <p style={{ color: '#0a7a2f', marginTop: 16 }} role="status">
          {withdrawInfo}
        </p>
      ) : null}

      {conflict ? (
        <section
          style={{
            marginTop: 16,
            padding: 12,
            background: '#fff4e5',
            borderRadius: 8,
            border: '1px solid #e0a800',
          }}
          role="alert"
        >
          <h3 style={{ marginTop: 0, fontSize: 16 }}>内容冲突（未写盘）</h3>
          <p>{conflict.message}</p>
          <ul style={{ marginBottom: 0 }}>
            <li>
              entryId：<code>{conflict.entryId}</code>
            </li>
            <li>
              sourceHash：<code>{conflict.sourceHash ?? '—'}</code>
            </li>
            <li>
              targetHash：<code>{conflict.targetHash ?? '—'}</code>
            </li>
          </ul>
        </section>
      ) : null}

      {error ? (
        <p style={{ color: '#b00020' }} role="alert">
          {error}
        </p>
      ) : null}
    </main>
  )
}

function btnStyle(busy: boolean): CSSProperties {
  return {
    padding: '10px 18px',
    fontSize: 15,
    cursor: busy ? 'wait' : 'pointer',
  }
}

const preStyle: CSSProperties = {
  marginTop: 8,
  padding: 12,
  background: '#f4f4f4',
  borderRadius: 8,
  whiteSpace: 'pre-wrap',
}

const thTd: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #eee',
  verticalAlign: 'top',
}
