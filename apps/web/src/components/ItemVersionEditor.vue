<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { DIMENSIONS, SCENARIO_NAMES } from '../domain/capabilities'
import ItemPresentationEditor from './ItemPresentationEditor.vue'
import type { AuthoringAdapter } from '../services/authoringApi'
import {
  createItem,
  listContent,
  type ContentIdentity,
  type ContentRecord,
  type CreateItemRequest,
  type ItemMetadata,
} from '../services/contentApi'

const props = defineProps<{ source?: ContentRecord | null; authoring?: AuthoringAdapter }>()
const emit = defineEmits<{
  saved: [value: ContentIdentity]
  cancel: []
  busy: [value: boolean]
  dirty: [value: boolean]
}>()
const id = useId()
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
const form = reactive({
  stem: '',
  dimension: 'foundations',
  type: 'objective' as CreateItemRequest['item_type'],
  difficulty: 0,
  tier: 'basic' as ItemMetadata['content_tier'],
  tags: '',
  scenarios: ['general'] as ItemMetadata['scenarios'],
  options: '',
  correct: '',
  rubric: '',
  turns: 3,
  practicalType: 'text',
  interactions: 5,
  config: '{}',
})
const error = ref(''),
  saving = ref(false)
const rubrics = ref<ContentRecord[]>([]),
  rubricError = ref(''),
  rubricLoading = ref(false),
  rubricTotal = ref(0),
  rubricOffset = ref(0)
