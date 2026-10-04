<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  ClipboardList,
  Zap,
  Box,
  Star,
  Check,
  History,
} from '@lucide/vue'

import {
  createAssessmentSession,
  getLaunchContext,
  operationKey,
  type LaunchContext,
  type LaunchBlueprint,
} from '../../web/src/services/assessmentApi'
import ResumeProgress from '../../web/src/components/ResumeProgress.vue'
import { useAccessStore } from '../../web/src/stores/access'
import { DIMENSIONS, MEASURE_UI_ENABLED, SCENARIO_NAMES } from '../../web/src/domain/capabilities'

const router = useRouter()
const route = useRoute()
const access = useAccessStore()
const context = ref<LaunchContext | null>(null)
const initialMode = route.query.mode
const selectedMode = ref<'rapid' | 'standard' | 'specialized' | 'fixed'>(
  initialMode === 'rapid' || initialMode === 'specialized' || initialMode === 'fixed'
    ? initialMode
    : 'standard',
)
const organizationId = ref(access.organizationId)
const syncingOrganization = ref(false)
let generation = 0
let organizationGeneration = 0
const blueprintId = ref('')
const busy = ref(false)
const error = ref('')
const organizationNotice = ref('')
const resumeSessionId = ref('')
const launchKey = ref(operationKey('session-create'))
const choosingMode = ref(false)
const launchNotice = ref('')
const launchConfiguration = ref<HTMLElement | null>(null)
type AssessmentMode = LaunchBlueprint['mode']

const modes = [
  {
    id: 'rapid' as const,
    icon: Zap,
    title: '极速测',
    text: '快速获得六维初步画像',
  },
  {
    id: 'standard' as const,
    icon: Box,
    title: '标准测',
    text: '覆盖客观、对话与实操',
  },
  {
    id: 'specialized' as const,
    icon: Star,
    title: '专项测',
    text: '聚焦单一能力维度',
  },
  {
    id: 'fixed' as const,
    icon: ClipboardList,
    title: '验证固定卷',
    text: '用于真实试测的同构题量基线',
  },
]

