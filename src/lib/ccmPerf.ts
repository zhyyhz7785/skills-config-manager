/** DEV 首屏时间线。生产构建不输出。tsx 单测无 `import.meta.env.DEV` 时静默。 */
const bootAt = performance.now()

function isDev(): boolean {
  try {
    return Boolean(import.meta.env?.DEV)
  } catch {
    return false
  }
}

export function ccmPerfOpen(label: string, extra = ''): void {
  if (!isDev()) return
  const since = (performance.now() - bootAt).toFixed(1)
  console.debug(`[ccm-perf] open ${label} +${since}ms${extra ? ` ${extra}` : ''}`)
}

export function ccmPerfSpan(label: string, started: number, extra = ''): void {
  if (!isDev()) return
  const dt = (performance.now() - started).toFixed(1)
  const since = (performance.now() - bootAt).toFixed(1)
  console.debug(
    `[ccm-perf] open ${label} ${dt}ms (boot+${since}ms)${extra ? ` ${extra}` : ''}`,
  )
}
