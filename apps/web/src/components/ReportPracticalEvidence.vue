<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import {
  getPracticalSnapshot,
  type PracticalSnapshot,
  type PracticalArtifact,
} from '../services/practicalApi'
const props = defineProps<{ sessionId: string; itemId: string }>()
const auth = useAuthStore()
const data = ref<PracticalSnapshot | null>(null),
  loading = ref(false),
  error = ref(''),
  downloadError = ref(''),
  downloading = ref(false)
let generation = 0
const connection = computed(() => ({
  apiBase: '',
  token: '',
  sessionId: props.sessionId,
  itemId: props.itemId,
  request: auth.request,
}))
async function load() {
  const ticket = ++generation
  loading.value = true
  error.value = ''
  data.value = null
  try {
    const value = await getPracticalSnapshot(connection.value)
    if (ticket === generation) data.value = value
  } catch {
    if (ticket === generation) error.value = '实操过程暂不可读取，可能已清理或访问权限已变化。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function download(file: PracticalArtifact) {
  if (downloading.value) return
  const ticket = generation
  downloading.value = true
  downloadError.value = ''
  try {
    const response = await auth.request(
      `/sessions/${props.sessionId}/practical/${props.itemId}/artifacts/${file.id}`,
    )
    if (!response.ok) throw new Error('文件下载失败，请稍后重试。')
    const blob = await response.blob()
    if (ticket !== generation) return
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.filename
    anchor.click()
    URL.revokeObjectURL(url)
  } catch {
    if (ticket === generation) downloadError.value = '文件下载失败，请稍后重试。'
  } finally {
    if (ticket === generation) downloading.value = false
  }
}
const eventNames: Record<string, string> = {
  task_decomposition: '任务拆解',
  prompt_draft: '提示词草稿',
  prompt_revision: '提示词迭代',
  tool_use: '工具使用',
  result_verification: '结果核验',
  artifact_note: '产物说明',
}
watch(() => [props.sessionId, props.itemId], load, { immediate: true })
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <section class="practical-evidence">
    <h3>实操过程与文件 · 只读</h3>
    <p v-if="loading" role="status">正在读取过程证据…</p>
    <p v-if="error" role="alert">{{ error }} <button @click="load">重新读取实操</button></p>
    <template v-if="data"
      ><details>
        <summary>过程事件 {{ data.events.length }} 项</summary>
        <article v-for="event in data.events" :key="event.id">
          <h4>{{ event.sequence }} · {{ eventNames[event.event_type] ?? event.event_type }}</h4>
          <pre>{{ JSON.stringify(event.payload, null, 2) }}</pre>
        </article>
      </details>
      <details>
        <summary>受控 AI 交互 {{ data.interactions.length }} 次</summary>
        <article v-for="interaction in data.interactions" :key="interaction.id">
          <h4>第 {{ interaction.sequence }} 次交互</h4>
          <p>{{ interaction.prompt }}</p>
          <pre>{{ interaction.response ?? '没有已保存的模型回答' }}</pre>
        </article>
      </details>
      <p v-if="downloadError" role="alert">{{ downloadError }}</p>
      <article v-for="file in data.artifacts" :key="file.id">
        <strong>{{ file.filename }}</strong>
        <p>{{ file.byte_size }} bytes · SHA-256 {{ file.sha256 }}</p>
        <button :disabled="downloading || file.state !== 'ready'" @click="download(file)">
          {{ file.state === 'ready' ? (downloading ? '下载中…' : '下载文件') : '文件尚不可用' }}
        </button>
      </article>
      <p v-if="!data.artifacts.length">没有已保存的文件产物。</p></template
    >
  </section>
</template>
<style scoped>
.practical-evidence {
  border-top: 1px solid #cbd9e1;
  padding-top: 18px;
  margin-top: 18px;
  font-size: 14px;
}
.practical-evidence details,
.practical-evidence article {
  padding: 14px 0;
  border-bottom: 1px solid #dbe3e9;
}
.practical-evidence p,
.practical-evidence pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  line-height: 1.8;
}
.practical-evidence summary {
  cursor: pointer;
  font-weight: 600;
}
.practical-evidence button {
  padding: 8px 12px;
  border: 1px solid #bdd1ed;
  background: white;
  color: #427eff;
  border-radius: 6px;
  cursor: pointer;
}
.practical-evidence button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