const selected = computed(() => modes.find((mode) => mode.id === selectedMode.value) ?? modes[1]!)
// The API validates published versions against the available item pool. This small
// guard also keeps stale/legacy malformed responses from rendering a zero-item start.
function validBlueprint(blueprint: LaunchBlueprint) {
  const minimums = Object.values(blueprint.item_type_minimums ?? {})
  return (
    blueprint.dimension_codes.length > 0 &&
    blueprint.dimension_codes.every((code) =>
      DIMENSIONS.some((dimension) => dimension.code === code),
    ) &&
    Number.isInteger(blueprint.min_items) &&
    blueprint.min_items > 0 &&
    Number.isInteger(blueprint.max_items) &&
    blueprint.max_items >= blueprint.min_items &&
    minimums.length === 3 &&
    minimums.every((value) => Number.isInteger(value) && value >= 0) &&
    minimums.reduce((sum, value) => sum + value, 0) > 0 &&
    minimums.reduce((sum, value) => sum + value, 0) <= blueprint.max_items &&
    (blueprint.mode !== 'standard' || minimums.every((value) => value > 0))
  )
}
const launchOrganizations = computed(() =>
  (context.value?.organizations ?? []).filter(
    (row) =>
      !MEASURE_UI_ENABLED || access.organizations.some((available) => available.id === row.id),
  ),
)
const validBlueprints = computed(() => (context.value?.blueprints ?? []).filter(validBlueprint))
const invalidBlueprintCount = computed(
  () => (context.value?.blueprints.length ?? 0) - validBlueprints.value.length,
)
function blueprintsFor(mode: AssessmentMode) {
  return validBlueprints.value.filter(
    (blueprint) =>
      blueprint.mode === mode &&
      (blueprint.organization_ids == null ||
        blueprint.organization_ids.includes(organizationId.value)),
  )
}
const availableBlueprints = computed(() => blueprintsFor(selectedMode.value))
function preferredBlueprint(mode: AssessmentMode) {
  const choices = blueprintsFor(mode)
  // Never silently prefer an experience plan over an available formal plan.
  const formal = choices.filter((row) => row.data_origin !== 'synthetic')
  const pool = formal.length ? formal : choices
  return pool.find((row) => row.scenario === 'higher_education') ?? pool[0]
}
const chosenBlueprint = computed(() =>
  availableBlueprints.value.find((blueprint) => blueprint.id === blueprintId.value),
)
const canStart = computed(() =>
  Boolean(
    organizationId.value &&
    chosenBlueprint.value &&
    !busy.value &&
    !choosingMode.value &&
    !syncingOrganization.value &&
    (!chosenBlueprint.value?.assessment_time_limit_seconds || timingAcknowledged.value) &&
    (!MEASURE_UI_ENABLED ||
      (access.ready && !access.error && access.organizationId === organizationId.value)),
  ),
)
const activeSessions = computed(() =>
  (context.value?.active_sessions ?? []).filter(
    (session) =>
      session.status === 'active' &&
      (access.singlePlatform || session.organization_id === organizationId.value),
  ),
)
const resumeSession = computed(() =>
  activeSessions.value.find((session) => session.id === resumeSessionId.value),
)
watch(activeSessions, (sessions) => {
  if (!sessions.some((session) => session.id === resumeSessionId.value))
    resumeSessionId.value = sessions[0]?.id ?? ''
})
const dimensionNames = computed(() =>
  (chosenBlueprint.value?.dimension_codes ?? []).map(
    (code) => DIMENSIONS.find((dimension) => dimension.code === code)?.name ?? code,
  ),
)
const itemTypeLabels = [
  { id: 'objective' as const, label: '客观题' },
  { id: 'dialogue' as const, label: '对话题' },
  { id: 'practical' as const, label: '实操题' },
]
function blueprintTypes(blueprint?: LaunchBlueprint) {
  return itemTypeLabels
    .map((type) => ({ ...type, minimum: blueprint?.item_type_minimums[type.id] ?? 0 }))
    .filter((type) => type.minimum > 0)
}
const chosenTypes = computed(() => blueprintTypes(chosenBlueprint.value))
const hasModelTasks = computed(() => chosenTypes.value.some((type) => type.id !== 'objective'))
const hasExactTypeCounts = computed(() => {
  const blueprint = chosenBlueprint.value
  return (
    blueprint?.mode === 'fixed' &&
    blueprint.min_items === blueprint.max_items &&
    chosenTypes.value.reduce((sum, type) => sum + type.minimum, 0) === blueprint.max_items
  )
})

function selectDefaults() {
  if (!context.value) return
  if (!launchOrganizations.value.some((row) => row.id === organizationId.value)) {
    const previousId = organizationId.value
    organizationId.value = launchOrganizations.value.some((row) => row.id === access.organizationId)
      ? access.organizationId
      : (launchOrganizations.value[0]?.id ?? '')
    if (
      !access.singlePlatform &&
      previousId &&
      organizationId.value &&
      previousId !== organizationId.value
    )
      organizationNotice.value = '已切换到你可参与测评的组织；管理权限不等同于学员参与资格。'
  }
  if (!availableBlueprints.value.some((row) => row.id === blueprintId.value)) {
    const preferred = preferredBlueprint(selectedMode.value)
    blueprintId.value = preferred?.id ?? ''
  }
}

watch(selectedMode, () => {
  selectDefaults()
  launchKey.value = operationKey('session-create')
})
watch([organizationId, blueprintId], () => {
  launchKey.value = operationKey('session-create')
})
watch(availableBlueprints, () => selectDefaults())
watch(
  () => access.organizationId,
  (id) => {
    if (context.value) {
      organizationId.value = id
      selectDefaults()
    }
  },
)
watch(organizationId, async (id) => {
  const organizationRequest = ++organizationGeneration
  if (!id || id === access.organizationId || !access.organizations.some((row) => row.id === id)) {
    syncingOrganization.value = false
    return
  }
  const request = generation
  syncingOrganization.value = true
  try {
    await access.selectOrganization(id)
    if (
      request === generation &&
      organizationRequest === organizationGeneration &&
      (access.error || access.organizationId !== id)
    )
      error.value = access.error || '组织切换未完成，请重新选择。'
  } catch (caught) {
    if (request === generation && organizationRequest === organizationGeneration)
      error.value = caught instanceof Error ? caught.message : '组织切换未完成。'
  } finally {
    if (request === generation && organizationRequest === organizationGeneration)
      syncingOrganization.value = false
  }
})

