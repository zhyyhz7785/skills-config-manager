import { useEffect, useState } from 'react'
import { getAgentIconSrc } from '../lib/agentIcons'

/** Compact tool mark for sidebar workspace rows (SM asset or glyph fallback). */

const GLYPH: Record<string, string> = {
  cursor: 'Cu',
  claude: 'Cl',
  codex: 'Cx',
  gemini: 'Ge',
  opencode: 'Op',
  windsurf: 'Ws',
  continue: 'Co',
  copilot: 'Gh',
  aider: 'Ai',
  goose: 'Go',
  amp: 'Am',
  cline: 'Cn',
  roo: 'Ro',
  trae: 'Tr',
  kilocode: 'Ki',
  crush: 'Cr',
  droid: 'Dr',
  warp: 'Wa',
  zed: 'Ze',
  vscode: 'Vs',
  antigravity: 'Ag',
  openclaw: 'Oc',
  qoder: 'Qo',
  pi: 'Pi',
  augment: 'Au',
}

function GlyphFallback({ id }: { id: string }) {
  const key = id.trim().toLowerCase() || 'cursor'
  const label = GLYPH[key] ?? key.slice(0, 2).replace(/^\w/, (c) => c.toUpperCase())
  return (
    <span className={`ws-tool-icon ws-tool-glyph ws-${key}`} aria-hidden title={id}>
      {label}
    </span>
  )
}

export function WorkspaceToolIcon({ id }: { id: string }) {
  const key = id.trim().toLowerCase() || 'cursor'
  const src = getAgentIconSrc(key)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (!src || failed) {
    return <GlyphFallback id={key} />
  }

  return (
    <span className={`ws-tool-icon ws-tool-img ws-${key}`} aria-hidden title={id}>
      <img
        src={src}
        alt=""
        draggable={false}
        className="ws-tool-icon-img"
        onError={() => setFailed(true)}
      />
    </span>
  )
}
