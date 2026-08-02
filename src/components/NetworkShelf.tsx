import type { MouseEvent as ReactMouseEvent } from 'react'
import type { LibraryListItemDto, NetworkNavNodeDto } from '../../shared/ipc'

export type NetworkNavSel = { kind: 'official' | 'popular'; id: string } | null

function PinBtn({
  pinned,
  disabled,
  onToggle,
}: {
  pinned: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className="net-pin-btn"
      disabled={disabled}
      title={pinned ? '取消置顶' : '置顶'}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {pinned ? '★' : '☆'}
    </button>
  )
}

function NavGroup({
  title,
  nodes,
  kind,
  selected,
  generalOpen,
  onToggleGeneral,
  onSelect,
  onTogglePin,
  onFetch,
  onContextNode,
  busy,
}: {
  title: string
  nodes: NetworkNavNodeDto[]
  kind: 'official' | 'popular'
  selected: NetworkNavSel
  generalOpen: boolean
  onToggleGeneral: () => void
  onSelect: (kind: 'official' | 'popular', id: string) => void
  onTogglePin: (kind: 'official' | 'popular', id: string, pinned: boolean) => void
  onFetch: (kind: 'official' | 'popular', id: string) => void
  onContextNode: (
    e: ReactMouseEvent,
    kind: 'official' | 'popular',
    id: string,
    node: NetworkNavNodeDto,
  ) => void
  busy: boolean
}) {
  const pinned = nodes.filter((n) => n.pinned)
  const general = nodes.filter((n) => !n.pinned)
  const renderRow = (n: NetworkNavNodeDto) => {
    const active = selected?.kind === kind && selected.id === n.id
    return (
      <div
        key={n.id}
        className={`nav-item net-nav-row${active ? ' active' : ''}`}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextNode(e, kind, n.id, n)
        }}
      >
        <PinBtn
          pinned={n.pinned}
          disabled={busy}
          onToggle={() => onTogglePin(kind, n.id, !n.pinned)}
        />
        <button
          type="button"
          className="net-nav-main"
          disabled={busy}
          title={
            n.hasDefaultRepo
              ? `${n.primaryRepoUrl}\n双击或右键「拉取当前源」`
              : '无默认仓；可粘贴 Git URL 或设置覆盖'
          }
          onClick={() => onSelect(kind, n.id)}
          onDoubleClick={() => {
            if (n.hasDefaultRepo) onFetch(kind, n.id)
          }}
        >
          <span className="net-nav-name">{n.displayName}</span>
          <span className="net-nav-meta">
            {n.heatLabel}
            {n.cachedCount > 0 ? ` · 已缓存 ${n.cachedCount}` : ''}
          </span>
        </button>
      </div>
    )
  }
  return (
    <div className="net-nav-group">
      <div className="nav-item cat">{title}</div>
      {pinned.map(renderRow)}
      {general.length > 0 ? (
        <>
          <button type="button" className="nav-item net-general-toggle" onClick={onToggleGeneral}>
            {generalOpen ? '▾ 一般' : '▸ 一般'}（{general.length}）
          </button>
          {generalOpen ? general.map(renderRow) : null}
        </>
      ) : null}
    </div>
  )
}

