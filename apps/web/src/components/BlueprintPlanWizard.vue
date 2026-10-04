<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { DIMENSIONS, MODE_NAMES, SCENARIO_NAMES } from '../domain/capabilities'
import {
  planOptions,
  previewPlan,
  publishPlan,
  type PlanRequest,
  type PlanPreview,
  type PoolItem,
  type TargetOrganization,
} from '../services/blueprintAuthoringApi'
import type { ContentIdentity } from '../services/contentApi'
import { useAccessStore } from '../stores/access'

const access = useAccessStore()
const emit = defineEmits<{ saved: [value: ContentIdentity]; cancel: []; busy: [value: boolean] }>()
const step = ref(0),
  busy = ref(false),
  loading = ref(false),
  error = ref('')
const steps = computed(() => [
  '基本信息',
  '选题与规则',
  access.singlePlatform ? '平台开放' : '开放组织',
  '校验并发布',
])
const typeNames: Record<string, string> = {
  objective: '客观题',
  dialogue: '对话题',
  practical: '实操题',
}
const form = reactive({
  name: '',
  mode: 'rapid' as PlanRequest['mode'],
  scenario: 'general' as PlanRequest['scenario'],
  data_origin: 'formal' as PlanRequest['data_origin'],
  min_items: 6,
  max_items: 12,
  timed: false,
  minutes: 30,
  dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d.code, 1])),
  item_type_minimums: { objective: 6, dialogue: 0, practical: 0 } as Record<string, number>,
})
const selectedItems = ref<Record<string, PoolItem>>({})
const selectedOrganizations = ref<Record<string, TargetOrganization>>({})
const items = ref<PoolItem[]>([]),
  organizations = ref<TargetOrganization[]>([])
const q = ref(''),
  offset = ref(0),
  total = ref<number | null>(null),
  optionError = ref('')
const filterTypes = ref<string[]>([]),
  filterDimensions = ref<string[]>([])
const filtersActive = computed(() =>
  Boolean(q.value || filterTypes.value.length || filterDimensions.value.length),
)
const preview = ref<PlanPreview | null>(null),
  acknowledged = ref(false)
const published = ref(false)
let requestKey = crypto.randomUUID(),
  generation = 0