let rubricGeneration = 0
let saveGeneration = 0
let savedPayload = ''
let retryKey = ''
let baseline = ''
watch(form, () => emit('dirty', JSON.stringify(form) !== baseline), { flush: 'post' })
const options = computed(() =>
  form.options
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean),
)
watch(
  () => props.source,
  (source) => {
    saveGeneration += 1
    rubricGeneration += 1
    saving.value = false
    emit('busy', false)
    rubrics.value = []
    rubricError.value = ''
    rubricLoading.value = false
    savedPayload = ''
    retryKey = ''
    const config = record(source?.configuration),
      metadata = record(config.metadata)
    form.stem = source?.stem ?? ''
    form.dimension = source?.dimension_code ?? 'foundations'
    form.type = ['objective', 'dialogue', 'practical'].includes(source?.item_type ?? '')
      ? (source!.item_type as CreateItemRequest['item_type'])
      : 'objective'
    form.difficulty = source?.difficulty ?? 0
    form.tier = metadata.content_tier === 'advanced' ? 'advanced' : 'basic'
    form.tags = Array.isArray(metadata.tags)
      ? metadata.tags.filter((value) => typeof value === 'string').join(', ')
      : ''
    form.scenarios = Array.isArray(metadata.scenarios)
      ? metadata.scenarios.filter((value): value is ItemMetadata['scenarios'][number] =>
          ['general', 'higher_education', 'enterprise'].includes(String(value)),
        )
      : ['general']
    form.options = Array.isArray(config.options) ? config.options.join('\n') : ''
    form.correct =
      typeof source?.answer_key?.correct_option === 'string' ? source.answer_key.correct_option : ''
    form.rubric = source?.rubric_version_id ?? ''
    form.turns = typeof config.dialogue_max_turns === 'number' ? config.dialogue_max_turns : 3
    form.practicalType =
      typeof config.practical_task_type === 'string' ? config.practical_task_type : 'text'
    form.interactions =
      typeof config.practical_max_ai_interactions === 'number'
        ? config.practical_max_ai_interactions
        : 5
    form.config = JSON.stringify(config, null, 2)
    error.value = ''
    baseline = JSON.stringify(form)
    emit('dirty', false)
  },
  { immediate: true },
)
async function loadRubrics(append = false) {
  const ticket = ++rubricGeneration
  rubricLoading.value = true
  rubricError.value = ''
  if (!append) {
    rubrics.value = []
    rubricOffset.value = 0
  }
  try {
    const offset = append ? rubricOffset.value + 20 : 0
    const page = props.authoring
      ? await props.authoring.rubrics(offset)
      : await listContent('rubrics', 'published', offset)
    if (ticket === rubricGeneration) {
      rubrics.value = append ? [...rubrics.value, ...page.items] : page.items
      rubricTotal.value = page.total
      rubricOffset.value = page.offset
    }
  } catch (caught) {
    if (ticket === rubricGeneration)
      rubricError.value =
        caught instanceof Error ? caught.message : '量规列表读取失败，可重试或填写已核实的版本 ID。'
  } finally {
    if (ticket === rubricGeneration) rubricLoading.value = false
  }
}
watch(
  () => [form.type, props.source?.id] as const,
  ([type]) => {
    if (type !== 'objective' && !rubrics.value.length && !rubricLoading.value) void loadRubrics()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  rubricGeneration += 1
  saveGeneration += 1
})
function payload(): CreateItemRequest {
  if (props.authoring && !props.source) throw new Error('请先选择管理员指派的来源版本。')
  if (!form.stem.trim() || !DIMENSIONS.some((dimension) => dimension.code === form.dimension))
    throw new Error('请填写题干并选择有效的能力维度。')
  if (
    typeof form.difficulty !== 'number' ||
    !Number.isFinite(form.difficulty) ||
    form.difficulty < -4 ||
    form.difficulty > 4
  )
    throw new Error('难度须为 −4 到 4 之间的数值。')
  const tags = [
    ...new Set(
      form.tags
        .split(/[,，\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  if (tags.length > 12 || tags.some((value) => value.length > 40))
    throw new Error('标签最多 12 个，每个不超过 40 字。')
  if (!form.scenarios.length) throw new Error('请至少选择一个适用场景。')
  let extra: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(form.config)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    extra = parsed as Record<string, unknown>
  } catch {
    throw new Error('扩展配置须为有效的 JSON 对象。')
  }
  const configuration = {
    ...extra,
    metadata: {
      ...record(extra.metadata),
      tags,
      scenarios: [...form.scenarios],
      content_tier: form.tier,
    },
  }
  let answerKey: Record<string, unknown> | null = null
  if (form.type === 'objective') {
    if (options.value.length < 2 || new Set(options.value).size !== options.value.length)
      throw new Error('客观题至少需要两个非空且不重复的选项。')
    if (!options.value.includes(form.correct)) throw new Error('请选择选项列表中的正确答案。')
    Object.assign(configuration, { options: options.value })
    answerKey = { ...record(props.source?.answer_key), correct_option: form.correct }
  } else {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form.rubric.trim()))
      throw new Error('请绑定一个已发布评分量规的完整版本 ID。')
    if (form.type === 'dialogue') {
      if (!Number.isInteger(form.turns) || form.turns < 1 || form.turns > 8)
        throw new Error('对话轮数须为 1–8 的整数。')
      Object.assign(configuration, { dialogue_max_turns: form.turns })
    } else {
      if (
        !['text', 'code', 'image'].includes(form.practicalType) ||
        !Number.isInteger(form.interactions) ||
        form.interactions < 1 ||
        form.interactions > 12
      )
        throw new Error('请选择有效的实操类型，AI 交互次数须为 1–12 的整数。')
      Object.assign(configuration, {
        practical_task_type: form.practicalType,
        practical_max_ai_interactions: form.interactions,
      })
    }
  }
  return {
    ...(props.source ? { logical_id: props.source.logical_id } : {}),
    dimension_code: form.dimension,
    item_type: form.type,
    difficulty: form.difficulty,
    stem: form.stem.trim(),
    configuration,
    answer_key: answerKey,
    rubric_version_id: form.type === 'objective' ? null : form.rubric.trim(),
  }
}
async function save() {
  if (saving.value) return
  const ticket = ++saveGeneration
  error.value = ''
  try {
    const body = payload()
    saving.value = true
    emit('busy', true)
    const serialized = JSON.stringify(body)
    if (serialized !== savedPayload || !retryKey) {
      savedPayload = serialized
      retryKey = `item-version-${crypto.randomUUID()}`
    }
    const result = props.authoring
      ? await props.authoring.save(body, retryKey)
      : await createItem(body)
    if (ticket === saveGeneration) {
      baseline = JSON.stringify(form)
      emit('dirty', false)
      emit('saved', result)
    }
  } catch (caught) {
    if (ticket === saveGeneration)
      error.value =
        caught instanceof Error ? caught.message : '保存失败，已保留表单内容，请核对后重试。'
  } finally {
    if (ticket === saveGeneration) {
      saving.value = false
      emit('busy', false)
    }
  }
}
</script>

<template>
  <section class="item-editor" aria-labelledby="editor-title">
    <header>
      <div>
        <p class="eyebrow">{{ authoring ? '指派题目 · 版本化编辑' : '系统管理员 · 版本化编辑' }}</p>
        <h2 id="editor-title">
          {{ source ? `基于 v${source.version} 创建新版本` : '新建题目草稿' }}
        </h2>
      </div>
      <button type="button" :disabled="saving" @click="emit('cancel')">取消编辑</button>
    </header>
    <p class="editor-note">
      保存会创建独立草稿，不会自动审核或发布，也不会改写现有题目、测评和报告。{{
        source ? `来源版本：${source.id}` : '请填写题目与标注信息，再单独提交审核。'
      }}
    </p>
    <form novalidate @submit.prevent="save">
      <fieldset :disabled="saving">
        <legend>题目与标注</legend>
        <label
          >题干<textarea v-model="form.stem" data-testid="item-stem" rows="4" required />
        </label>
        <div class="field-grid">
          <label
            >能力维度<select v-model="form.dimension">
              <option v-for="dimension in DIMENSIONS" :key="dimension.code" :value="dimension.code">
                {{ dimension.name }}
              </option>
            </select></label
          ><label
            >题型<select v-model="form.type" data-testid="item-type">
              <option value="objective">客观题</option>
              <option value="dialogue">对话题</option>
              <option value="practical">实操题</option>
            </select></label
          ><label
            >测量难度（−4～4）<input
              v-model.number="form.difficulty"
              type="number"
              min="-4"
              max="4"
              step="0.1"
              required /></label
          ><label
            >内容层级<select v-model="form.tier">
              <option value="basic">基础</option>
              <option value="advanced">进阶</option>
            </select></label
          >
        </div>
        <p class="field-note">基础 / 进阶为题目内容分类，与数值难度分别记录，不自动互相推断。</p>
        <label
          >标签（逗号分隔，最多 12 个）<input
            v-model="form.tags"
            data-testid="item-tags"
            placeholder="例如：来源核验, 提示约束"
        /></label>
        <div class="scenario-field">
          <span>适用场景（至少一项）</span>
          <div>
            <label v-for="(name, value) in SCENARIO_NAMES" :key="value"
              ><input v-model="form.scenarios" type="checkbox" :value="value" />{{ name }}</label
            >
          </div>
        </div>
      </fieldset>
      <fieldset v-if="form.type === 'objective'" :disabled="saving">
        <legend>客观题答案</legend>
        <label
          >选项（每行一项，至少两项）<textarea
            v-model="form.options"
            data-testid="item-options"
            rows="4"
            placeholder="输入各个选项，每行一项"
          /></label
        ><label
          >正确答案<select v-model="form.correct" data-testid="item-answer">
            <option disabled value="">请选择正确选项</option>
            <option v-for="option in options" :key="option" :value="option">{{ option }}</option>
          </select></label
        >
      </fieldset>
      <fieldset v-else :disabled="saving">
        <legend>评分量规与交互配置</legend>
        <label
          >已发布量规版本<input
            v-model="form.rubric"
            data-testid="item-rubric"
            :list="`${id}-rubrics`"
            placeholder="选择或填写精确版本 UUID"
          /><datalist :id="`${id}-rubrics`">
            <option v-for="rubric in rubrics" :key="rubric.id" :value="rubric.id">
              {{ rubric.title }} · v{{ rubric.version }}
            </option>
          </datalist></label
        >
        <p class="field-note">
          {{
            authoring
              ? '仅可绑定此指派题目已关联的已发布量规版本，不能读取其他题目的量规。'
              : '仅可绑定已发布的精确量规版本，发布时服务端会再次验证。输入框可检索已读取量规。'
          }}
        </p>
        <p v-if="rubricError" class="rubric-error" role="status">
          {{ rubricError }} <button type="button" @click="loadRubrics()">重新读取量规</button>
        </p>
        <p v-if="rubricLoading" role="status">正在读取已发布量规…</p>
        <button
          v-if="rubrics.length < rubricTotal && rubricOffset < 10000"
          type="button"
          :disabled="rubricLoading"
          @click="loadRubrics(true)"
        >
          读取更多量规（{{ rubrics.length }} / {{ rubricTotal }}）</button
        ><label v-if="form.type === 'dialogue'"
          >最多对话轮数<input v-model.number="form.turns" type="number" min="1" max="8"
        /></label>
        <div v-else class="field-grid">
          <label
            >实操类型<select v-model="form.practicalType" data-testid="practical-type">
              <option value="text">文本任务</option>
              <option value="code">代码任务</option>
              <option value="image">图像任务</option>
            </select></label
          ><label
            >最多 AI 交互次数<input
              v-model.number="form.interactions"
              type="number"
              min="1"
              max="12"
          /></label>
        </div>
      </fieldset>
      <ItemPresentationEditor
        v-model="form.config"
        :dialogue="form.type === 'dialogue'"
        :disabled="saving"
      />
      <details>
        <summary>扩展配置（JSON / 图片题素材等）</summary>
        <p class="field-note">
          已带入原配置，未修改字段会保留，删除字段后保存即可移除；维度标注、选项和交互限制以表单为准。题干图片使用
          media.images，每张图须提供 /assessment-media/ 内的 src 和非空 alt，不接受外部链接。
        </p>
        <label
          >扩展配置 JSON<textarea
            v-model="form.config"
            data-testid="item-config"
            class="json-input"
            rows="8"
            spellcheck="false"
            :disabled="saving"
          />
        </label>
      </details>
      <p v-if="error" class="editor-error" role="alert">{{ error }}</p>
      <footer>
        <span>下一步：在题目详情中单独提交审核</span
        ><button class="save-button" type="submit" :disabled="saving">
          {{ saving ? '正在保存草稿…' : '保存为新草稿' }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.item-editor {
  padding: 26px;
  border: 1px solid #bedce5;
  border-radius: 14px;
  margin: 20px 0;
  background: #f8fcfd;
  color: #183b46;
}
.item-editor header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.eyebrow {
  font-size: 12px;
  color: #137f91;
  font-weight: 700;
  margin-bottom: 7px;
}
.item-editor h2 {
  font-size: 22px;
}
.editor-note {
  font-size: 13px;
  line-height: 1.75;
  color: #5d727a;
  margin: 13px 0 20px;
  overflow-wrap: anywhere;
}
fieldset {
  border: 0;
  border-top: 1px solid #d6e8ed;
  padding: 20px 0 0;
  margin: 20px 0;
  min-width: 0;
}
legend {
  font-size: 15px;
  font-weight: 700;
  padding-right: 12px;
}
.item-editor label {
  display: grid;
  gap: 8px;
  font-size: 13px;
  margin-bottom: 15px;
}
.field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 18px;
}
.item-editor input:not([type='checkbox']),
.item-editor select,
.item-editor textarea {
  width: 100%;
  min-width: 0;
  border: 1px solid #bfd8e0;
  border-radius: 7px;
  padding: 10px 12px;
  background: white;
  color: #183b46;
  font: inherit;
}
.item-editor textarea {
  resize: vertical;
  line-height: 1.6;
}
.field-note {
  font-size: 12px;
  line-height: 1.7;
  color: #5d727a;
  margin: -3px 0 14px;
}
.scenario-field > span {
  font-size: 13px;
}
.scenario-field > div {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 10px;
}
.scenario-field label {
  display: flex;
  align-items: center;
  gap: 7px;
}
.scenario-field input {
  accent-color: #137f91;
}
details {
  padding: 15px;
  border: 1px solid #d6e8ed;
  border-radius: 8px;
  background: #f0f8fa;
}
summary {
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
details .field-note {
  margin: 13px 0;
}
.item-editor .json-input {
  font:
    12px/1.7 'Cascadia Mono',
    monospace;
}
button {
  padding: 9px 14px;
  border: 1px solid #bedbe3;
  border-radius: 8px;
  background: white;
  color: #176a7a;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.save-button {
  background: #137f91;
  color: white;
  border-color: #137f91;
  padding: 11px 19px;
}
footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 20px;
}
footer span {
  font-size: 12px;
  color: #5d727a;
}
.editor-error,
.rubric-error {
  padding: 12px;
  color: #934636;
  background: #fff2ee;
  border-radius: 7px;
  font-size: 13px;
  line-height: 1.7;
  margin-top: 14px;
}
:is(input, select, textarea, button, summary):focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .item-editor {
    padding: 17px;
  }
  .item-editor header {
    flex-direction: column;
  }
  .field-grid {
    grid-template-columns: 1fr;
  }
  footer {
    align-items: flex-start;
    flex-direction: column;
  }
  footer button {
    width: 100%;
  }
}
</style>
