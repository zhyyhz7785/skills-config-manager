/**
 * CCM workspace id → SM `public/agent-icons` filename.
 * Assets copied from skills-manager-1.28.3; missing id → null (glyph fallback).
 */

/** Align with SM `agentIcons.ts` keys, keyed by CCM normalize_workspace_id. */
const CCM_ICON_FILE: Record<string, string> = {
  cursor: 'cursor.png',
  claude: 'claude_code.svg',
  codex: 'codex.svg',
  gemini: 'gemini_cli.svg',
  opencode: 'opencode.png',
  windsurf: 'windsurf.svg',
  continue: 'continue.png',
  copilot: 'github_copilot.png',
  goose: 'goose.png',
  amp: 'amp.svg',
  cline: 'cline.png',
  roo: 'roo_code.svg',
  trae: 'trae.svg',
  kilocode: 'kilo_code.svg',
  crush: 'crush.png',
  droid: 'droid.svg',
  warp: 'warp.svg',
  antigravity: 'antigravity.png',
  openclaw: 'openclaw.svg',
  qoder: 'qoder.svg',
  pi: 'pi.svg',
  augment: 'augment.svg',
  // No SM asset for aider / zed / vscode → glyph fallback
}

export function getAgentIconSrc(workspaceId: string): string | null {
  const key = workspaceId.trim().toLowerCase()
  const file = CCM_ICON_FILE[key]
  return file ? `/agent-icons/${file}` : null
}

export function hasAgentIcon(workspaceId: string): boolean {
  return getAgentIconSrc(workspaceId) != null
}