async function load() {
  const request = ++generation
  error.value = ''
  try {
    if (MEASURE_UI_ENABLED && !access.ready) await access.load()
    if (request !== generation) return
    if (MEASURE_UI_ENABLED && (!access.ready || access.error))
      throw new Error(access.error || '无法确认组织权限，请重新加载。')
    const data = await getLaunchContext()
    if (request !== generation) return
    context.value = data
    selectDefaults()
  } catch (caught) {
    if (request === generation)
      error.value = caught instanceof Error ? caught.message : '可用测评加载失败。'
  }
}

const timingAcknowledged = ref(false)
watch(blueprintId, () => {
  timingAcknowledged.value = false
  launchNotice.value = ''
})
function matchingSession(mode: AssessmentMode, blueprint?: LaunchBlueprint) {
  return activeSessions.value.find(
    (session) =>
      session.mode === mode && (!blueprint || session.blueprint_version_id === blueprint.id),
  )
}
function modeAction(mode: AssessmentMode) {
  if (!preferredBlueprint(mode)) return '暂未开放 · 查看说明'
  if (selectedMode.value === mode) return '已选择 · 请在下方开始'
  if (mode === 'specialized') return '选择专项维度 →'
  return '选择此测评方式 →'
}
function cardBlueprint(mode: AssessmentMode) {
  return selectedMode.value === mode
    ? (chosenBlueprint.value ?? preferredBlueprint(mode))
    : preferredBlueprint(mode)
}
function modePlanName(mode: AssessmentMode) {
  return cardBlueprint(mode)?.name
}
function modeDescription(mode: AssessmentMode) {
  const blueprint = cardBlueprint(mode)
  if (!blueprint) return modes.find((entry) => entry.id === mode)?.text ?? ''
  const types = blueprintTypes(blueprint)
    .map((type) => type.label)
    .join('、')
  if (mode === 'fixed') return `固定题目 · ${types}`
  if (mode === 'specialized')
    return `聚焦${blueprint.dimension_codes.length === 1 ? '单一' : blueprint.dimension_codes.length + '个'}能力维度 · ${types}`
  if (mode === 'rapid')
    return `${types} · ${blueprint.dimension_codes.length === 6 ? '六维初步画像' : blueprint.dimension_codes.length + '维初步画像'}`
  return `覆盖${types}`
}
function modeIsExperience(mode: AssessmentMode) {
  return cardBlueprint(mode)?.data_origin === 'synthetic'
}
function blueprintOptionLabel(blueprint: LaunchBlueprint) {
  const parts = [blueprint.name]
  const scenario = SCENARIO_NAMES[blueprint.scenario]
  if (scenario && !blueprint.name.includes(scenario)) parts.push(scenario)
  if (blueprint.mode === 'specialized') {
    const dimensions = blueprint.dimension_codes
      .map((code) => DIMENSIONS.find((dimension) => dimension.code === code)?.name ?? code)
      .filter((name) => !blueprint.name.includes(name))
    if (dimensions.length) parts.push(dimensions.join('、'))
  }
  parts.push(
    blueprint.min_items === blueprint.max_items
      ? `${blueprint.max_items}题`
      : `${blueprint.min_items}–${blueprint.max_items}题`,
  )
  return parts.join(' · ')
}
async function focusConfiguration() {
  await nextTick()
  launchConfiguration.value?.scrollIntoView?.({ block: 'nearest' })
  launchConfiguration.value?.focus()
}
async function chooseMode(mode: AssessmentMode) {
  if (busy.value || choosingMode.value || syncingOrganization.value) return
  choosingMode.value = true
  launchNotice.value = ''
  error.value = ''
  try {
    selectedMode.value = mode
    await nextTick()
    selectDefaults()
    await nextTick()
    if (
      MEASURE_UI_ENABLED &&
      (!access.ready || access.error || access.organizationId !== organizationId.value)
    ) {
      error.value = '无法确认当前测评权限，请重新加载。'
      return
    }
    if (!chosenBlueprint.value) {
      launchNotice.value = `${selected.value.title}暂未开放：平台尚未发布你可参与的有效方案。无需逐人分配，管理员发布方案后即可自助开始。待审核题不会自动进入正式测评。`
      await focusConfiguration()
      return
    }
    launchNotice.value =
      mode === 'specialized'
        ? '选择你要测评的专项维度和方案，然后点击开始测评；无需管理员指派。'
        : chosenBlueprint.value.assessment_time_limit_seconds
          ? '本方案有时间限制，请阅读并确认下方限时规则后开始。'
          : '已选择测评方式，请确认下方方案，再点击开始测评；有该方案的未完成记录时可继续作答。'
    await focusConfiguration()
  } finally {
    choosingMode.value = false
  }
}
async function start() {
  if (!canStart.value) return
  const existing = matchingSession(selectedMode.value, chosenBlueprint.value)
  if (existing) {
    await router.push(`/assessment/${existing.id}`)
    return
  }
  if (chosenBlueprint.value?.assessment_time_limit_seconds && !timingAcknowledged.value) {
    error.value = '请先确认限时测评规则。'
    return
  }
  const request = generation
  const selectedOrganization = organizationId.value
  busy.value = true
  error.value = ''
  try {
    const session = await createAssessmentSession(
      organizationId.value,
      blueprintId.value,
      launchKey.value,
    )
    if (
      request !== generation ||
      (MEASURE_UI_ENABLED && access.organizationId !== selectedOrganization)
    )
      return
    await router.push(`/assessment/${session.id}`)
  } catch (caught) {
    if (request === generation)
      error.value = caught instanceof Error ? caught.message : '测评会话创建失败。'
  } finally {
    if (request === generation) busy.value = false
  }
}