const itemCount = computed(() => Object.keys(selectedItems.value).length)
const usableCount = computed(
  () =>
    Object.values(selectedItems.value).filter(
      (item) =>
        (form.dimensions[item.dimension_code] ?? 0) > 0 &&
        (form.item_type_minimums[item.item_type] ?? 0) > 0,
    ).length,
)
const organizationCount = computed(() => Object.keys(selectedOrganizations.value).length)
const body = computed<PlanRequest>(() => ({
  name: form.name.trim(),
  mode: form.mode,
  scenario: form.scenario,
  data_origin: form.data_origin,
  min_items: form.mode === 'fixed' ? itemCount.value : form.min_items,
  max_items: form.mode === 'fixed' ? itemCount.value : form.max_items,
  dimensions: { ...form.dimensions },
  item_type_minimums: { ...form.item_type_minimums },
  item_ids: Object.keys(selectedItems.value).sort(),
  organization_ids: Object.keys(selectedOrganizations.value).sort(),
  assessment_time_limit_seconds: form.timed ? form.minutes * 60 : null,
}))
watch(
  body,
  () => {
    preview.value = null
    acknowledged.value = false
    requestKey = crypto.randomUUID()
  },
  { deep: true },
)
watch(busy, (value) => emit('busy', value), { flush: 'sync' })
watch(
  () => [form.scenario, form.data_origin],
  () => {
    selectedItems.value = {}
    selectedOrganizations.value = {}
  },
)
watch(
  () => form.mode,
  (mode) => {
    form.dimensions = Object.fromEntries(
      DIMENSIONS.map((d) => [
        d.code,
        mode === 'specialized' ? Number(d.code === 'foundations') : 1,
      ]),
    )
    form.item_type_minimums =
      mode === 'standard' || mode === 'fixed'
        ? { objective: 6, dialogue: 2, practical: 1 }
        : { objective: mode === 'specialized' ? 1 : 6, dialogue: 0, practical: 0 }
    form.min_items = mode === 'specialized' ? 1 : mode === 'rapid' ? 6 : 9
    form.max_items = mode === 'specialized' ? 6 : mode === 'rapid' ? 12 : 18
  },
)
const hasWork = computed(() => Boolean(form.name || itemCount.value || organizationCount.value))
function mayLeave() {
  return (
    published.value ||
    (!busy.value &&
      (!hasWork.value || window.confirm('方案尚未发布，离开会丢失本次填写。确定离开吗？')))
  )
}
function cancel() {
  if (mayLeave()) emit('cancel')
}
onBeforeRouteLeave(() => mayLeave())
function beforeUnload(event: BeforeUnloadEvent) {
  if (hasWork.value && !published.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => {
  generation++
  window.removeEventListener('beforeunload', beforeUnload)
})
async function loadOptions(reset = false) {
  if (reset) offset.value = 0
  const ticket = ++generation
  const currentStep = step.value
  optionError.value = ''
  total.value = null
  loading.value = true
  items.value = []
  organizations.value = []
  try {
    const query = { q: q.value, offset: String(offset.value), limit: '30' }
    if (currentStep === 1) {
      const result = await planOptions<PoolItem>('items', {
        ...query,
        scenario: form.scenario,
        data_origin: form.data_origin,
        item_types: [...filterTypes.value],
        dimensions: [...filterDimensions.value],
      })
      if (ticket === generation) {
        items.value = result.items
        total.value = result.total
      }
    } else if (currentStep === 2) {
      const result = await planOptions<TargetOrganization>('organizations', query)
      if (ticket === generation) {
        organizations.value = result.items
        total.value = result.total
      }
    }
  } catch (caught) {
    if (ticket === generation)
      optionError.value = caught instanceof Error ? caught.message : '读取失败'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
watch(step, () => {
  q.value = ''
  offset.value = 0
  error.value = ''
  void loadOptions()
})
watch(
  [filterTypes, filterDimensions],
  () => {
    if (step.value === 1) void loadOptions(true)
  },
  { deep: true },
)
function resetFilters() {
  q.value = ''
  filterTypes.value = []
  filterDimensions.value = []
  // The watcher handles one request for changed filters; assigning fresh arrays
  // also triggers it when already empty, so no second request is needed.
}
function closeFilter(event: KeyboardEvent) {
  const details = event.currentTarget as HTMLDetailsElement
  details.open = false
  details.querySelector('summary')?.focus()
}
function selectPage() {
  for (const item of items.value) {
    if (itemCount.value < 1000) selectedItems.value[item.id] = item
  }
}
function deselectPage() {
  for (const item of items.value) delete selectedItems.value[item.id]
}
function toggleItem(item: PoolItem) {
  if (selectedItems.value[item.id]) delete selectedItems.value[item.id]
  else if (itemCount.value < 1000) selectedItems.value[item.id] = item
}
function toggleOrganization(org: TargetOrganization) {
  if (selectedOrganizations.value[org.id]) delete selectedOrganizations.value[org.id]
  else if (organizationCount.value < 100) selectedOrganizations.value[org.id] = org
}
function incompatible(org: TargetOrganization) {
  return form.data_origin === 'formal' ? org.experience_only : !org.accepts_experience
}
function next() {
  error.value = ''
  if (step.value === 1 && !itemCount.value) {
    error.value = '请先选择至少一道已发布题目。'
    return
  }
  if (step.value === 2 && !organizationCount.value) {
    error.value = '请选择至少一个开放组织。'
    return
  }
  step.value = Math.min(3, step.value + 1)
}
async function validate() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  preview.value = null
  acknowledged.value = false
  try {
    preview.value = await previewPlan(body.value)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '校验失败'
  } finally {
    busy.value = false
  }
}
async function publish() {
  if (busy.value || !preview.value?.valid || !acknowledged.value) return
  busy.value = true
  error.value = ''
  try {
    const identity = await publishPlan(body.value, requestKey)
    published.value = true
    emit('saved', identity)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '发布未确认，请重试'
  } finally {
    busy.value = false
  }
}
function page(delta: number) {
  offset.value += delta * 30
  void loadOptions()
}
</script>

<template>
  <section class="plan-wizard" aria-labelledby="plan-heading">
    <header class="plan-heading">
      <div>
        <p class="eyebrow">让题库真正进入学员测评</p>
        <h2 id="plan-heading">新建测评方案</h2>
        <p>
          {{
            access.singlePlatform
              ? '选定题目版本、配置出题规则，再向 AI Measure 平台学员开放。'
              : '选定题目版本、配置出题规则，再向指定组织发布。'
          }}不会修改已有测评和成绩。
        </p>
      </div>
      <button type="button" class="secondary-button" :disabled="busy" @click="cancel">
        取消创建
      </button>
    </header>
    <ol class="plan-steps" aria-label="创建进度">
      <li
        v-for="(title, index) in steps"
        :key="title"
        :class="{ current: step === index, done: step > index }"
        :aria-current="step === index ? 'step' : undefined"
      >
        <span>{{ index + 1 }}</span
        >{{ title }}
      </li>
    </ol>
    <form @submit.prevent="next">
      <fieldset :disabled="busy">
        <legend class="sr-only">{{ steps[step] }}</legend>
        <section v-if="step === 0" class="plan-fields">
          <label class="full"
            >测评方案名称<input
              v-model="form.name"
              required
              maxlength="160"
              placeholder="例如：2026 秋季 · 高校 AI 能力标准测"
          /></label>
          <label
            >测评方式<select v-model="form.mode">
              <option v-for="(name, key) in MODE_NAMES" :key="key" :value="key">{{ name }}</option>
            </select></label
          >
          <label
            >适用场景<select v-model="form.scenario">
              <option v-for="(name, key) in SCENARIO_NAMES" :key="key" :value="key">
                {{ name }}
              </option>
            </select></label
          >
          <label class="full"
            >题目来源<select v-model="form.data_origin">
              <option value="formal">正式题库 · 已发布题目</option>
              <option value="synthetic">本地体验 · 合成题目（非正式题库）</option></select
            ><small
              >来源或场景变更后会清空已选题目与组织。隔离审题包、草稿及待审核题不会出现在选题列表。</small
            ></label
          >
          <div class="plan-callout full">
            自适应测评仅从你选定的题池派题；验证固定卷使用全部所选题目。标准测与验证固定卷必须覆盖六维及三类题型。
          </div>
          <label class="check-line"
            ><input v-model="form.timed" type="checkbox" />启用测评限时</label
          >
          <label v-if="form.timed"
            >时限（分钟）<input
              v-model.number="form.minutes"
              type="number"
              min="1"
              max="1440"
              step="1"
              required
            /><small>开始后连续计时，退出不暂停；旧会话不受影响。</small></label
          >
        </section>

        <section v-else-if="step === 1">
          <div class="plan-callout">
            {{ MODE_NAMES[form.mode] }} · {{ SCENARIO_NAMES[form.scenario] }} ·
            {{ form.data_origin === 'synthetic' ? '本地体验' : '正式题库' }}。题型最低数为 0
            的题型不会派发；专项测只启用一个维度。
          </div>
          <div class="plan-rules">
            <label
              >最少题数<input
                :value="body.min_items"
                type="number"
                min="1"
                max="100"
                step="1"
                required
                :readonly="form.mode === 'fixed'"
                @input="form.min_items = Number(($event.target as HTMLInputElement).value)"
            /></label>
            <label
              >最多题数<input
                :value="body.max_items"
                type="number"
                min="1"
                max="100"
                step="1"
                required
                :readonly="form.mode === 'fixed'"
                @input="form.max_items = Number(($event.target as HTMLInputElement).value)"
            /></label>
            <label v-for="(name, key) in typeNames" :key="key"
              >{{ name }}最低数<input
                v-model.number="form.item_type_minimums[key]"
                type="number"
                min="0"
                max="100"
                step="1"
                required
            /></label>
          </div>
          <div class="plan-dimensions">
            <label v-for="dimension in DIMENSIONS" :key="dimension.code"
              >{{ dimension.name }}最低数<input
                v-model.number="form.dimensions[dimension.code]"
                type="number"
                min="0"
                max="100"
                step="1"
                required
            /></label>
          </div>
          <div class="picker-heading">
            <h3>
              已发布题目 <span>已选 {{ itemCount }} 道 · 最多可选 1000 道</span>
            </h3>
            <button type="button" class="text-button" @click="selectedItems = {}">清空选择</button>
          </div>
          <p class="muted">
            1000
            是本方案的选题上限，不是题库总数。下方显示当前条件的匹配数量；筛选和翻页不会清空已选题目。
          </p>
          <p v-if="itemCount" class="muted">
            当前选择中，{{ usableCount }} 道题符合已启用的维度和题型。
            <button
              v-if="form.mode !== 'fixed'"
              type="button"
              class="text-button"
              :disabled="usableCount === 0"
              @click="form.max_items = Math.min(100, usableCount)"
            >
              按可用题量设置上限
            </button>
          </p>
          <div v-if="itemCount" class="chosen-list" aria-label="已选题目">
            <button
              v-for="item in selectedItems"
              :key="item.id"
              type="button"
              :title="item.stem"
              @click="toggleItem(item)"
            >
              {{ item.stem.slice(0, 22) }} · {{ item.id.slice(0, 6) }} ×
            </button>
          </div>
          <div class="picker-search">
            <label
              >题干关键词<input
                v-model="q"
                placeholder="搜索已发布题目"
                @keydown.enter.prevent="loadOptions(true)" /></label
            ><button
              type="button"
              class="secondary-button"
              :disabled="loading"
              @click="loadOptions(true)"
            >
              搜索
            </button>
          </div>
          <div class="picker-filters" aria-label="题目筛选">
            <details class="filter-dropdown" @keydown.esc.prevent="closeFilter">
              <summary>
                题型
                <span>{{ filterTypes.length ? `已选 ${filterTypes.length} 类` : '全部题型' }}</span>
              </summary>
              <div class="filter-options" role="group" aria-label="题型（可多选）">
                <label v-for="(name, key) in typeNames" :key="key">
                  <input v-model="filterTypes" type="checkbox" :value="key" />{{ name }}
                </label>
                <button type="button" class="text-button" @click="filterTypes = []">
                  不限题型
                </button>
              </div>
            </details>
            <details class="filter-dropdown" @keydown.esc.prevent="closeFilter">
              <summary>
                能力维度
                <span>{{
                  filterDimensions.length ? `已选 ${filterDimensions.length} 项` : '全部维度'
                }}</span>
              </summary>
              <div class="filter-options" role="group" aria-label="能力维度（可多选）">
                <label v-for="dimension in DIMENSIONS" :key="dimension.code">
                  <input v-model="filterDimensions" type="checkbox" :value="dimension.code" />{{
                    dimension.name
                  }}
                </label>
                <button type="button" class="text-button" @click="filterDimensions = []">
                  不限维度
                </button>
              </div>
            </details>
            <button
              type="button"
              class="text-button"
              :disabled="!filtersActive"
              @click="resetFilters"
            >
              重置筛选
            </button>
          </div>
          <p class="muted">
            下拉选项支持多选：同类条件满足任意一项即可，题型、维度和关键词同时匹配。这里仅筛选题目，不修改上方测评覆盖规则。
          </p>
          <div
            v-if="filterTypes.length || filterDimensions.length"
            class="chosen-list"
            aria-label="当前筛选条件"
          >
            <button
              v-for="key in filterTypes"
              :key="key"
              type="button"
              @click="filterTypes = filterTypes.filter((value) => value !== key)"
            >
              题型：{{ typeNames[key] }} ×
            </button>
            <button
              v-for="key in filterDimensions"
              :key="key"
              type="button"
              @click="filterDimensions = filterDimensions.filter((value) => value !== key)"
            >
              维度：{{ DIMENSIONS.find((d) => d.code === key)?.name }} ×
            </button>
          </div>
          <div class="picker-bulk">
            <span role="status">{{
              loading
                ? '正在读取匹配题目…'
                : optionError
                  ? '读取失败，暂无法确认题目数量'
                  : `当前筛选共 ${total ?? 0} 道 · 本页 ${items.length} 道`
            }}</span>
            <button
              type="button"
              class="text-button"
              :disabled="loading || !items.length || itemCount >= 1000"
              @click="selectPage"
            >
              选中本页
            </button>
            <button
              type="button"
              class="text-button"
              :disabled="loading || !items.some((item) => selectedItems[item.id])"
              @click="deselectPage"
            >
              取消本页选择
            </button>
          </div>
          <div v-if="!loading && !optionError && !items.length" class="plan-empty">
            没有匹配的已发布题目。请调整题型、维度、关键词，或检查来源和场景；如题目仍在待审核区，需要先完成其审核与发布验收。
          </div>
          <div class="picker-list">
            <label v-for="item in items" :key="item.id" class="picker-row"
              ><input
                type="checkbox"
                :checked="Boolean(selectedItems[item.id])"
                :disabled="!selectedItems[item.id] && itemCount >= 1000"
                @change="toggleItem(item)"
              /><span
                ><strong>{{ item.stem }}</strong
                ><small
                  >{{ DIMENSIONS.find((d) => d.code === item.dimension_code)?.name }} ·
                  {{ typeNames[item.item_type] }} · v{{ item.version }} ·
                  {{ item.bank_version || '未标注题库批次' }} · {{ item.id.slice(0, 8) }}</small
                ></span
              ></label
            >
          </div>
        </section>

        <section v-else-if="step === 2">
          <div class="plan-callout">
            {{
              access.singlePlatform
                ? '当前采用统一 AI Measure 平台。确认开放后，平台学员可在「能力测评」选择此方案；不会显示或发布到历史测试组织。'
                : '发布后，所选组织的成员可在「能力测评」选择此方案。这里不添加成员、不更改学员所属组织，也不向所有组织开放。'
            }}
          </div>
          <div class="picker-heading">
            <h3>
              {{ access.singlePlatform ? 'AI Measure 平台开放范围' : '开放组织' }}
              <span
                >已选 {{ organizationCount }}{{ access.singlePlatform ? ' / 1' : ' / 100' }}</span
              >
            </h3>
            <button type="button" class="text-button" @click="selectedOrganizations = {}">
              清空选择
            </button>
          </div>
          <div class="chosen-list">
            <button
              v-for="org in selectedOrganizations"
              :key="org.id"
              type="button"
              @click="toggleOrganization(org)"
            >
              {{ org.name }} · {{ org.id.slice(0, 8) }} ×
            </button>
          </div>
          <div class="picker-search">
            <label
              >名称或组织标识<input
                v-model="q"
                placeholder="例如：体验学员、本地体验空间"
                @keydown.enter.prevent="loadOptions(true)" /></label
            ><button
              type="button"
              class="secondary-button"
              :disabled="loading"
              @click="loadOptions(true)"
            >
              搜索
            </button>
          </div>
          <div v-if="!loading && !optionError && !organizations.length" class="plan-empty">
            未找到组织，请调整搜索条件。
          </div>
          <div class="picker-list">
            <label
              v-for="org in organizations"
              :key="org.id"
              class="picker-row"
              :class="{ unavailable: incompatible(org) }"
              ><input
                type="checkbox"
                :checked="Boolean(selectedOrganizations[org.id])"
                :disabled="
                  incompatible(org) || (!selectedOrganizations[org.id] && organizationCount >= 100)
                "
                @change="toggleOrganization(org)"
              /><span
                ><strong>{{ org.name }}</strong
                ><small
                  >{{ org.member_count }} 位成员 · {{ org.slug }} · {{ org.id.slice(0, 8) }}</small
                ><small v-if="incompatible(org)"
                  >与当前题目来源不兼容；体验题需要明确配置的测评目录。</small
                ><small v-else-if="!org.member_count"
                  >尚无成员，发布后需要先在成员管理中配置学员。</small
                ></span
              ></label
            >
          </div>
        </section>

        <section v-else class="plan-confirm">
          <h3>{{ form.name }}</h3>
          <p>
            {{ MODE_NAMES[form.mode] }} · {{ SCENARIO_NAMES[form.scenario] }} ·
            {{ form.data_origin === 'synthetic' ? '本地体验，非正式题库' : '正式题库' }}
          </p>
          <dl class="plan-totals">
            <div>
              <dt>题池版本</dt>
              <dd>{{ itemCount }} 道</dd>
            </div>
            <div>
              <dt>每次题量</dt>
              <dd>{{ body.min_items }}–{{ body.max_items }} 题</dd>
            </div>
            <div>
              <dt>开放范围</dt>
              <dd>
                {{ access.singlePlatform ? 'AI Measure 平台' : `${organizationCount} 个组织` }}
              </dd>
            </div>
            <div>
              <dt>测评时限</dt>
              <dd>{{ form.timed ? `${form.minutes} 分钟` : '不限时' }}</dd>
            </div>
          </dl>
          <ul class="target-summary">
            <li v-for="org in selectedOrganizations" :key="org.id">
              {{ org.name }} · {{ org.slug }} · {{ org.member_count }} 位成员
            </li>
          </ul>
          <button type="button" class="secondary-button" @click="validate">
            {{ busy ? '正在处理…' : '检查题池与发布条件' }}
          </button>
          <div
            v-if="preview"
            class="plan-validation"
            :class="{ valid: preview.valid }"
            role="status"
          >
            <strong>{{ preview.valid ? '当前发布条件检查通过' : '尚不能发布，请返回调整' }}</strong>
            <ul v-if="preview.issues.length">
              <li v-for="issue in preview.issues" :key="issue">{{ issue }}</li>
            </ul>
            <div class="coverage-grid">
              <span v-for="dimension in DIMENSIONS" :key="dimension.code"
                >{{ dimension.name }}：{{ preview.dimensions[dimension.code] || 0 }} 题</span
              >
            </div>
            <p>
              这是所选题池数量，不等于每位学员实际作答数量。确认时会重新检查版本状态与组织目录；后续题目退役或服务不可用仍可能影响开测。
            </p>
          </div>
          <label v-if="preview?.valid" class="check-line"
            ><input
              v-model="acknowledged"
              type="checkbox"
            />我已核对题目与规则，同意创建并发布到以上范围。</label
          >
          <p class="muted">
            此操作创建独立的新版本，不替换其他方案，不重算历史成绩。正式题库沿用现有 CAT 曝光限制。
          </p>
        </section>

        <div v-if="step === 1 || step === 2" class="picker-footer">
          <span v-if="loading" role="status">正在读取…</span
          ><span v-else-if="optionError">读取失败 · 数量未确认</span
          ><span v-else>共 {{ total }} 条 · 第 {{ Math.floor(offset / 30) + 1 }} 页</span
          ><button
            type="button"
            class="secondary-button"
            :disabled="loading || Boolean(optionError) || offset === 0"
            @click="page(-1)"
          >
            上一页</button
          ><button
            type="button"
            class="secondary-button"
            :disabled="loading || Boolean(optionError) || offset + 30 >= (total ?? 0)"
            @click="page(1)"
          >
            下一页
          </button>
        </div>
        <div v-if="optionError && (step === 1 || step === 2)" role="alert" class="plan-error">
          {{ optionError }}
          <button type="button" class="text-button" @click="loadOptions()">重新读取</button>
        </div>
        <p v-if="error" role="alert" class="plan-error">{{ error }}</p>
        <footer class="plan-actions">
          <button v-if="step > 0" type="button" class="secondary-button" @click="step--">
            返回上一步</button
          ><span>步骤 {{ step + 1 }} / 4</span
          ><button v-if="step < 3" class="primary-button" type="submit">下一步</button
          ><button
            v-else
            type="button"
            class="primary-button"
            :disabled="!preview?.valid || !acknowledged"
            @click="publish"
          >
            {{ busy ? '正在发布…' : '确认创建并发布' }}
          </button>
        </footer>
      </fieldset>
    </form>
  </section>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.plan-wizard {
  padding: 28px;
  background: #fff;
  border: 1px solid #c9e4ea;
  border-radius: 16px;
  color: #183b46;
}
.plan-heading,
.picker-heading,
.picker-search,
.picker-footer,
.plan-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
.plan-heading {
  align-items: start;
  justify-content: space-between;
}
.plan-heading h2 {
  margin: 6px 0 10px;
  font-size: 25px;
}
.plan-heading p {
  color: #5d727a;
  margin: 0;
  line-height: 1.7;
}
.plan-heading .eyebrow {
  color: #137f91;
  font-size: 13px;
}
.plan-heading button {
  flex-shrink: 0;
}
.plan-steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  list-style: none;
  padding: 0;
  margin: 28px 0;
}
.plan-steps li {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #5d727a;
  border-bottom: 2px solid #e5eef0;
  padding-bottom: 14px;
}
.plan-steps span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #f0f6f8;
  flex-shrink: 0;
}
.plan-steps .current {
  color: #137f91;
  border-color: #137f91;
  font-weight: 700;
}
.plan-steps .current span {
  color: white;
  background: #137f91;
}
.plan-steps .done span {
  background: #d8eef1;
}
fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
label {
  display: grid;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
}
input:not([type='checkbox']),
select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid #b8d4db;
  border-radius: 8px;
  background: #fff;
  color: #183b46;
  font: inherit;
}
input:focus-visible,
select:focus-visible,
button:focus-visible {
  outline: 3px solid #219bac;
  outline-offset: 3px;
}
summary:focus-visible {
  outline: 3px solid #219bac;
  outline-offset: 3px;
}
.picker-filters {
  display: flex;
  align-items: start;
  flex-wrap: wrap;
  gap: 12px;
}
.filter-dropdown {
  flex: 1;
  min-width: 200px;
  border: 1px solid #b8d4db;
  border-radius: 8px;
  background: #fff;
}
.filter-dropdown summary {
  cursor: pointer;
  padding: 12px 16px;
  font-size: 14px;
  min-height: 44px;
  box-sizing: border-box;
}
.filter-dropdown summary span {
  margin-left: 12px;
  color: #5d727a;
}
.filter-options {
  padding: 8px 12px;
  border-top: 1px solid #e2ecef;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 4px;
}
.filter-options label {
  display: flex;
  align-items: center;
  min-height: 44px;
  cursor: pointer;
}
.picker-bulk {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin: 12px 0;
  font-size: 13px;
}
.picker-bulk span {
  margin-right: auto;
}
input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: #137f91;
  flex-shrink: 0;
}
small,
.muted {
  color: #5d727a;
  font-weight: 400;
  line-height: 1.7;
  font-size: 13px;
}
.plan-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
}
.full {
  grid-column: 1 / -1;
}
.plan-callout {
  padding: 16px 18px;
  background: #edf7f9;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.8;
}
.check-line {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 18px 0;
  line-height: 1.7;
}
.plan-rules {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}
.plan-dimensions {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  margin: 18px 0 28px;
}
.picker-heading {
  justify-content: space-between;
}
.picker-heading h3 {
  font-size: 18px;
}
.picker-heading h3 span {
  color: #5d727a;
  font-size: 13px;
  font-weight: 400;
  margin-left: 12px;
}
.picker-search {
  margin: 16px 0;
  align-items: end;
  flex-wrap: wrap;
}
.picker-search label {
  flex: 1;
  min-width: 180px;
}
.picker-list {
  max-height: 480px;
  overflow: auto;
  border-top: 1px solid #e2ecef;
}
.picker-row {
  display: flex;
  align-items: start;
  gap: 12px;
  padding: 16px 8px;
  border-bottom: 1px solid #e2ecef;
  cursor: pointer;
}
.picker-row strong {
  display: block;
  line-height: 1.7;
  white-space: pre-wrap;
  font-size: 14px;
}
.picker-row small {
  display: block;
  overflow-wrap: anywhere;
}
.unavailable {
  opacity: 0.65;
  cursor: not-allowed;
}
.picker-footer {
  justify-content: flex-end;
  margin-top: 16px;
  font-size: 13px;
}
.picker-footer span {
  margin-right: auto;
}
.chosen-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  max-height: 150px;
  overflow: auto;
}
.chosen-list button {
  background: #edf7f9;
  color: #137f91;
  border: 1px solid #c9e4ea;
  border-radius: 8px;
  padding: 7px 10px;
  text-align: left;
  font: inherit;
  font-size: 12px;
}
.plan-empty {
  padding: 24px;
  color: #5d727a;
  line-height: 1.8;
}
.plan-actions {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid #d8e7eb;
}
.plan-actions span {
  margin-left: auto;
  font-size: 13px;
  color: #5d727a;
}
.plan-totals {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  background: #edf7f9;
  padding: 20px;
  border-radius: 12px;
}
.plan-totals dt {
  color: #5d727a;
  font-size: 13px;
}
.plan-totals dd {
  font-size: 21px;
  color: #137f91;
  margin: 10px 0 0;
}
.target-summary {
  padding-left: 20px;
  line-height: 1.9;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.plan-validation {
  background: #fff7ee;
  padding: 20px;
  border-radius: 12px;
  margin: 20px 0;
  line-height: 1.8;
}
.plan-validation.valid {
  background: #edf7f9;
}
.plan-validation p {
  font-size: 13px;
  color: #5d727a;
  margin-bottom: 0;
}
.coverage-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  font-size: 14px;
}
.plan-error {
  color: #a93626;
  background: #fff3ef;
  padding: 14px;
  border-radius: 8px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.text-button {
  border: 0;
  background: transparent;
  color: #137f91;
  padding: 10px 6px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
@media (max-width: 1100px) {
  .plan-rules,
  .plan-dimensions {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 650px) {
  .plan-wizard {
    padding: 16px;
  }
  .plan-heading {
    flex-direction: column;
  }
  .plan-steps {
    grid-template-columns: repeat(2, 1fr);
    font-size: 13px;
  }
  .plan-fields {
    grid-template-columns: 1fr;
  }
  .plan-rules,
  .plan-dimensions,
  .coverage-grid,
  .plan-totals {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .picker-heading {
    align-items: start;
  }
  .picker-heading h3 span {
    display: block;
    margin: 6px 0 0;
  }
  .plan-actions {
    flex-wrap: wrap;
  }
  .picker-footer {
    flex-wrap: wrap;
  }
}
</style>
