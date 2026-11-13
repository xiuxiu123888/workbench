export interface ServiceConfig {
  articleTarget: string
  articleToken: string
  misTarget: string
  misToken: string
  misAdminToken: string
  misClientId: string
  ruoyiTarget: string
  ruoyiToken: string
}

function read(name: keyof ImportMetaEnv): string {
  return String(import.meta.env[name] ?? '').trim()
}

export const serviceConfig: ServiceConfig = {
  articleTarget: read('VITE_ARTICLE_API_TARGET'),
  articleToken: read('VITE_ARTICLE_TOKEN'),
  misTarget: read('VITE_MIS_API_TARGET'),
  misToken: read('VITE_MIS_TOKEN'),
  misAdminToken: read('VITE_MIS_ADMIN_TOKEN'),
  misClientId: read('VITE_MIS_CLIENT_ID'),
  ruoyiTarget: read('VITE_RUOYI_API_TARGET'),
  ruoyiToken: read('VITE_RUOYI_TOKEN'),
}

export const articleReady = Boolean(serviceConfig.articleTarget && serviceConfig.articleToken)
export const misReady = Boolean(serviceConfig.misTarget && serviceConfig.misToken && serviceConfig.misClientId)
export const ruoyiReady = Boolean(serviceConfig.ruoyiTarget && serviceConfig.ruoyiToken)
export const appReady = articleReady && misReady

export const CONFIG_FIELDS: Array<{ key: keyof ServiceConfig; label: string }> = [
  { key: 'articleTarget', label: 'VITE_ARTICLE_API_TARGET' },
  { key: 'articleToken', label: 'VITE_ARTICLE_TOKEN' },
  { key: 'misTarget', label: 'VITE_MIS_API_TARGET' },
  { key: 'misToken', label: 'VITE_MIS_TOKEN' },
  { key: 'misAdminToken', label: 'VITE_MIS_ADMIN_TOKEN' },
  { key: 'misClientId', label: 'VITE_MIS_CLIENT_ID' },
  { key: 'ruoyiTarget', label: 'VITE_RUOYI_API_TARGET' },
  { key: 'ruoyiToken', label: 'VITE_RUOYI_TOKEN' },
]
