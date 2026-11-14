<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { appReady, articleReady, misReady, ruoyiReady } from './config/env'
import SetupScreen from './components/SetupScreen.vue'

const route = useRoute()
const sidebarCollapsed = ref(false)
const openMenus = ref<string[]>(['ops', 'data', 'funnelOps'])

const activeMenu = computed(() => route.path)
const pageTitle = computed(() => String(route.meta.title || '运营工作台'))
const pageSubtitle = computed(() => String(route.meta.subtitle || ''))
const pageFill = computed(() => Boolean(route.meta.fill))
</script>

<template>
  <div class="shell" :class="{ collapsed: sidebarCollapsed }">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="brand-mark" aria-hidden="true">运</div>
        <div v-show="!sidebarCollapsed" class="brand-copy">
          <strong>运营工作台</strong>
        </div>
      </div>

      <div v-if="appReady" class="sidebar-nav">
        <el-menu
          :key="String(sidebarCollapsed)"
          :default-active="activeMenu"
          :default-openeds="openMenus"
          :collapse="sidebarCollapsed"
          :collapse-transition="false"
          background-color="#101826"
          text-color="#c9d4e5"
          active-text-color="#ffffff"
          class="side-menu"
          router
        >
          <el-sub-menu index="ops">
            <template #title>
              <span>推荐文章运营</span>
            </template>
            <el-menu-item index="/config">配置</el-menu-item>
            <el-menu-item index="/auto">编排</el-menu-item>
            <el-menu-item index="/replace">换文待办</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="data">
            <template #title>
              <span>数据</span>
            </template>
            <el-menu-item index="/dashboard">运营文章大盘</el-menu-item>
          </el-sub-menu>

          <el-sub-menu index="funnelOps">
            <template #title>
              <span>运营中心</span>
            </template>
            <el-menu-item index="/funnels">漏斗总览</el-menu-item>
            <el-menu-item index="/ops-center">漏斗分析</el-menu-item>
            <el-menu-item index="/offer-seed">Offer 创编</el-menu-item>
            <el-menu-item index="/offer-create">创建 Offer</el-menu-item>
            <el-menu-item index="/seed-keyword-daily">种子词日报</el-menu-item>
            <el-menu-item index="/auto-offer-replace">调优报告</el-menu-item>
          </el-sub-menu>
        </el-menu>
      </div>

      <div class="sidebar-foot">
        <div v-show="!sidebarCollapsed" class="status">
          <span class="pill" :class="{ on: articleReady }">
            <i />运营配置 {{ articleReady ? '已配置' : '未配置' }}
          </span>
          <span class="pill" :class="{ on: misReady }">
            <i />MIS {{ misReady ? '已配置' : '未配置' }}
          </span>
          <span class="pill" :class="{ on: ruoyiReady }">
            <i />漏斗 {{ ruoyiReady ? '已配置' : '未配置' }}
          </span>
        </div>
        <el-button class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
          {{ sidebarCollapsed ? '展开菜单' : '收起菜单' }}
        </el-button>
      </div>
    </aside>

    <div class="main-column">
      <header v-if="appReady" class="main-bar">
        <h1>{{ pageTitle }}</h1>
        <p v-if="pageSubtitle">{{ pageSubtitle }}</p>
      </header>

      <SetupScreen v-if="!appReady" />
      <main v-else class="page-frame" :class="{ 'page-frame--fill': pageFill }">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(1200px 400px at 80% -10%, #e8eef8 0%, transparent 55%),
    var(--paper);
}

.sidebar {
  display: flex;
  flex-direction: column;
  width: 232px;
  flex: 0 0 232px;
  height: 100%;
  min-height: 0;
  color: #e8eef6;
  background: linear-gradient(165deg, #152033 0%, #101826 48%, #0d1420 100%);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.08);
}

.shell.collapsed .sidebar {
  width: 72px;
  flex-basis: 72px;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.brand-mark {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(145deg, #3b82f6 0%, #1d4ed8 100%);
  box-shadow: 0 8px 18px rgba(29, 78, 216, 0.35);
  color: #fff;
  font-size: 15px;
  font-weight: 750;
}

.brand-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.brand-copy strong {
  font-size: 15px;
  font-weight: 700;
}

.brand-copy span {
  color: #93a0b4;
  font-size: 12px;
}

.sidebar-nav {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 10px 0;
}

.side-menu {
  border-right: 0 !important;
  background: transparent !important;
}

.side-menu:not(.el-menu--collapse) {
  width: 100%;
}

.side-menu :deep(.el-sub-menu__title),
.side-menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 2px 10px;
  border-radius: 10px;
}

.side-menu :deep(.el-sub-menu__title:hover),
.side-menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.06) !important;
}

.side-menu :deep(.el-menu-item.is-active) {
  background: rgba(47, 111, 237, 0.28) !important;
  color: #fff !important;
  font-weight: 650;
}

.side-menu :deep(.el-sub-menu .el-menu) {
  background: transparent !important;
}

.side-menu :deep(.el-sub-menu .el-menu-item) {
  padding-left: 44px !important;
  min-width: 0;
}

.side-menu :deep(.el-sub-menu__icon-arrow) {
  color: #93a0b4;
}

.sidebar-foot {
  display: grid;
  gap: 10px;
  padding: 14px 12px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.18);
}

.status {
  display: grid;
  gap: 6px;
}

.sidebar .pill {
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.05);
  color: #93a0b4;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.sidebar .pill.on {
  background: rgba(23, 128, 61, 0.18);
  color: #86efac;
  border-color: rgba(134, 239, 172, 0.25);
}

.sidebar .pill.on i {
  background: #4ade80;
}

.collapse-btn {
  width: 100%;
  --el-button-bg-color: rgba(255, 255, 255, 0.04);
  --el-button-border-color: rgba(255, 255, 255, 0.12);
  --el-button-text-color: #93a0b4;
  --el-button-hover-bg-color: rgba(47, 111, 237, 0.18);
  --el-button-hover-border-color: rgba(147, 197, 253, 0.35);
  --el-button-hover-text-color: #dbeafe;
}

.main-column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-bar {
  flex: 0 0 56px;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
}

.main-bar h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 650;
}

.main-bar p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.page-frame {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px 24px;
}

.page-frame--fill {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.page-frame--fill > :deep(*) {
  flex: 1;
  min-height: 0;
}

.shell.collapsed .sidebar-brand {
  justify-content: center;
}

@media (max-width: 900px) {
  .shell {
    flex-direction: column;
    overflow: auto;
  }

  .sidebar,
  .shell.collapsed .sidebar {
    width: 100%;
    flex-basis: auto;
    height: auto;
    min-height: 0;
  }

  .main-column {
    height: auto;
    min-height: calc(100vh - 120px);
  }

  .page-frame {
    overflow: auto;
  }

  .main-bar p {
    display: none;
  }
}
</style>
