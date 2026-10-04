<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FilePenLine, Lightbulb, X } from '@lucide/vue'
import type { AssessmentItem } from '../services/assessmentApi'
const props = defineProps<{ item: AssessmentItem; hideHint?: boolean }>()
const dialog = ref<HTMLDialogElement | null>(null)
const materials = computed(() => {
  const source = props.item.configuration.reference_materials
  return Array.isArray(source)
    ? source.filter(
        (entry): entry is { title: string; content: string } =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof entry.title === 'string' &&
          Boolean(entry.title.trim()) &&
          typeof entry.content === 'string' &&
          Boolean(entry.content.trim()),
      )
    : []
})
const hint = computed(() =>
  typeof props.item.configuration.learner_guidance === 'string'
    ? props.item.configuration.learner_guidance.trim()
    : '',
)
function open() {
  if (materials.value.length && dialog.value && !dialog.value.open) dialog.value.showModal()
}
watch(
  () => props.item.item_version_id,
  () => {
    if (dialog.value?.open) dialog.value.close()
  },
)
defineExpose({ open })
</script>
<template>
  <div v-if="materials.length || (!hideHint && hint)" class="assessment-materials">
    <button
      v-if="hideHint && materials.length"
      type="button"
      class="materials-trigger"
      aria-haspopup="dialog"
      @click="open"
    >
      <FilePenLine :size="18" />查看任务资料
    </button>
    <div v-if="!hideHint && hint" class="exam-guidance">
      <Lightbulb :size="25" />
      <div>
        <strong>回答提示</strong>
        <p>{{ hint }}</p>
      </div>
    </div>
    <dialog
      v-if="materials.length"
      ref="dialog"
      class="assessment-material-dialog"
      aria-label="本题任务资料"
    >
      <header>
        <h2>本题任务资料</h2>
        <button type="button" aria-label="关闭任务资料" @click="dialog?.close()">
          <X :size="20" />
        </button>
      </header>
      <p class="material-scope">仅展示本题已发布版本的资料；不提供正式作答答案。</p>
      <article v-for="(entry, index) in materials" :key="index">
        <h3>{{ entry.title }}</h3>
        <p>{{ entry.content }}</p>
      </article>
    </dialog>
  </div>
</template>
<style scoped>
.materials-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  border: 0;
  background: none;
  color: #777e82;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.exam-guidance {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: calc(32 * var(--exam-u, 1px));
  padding: calc(14.5 * var(--exam-u, 1px)) calc(22 * var(--exam-u, 1px));
  min-height: calc(81 * var(--exam-u, 1px));
  border-radius: 22px;
  background: #ebf6f9;
  color: #59676c;
}
.exam-guidance > svg {
  flex: none;
  color: #219bac;
}
.exam-guidance strong {
  display: block;
  font-size: calc(15 * var(--exam-u, 1px));
  font-weight: 650;
}
.exam-guidance p {
  font-size: calc(15 * var(--exam-u, 1px));
  line-height: 1.6;
  margin-top: 4px;
  color: #68777d;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assessment-material-dialog {
  position: fixed;
  inset: 0 0 0 auto;
  width: min(540px, 100vw);
  height: 100dvh;
  max-height: none;
  margin: 0;
  border: 0;
  border-left: 1px solid #c5c7c9;
  padding: 28px;
}
.assessment-material-dialog::backdrop {
  background: #183b4655;
}
.assessment-material-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.assessment-material-dialog button {
  border: 0;
  background: none;
  cursor: pointer;
}
.assessment-material-dialog h2 {
  font-size: 20px;
}
.assessment-material-dialog h3 {
  font-size: 16px;
}
.assessment-material-dialog article {
  margin: 22px 0;
  border-top: 1px solid #dce6e9;
  padding-top: 18px;
}
.assessment-material-dialog p {
  font-size: 14px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin-top: 12px;
}
.assessment-material-dialog .material-scope {
  color: #6a7d85;
  font-size: 12px;
}
@media (max-width: 600px) {
  .exam-guidance {
    padding: 16px;
    border-radius: 16px;
    gap: 10px;
  }
  .exam-guidance p {
    font-size: 13px;
  }
  .materials-trigger {
    font-size: 12px;
    min-height: 40px;
  }
}
</style>
