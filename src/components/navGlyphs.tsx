/** Inline nav glyphs (no lucide dependency). */

export function EyeGlyph({ off = false }: { off?: boolean }) {
  if (off) {
    return (
      <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path
          fill="currentColor"
          d="M12 6c-4.5 0-8.3 2.7-10 6 1.1 2.1 2.8 3.8 4.9 4.9L5.1 18.7l1.4 1.4 13.8-13.8-1.4-1.4-2.3 2.3C15.5 6.4 13.8 6 12 6zm0 2c1.1 0 2.1.2 3 .6l-1.5 1.5A2.5 2.5 0 0 0 12 9.5c-.3 0-.6.1-.8.2l-1.6-1.6c.7-.4 1.5-.6 2.4-.6zm-6.9 4c.7-1.2 1.7-2.2 2.9-2.9l1.7 1.7A2.5 2.5 0 0 0 12 14.5c.3 0 .6-.1.9-.2l1.5 1.5c-.7.3-1.5.5-2.4.5-2.5 0-4.6-1.7-5.4-4zM14.5 12c0 .3-.1.6-.2.9l-1.7-1.7c.1-.1.2-.2.2-.4 0-.4-.2-.8-.5-1.1l1.7-1.7c.4.7.5 1.5.5 2.3z"
        />
      </svg>
    )
  }
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M12 5c-5 0-9.3 3.1-11 7 1.7 3.9 6 7 11 7s9.3-3.1 11-7c-1.7-3.9-6-7-11-7zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-2.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"
      />
    </svg>
  )
}

/**
 * 批量「全部打开」：同行眼睛语义 + 右下角三点（多条）。
 * 对标图层面板 Show all（眼睛）类控件，避免与单行眼睛完全同形。
 */
export function EyeShowAllGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M12 4.5c-4.6 0-8.5 2.8-10.2 6.5 1.7 3.7 5.6 6.5 10.2 6.5 1.4 0 2.7-.3 3.9-.7l-.9-1.1c-.9.3-1.9.5-3 .5-3.6 0-6.7-2.1-8.2-5.2C5.3 8.1 8.4 6 12 6c3.1 0 5.8 1.5 7.4 3.8l1.1-.9C18.6 6.3 15.5 4.5 12 4.5zm0 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zm0 2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z"
      />
      <circle cx="18.2" cy="17.2" r="1.15" fill="currentColor" />
      <circle cx="21" cy="17.2" r="1.15" fill="currentColor" />
      <circle cx="19.6" cy="20" r="1.15" fill="currentColor" />
    </svg>
  )
}

/**
 * 批量「全部关闭」：划掉的眼睛 + 右下角三点。
 * 对标图层面板 Hide all（eye-off）。
 */
export function EyeHideAllGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M3.3 2.1 2 3.4l3.1 3.1C3.4 7.5 2.1 8.9 1.2 10.5c1.6 3.5 5.2 6 9.8 6 1.5 0 2.9-.3 4.2-.8l1.6 1.6 1.3-1.3L3.3 2.1zM11 8.2l2.3 2.3c0 .1.1.3.1.5a2.4 2.4 0 0 1-2.4 2.4c-.2 0-.4 0-.5-.1L8.2 15c.5.3 1.1.4 1.8.4 2.5 0 4.5-2 4.5-4.5 0-.7-.2-1.3-.5-1.8L11 8.2zm1-3.7c-1.1 0-2.1.2-3.1.5l1.4 1.4c.5-.1 1-.2 1.7-.2 3.5 0 6.5 2 8 5-.5 1.1-1.3 2.1-2.2 2.9l1.2 1.2c1.3-1.1 2.3-2.5 3-4.1C19.3 7.2 15.7 4.5 12 4.5z"
      />
      <circle cx="18.2" cy="17.2" r="1.15" fill="currentColor" />
      <circle cx="21" cy="17.2" r="1.15" fill="currentColor" />
      <circle cx="19.6" cy="20" r="1.15" fill="currentColor" />
    </svg>
  )
}

export function StarGlyph({ filled = false }: { filled?: boolean }) {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      {filled ? (
        <path
          fill="currentColor"
          d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.5 6.1 20.7l1.2-6.6L2.5 9.5l6.6-.9L12 2.5z"
        />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
          d="M12 3.2l2.5 5.3 5.8.8-4.2 4 1 5.8L12 16.2 6.9 19.1l1-5.8-4.2-4 5.8-.8L12 3.2z"
        />
      )}
    </svg>
  )
}

/**
 * 池（抽屉）开合开关：闭合时向下尖角（可展开），打开时向上尖角（可收起）。
 * 替换原齿轮——按钮实际只做展开/收起，齿轮的「设置」语义会误导。
 */
export function PoolToggleGlyph({ open = false }: { open?: boolean }) {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={open ? 'M6 14.5 12 8.5l6 6' : 'M6 9.5l6 6 6-6'}
      />
    </svg>
  )
}

/** Circular refresh (VS Code view-title Refresh). */
export function RefreshGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 12a8 8 0 1 1-2.2-5.5M20 4v6h-6"
      />
    </svg>
  )
}

/** Plus: add new item (e.g. container). */
export function PlusGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M12 5v14M5 12h14"
      />
    </svg>
  )
}

/** Empty a container's skills folder (tray with a minus). */
export function ClearSkillsGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M9 12h6"
      />
    </svg>
  )
}

/** Folder path mark (optional reuse). */
export function FolderGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2zm0 2.5 1.2 1.2H20v10H4V6h6z"
      />
    </svg>
  )
}

/** 列表「展开/折叠全部分组」：与侧栏池开关同一套尖角符号。 */
export function CollapseAllButton({
  collapsed,
  onClick,
  expandTitle,
  collapseTitle,
}: {
  collapsed: boolean
  onClick: () => void
  expandTitle: string
  collapseTitle: string
}) {
  return (
    <button
      type="button"
      className="nav-ws-icon-btn section-collapse-all"
      title={collapsed ? expandTitle : collapseTitle}
      aria-label={collapsed ? expandTitle : collapseTitle}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
    >
      <PoolToggleGlyph open={!collapsed} />
    </button>
  )
}

/** Pen: edit workspace container root. */
export function PenGlyph() {
  return (
    <svg className="nav-ws-glyph" viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path
        fill="currentColor"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 0 0 0-1.41l-2.51-2.51a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 2-1.66z"
      />
    </svg>
  )
}
