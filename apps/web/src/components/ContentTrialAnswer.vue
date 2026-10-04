<script setup lang="ts">
import type { TrialQuestion, TrialType } from '../services/contentTrialApi'
import type { TrialFields } from '../domain/contentTrial'
defineProps<{ type: TrialType; question: TrialQuestion; disabled: boolean }>()
const fields = defineModel<TrialFields>({ required: true })
const practicalFields = [
  { key: 'plan' as const, label: '任务拆解', hint: '说明目标、约束与处理步骤。', max: 8000 },
  {
    key: 'artifact' as const,
    label: '文本 / 代码产出',
    hint: '在此粘贴你的文本或代码。本页不执行代码，也不接收文件。',
    max: 30000,
  },
  {
    key: 'verification' as const,
    label: '验证方法',
    hint: '说明会怎样检验产出，列出测试或核查依据。',
    max: 8000,
  },
  {
    key: 'reflection' as const,
    label: '反思',
    hint: '说明局限、风险与可以改进的地方。',
    max: 8000,
  },
]
</script>
<template>
  <div class="trial-answer">
    <p class="question-stem">{{ question.stem }}</p>
    <p v-if="question.attribution" class="attribution">{{ question.attribution }}</p>
    <fieldset v-if="type === 'objective'" :disabled="disabled">
      <legend>选择一个选项</legend>
      <label v-for="(option, index) in question.options" :key="index" class="option">
        <input
          v-model="fields.selected_index"
          type="radio"
          name="trial-choice"
          :value="index"
          :data-testid="`trial-option-${index}`"
          :disabled="disabled"
        />
        <span
          ><b>{{ String.fromCharCode(65 + index) }}.</b> {{ option }}</span
        >
      </label>
    </fieldset>
    <template v-else-if="type === 'dialogue'">
      <p class="hint">完成初答和两条已经审核的固定追问。本页没有 AI 对话或自动评分。</p>
      <label v-for="(_, index) in fields.answers" :key="index" class="answer-field">
        <strong>{{ index === 0 ? '初答' : `固定追问 ${index}` }}</strong>
        <span v-if="index > 0" class="followup">{{ question.followups[index - 1] }}</span>
        <textarea
          v-model="fields.answers[index]"
          :data-testid="`trial-dialogue-${index}`"
          rows="5"
          maxlength="4000"
          :disabled="disabled"
        />
        <small>{{ fields.answers[index]?.length ?? 0 }} / 4000 字</small>
      </label>
    </template>
    <template v-else>
      <p class="hint">
        按下列四部分说明你的处理。只收集文字与代码文本，不调用模型、不执行代码、不上传文件。
      </p>
      <label v-for="field in practicalFields" :key="field.key" class="answer-field">
        <strong>{{ field.label }}</strong
        ><span>{{ field.hint }}</span>
        <textarea
          v-model="fields[field.key]"
          :data-testid="`trial-practical-${field.key}`"
          :class="{ code: field.key === 'artifact' }"
          :rows="field.key === 'artifact' ? 10 : 5"
          :maxlength="field.max"
          :disabled="disabled"
        />
        <small>{{ fields[field.key].length }} / {{ field.max }} 字</small>
      </label>
    </template>
  </div>
</template>
<style scoped>
.question-stem,
.followup {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.85;
}
.question-stem {
  font-size: 17px;
  color: #183b46;
  margin: 0 0 18px;
}
.attribution,
.hint,
.answer-field > span,
small {
  font-size: 13px;
  color: #5d727a;
  line-height: 1.75;
}
.attribution {
  border-left: 2px solid #d8e6ea;
  padding-left: 12px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 20px 0;
}
legend {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 12px;
}
.option {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 14px;
  border: 1px solid #d8e6ea;
  border-radius: 9px;
  margin: 8px 0;
  cursor: pointer;
  line-height: 1.7;
}
.option:has(input:checked) {
  background: #eaf5f7;
  border-color: #137f91;
}
input {
  accent-color: #137f91;
}
.answer-field {
  display: grid;
  gap: 8px;
  margin-top: 22px;
}
textarea {
  width: 100%;
  resize: vertical;
  padding: 12px;
  border: 1px solid #d8e6ea;
  border-radius: 9px;
  background: white;
  font: inherit;
  line-height: 1.8;
  color: #183b46;
}
.code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
}
textarea:disabled {
  background: #f4f8f9;
}
:is(input, textarea):focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
</style>
