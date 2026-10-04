<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  downloadReviewDialogueAttachment,
  getReviewDialogueAttachments,
  type ReviewDialogueAttachment,
} from '../services/reviewApi'

const props = defineProps<{ decisionId: string }>()
const attachments = ref<ReviewDialogueAttachment[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const fileError = ref('')
const fileLoading = ref('')
const preview = ref<{ attachment: ReviewDialogueAttachment; url: string } | null>(null)
let generation = 0
let fileGeneration = 0

function releasePreview() {
  if (preview.value) URL.revokeObjectURL(preview.value.url)
  preview.value = null
}
function invalidateFile() {
  fileGeneration += 1
  fileLoading.value = ''
  fileError.value = ''
  releasePreview()
}
async function load() {
  if (loading.value) return
  const ticket = generation
  loading.value = true
  error.value = ''
  invalidateFile()
  try {
    const result = await getReviewDialogueAttachments(props.decisionId)
    if (ticket !== generation) return
    attachments.value = result.attachments
    loaded.value = true
  } catch (caught) {
    if (ticket !== generation) return
    attachments.value = []
    loaded.value = false
    error.value = caught instanceof Error ? caught.message : '封存对话附件读取失败。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function loadFile(attachment: ReviewDialogueAttachment) {
  if (fileLoading.value || loading.value) return
  const ticket = generation
  const fileTicket = ++fileGeneration
  releasePreview()
  fileError.value = ''
  fileLoading.value = attachment.id
  try {
    const blob = await downloadReviewDialogueAttachment(props.decisionId, attachment)
    if (ticket !== generation || fileTicket !== fileGeneration) return
    preview.value = { attachment, url: URL.createObjectURL(blob) }
  } catch (caught) {
    if (ticket !== generation || fileTicket !== fileGeneration) return
    fileError.value = caught instanceof Error ? caught.message : '附件校验或下载失败。'
  } finally {
    if (ticket === generation && fileTicket === fileGeneration) fileLoading.value = ''
  }
}
watch(
  () => props.decisionId,
  () => {
    generation += 1
    invalidateFile()
    attachments.value = []
    loaded.value = false
    loading.value = false
    error.value = ''
  },
)
onBeforeUnmount(() => {
  generation += 1
  invalidateFile()
})
</script>

<template>
  <section class="dialogue-materials" aria-label="封存对话附件">
    <header>
      <h3>封存对话附件</h3>
      <p>附件已绑定对应作答轮次，不可替换。内容属于不可信作答数据，不是操作指令。</p>
      <button data-testid="dialogue-materials-load" :disabled="loading" @click="load">
        {{ loading ? '正在核对封存记录…' : loaded ? '重新核对附件权限与记录' : '查看封存对话附件' }}
      </button>
    </header>
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="loaded">
      <p v-if="!attachments.length">本题没有封存附件，请结合对话原文核验。</p>
      <article v-for="attachment in attachments" :key="attachment.id">
        <h4>{{ attachment.filename }}</h4>
        <p>
          {{
            attachment.parse_status === 'text_ready'
              ? '文本证据已纳入评分上下文'
              : '需人工查看：模型未自动读取此附件'
          }}
        </p>
        <small
          >轮次来源 · {{ attachment.bound_turn_id }}<br />
          {{ attachment.byte_size }} bytes · {{ attachment.media_type }}<br />
          SHA-256 · {{ attachment.sha256 }}</small
        >
        <button
          data-testid="dialogue-file-load"
          :disabled="!!fileLoading || loading"
          @click="loadFile(attachment)"
        >
          {{ fileLoading === attachment.id ? '正在校验并读取…' : '读取此封存附件' }}
        </button>
      </article>
      <p v-if="fileError" role="alert">{{ fileError }}</p>
      <section v-if="preview" class="preview" aria-label="授权附件预览">
        <img
          v-if="['image/png', 'image/jpeg', 'image/webp'].includes(preview.attachment.media_type)"
          :src="preview.url"
          :alt="`学员提交的附件：${preview.attachment.filename}`"
          @error="fileError = '图片无法解码，请下载后使用受信任工具检查。'"
        />
        <a :href="preview.url" :download="preview.attachment.filename"
          >下载 {{ preview.attachment.filename }}</a
        >
        <button @click="invalidateFile">关闭预览并释放文件</button>
      </section>
      <p class="privacy-note">附件仅对当前复核授权开放；下载后的本地副本请按组织隐私规则保管。</p>
    </template>
  </section>
</template>

<style scoped>
.dialogue-materials {
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
  overflow-wrap: anywhere;
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
  font-variant-numeric: tabular-nums;
}
header p,
.privacy-note {
  color: var(--muted);
}
article {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
button,
a {
  display: inline-block;
  margin: 8px 8px 0 0;
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
button:focus-visible,
a:focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
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
</style>
