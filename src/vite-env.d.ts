/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARTICLE_API_TARGET: string
  readonly VITE_ARTICLE_TOKEN: string
  readonly VITE_ARTICLE_AGENT_TARGET?: string
  readonly VITE_MIS_API_TARGET: string
  readonly VITE_MIS_TOKEN: string
  readonly VITE_MIS_ADMIN_TOKEN: string
  readonly VITE_MIS_CLIENT_ID: string
  readonly VITE_RUOYI_API_TARGET: string
  readonly VITE_RUOYI_TOKEN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
