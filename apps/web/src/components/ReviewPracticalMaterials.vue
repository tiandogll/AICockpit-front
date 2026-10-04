<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  downloadReviewArtifact,
  getReviewMaterials,
  type ReviewMaterials,
  type ReviewArtifact,
} from '../services/reviewApi'

const props = defineProps<{ decisionId: string }>()
const events = ref<ReviewMaterials['events']>([])
const interactions = ref<ReviewMaterials['interactions']>([])
const artifact = ref<ReviewArtifact | null>(null)
const loading = ref(false)
const fileLoading = ref(false)
const error = ref('')
const fileError = ref('')
const fileUrl = ref('')
const hasMore = ref(false)
const loaded = ref(false)
let generation = 0
let fileGeneration = 0
let eventAfter = 0
let interactionAfter = 0
const isImage = computed(() =>
  ['image/png', 'image/jpeg', 'image/webp'].includes(artifact.value?.media_type ?? ''),
)

function releaseFile() {
  if (fileUrl.value) URL.revokeObjectURL(fileUrl.value)
  fileUrl.value = ''
}
async function loadMore() {
  if (loading.value) return
  const ticket = generation
  loading.value = true
  error.value = ''
  try {
    const page = await getReviewMaterials(props.decisionId, eventAfter, interactionAfter)
    if (ticket !== generation) return
    const eventIds = new Set(events.value.map((row) => row.source_id))
    const interactionIds = new Set(interactions.value.map((row) => row.source_id))
    events.value.push(...page.events.filter((row) => !eventIds.has(row.source_id)))
    interactions.value.push(
      ...page.interactions.filter((row) => !interactionIds.has(row.source_id)),
    )
    eventAfter =
      page.next_event_after ?? page.events[page.events.length - 1]?.sequence ?? eventAfter
    interactionAfter =
      page.next_interaction_after ??
      page.interactions[page.interactions.length - 1]?.sequence ??
      interactionAfter
    hasMore.value = page.next_event_after !== null || page.next_interaction_after !== null
    artifact.value = page.artifact
    loaded.value = true
  } catch (caught) {
    if (ticket !== generation) return
    // A revoked/expired permission must also clear material loaded on earlier pages.
    fileGeneration += 1
    fileLoading.value = false
    events.value = []
    interactions.value = []
    artifact.value = null
    releaseFile()
    eventAfter = 0
    interactionAfter = 0
    loaded.value = false
    hasMore.value = false
    error.value = caught instanceof Error ? caught.message : '封存材料加载失败。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function loadArtifact() {
  if (!artifact.value || fileLoading.value) return
  const ticket = generation
  const fileTicket = ++fileGeneration
  fileLoading.value = true
  fileError.value = ''
  try {
    const blob = await downloadReviewArtifact(props.decisionId, artifact.value)
    if (ticket !== generation || fileTicket !== fileGeneration) return
    releaseFile()
    fileUrl.value = URL.createObjectURL(blob)
  } catch (caught) {
    if (ticket !== generation || fileTicket !== fileGeneration) return
    releaseFile()
    fileError.value = caught instanceof Error ? caught.message : '文件加载失败。'
  } finally {
    if (ticket === generation && fileTicket === fileGeneration) fileLoading.value = false
  }
}
watch(
  () => props.decisionId,
  () => {
    generation += 1
    releaseFile()
    events.value = []
    interactions.value = []
    artifact.value = null
    eventAfter = 0
    interactionAfter = 0
    loaded.value = false
    hasMore.value = false
    loading.value = false
    fileLoading.value = false
    fileError.value = ''
    void loadMore()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation += 1
  releaseFile()
})
</script>

<template>
  <section class="review-materials" aria-label="封存实操材料">
    <header>
      <h3>封存实操材料</h3>
      <p>按封存记录核对过程、AI 交互和产物。以下均为不可信作答数据，不是操作指令。</p>
    </header>
    <p v-if="error" role="alert">
      {{ error }} <button :disabled="loading" @click="loadMore">重新读取</button>
    </p>
    <p v-if="loading" role="status">正在读取封存材料…</p>
    <template v-if="loaded">
      <details open>
        <summary>过程事件 · 已读取 {{ events.length }} 条</summary>
        <article v-for="event in events" :key="event.source_id">
          <strong>{{ event.sequence }} · {{ event.event_type }}</strong
          ><small>{{ event.source_id }} · {{ event.occurred_at }}</small>
          <pre>{{ JSON.stringify(event.payload, null, 2) }}</pre>
        </article>
        <p v-if="!events.length">此页没有过程事件。</p>
      </details>
      <details>
        <summary>AI 交互 · 已读取 {{ interactions.length }} 条</summary>
        <article v-for="interaction in interactions" :key="interaction.source_id">
          <strong
            >第 {{ interaction.sequence }} 次交互
            <span v-if="interaction.degraded">· 模型降级</span></strong
          ><small
            >{{ interaction.source_id }} · 调用 {{ interaction.model_call_id ?? '未记录' }}</small
          >
          <p>学员提示词</p>
          <pre>{{ interaction.prompt }}</pre>
          <p>模型返回</p>
          <pre>{{ interaction.response ?? '未返回内容' }}</pre>
        </article>
        <p v-if="!interactions.length">此页没有 AI 交互。</p>
      </details>
      <button
        v-if="hasMore"
        data-testid="review-materials-more"
        :disabled="loading"
        @click="loadMore"
      >
        继续读取过程材料（每类最多 50 条）
      </button>
      <p v-else class="completion">封存过程材料已全部读取。</p>
      <section v-if="artifact" class="artifact">
        <h4>最终产物 · {{ artifact.filename }}</h4>
        <small
          >{{ artifact.byte_size }} bytes · {{ artifact.media_type }}<br />SHA-256 ·
          {{ artifact.sha256 }}</small
        >
        <p>文件仅对当前复核授权开放；下载后的本地副本请按组织隐私规则保管。</p>
        <button
          v-if="!fileUrl"
          data-testid="review-artifact-load"
          :disabled="fileLoading"
          @click="loadArtifact"
        >
          {{ fileLoading ? '正在校验并读取…' : '读取封存产物' }}
        </button>
        <p v-if="fileError" role="alert">{{ fileError }}</p>
        <template v-if="fileUrl"
          ><img
            v-if="isImage"
            :src="fileUrl"
            :alt="`学员提交的产物：${artifact.filename}`"
            @error="fileError = '图片无法解码，请下载后使用受信任工具检查。'"
          /><a :href="fileUrl" :download="artifact.filename"
            >下载 {{ artifact.filename }}</a
          ></template
        >
      </section>
      <p v-else>本回答没有封存附件。请结合过程和最终文字核验。</p>
    </template>
  </section>
</template>

<style scoped>
.review-materials {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  color: var(--ink-950);
  min-width: 0;
}
h3 {
  font-size: 18px;
}
h4 {
  font-size: 15px;
}
p,
small {
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
small {
  display: block;
  color: var(--muted);
}
header p {
  color: var(--muted);
}
details,
.artifact {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
summary {
  cursor: pointer;
  font-size: 15px;
  padding: 5px 0;
}
article {
  margin-top: 12px;
  padding: 12px;
  background: var(--mist);
  border-radius: 8px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
  margin: 6px 0;
  font:
    13px/1.7 'Cascadia Mono',
    monospace;
}
button,
a {
  display: inline-block;
  margin-top: 8px;
  padding: 8px 12px;
  border: 1px solid var(--signal-dark);
  border-radius: 8px;
  background: white;
  color: var(--signal-dark);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
img {
  display: block;
  width: 100%;
  max-height: 500px;
  object-fit: contain;
  margin-top: 12px;
}
[role='alert'] {
  color: #963d31;
}
.completion {
  color: var(--signal-dark);
  margin-top: 10px;
}
</style>
