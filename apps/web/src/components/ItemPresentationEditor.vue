<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ modelValue: string; dialogue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const config = computed<Record<string, unknown> | null>(() => {
  try {
    const value: unknown = JSON.parse(props.modelValue)
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
})
const policy = computed(
  () => config.value?.attachment_policy as Record<string, unknown> | undefined,
)
const materials = computed(() =>
  Array.isArray(config.value?.reference_materials)
    ? (config.value.reference_materials as { title: string; content: string }[])
    : [],
)
function update(key: string, value: unknown) {
  if (!config.value || props.disabled) return
  const next = { ...config.value }
  if (value === '' || value === undefined) delete next[key]
  else next[key] = value
  emit('update:modelValue', JSON.stringify(next, null, 2))
}
function text(event: Event) {
  return (event.target as HTMLInputElement).value
}
function attachment(key: string, value: unknown) {
  update('attachment_policy', {
    enabled: false,
    max_files: 3,
    max_bytes: 5242880,
    allow_code: false,
    ...policy.value,
    [key]: value,
  })
}
function material(index: number, key: string, value: string) {
  update(
    'reference_materials',
    materials.value.map((entry, i) => (i === index ? { ...entry, [key]: value } : entry)),
  )
}
</script>
<template>
  <fieldset class="presentation-editor" :disabled="disabled || !config">
    <legend>学员可见信息与附件规则</legend>
    <p>以下内容将在正式答题页展示；不要填写标准答案、隐藏量规或内部提示词。保存后仍需审核发布。</p>
    <p v-if="!config" role="alert">请先修正下方扩展配置 JSON，再编辑展示内容。</p>
    <label
      >题目目标等级<select
        :value="config?.target_level ?? ''"
        data-testid="target-level"
        @change="update('target_level', text($event))"
      >
        <option value="">未配置（不展示等级）</option>
        <option v-for="level in ['L1', 'L2', 'L3', 'L4']" :key="level">{{ level }}</option>
      </select></label
    >
    <label
      >公开回答提示<textarea
        :value="String(config?.learner_guidance ?? '')"
        maxlength="2000"
        rows="3"
        data-testid="learner-guidance"
        @input="update('learner_guidance', text($event))"
      />
    </label>
    <label
      >能力观察重点（每行一项，最多8项，每项300字）<textarea
        :value="Array.isArray(config?.evidence_focus) ? config.evidence_focus.join('\n') : ''"
        rows="3"
        @change="
          update(
            'evidence_focus',
            text($event)
              .split('\n')
              .map((value) => value.trim())
              .filter(Boolean),
          )
        "
      />
    </label>
    <div v-for="(entry, index) in materials" :key="index" class="material-editor">
      <label
        >资料 {{ index + 1 }} 标题<input
          :value="entry.title"
          maxlength="160"
          required
          @input="material(index, 'title', text($event))" /></label
      ><label
        >资料正文<textarea
          :value="entry.content"
          maxlength="20000"
          rows="4"
          required
          @input="material(index, 'content', text($event))"
        /></label
      ><button
        type="button"
        @click="
          update(
            'reference_materials',
            materials.filter((_, i) => i !== index),
          )
        "
      >
        移除此资料
      </button>
    </div>
    <button
      type="button"
      :disabled="materials.length >= 5"
      @click="update('reference_materials', [...materials, { title: '', content: '' }])"
    >
      添加任务资料（{{ materials.length }}/5）
    </button>
    <template v-if="dialogue"
      ><label class="check"
        ><input
          type="checkbox"
          :checked="policy?.enabled === true"
          @change="attachment('enabled', ($event.target as HTMLInputElement).checked)"
        />允许对话附件</label
      ><template v-if="policy?.enabled"
        ><label
          >每题文件上限<input
            type="number"
            :value="policy.max_files ?? 3"
            min="1"
            max="3"
            required
            @change="attachment('max_files', Number(text($event)))" /></label
        ><label
          >单文件上限（字节，最多5 MiB）<input
            type="number"
            :value="policy.max_bytes ?? 5242880"
            min="1"
            max="5242880"
            required
            @change="attachment('max_bytes', Number(text($event)))" /></label
        ><label class="check"
          ><input
            type="checkbox"
            :checked="policy.allow_code === true"
            @change="attachment('allow_code', ($event.target as HTMLInputElement).checked)"
          />额外允许受支持的代码文本</label
        >
        <p>
          支持 TXT、MD、CSV、JSON、PNG、JPEG、WebP；图片进入人工复核。首版不支持 PDF、DOCX。
        </p></template
      ></template
    >
  </fieldset>
</template>
<style scoped>
.presentation-editor {
  border: 0;
  border-top: 1px solid #d6e8ed;
  padding: 20px 0;
  margin: 20px 0;
  min-width: 0;
}
.presentation-editor legend {
  font-size: 15px;
  font-weight: 700;
  padding-right: 12px;
}
.presentation-editor p {
  font-size: 13px;
  color: #5d727a;
  line-height: 1.7;
  margin: 10px 0 16px;
}
.presentation-editor label {
  display: grid;
  gap: 8px;
  font-size: 13px;
  margin: 15px 0;
}
.presentation-editor input,
.presentation-editor select,
.presentation-editor textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #bcd2db;
  border-radius: 7px;
  background: white;
  font: inherit;
  color: #183b46;
}
.presentation-editor .check {
  display: flex;
  align-items: center;
}
.check input {
  width: auto;
}
.presentation-editor button {
  border: 1px solid #bcd2db;
  padding: 9px 13px;
  border-radius: 7px;
  background: #fff;
  color: #137f91;
  cursor: pointer;
}
.material-editor {
  border-left: 2px solid #c9e4ea;
  padding-left: 15px;
}
</style>
