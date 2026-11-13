<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { errorMessage } from '../api/http'
import { getArticleJobItemArticle, type ArticleJobItemArticle } from '../api/articleJobs'

const props = defineProps<{
  modelValue: boolean
  taskId: string
  itemId: string | number
  subtitle?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const loading = ref(false)
const article = ref<ArticleJobItemArticle | null>(null)
const loadError = ref('')

watch(
  () => [props.modelValue, props.taskId, props.itemId] as const,
  ([open, taskId, itemId]) => {
    if (!open || !taskId || itemId == null || itemId === '') {
      return
    }
    void loadDraft()
  },
)

async function loadDraft() {
  loading.value = true
  loadError.value = ''
  article.value = null
  try {
    article.value = await getArticleJobItemArticle(props.taskId, props.itemId)
  } catch (error) {
    loadError.value = errorMessage(error)
    ElMessage.error(loadError.value)
  } finally {
    loading.value = false
  }
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    size="52%"
    append-to-body
    destroy-on-close
    title="文章草稿"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="draft-drawer">
      <p v-if="subtitle" class="sub">{{ subtitle }}</p>
      <div v-if="loading" class="state">加载草稿中…</div>
      <div v-else-if="loadError" class="state error">
        <p>{{ loadError }}</p>
        <el-button size="small" @click="loadDraft">重试</el-button>
      </div>
      <template v-else-if="article">
        <h3>{{ article.title || '（无标题）' }}</h3>
        <p v-if="article.metaTitle || article.metaDescription" class="meta">
          <span v-if="article.metaTitle">SEO：{{ article.metaTitle }}</span>
          <span v-if="article.metaDescription">{{ article.metaDescription }}</span>
        </p>
        <p v-if="article.firstP" class="lead">{{ article.firstP }}</p>
        <img v-if="article.image" class="cover" :src="article.image" alt="" />
        <div v-if="article.terms?.length" class="terms">
          <el-tag v-for="term in article.terms" :key="term" size="small" effect="plain">{{ term }}</el-tag>
        </div>
        <div class="body" v-html="article.text || '<p>（暂无正文）</p>'" />
        <ul v-if="article.sources?.length" class="sources">
          <li v-for="(source, index) in article.sources" :key="index">{{ source }}</li>
        </ul>
      </template>
      <div v-else class="state">暂无内容</div>
      <div class="foot">
        <el-button @click="close">关闭</el-button>
        <el-button type="primary" :loading="loading" @click="loadDraft">刷新</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.draft-drawer {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.sub,
.meta,
.lead,
.state {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.state.error {
  color: #b91c1c;
}

h3 {
  margin: 0;
  font-size: 20px;
  line-height: 1.35;
}

.meta {
  display: grid;
  gap: 4px;
}

.cover {
  max-width: 100%;
  border-radius: 10px;
  border: 1px solid var(--line);
}

.terms {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fafbfc;
  line-height: 1.7;
  font-size: 14px;
}

.body :deep(img) {
  max-width: 100%;
}

.sources {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12px;
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
</style>