onMounted(load)
onBeforeUnmount(() => {
  generation += 1
})

// Mobile presentation only; permission, catalog and session logic above stay identical.
function compactModeDescription(mode: AssessmentMode) {
  return modeDescription(mode)
    .replaceAll('客观题', '客观')
    .replaceAll('对话题', '对话')
    .replaceAll('实操题', '实操')
    .replaceAll('、', ' · ')
}
const compactSelectionNotice = computed(() => {
  if (!launchNotice.value) return ''
  if (!chosenBlueprint.value) return launchNotice.value
  if (chosenBlueprint.value.assessment_time_limit_seconds) return '请确认限时规则后开始。'
  return selectedMode.value === 'specialized'
    ? '已选择专项测，请确认维度与方案。'
    : '已选择，确认方案后点击开始测评。'
})
</script>

<template>
  <section class="mobile-assessment" data-testid="mobile-assessment">
    <header class="m-assess-heading">
      <h1 data-testid="assessment-title">选择测评方式</h1>
      <p>选方式、确认方案，再开始作答。</p>
    </header>

    <div v-if="error" class="m-assess-error" role="alert">
      <p>{{ error }}</p>
      <button type="button" :disabled="busy || choosingMode" @click="load">重新加载</button>
    </div>
    <p v-if="!context && !error" class="m-assess-loading" role="status">正在读取可用测评…</p>

    <template v-if="context">
      <section v-if="resumeSession" class="m-assess-resume" aria-label="继续上次测评">
        <div class="m-assess-resume-row">
          <span class="m-assess-resume-icon"><History :size="18" /></span>
          <div class="m-assess-resume-copy">
            <small>上次尚未完成</small>
            <strong>{{ resumeSession.blueprint_name }}</strong>
          </div>
          <button
            data-testid="resume-session"
            type="button"
            :disabled="busy || choosingMode || syncingOrganization || (MEASURE_UI_ENABLED && (!access.ready || !!access.error || access.organizationId !== organizationId))"
            @click="router.push('/assessment/' + resumeSession.id)"
          >继续 <ArrowRight :size="14" /></button>
        </div>
        <p v-if="resumeSession.data_origin === 'synthetic'" class="m-assess-origin">
          本地体验 · 非正式比赛题库
        </p>
        <label v-if="activeSessions.length > 1" class="m-assess-field">
          切换未完成测评
          <select v-model="resumeSessionId" data-testid="resume-session-choice">
            <option v-for="session in activeSessions" :key="session.id" :value="session.id">{{ session.blueprint_name }}</option>
          </select>
        </label>
        <ResumeProgress
          :organization-id="organizationId"
          :session-id="resumeSession.id"
          :mode="resumeSession.mode"
        />
      </section>

      <div class="m-assess-modes" aria-label="测评方式">
        <button
          v-for="mode in modes"
          :key="mode.id"
          class="m-assess-mode"
          :class="{ 'is-selected': selectedMode === mode.id, 'is-unavailable': !preferredBlueprint(mode.id) }"
          type="button"
          :data-testid="`mode-${mode.id}`"
          :disabled="busy || choosingMode || syncingOrganization || (MEASURE_UI_ENABLED && (!access.ready || !!access.error))"
          :aria-pressed="selectedMode === mode.id"
          :aria-label="mode.title + '，' + modeDescription(mode.id) + '，' + modeAction(mode.id)"
          :title="modePlanName(mode.id)"
          @click="chooseMode(mode.id)"
        >
          <span class="m-assess-mode-icon"><component :is="mode.icon" :size="20" /></span>
          <strong>{{ mode.title }}</strong>
          <Check v-if="selectedMode === mode.id" class="m-assess-selected-check" :size="13" aria-hidden="true" />
          <p>{{ compactModeDescription(mode.id) }}</p>
          <span class="m-assess-mode-state" :class="{ 'is-synthetic': modeIsExperience(mode.id) }">
            {{ !preferredBlueprint(mode.id) ? '暂未开放 · 查看说明' : modeIsExperience(mode.id) ? '合成体验 · 非正式' : selectedMode === mode.id ? '已选择' : '选择此方式' }}
          </span>
        </button>
      </div>

      <section ref="launchConfiguration" class="m-assess-launch" tabindex="-1" aria-label="测评方案与开始规则">
        <div class="m-assess-launch-heading">
          <h2>{{ selectedMode === 'specialized' ? '确认专项维度与方案' : '确认测评方案' }}</h2>
          <span v-if="chosenBlueprint" class="m-assess-catalog-state" :class="{ 'is-synthetic': chosenBlueprint.data_origin === 'synthetic' }">
            {{ chosenBlueprint.data_origin === 'synthetic' ? '合成体验' : '已发布题库' }}
          </span>
        </div>
        <label v-if="!access.singlePlatform" class="m-assess-field" for="launch-organization">
          <span><Building2 :size="14" /> 测评组织</span>
          <select
            id="launch-organization"
            v-model="organizationId"
            data-testid="launch-organization"
            :disabled="busy || choosingMode || syncingOrganization || !launchOrganizations.length"
          >
            <option v-if="!organizationId" value="" disabled>{{ launchOrganizations.length ? '请选择可参与的组织' : '暂无可参与测评的组织' }}</option>
            <option v-for="organization in launchOrganizations" :key="organization.id" :value="organization.id">{{ organization.name }}</option>
          </select>
        </label>
        <label v-if="availableBlueprints.length !== 1" class="m-assess-field" for="launch-blueprint">
          <span>{{ selectedMode === 'specialized' ? '能力维度与场景' : '测评场景与方案' }}</span>
          <select
            id="launch-blueprint"
            v-model="blueprintId"
            :disabled="!availableBlueprints.length || busy || choosingMode || syncingOrganization"
            data-testid="launch-blueprint"
            aria-describedby="launch-blueprint-help"
          >
            <option v-if="!availableBlueprints.length" value="">{{ selected.title }}暂无可开始的方案</option>
            <option v-for="blueprint in availableBlueprints" :key="blueprint.id" :value="blueprint.id">{{ blueprintOptionLabel(blueprint) }}</option>
          </select>
        </label>
        <div v-else-if="chosenBlueprint" class="m-assess-single-plan" data-testid="confirmed-blueprint">
          {{ blueprintOptionLabel(chosenBlueprint) }}
        </div>

        <p v-if="compactSelectionNotice" class="m-assess-selection-notice" role="status">{{ compactSelectionNotice }}</p>
        <p v-if="syncingOrganization" class="m-assess-selection-notice" role="status">正在同步组织权限…</p>
        <p v-if="organizationNotice" class="m-assess-warning" role="status">{{ organizationNotice }}</p>
        <p v-if="invalidBlueprintCount" class="m-assess-warning" role="status">已隐藏配置不完整的版本，请管理员检查题目覆盖和发布配置。</p>
        <p v-if="!launchOrganizations.length" class="m-assess-warning">当前账号暂无测评参与资格，请联系管理员确认账号状态。</p>

        <template v-if="chosenBlueprint">
          <div class="m-assess-facts" aria-label="测评基本信息">
            <span><b>{{ chosenBlueprint.dimension_codes.length }}</b> 个维度</span>
            <span><b>{{ chosenBlueprint.min_items === chosenBlueprint.max_items ? chosenBlueprint.max_items : chosenBlueprint.min_items + '–' + chosenBlueprint.max_items }}</b> 题</span>
            <span><b>{{ chosenBlueprint.assessment_time_limit_seconds ? Math.ceil(chosenBlueprint.assessment_time_limit_seconds / 60) + '分钟' : '不限时' }}</b></span>
          </div>
          <div class="m-assess-types" aria-label="本方案题型覆盖">
            <span v-for="type in chosenTypes" :key="type.id">{{ type.label }} {{ type.minimum }}{{ hasExactTypeCounts ? '题' : '题起' }}</span>
          </div>
          <p v-if="chosenBlueprint.data_origin === 'synthetic'" class="m-assess-origin">
            本地体验 · 非正式比赛题库，不作为比赛实测或专家验证数据。
          </p>
          <label v-if="chosenBlueprint.assessment_time_limit_seconds" class="m-assess-timing">
            <input v-model="timingAcknowledged" type="checkbox" />
            <span>我已知晓：限时 {{ chosenBlueprint.assessment_time_limit_seconds }} 秒，{{ hasModelTasks ? '包含模型等待；' : '' }}退出后继续计时，超时保留记录但不生成完整报告。</span>
          </label>
        </template>
        <p v-else-if="!launchNotice" class="m-assess-warning">当前暂无可用方案。可切换测评方式，或联系管理员发布题目覆盖完整的方案。</p>

        <button class="m-assess-start" data-testid="start-assessment" type="button" :disabled="!canStart" @click="start">
          {{ busy ? '正在创建会话…' : matchingSession(selectedMode, chosenBlueprint) && chosenBlueprint ? '继续此方案测评' : '开始测评' }}
          <ArrowRight :size="16" />
        </button>

        <details class="m-assess-rules">
          <summary>题型覆盖、抽题与作答规则</summary>
          <p id="launch-blueprint-help">切换方式或方案只更新选择，点击「开始测评」才会进入作答。有该方案的未完成记录时，将继续原会话。</p>
          <template v-if="chosenBlueprint">
            <p class="m-assess-coverage-state">{{ chosenBlueprint.data_origin === 'synthetic' ? '本地体验方案' : '当前可用版本' }} · 题型覆盖检查通过</p>
            <p>{{ hasExactTypeCounts ? '以上为本卷题型数量' : '以上为最低题型覆盖要求' }}；{{ chosenBlueprint.mode === 'fixed' ? '按固定卷作答' : '实际题量由自适应规则决定' }}。</p>
            <p>覆盖维度：{{ dimensionNames.join('、') }}。</p>
            <p v-if="chosenTypes.length === 1">本次仅含{{ chosenTypes[0]?.label }}，不包含其他题型。</p>
            <p v-if="chosenBlueprint.mode !== 'fixed'">系统按能力估计、维度与题型要求，从本方案已发布题池动态抽题。同难度候选题随机选择，本次测评不重复出题；刷新后仍是当前题。不同学员可能抽到相同题目。</p>
            <p v-else>固定卷使用方案指定的题目，便于同卷对比，不按学员随机换题。</p>
            <p>回答与过程证据保存在当前账号下，开始后进入答题工作区。</p>
          </template>
        </details>
      </section>

      <div class="m-assess-secondary-links">
        <RouterLink to="/content-trials">我的题质试答 <ArrowRight :size="13" /></RouterLink>
        <RouterLink to="/workspace"><ArrowLeft :size="13" /> 返回首页</RouterLink>
      </div>
      <p class="m-assess-trial-note">题质试答由管理员指定，不计入正式成绩。</p>
    </template>
  </section>
