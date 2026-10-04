<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { getWorkspaceOverview, type ActiveSession } from '../services/workspaceApi'
const props = defineProps<{ organizationId: string; sessionId: string; mode: string }>()
const record = ref<ActiveSession | null>(null)
const loading = ref(false)
const error = ref('')
let generation = 0
async function load() {
  const ticket = ++generation
  record.value = null
  error.value = ''
  loading.value = true
  try {
    const data = await getWorkspaceOverview(props.organizationId)
    if (ticket === generation)
      record.value = data.active_sessions?.find((row) => row.id === props.sessionId) ?? null
  } catch {
    if (ticket === generation) error.value = '进度暂未同步'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
const percent = computed(() =>
  record.value?.max_items
    ? Math.min(100, (record.value.answered / record.value.max_items) * 100)
    : 0,
)
const savedTime = computed(() => {
  if (!record.value?.last_saved_at) return '暂无保存时间'
  const date = new Date(record.value.last_saved_at)
  return Number.isFinite(date.getTime())
    ? `保存于 ${date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
    : '保存时间未记录'
})
watch(() => [props.organizationId, props.sessionId], load, { immediate: true })
onBeforeUnmount(() => {
  generation++
})
</script>
<template>
  <div class="resume-progress" aria-live="polite">
    <span v-if="loading">正在同步进度…</span>
    <button v-else-if="error" type="button" @click="load">{{ error }} · 重试</button>
    <template v-else-if="record">
      <small>{{ savedTime }}</small>
      <span
        >已答 {{ record.answered }} 题<span v-if="record.max_items">
          / {{ mode === 'fixed' ? '共' : '最多' }} {{ record.max_items }} 题</span
        ></span
      >
      <progress
        v-if="record.max_items"
        :value="percent"
        max="100"
        :aria-label="mode === 'fixed' ? '固定卷答题进度' : '已答题量占上限比例，并非确定完成率'"
      />
    </template>
    <span v-else>从已保存的位置继续</span>
  </div>
</template>
<style scoped>
.resume-progress {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 14px;
  color: #657078;
}
.resume-progress small {
  font-size: 12px;
}
progress {
  appearance: none;
  width: 150px;
  height: 5px;
  border: 0;
  border-radius: 4px;
  overflow: hidden;
}
progress::-webkit-progress-bar {
  background: #e4e5e9;
}
progress::-webkit-progress-value {
  background: #347fff;
}
progress::-moz-progress-bar {
  background: #347fff;
}
button {
  color: #347fff;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 8px;
}
button:focus-visible {
  outline: 2px solid #347fff;
}
@media (max-width: 600px) {
  .resume-progress {
    justify-content: flex-start;
  }
  progress {
    width: 100px;
  }
}
</style>
