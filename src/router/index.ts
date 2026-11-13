import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

export type AppRouteName =
  | 'config'
  | 'auto'
  | 'dashboard'
  | 'replace'
  | 'funnelBrowse'
  | 'opsCenter'
  | 'offerSeed'
  | 'offerCreate'
  | 'autoOfferReplace'

declare module 'vue-router' {
  interface RouteMeta {
    title: string
    subtitle?: string
    fill?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/config' },
  {
    path: '/config',
    name: 'config',
    component: () => import('../views/Workbench.vue'),
    meta: { title: '配置', subtitle: '生成落地页链接，写入推荐文章，查看回收与大盘' },
  },
  {
    path: '/auto',
    name: 'auto',
    component: () => import('../components/AutoArticlePanel.vue'),
    meta: { title: '编排', subtitle: '生成落地页链接，写入推荐文章，查看回收与大盘' },
  },
  {
    path: '/replace',
    name: 'replace',
    component: () => import('../components/ReplaceOpsPanel.vue'),
    meta: { title: '换文待办', subtitle: '生成落地页链接，写入推荐文章，查看回收与大盘' },
  },
  {
    path: '/dashboard',
    name: 'dashboard',
    component: () => import('../components/DashboardPanel.vue'),
    meta: { title: '运营文章大盘', subtitle: '生成落地页链接，写入推荐文章，查看回收与大盘' },
  },
  {
    path: '/funnels',
    name: 'funnelBrowse',
    component: () => import('../components/FunnelBrowsePanel.vue'),
    meta: { title: '漏斗总览', subtitle: '查看全部漏斗、页面组与 offer 明细', fill: true },
  },
  {
    path: '/ops-center',
    name: 'opsCenter',
    component: () => import('../components/OpsCenterPanel.vue'),
    meta: { title: '漏斗分析', subtitle: '先看结论和换文，再按需切排行做分析', fill: true },
  },
  {
    path: '/offer-seed',
    name: 'offerSeed',
    component: () => import('../components/OfferSeedWorkbenchPanel.vue'),
    meta: { title: 'Offer 创编', subtitle: '按 offer 匹配词库种子，随机分配后创编写回', fill: true },
  },
  {
    path: '/offer-create',
    name: 'offerCreate',
    component: () => import('../components/OfferCreatePanel.vue'),
    meta: {
      title: '创建 Offer',
      subtitle: '白名单漏斗各建 1 条；4 美妆词轮询；seekmoon.ai / A17',
      fill: true,
    },
  },
  {
    path: '/auto-offer-replace',
    name: 'autoOfferReplace',
    component: () => import('../components/AutoOfferReplacePanel.vue'),
    meta: {
      title: '调优报告',
      subtitle: '看哪些词/单元跑得好或差；优化前后对比；支持 3 小时换文节奏',
      fill: true,
    },
  },
  { path: '/:pathMatch(.*)*', redirect: '/config' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