</template>

<style scoped>
.mobile-assessment {
  --m-assess-ink: #15353c;
  --m-assess-muted: #586f73;
  --m-assess-teal: #087f82;
  --m-assess-line: #dce9e5;
  --m-assess-soft: #edf7f3;
  --m-assess-paper: #fff;
  color: var(--m-assess-ink);
}
.m-assess-heading { margin-bottom: 12px; }
.m-assess-heading h1 { font-size: 18px !important; line-height: 1.45 !important; margin: 0 0 4px; font-weight: 700; }
.m-assess-heading p { color: var(--m-assess-muted); font-size: 12px; line-height: 1.5; }
.m-assess-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 12px; }
.m-assess-mode { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); grid-template-rows: 28px minmax(18px, 1fr) 15px; align-items: center; gap: 5px 7px; min-height: 110px; padding: 11px; border: 1px solid var(--m-assess-line); border-radius: 12px; background: var(--m-assess-paper); text-align: left; color: var(--m-assess-ink); }
.m-assess-mode.is-selected { border-color: var(--m-assess-teal); background: var(--m-assess-soft); box-shadow: inset 0 0 0 1px var(--m-assess-teal); }
.m-assess-mode.is-unavailable { background: #f5f7f6; }
.m-assess-mode-icon { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: var(--m-assess-soft); color: var(--m-assess-teal); }
.is-selected .m-assess-mode-icon { background: var(--m-assess-teal); color: white; }
.m-assess-mode > strong { font-size: 14px; font-weight: 700; line-height: 1.35; padding-right: 3px; }
.m-assess-selected-check { position: absolute; top: 8px; right: 7px; color: var(--m-assess-teal); }
.m-assess-mode p { grid-column: 1 / -1; font-size: 12px; line-height: 1.5; color: var(--m-assess-muted); margin: 0; }
.m-assess-mode-state { grid-column: 1 / -1; font-size: 11px; line-height: 1.4; color: var(--m-assess-teal); }
.is-synthetic { color: #86632d !important; }
.m-assess-launch { padding: 14px; border: 1px solid var(--m-assess-line); border-radius: 14px; background: var(--m-assess-paper); }
.m-assess-launch-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
.m-assess-launch-heading h2 { font-size: 14px !important; line-height: 1.5 !important; margin: 0; }
.m-assess-catalog-state { flex: none; font-size: 10px; color: #43766c; padding: 3px 6px; border-radius: 5px; background: var(--m-assess-soft); }
.m-assess-field { display: grid; gap: 5px; margin-top: 8px; font-size: 12px; color: var(--m-assess-muted); }
.m-assess-field > span { display: flex; align-items: center; gap: 5px; }
.m-assess-field select { width: 100%; min-width: 0; height: 44px; margin: 0; padding: 8px 10px; border: 1px solid #b9d5cc; border-radius: 9px; color: var(--m-assess-teal); background: white; font-size: 16px; font-weight: 500; }
.m-assess-single-plan { font-size: 14px; line-height: 1.6; color: var(--m-assess-teal); overflow-wrap: anywhere; }
.m-assess-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 0; margin-top: 12px; color: var(--m-assess-muted); font-size: 11px; line-height: 1.6; }
.m-assess-facts > span { padding: 0 10px; border-right: 1px solid var(--m-assess-line); }
.m-assess-facts > span:first-child { padding-left: 0; }
.m-assess-facts > span:last-child { border: 0; padding-right: 0; }
.m-assess-facts b { color: var(--m-assess-ink); font-size: 13px; font-weight: 650; font-variant-numeric: tabular-nums; }
.m-assess-types { display: flex; flex-wrap: wrap; gap: 4px 12px; margin: 7px 0 12px; color: var(--m-assess-muted); font-size: 11px; line-height: 1.6; }
.m-assess-selection-notice { color: var(--m-assess-teal); margin-top: 7px; font-size: 12px; line-height: 1.6; }
.m-assess-warning, .m-assess-origin { margin-top: 8px; font-size: 12px; line-height: 1.6; padding: 8px 10px; border-radius: 8px; background: #fff6e9; color: #795723; overflow-wrap: anywhere; }
.m-assess-timing { display: flex; align-items: flex-start; gap: 8px; min-height: 44px; margin: 7px 0 10px; font-size: 12px; line-height: 1.6; color: #795723; }
.m-assess-timing input { width: 17px; height: 17px; margin-top: 2px; flex: none; accent-color: var(--m-assess-teal); }
.m-assess-start { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 44px; padding: 10px 12px; border: 0; border-radius: 10px; background: var(--m-assess-teal); color: white; font-size: 14px; font-weight: 650; }
.m-assess-start:disabled { opacity: 1; background: #e5eeea; color: #69847a; cursor: not-allowed; }
.m-assess-rules { margin-top: 8px; border-top: 1px solid var(--m-assess-line); font-size: 12px; color: var(--m-assess-muted); line-height: 1.7; }
.m-assess-rules summary { min-height: 44px; padding: 12px 0 8px; cursor: pointer; }
.m-assess-rules p { margin: 0 0 7px; }
.m-assess-coverage-state { color: var(--m-assess-teal); }
.m-assess-secondary-links { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; font-size: 12px; color: var(--m-assess-teal); }
.m-assess-secondary-links a { display: inline-flex; align-items: center; gap: 4px; min-height: 44px; }
.m-assess-trial-note { font-size: 11px; line-height: 1.6; color: var(--m-assess-muted); margin-top: -3px; }
.m-assess-resume { border: 1px solid var(--m-assess-line); border-radius: 12px; background: var(--m-assess-soft); padding: 10px; margin-bottom: 12px; }
.m-assess-resume-row { display: flex; align-items: center; gap: 8px; }
.m-assess-resume-icon { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; flex: none; color: var(--m-assess-teal); background: white; }
.m-assess-resume-copy { flex: 1; min-width: 0; }
.m-assess-resume-copy small { display: block; color: var(--m-assess-muted); font-size: 10px; margin-bottom: 3px; }
.m-assess-resume-copy strong { display: block; color: var(--m-assess-ink); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.m-assess-resume-row > button { display: inline-flex; align-items: center; justify-content: center; gap: 3px; border: 0; padding: 0 5px; background: none; color: var(--m-assess-teal); min-height: 44px; font-size: 12px; font-weight: 650; flex: none; }
.m-assess-error, .m-assess-loading { font-size: 13px; line-height: 1.7; padding: 12px; border-radius: 10px; margin-bottom: 12px; background: #fff2ed; color: #963c2c; }
.m-assess-loading { background: var(--m-assess-soft); color: var(--m-assess-muted); }
.m-assess-error button { min-height: 44px; border: 0; color: inherit; padding: 8px 0; background: none; font-size: 13px; text-decoration: underline; }
.mobile-assessment button:disabled { cursor: not-allowed; }
.mobile-assessment button:focus-visible, .mobile-assessment a:focus-visible, .mobile-assessment select:focus-visible, .mobile-assessment summary:focus-visible { outline: 2px solid var(--m-assess-teal); outline-offset: 3px; }
@media (max-width: 350px) {
  .m-assess-mode { padding: 10px; gap: 5px; }
  .m-assess-mode > strong { font-size: 13px; }
  .m-assess-facts > span { padding: 0 7px; }
}
</style>
