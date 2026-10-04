<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { Download, FileCheck2 } from '@lucide/vue'
import {
  downloadDialogueAttachment,
  getDialogueAttachments,
  type DialogueAttachment,
} from '../services/assessmentWorkspaceApi'

const props = defineProps<{ sessionId: string; itemId: string }>()
const attachments = ref<DialogueAttachment[]>([])
const loading = ref(false)
const downloading = ref('')
const error = ref('')
let generation = 0
let downloadController: AbortController | null = null
async function load() {
  const ticket = ++generation
  downloadController?.abort()
  attachments.value = []
  downloading.value = ''
  error.value = ''
  loading.value = true
  try {
    const response = await getDialogueAttachments(props.sessionId, props.itemId)
    if (ticket === generation)
      attachments.value = response.attachments.filter((file) => file.state === 'ready')
  } catch (caught) {
    if (ticket === generation)
      error.value = caught instanceof Error ? caught.message : '附件暂时无法读取。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function download(file: DialogueAttachment) {
  if (downloading.value) return
  const ticket = generation
  downloading.value = file.id
  downloadController = new AbortController()
  error.value = ''
  try {
    await downloadDialogueAttachment(props.sessionId, props.itemId, file, downloadController.signal)
  } catch (caught) {
    if (ticket === generation)
      error.value = caught instanceof Error ? caught.message : '附件暂时无法下载。'
  } finally {
    if (ticket === generation) downloading.value = ''
  }
}
watch(
  () => [props.sessionId, props.itemId],
  () => void load(),
  { immediate: true },
)
onBeforeUnmount(() => {
  generation += 1
  downloadController?.abort()
})
</script>
<template>
  <section class="read-only-attachments" aria-label="本题附件记录">
    <h3><FileCheck2 :size="17" />本题附件记录</h3>
    <p v-if="loading" role="status">正在读取私有附件记录…</p>
    <p v-if="error" role="alert">
      {{ error }} <button :disabled="loading" @click="load">重新读取</button>
    </p>
    <ul v-if="attachments.length">
      <li v-for="file in attachments" :key="file.id">
        <div>
          <strong>{{ file.filename }}</strong>
          <small
            >{{ file.bound_turn_id ? '已随回答封存 · 只读' : '尚未随回答正式提交' }} ·
            {{ file.byte_size }} bytes</small
          >
          <small v-if="file.parse_status !== 'text_ready'">需人工查看，不作为自动识图结果。</small>
        </div>
        <button
          :disabled="!!downloading"
          :aria-label="`下载${file.filename}`"
          @click="download(file)"
        >
          <Download :size="15" />{{ downloading === file.id ? '下载中' : '下载' }}
        </button>
      </li>
    </ul>
    <p v-else-if="!loading && !error">本题没有可读取的附件。</p>
    <p v-if="attachments.length" class="note">回看不会修改回答；未提交附件不会成为正式评分证据。</p>
  </section>
</template>
<style scoped>
.read-only-attachments {
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid #d6e1e4;
  color: #5d727a;
}
h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
}
p,
small {
  font-size: 13px;
  line-height: 1.7;
}
ul {
  list-style: none;
  padding: 0;
  margin: 12px 0;
}
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
}
li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
strong {
  font-size: 14px;
}
small {
  display: block;
}
button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 10px;
  border: 1px solid #b7d5dc;
  border-radius: 5px;
  background: #fff;
  color: #137f91;
  white-space: nowrap;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
button:disabled {
  opacity: 0.55;
  cursor: wait;
}
[role='alert'] {
  color: #923d30;
}
.note {
  color: #718189;
}
</style>
