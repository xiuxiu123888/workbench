/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { feishuPushPlugin } from './src/server/feishuPushPlugin'
import { generationLogPlugin } from './src/server/generationLogPlugin'
import { opsCenterPlugin } from './src/server/opsCenterPlugin'
import { reportCachePlugin } from './src/server/reportCachePlugin'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy: Record<string, object> = {}

  if (env.VITE_ARTICLE_API_TARGET) {
    proxy['/article-api'] = {
      target: env.VITE_ARTICLE_API_TARGET,
      changeOrigin: true,
      timeout: 50000,
      proxyTimeout: 50000,
      rewrite: (path: string) => path.replace(/^\/article-api/, ''),
    }
  }

  if (env.VITE_MIS_API_TARGET) {
    proxy['/mis-api'] = {
      target: env.VITE_MIS_API_TARGET,
      changeOrigin: true,
      timeout: 50000,
      proxyTimeout: 50000,
      rewrite: (path: string) => path.replace(/^\/mis-api/, ''),
    }
  }

  if (env.VITE_RUOYI_API_TARGET) {
    proxy['/ruoyi-api'] = {
      target: env.VITE_RUOYI_API_TARGET,
      changeOrigin: true,
      timeout: 60000,
      proxyTimeout: 60000,
      rewrite: (path: string) => path.replace(/^\/ruoyi-api/, ''),
    }
  }

  // 正式服：https://adesmobi.com/api/v1/admin/article-jobs
  const articleAgentTarget = env.VITE_ARTICLE_AGENT_TARGET || 'https://adesmobi.com'
  proxy['/article-agent-api'] = {
    target: articleAgentTarget,
    changeOrigin: true,
    timeout: 60000,
    proxyTimeout: 60000,
    rewrite: (path: string) => path.replace(/^\/article-agent-api/, ''),
  }

  return {
    plugins: [
      vue(),
      generationLogPlugin(process.cwd()),
      reportCachePlugin(process.cwd()),
      opsCenterPlugin(process.cwd(), {
        mis: {
          misTarget: env.VITE_MIS_API_TARGET || '',
          misToken: env.VITE_MIS_TOKEN || '',
          misClientId: env.VITE_MIS_CLIENT_ID || '',
        },
        // vitest 也会起 vite server，避免测试里真去拉 MIS
        autoHourly: env.OPS_HOURLY_AUTO !== '0' && process.env.VITEST !== 'true',
      }),
      feishuPushPlugin(process.cwd()),
    ],
    server: {
      host: true, // 或 '0.0.0.0'
      port: 5173,
      proxy,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      server: {
        deps: {
          external: ['node:sqlite'],
        },
      },
    },
  }
})
