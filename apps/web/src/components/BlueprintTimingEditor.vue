<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import {
  createBlueprintTimingVersion,
  type ContentRecord,
  type ContentIdentity,
} from '../services/contentApi'
const props = defineProps<{ source: ContentRecord; disabled?: boolean }>()
const emit = defineEmits<{ saved: [identity: ContentIdentity]; busy: [value: boolean] }>()
const seconds = ref(1800),
  enabled = ref(false),
  busy = ref(false),
  error = ref('')
let fingerprint = '',
  key = '',
  generation = 0
watch(
  () => props.source,
  (value) => {
    generation++
    const duration = value.configuration?.assessment_time_limit_seconds
    enabled.value = typeof duration === 'number'
    seconds.value = typeof duration === 'number' ? duration : 1800
    fingerprint = ''
    key = ''
    error.value = ''
    busy.value = false
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
})
async function save() {
  if (busy.value || props.disabled) return
  const value = enabled.value ? seconds.value : null
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 86400)) {
    error.value = '时限须为1至86400秒的整数。'
    return
  }
  const body = JSON.stringify([props.source.id, value])
  if (body !== fingerprint) {
    fingerprint = body
    key = `blueprint-timing-${crypto.randomUUID()}`
  }
  const ticket = generation
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const identity = await createBlueprintTimingVersion(props.source.id, value, key)
    if (ticket === generation) emit('saved', identity)
  } catch (cause) {
    if (ticket === generation) error.value = cause instanceof Error ? cause.message : '保存失败。'
  } finally {
    if (ticket === generation) busy.value = false
    emit('busy', false)
  }
}
</script>
<template>
  <form class="timing-editor" @submit.prevent="save">
    <h3>基于此版本调整限时</h3>
    <p>
      生成独立草稿，审核发布后才用于新测评；原版本和进行中的测评不变。限时连续计算，包含模型等待与退出后的时间。
    </p>
    <fieldset :disabled="disabled || busy">
      <label><input v-model="enabled" type="checkbox" />启用测评时限</label
      ><label v-if="enabled"
        >时限（秒）<input
          v-model.number="seconds"
          type="number"
          min="1"
          max="86400"
          required /></label
      ><button type="submit">{{ busy ? '正在保存…' : '创建限时配置新版本' }}</button>
    </fieldset>
    <p v-if="error" role="alert">{{ error }}</p>
  </form>
</template>
<style scoped>
.timing-editor {
  margin: 20px 0;
  padding: 20px;
  background: #f1f8fa;
  border: 1px solid #c9e4ea;
  border-radius: 10px;
}
.timing-editor h3 {
  font-size: 16px;
}
.timing-editor p {
  font-size: 13px;
  line-height: 1.8;
  margin: 10px 0;
  color: #5d727a;
}
.timing-editor fieldset {
  border: 0;
  padding: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
}
.timing-editor label {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
}
.timing-editor input[type='number'] {
  width: 110px;
  padding: 9px;
  border: 1px solid #bcd2db;
  border-radius: 6px;
}
.timing-editor button {
  background: white;
  border: 1px solid #9ecad5;
  color: #137f91;
  border-radius: 6px;
  padding: 10px 14px;
  cursor: pointer;
}
</style>
