/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CCM_BROWSER?: string
  /** 设为 "1" 时 Tauri 入口使用闸门最小壳而非全量 App */
  readonly VITE_CCM_P0_SHELL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export {}

declare global {
  interface Window {
    ccm?: {
      invoke: <T = unknown>(
        method: import('../shared/ipc').IpcMethod,
        args?: Record<string, unknown>,
      ) => Promise<import('../shared/ipc').IpcEnvelope<T>>
      /** 原生文件拖出；须在 dragstart 同步调用。浏览器预览可缺省。 */
      startDrag?: (entryIds: string[], pathSide?: 'container' | 'library') => void
    }
  }
}