export function NetworkNav({
  busy,
  rootDisplay,
  configured,
  itemCount,
  official,
  popular,
  selected,
  officialGeneralOpen,
  popularGeneralOpen,
  skillsShConfigured,
  onPickRoot,
  onOpenRoot,
  onSelectAll,
  onSelectNode,
  onToggleOfficialGeneral,
  onTogglePopularGeneral,
  onTogglePin,
  onFetchAnthropic,
  onFetchVercel,
  onPasteGitUrl,
  onCheckUpdates,
  onApplyCache,
  onPromote,
  onFetchNode,
  onRefreshHeat,
  onCleanupCache,
  onSearchSkillsSh,
  onContextNode,
  onContextBlank,
}: {
  busy: boolean
  rootDisplay: string
  configured: boolean
  itemCount: number
  official: NetworkNavNodeDto[]
  popular: NetworkNavNodeDto[]
  selected: NetworkNavSel
  officialGeneralOpen: boolean
  popularGeneralOpen: boolean
  skillsShConfigured: boolean
  onPickRoot: () => void
  onOpenRoot: () => void
  onSelectAll: () => void
  onSelectNode: (kind: 'official' | 'popular', id: string) => void
  onToggleOfficialGeneral: () => void
  onTogglePopularGeneral: () => void
  onTogglePin: (kind: 'official' | 'popular', id: string, pinned: boolean) => void
  onFetchAnthropic: () => void
  onFetchVercel: () => void
  onPasteGitUrl: () => void
  onCheckUpdates: () => void
  onApplyCache: () => void
  onPromote: () => void
  onFetchNode: (kind: 'official' | 'popular', id: string) => void
  onRefreshHeat: () => void
  onCleanupCache: () => void
  onSearchSkillsSh: () => void
  onContextNode: (
    e: ReactMouseEvent,
    kind: 'official' | 'popular',
    id: string,
    node: NetworkNavNodeDto,
  ) => void
  onContextBlank: (e: ReactMouseEvent) => void
}) {
  return (
    <div
      className="network-nav"
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onContextBlank(e)
      }}
    >
      <div className="nav-item cat">网络库</div>
      <button
        type="button"
        className="nav-item network-nav-path"
        title={configured ? `打开：${rootDisplay}` : '点击配置网络库目录'}
        disabled={busy}
        onClick={() => (configured ? onOpenRoot() : onPickRoot())}
      >
        {configured ? rootDisplay : '（未配置 · 点击设置）'}
      </button>
      <div className="net-nav-ops">
        <button type="button" disabled={busy} onClick={onFetchAnthropic}>
          Anthropic 基线
        </button>
        <button type="button" disabled={busy} onClick={onFetchVercel}>
          Vercel 基线
        </button>
        <button type="button" disabled={busy} onClick={onPasteGitUrl}>
          粘贴 Git URL
        </button>
        <button type="button" disabled={busy} onClick={onCheckUpdates}>
          检查更新
        </button>
        <button type="button" disabled={busy} onClick={onApplyCache}>
          更新缓存
        </button>
        <button type="button" disabled={busy} onClick={onPromote}>
          转入本地
        </button>
        <button type="button" disabled={busy} title="用 gh api 刷新热度" onClick={onRefreshHeat}>
          刷新热度
        </button>
        <button type="button" disabled={busy} onClick={onCleanupCache}>
          清理无效缓存
        </button>
        <button
          type="button"
          disabled={busy}
          title={
            skillsShConfigured
              ? '搜索 skills.sh（需 API Key）'
              : '需自行申请 skills.sh API Key；当前使用固化热门清单'
          }
          onClick={onSearchSkillsSh}
        >
          skills.sh 搜索
        </button>
        {!configured ? (
          <button type="button" disabled={busy} onClick={onPickRoot}>
            配置目录
          </button>
        ) : null}
      </div>
      <button
        type="button"
        className={`nav-item${selected == null ? ' active' : ''}`}
        disabled={busy}
        onClick={onSelectAll}
      >
        全部已缓存（{itemCount}）
      </button>
      <NavGroup
        title="官方工作区"
        nodes={official}
        kind="official"
        selected={selected}
        generalOpen={officialGeneralOpen}
        onToggleGeneral={onToggleOfficialGeneral}
        onSelect={onSelectNode}
        onTogglePin={onTogglePin}
        onFetch={onFetchNode}
        onContextNode={onContextNode}
        busy={busy}
      />
      <NavGroup
        title="GitHub 热门"
        nodes={popular}
        kind="popular"
        selected={selected}
        generalOpen={popularGeneralOpen}
        onToggleGeneral={onTogglePopularGeneral}
        onSelect={onSelectNode}
        onTogglePin={onTogglePin}
        onFetch={onFetchNode}
        onContextNode={onContextNode}
        busy={busy}
      />
    </div>
  )
}

export function NetworkWorkbench({
  busy,
  items,
  selectedIds,
  onToggle,
  onSelectAllFiltered,
  onSetLevel,
  onPromote,
  onFetchCurrent,
  hasNavFilter,
}: {
  busy: boolean
  items: LibraryListItemDto[]
  selectedIds: Set<string>
  onToggle: (id: string, e: React.MouseEvent) => void
  onSelectAllFiltered: () => void
  onSetLevel: (level: '' | 'L0' | 'L1' | 'L2') => void
  onPromote: () => void
  onFetchCurrent: () => void
  hasNavFilter: boolean
}) {
  const selectedCount = items.filter((i) => selectedIds.has(i.entryId)).length
  return (
    <div className="network-workbench">
      <div className="net-wb-toolbar">
        <span className="net-wb-selected">已选 {selectedCount} 项</span>
        <button type="button" disabled={busy || items.length === 0} onClick={onSelectAllFiltered}>
          全选当前过滤
        </button>
        <button type="button" disabled={busy || !hasNavFilter} onClick={onFetchCurrent}>
          拉取当前源
        </button>
        <label className="net-wb-level">
          意向层级
          <select
            disabled={busy || selectedCount === 0}
            defaultValue=""
            onChange={(e) => {
              const raw = e.target.value
              if (raw === 'L0' || raw === 'L1' || raw === 'L2') onSetLevel(raw)
              else if (raw === 'clear') onSetLevel('')
              e.target.value = ''
            }}
          >
            <option value="">设置…</option>
            <option value="L0">L0</option>
            <option value="L1">L1</option>
            <option value="L2">L2</option>
            <option value="clear">清除</option>
          </select>
        </label>
        <button type="button" disabled={busy || selectedCount === 0} onClick={onPromote}>
          转入本地
        </button>
      </div>
      {items.length === 0 ? (
        <div className="empty" style={{ padding: '12px 10px' }}>
          {hasNavFilter ? '当前源无缓存条目；可点「拉取当前源」' : '网络库暂无条目'}
        </div>
      ) : (
        <table className="net-wb-table">
          <thead>
            <tr>
              <th />
              <th>名称</th>
              <th>热度</th>
              <th>意向</th>
              <th>安全</th>
              <th>更新</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const checked = selectedIds.has(it.entryId)
              return (
                <tr
                  key={it.entryId}
                  className={checked ? 'is-selected' : ''}
                  onClick={(e) => onToggle(it.entryId, e)}
                >
                  <td>
                    <input type="checkbox" checked={checked} readOnly />
                  </td>
                  <td title={it.entryId}>{it.displayName}</td>
                  <td>{it.heatLabel || '—'}</td>
                  <td>{it.intendedLevel || it.levelKey || '—'}</td>
                  <td className={`sec-${it.securityLevel || 'unknown'}`}>
                    {it.securityLevel || '—'}
                  </td>
                  <td>{it.updateAvailable ? '有更新' : '—'}</td>
                  <td title={it.sourceUrl || ''}>{it.sourceId || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
