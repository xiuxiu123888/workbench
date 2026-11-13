<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { buildDirectLandingUrl } from '../domain/campaignForm'
import { collectDirectGroups, type ArticleRefGroup } from '../domain/batch'

const props = defineProps<{
  domain: string
  writing: boolean
}>()

const emit = defineEmits<{
  write: [urls: string[]]
}>()

let nextKey = 1
const groups = ref<Array<ArticleRefGroup & { key: number }>>([emptyGroup()])

const preview = computed(() => {
  if (!props.domain) {
    return []
  }
  const urls: string[] = []
  for (const group of groups.value) {
    const result = collectDirectGroups([group])
    const item = result.ok ? result.groups[0] : undefined
    if (!item) {
      continue
    }
    urls.push(buildDirectLandingUrl(props.domain, item.articleId, item.channelId, item.linkRef))
  }
  return urls
})

function emptyGroup() {
  nextKey += 1
  return { key: nextKey, articleId: '', channelId: '', linkRef: '' }
}

function addGroup() {
  groups.value.push(emptyGroup())
}

function removeGroup(key: number) {
  if (groups.value.length === 1) {
    groups.value = [emptyGroup()]
    return
  }
  groups.value = groups.value.filter((group) => group.key !== key)
}

function clearAll() {
  if (props.writing) {
    return
  }
  groups.value = [emptyGroup()]
}

function submit() {
  if (!props.domain) {
    ElMessage.error('先在左侧选中一条运营配置，用它的域名拼链接')
    return
  }
  const result = collectDirectGroups(groups.value)
  if (!result.ok) {
    ElMessage.error(result.message)
    return
  }
  emit(
    'write',
    result.groups.map((group) => buildDirectLandingUrl(props.domain, group.articleId, group.channelId, group.linkRef)),
  )
}

async function copyUrls() {
  if (preview.value.length === 0) {
    return
  }
  try {
    await navigator.clipboard.writeText(preview.value.join('\n'))
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}
</script>

<template>
  <div class="direct">
    <h2>直接生成链接</h2>
    <p v-if="domain" class="hint">用 {{ domain }} 和填写的文章 ID 直接拼接，不复制文章，也不请求创建接口。写入时追加到左侧选中的运营配置。</p>
    <p v-else class="hint">先在左侧选中一条运营配置。链接用那条配置的域名拼接。</p>
    <div class="groups">
      <div v-for="(group, index) in groups" :key="group.key" class="group">
        <span class="group-index">{{ index + 1 }}</span>
        <label>
          <span>文章 ID</span>
          <el-input v-model="group.articleId" placeholder="文章 ID" />
        </label>
        <label>
          <span>渠道 ID</span>
          <el-input v-model="group.channelId" placeholder="渠道 ID" />
        </label>
        <label>
          <span>ref</span>
          <el-input v-model="group.linkRef" placeholder="这条链接的 ref" />
        </label>
        <el-button text @click="removeGroup(group.key)">删除</el-button>
      </div>
      <div class="group-actions">
        <el-button @click="addGroup">添加一组</el-button>
        <el-button :disabled="writing" @click="clearAll">全部清除</el-button>
      </div>
    </div>
    <div v-if="preview.length" class="preview">
      <p>已拼出 {{ preview.length }} 条</p>
      <code v-for="url in preview" :key="url">{{ url }}</code>
    </div>
    <div class="actions">
      <el-button :disabled="preview.length === 0" @click="copyUrls">复制</el-button>
      <el-button type="primary" :disabled="preview.length === 0" :loading="writing" @click="submit">
        {{ preview.length ? `写入 ${preview.length} 条` : '写入' }}
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.direct {
  height: 100%;
  overflow: auto;
}

h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 650;
}

h2::before {
  content: "";
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: var(--blue);
}

.hint {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.group {
  display: grid;
  grid-template-columns: 24px minmax(110px, 160px) minmax(120px, 180px) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: end;
}

.group-index {
  padding-bottom: 8px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 12px;
}

.group label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
}

label > span {
  color: #344054;
  font-size: 13px;
}

.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
}

.preview p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.preview code {
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-all;
}

.actions {
  display: flex;
  gap: 8px;
  margin-top: 16px;
}
</style>
