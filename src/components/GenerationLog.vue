<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { filterGenerationLog, type GenerationRecord } from '../domain/generationLog'
import { generationLogOpen } from '../generationLogUi'

const props = defineProps<{
  records: GenerationRecord[]
}>()

const emit = defineEmits<{
  clear: []
}>()

const query = ref('')

const visible = computed(() => filterGenerationLog(props.records, query.value))

function formatTime(createdAt: number): string {
  const date = new Date(createdAt)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

async function copyText(text: string) {
  if (!text) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function clearLog() {
  try {
    await ElMessageBox.confirm('清空后会删除 data/generation-log.db 里的记录，已经写入的运营配置不受影响。', '清空生成记录', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  emit('clear')
}
</script>

<template>
  <el-drawer v-model="generationLogOpen" title="生成记录" size="92%" append-to-body class="generation-drawer">
    <div class="drawer-toolbar">
      <el-input v-model="query" clearable placeholder="搜文章 ID、标题、ref、渠道、网站或链接" />
      <span>{{ visible.length }} / {{ records.length }}</span>
      <el-button :disabled="records.length === 0" @click="clearLog">清空</el-button>
    </div>
    <el-table :data="visible" height="calc(100vh - 150px)" stripe empty-text="还没有生成记录">
      <el-table-column label="时间" width="168">
        <template #default="{ row }">{{ formatTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="sourceArticleId" label="原文章 ID" width="130" show-overflow-tooltip />
      <el-table-column prop="newArticleId" label="新文章 ID" width="130" show-overflow-tooltip />
      <el-table-column prop="title" label="标题" min-width="160" show-overflow-tooltip />
      <el-table-column prop="linkRef" label="ref" min-width="180" show-overflow-tooltip />
      <el-table-column prop="siteName" label="网站" width="150" show-overflow-tooltip />
      <el-table-column prop="articleAccount" label="文章账户" width="110" show-overflow-tooltip />
      <el-table-column prop="afsAccount" label="AFS" width="90" show-overflow-tooltip />
      <el-table-column prop="channel" label="渠道" width="130" show-overflow-tooltip />
      <el-table-column label="链接" min-width="280">
        <template #default="{ row }">
          <div class="link-cell">
            <span>{{ row.url || '—' }}</span>
            <el-button v-if="row.url" link type="primary" @click="copyText(row.url)">复制</el-button>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="140">
        <template #default="{ row }">
          <span :class="row.ok ? 'ok' : 'bad'">{{ row.ok ? '完成' : row.message || '失败' }}</span>
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>
</template>

<style scoped>
.drawer-toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.drawer-toolbar .el-input {
  flex: 1;
}

.drawer-toolbar span {
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 12px;
}

.link-cell {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.link-cell span {
  min-width: 0;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.ok {
  color: var(--ok);
}

.bad {
  color: #c2410c;
}
</style>
