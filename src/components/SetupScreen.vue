<script setup lang="ts">
import { CONFIG_FIELDS, serviceConfig } from '../config/env'
</script>

<template>
  <main class="setup">
    <section class="setup-card">
      <p class="eyebrow">开始之前</p>
      <h2>先填写接口地址和 token</h2>
      <p class="lead">
        把项目根目录的 <code>.env.example</code> 复制为 <code>.env.local</code>，填好下面各项，然后重新运行
        <code>npm run dev</code>。改环境变量后需要重启开发服务才会生效。收入走
        <code>/report/afsData/list</code>，使用 <code>VITE_MIS_ADMIN_TOKEN</code>。
      </p>
      <ol>
        <li v-for="field in CONFIG_FIELDS" :key="field.key">
          <span class="mark" :class="{ ok: Boolean(serviceConfig[field.key]) }">
            {{ serviceConfig[field.key] ? '已填写' : '未填写' }}
          </span>
          <code>{{ field.label }}</code>
        </li>
      </ol>
      <p class="note">token 只留在本机的 <code>.env.local</code>，这个文件不会提交到仓库。</p>
    </section>
  </main>
</template>

<style scoped>
.setup {
  display: grid;
  place-items: center;
  min-height: calc(100vh - 56px);
  padding: 32px 16px;
}

.setup-card {
  width: min(680px, 100%);
  padding: 32px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: #fff;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--blue);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.08em;
}

h2 {
  margin: 0 0 12px;
  font-size: 28px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.lead,
.note {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}

code {
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 12px;
}

ol {
  display: grid;
  gap: 10px;
  margin: 22px 0;
  padding: 0;
  list-style: none;
}

li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--paper);
}

.mark {
  flex: 0 0 auto;
  min-width: 52px;
  color: var(--warn);
  font-size: 12px;
  font-weight: 650;
}

.mark.ok {
  color: var(--ok);
}
</style>
