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
} from '../services/assessmentApi'
import ResumeProgress from '../components/ResumeProgress.vue'
import { useAccessStore } from '../stores/access'
import { DIMENSIONS, MEASURE_UI_ENABLED, SCENARIO_NAMES } from '../domain/capabilities'

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
</script>

<template>
  <section class="assessment shell">
    <header class="assessment-heading">
      <span class="setup-label">ASSESSMENT SETUP</span>
      <h1 data-testid="assessment-title">选择测评方式</h1>
      <p>先选择测评方式，再确认下方方案，最后点击「开始测评」。无需管理员逐人分配。</p>
      <p class="content-trial-entry">
        <RouterLink to="/content-trials">我的题质试答 →</RouterLink>
        <span>管理员指定的独立试答，不计入正式成绩</span>
      </p>
    </header>
    <div v-if="error" class="assessment-alert" role="alert">
      {{ error }}
      <button type="button" :disabled="busy || choosingMode" @click="load">重新加载</button>
    </div>
    <p v-if="launchNotice" class="loading-state" role="status">{{ launchNotice }}</p>
    <div v-if="!context && !error" class="loading-state" role="status">
      正在读取可参与的组织与测评方案……
    </div>
    <template v-if="context">
      <section v-if="resumeSession" class="resume-strip" aria-label="继续上次测评">
        <div class="resume-copy">
          <span class="resume-icon"><History :size="25" /></span>
          <div>
            <small>RESUME · 继续上次测评</small><strong>{{ resumeSession.blueprint_name }}</strong>
            <span v-if="resumeSession.data_origin === 'synthetic'" class="experience-label"
              >本地体验 · 非正式比赛题库</span
            >
          </div>
        </div>
        <label v-if="activeSessions.length > 1" class="resume-choice"
          >切换未完成测评<select v-model="resumeSessionId" data-testid="resume-session-choice">
            <option v-for="session in activeSessions" :key="session.id" :value="session.id">
              {{ session.blueprint_name }}
            </option>
          </select></label
        >
        <ResumeProgress
          :organization-id="organizationId"
          :session-id="resumeSession.id"
          :mode="resumeSession.mode"
        />
        <button
          data-testid="resume-session"
          type="button"
          class="text-action"
          :disabled="
            busy ||
            choosingMode ||
            syncingOrganization ||
            (MEASURE_UI_ENABLED &&
              (!access.ready || !!access.error || access.organizationId !== organizationId))
          "
          @click="router.push('/assessment/' + resumeSession.id)"
        >
          继续测评 <ArrowRight :size="16" />
        </button>
      </section>
      <div class="mode-grid" aria-label="测评方式">
        <button
          v-for="(mode, index) in modes"
          :key="mode.id"
          class="mode-card"
          :class="{ selected: selectedMode === mode.id }"
          type="button"
          :data-testid="`mode-${mode.id}`"
          :disabled="
            busy ||
            choosingMode ||
            syncingOrganization ||
            (MEASURE_UI_ENABLED && (!access.ready || !!access.error))
          "
          :aria-pressed="selectedMode === mode.id"
          @click="chooseMode(mode.id)"
        >
          <span class="mode-number">{{ String(index + 1).padStart(2, '0') }}</span>
          <span v-if="selectedMode === mode.id" class="selected-check"><Check :size="15" /></span>
          <span class="mode-icon"><component :is="mode.icon" :size="27" /></span>
          <strong>{{ mode.title }}</strong>
          <p>{{ modeDescription(mode.id) }}</p>
          <small v-if="modePlanName(mode.id)">{{ modePlanName(mode.id) }}</small>
          <small v-if="modeIsExperience(mode.id)" class="experience-label"
            >本地体验 · 非正式比赛题库</small
          >
          <small v-else-if="preferredBlueprint(mode.id)">已发布题库 · 自助测评</small>
          <span class="mode-action">{{
            busy && selectedMode === mode.id ? '正在进入测评…' : modeAction(mode.id)
          }}</span>
        </button>
      </div>
      <div
        ref="launchConfiguration"
        class="launch-grid"
        tabindex="-1"
        aria-label="测评方案与开始规则"
      >
        <section class="configuration-card" aria-label="测评配置">
          <h2>
            {{ selectedMode === 'specialized' ? '选择专项维度与方案' : '确认测评方案' }}
          </h2>
          <template v-if="!access.singlePlatform">
            <label for="launch-organization"><Building2 :size="17" /> 测评组织</label>
            <select
              id="launch-organization"
              v-model="organizationId"
              data-testid="launch-organization"
              :disabled="busy || choosingMode || syncingOrganization || !launchOrganizations.length"
            >
              <option v-if="!organizationId" value="" disabled>
                {{ launchOrganizations.length ? '请选择可参与的组织' : '暂无可参与测评的组织' }}
              </option>
              <option
                v-for="organization in launchOrganizations"
                :key="organization.id"
                :value="organization.id"
              >
                {{ organization.name }}
              </option>
            </select>
          </template>
          <label
            v-if="availableBlueprints.length !== 1"
            class="version-label"
            for="launch-blueprint"
            >{{ selectedMode === 'specialized' ? '专项维度与方案' : '测评场景与方案' }}</label
          >
          <select
            v-if="availableBlueprints.length !== 1"
            id="launch-blueprint"
            v-model="blueprintId"
            :disabled="!availableBlueprints.length || busy || choosingMode || syncingOrganization"
            data-testid="launch-blueprint"
            aria-describedby="launch-blueprint-help"
          >
            <option v-if="!availableBlueprints.length" value="">
              {{ selected.title }}暂无可开始的方案
            </option>
            <option
              v-for="blueprint in availableBlueprints"
              :key="blueprint.id"
              :value="blueprint.id"
            >
              {{ blueprintOptionLabel(blueprint) }}
            </option>
          </select>
          <div
            v-else-if="chosenBlueprint"
            class="single-blueprint"
            data-testid="confirmed-blueprint"
          >
            <span class="version-label">当前测评方案</span>
            <strong>{{ blueprintOptionLabel(chosenBlueprint) }}</strong>
          </div>
          <p id="launch-blueprint-help" class="configuration-notice">
            {{
              availableBlueprints.length === 1
                ? '当前只有这一份可用方案。确认题型与作答规则后，点击开始测评。'
                : selectedMode === 'specialized'
                  ? '这里选择要测评的能力维度和场景。确认后，点击右侧或下方的开始测评。'
                  : '同一种测评方式可有不同场景的已发布方案。切换这里只更新方案，点击开始测评才会进入答题。'
            }}
          </p>
          <p v-if="syncingOrganization" role="status">正在同步组织权限…</p>
          <p v-if="organizationNotice" class="configuration-notice" role="status">
            {{ organizationNotice }}
          </p>
          <p v-if="invalidBlueprintCount" class="configuration-notice" role="status">
            已隐藏配置不完整的版本，请管理员检查题目覆盖和发布配置。
          </p>
          <p v-if="!launchOrganizations.length" class="configuration-notice">
            当前账号暂无测评参与资格，请联系管理员确认账号状态。
          </p>
          <p v-if="chosenBlueprint" class="coverage-note">
            <span aria-hidden="true">●</span>
            {{
              chosenBlueprint.data_origin === 'synthetic'
                ? '本地体验方案 · 题型覆盖检查通过'
                : '当前可用版本 · 题型覆盖检查通过'
            }}
          </p>
          <RouterLink class="back-link" to="/workspace"
            ><ArrowLeft :size="15" /> 返回工作台</RouterLink
          >
        </section>
        <section class="launch-preview" aria-label="即将开始">
          <span class="preview-label">即将开始</span>
          <h2>{{ chosenBlueprint?.name ?? `${selected.title}暂无可开始的方案` }}</h2>
          <template v-if="chosenBlueprint">
            <p class="preview-scenario">{{ SCENARIO_NAMES[chosenBlueprint.scenario] }}</p>
            <dl class="preview-facts">
              <div>
                <dt>能力维度</dt>
                <dd>{{ chosenBlueprint.dimension_codes.length }}</dd>
              </div>
              <div>
                <dt>
                  {{
                    chosenBlueprint.mode === 'fixed'
                      ? chosenBlueprint.min_items === chosenBlueprint.max_items
                        ? '固定题量'
                        : '题量范围'
                      : '题量上限'
                  }}
                </dt>
                <dd>
                  {{
                    chosenBlueprint.mode === 'fixed' &&
                    chosenBlueprint.min_items !== chosenBlueprint.max_items
                      ? chosenBlueprint.min_items + '–'
                      : ''
                  }}{{ chosenBlueprint.max_items }}
                </dd>
              </div>
              <div>
                <dt>测评题型</dt>
                <dd :class="{ 'single-type-name': chosenTypes.length === 1 }">
                  {{ chosenTypes.length === 1 ? chosenTypes[0]?.label : `${chosenTypes.length}类` }}
                </dd>
              </div>
              <div>
                <dt>
                  {{ chosenBlueprint.assessment_time_limit_seconds ? '限时分钟' : '作答时间' }}
                </dt>
                <dd>
                  {{
                    chosenBlueprint.assessment_time_limit_seconds
                      ? Math.ceil(chosenBlueprint.assessment_time_limit_seconds / 60)
                      : '不限时'
                  }}
                </dd>
              </div>
            </dl>
            <div class="type-coverage" aria-label="本方案题型覆盖">
              <template v-for="(type, index) in chosenTypes" :key="type.id">
                <i v-if="index" aria-hidden="true"></i>
                <span
                  >{{ type.label }} {{ type.minimum }}{{ hasExactTypeCounts ? '题' : '题起' }}</span
                >
              </template>
            </div>
            <p v-if="chosenTypes.length === 1" class="minimum-note">
              本次仅含{{ chosenTypes[0]?.label }}。
            </p>
            <details class="dimension-details">
              <summary>查看覆盖维度与规则</summary>
              <p>
                {{ hasExactTypeCounts ? '以上为本卷题型数量' : '以上为最低题型覆盖要求' }}；{{
                  chosenBlueprint.mode === 'fixed' ? '按固定卷作答' : '实际题量由自适应规则决定'
                }}。
              </p>
              <p>{{ dimensionNames.join('、') }}</p>
              <p v-if="chosenBlueprint.mode !== 'fixed'">
                系统按能力估计、维度与题型要求，从本方案已发布题池动态抽题。同难度候选题随机选择，本次测评不重复出题；刷新后仍是当前题。不同学员可能抽到相同题目。
              </p>
              <p v-else>固定卷使用方案指定的题目，便于同卷对比，不按学员随机换题。</p>
              <p>回答与过程证据保存在当前账号下，开始后进入答题工作区。</p>
            </details>
            <p v-if="chosenBlueprint.data_origin === 'synthetic'" class="experience-label">
              本地体验 · 非正式比赛题库，不作为比赛实测或专家验证数据。
            </p>
            <label v-if="chosenBlueprint.assessment_time_limit_seconds" class="timing-ack"
              ><input v-model="timingAcknowledged" type="checkbox" />我已知晓：限时
              {{ chosenBlueprint.assessment_time_limit_seconds }}
              秒，{{
                hasModelTasks ? '包含模型等待；' : ''
              }}退出后继续计时，超时保留记录但不生成完整报告。</label
            >
          </template>
          <p v-else class="empty-preview">
            可以切换其他测评方式，或联系组织管理员发布题目覆盖完整的方案。
          </p>
          <button
            class="primary-button"
            data-testid="start-assessment"
            type="button"
            :disabled="!canStart"
            @click="start"
          >
            {{
              busy
                ? '正在创建会话'
                : matchingSession(selectedMode, chosenBlueprint) && chosenBlueprint
                  ? '继续此方案测评'
                  : '开始测评'
            }}
            <ArrowRight :size="16" />
          </button>
        </section>
      </div>
    </template>
  </section>
</template>
<style scoped>
.content-trial-entry {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 13px;
  margin-top: 14px;
}
.content-trial-entry a {
  color: #137f91;
  text-underline-offset: 4px;
}
.content-trial-entry span {
  color: #5d727a;
}
.assessment {
  --launch-blue: #427eff;
  --launch-teal: #219bac;
  --launch-line: #c0cfea;
  --launch-ink: #555;
  --launch-unit: var(--reference-unit, 1px);
  width: 100%;
  color: var(--launch-ink);
  padding: 0 0 24px;
}
.assessment-heading {
  margin-bottom: 8px;
}
.setup-label {
  font-size: 16px;
  color: #797979;
}
.assessment-heading h1 {
  font-size: 32px;
  line-height: 1.4;
  margin: 8px 0 5px;
  font-weight: 700;
}
.assessment-heading p {
  font-size: 15px;
  color: #767676;
}
.resume-strip {
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 83px;
  padding: 14px 30px;
  border: 1px solid #a7dbe5;
  border-radius: 14px;
  background: #f1f4f9;
  box-shadow: 0 3px 9px #137f910a;
  margin: 0 0 36px;
}
.resume-copy {
  display: flex;
  gap: 20px;
  align-items: center;
  margin-right: auto;
}
.resume-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex: none;
  border-radius: 7px;
  background: #dce5f6;
  color: var(--launch-blue);
}
.resume-copy small {
  display: block;
  color: #777;
  font-size: 14px;
}
.resume-copy strong {
  display: block;
  font-size: 16px;
  margin-top: 5px;
}
.resume-choice {
  font-size: 12px;
  max-width: 180px;
}
.resume-choice select {
  height: 36px;
  margin: 5px 0;
  font-size: 13px;
  padding: 5px;
}
.text-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: none;
  border: 0;
  color: var(--launch-blue);
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
  min-height: 44px;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: calc(40 * var(--launch-unit));
  margin-bottom: calc(44 * var(--launch-unit));
}
.mode-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-height: calc(207 * var(--launch-unit));
  padding: calc(27 * var(--launch-unit)) calc(35 * var(--launch-unit)) 22px;
  background: white;
  border: 1px solid var(--launch-line);
  box-shadow: 0 3px 8px #6784b51c;
  border-radius: 16px;
  color: var(--launch-ink);
  text-align: left;
  cursor: pointer;
  transition:
    background 0.18s,
    border-color 0.18s;
}
.mode-card.selected {
  border: 2px solid var(--launch-blue);
  background: #f1f4fb;
  padding-top: calc(27 * var(--launch-unit) - 1px);
  padding-left: calc(35 * var(--launch-unit) - 1px);
  box-shadow: 0 3px 8px #427eff25;
}
.mode-action {
  color: #137f91;
  font-size: 14px;
  font-weight: 600;
  margin-top: auto;
  padding-top: 12px;
}
.launch-grid:focus-visible {
  outline: 3px solid #347fff;
  outline-offset: 5px;
}
.mode-card:hover {
  background: #f3f7fb;
}
.mode-number {
  color: #767676;
  font-weight: 600;
  font-size: 16px;
  margin-bottom: 8px;
}
.mode-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 6px;
  background: #e1e8f5;
  color: #728bb9;
  margin-bottom: 8px;
}
.selected .mode-icon {
  background: var(--launch-blue);
  color: white;
}
.selected-check {
  position: absolute;
  right: 24px;
  top: 23px;
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  border-radius: 50%;
  background: var(--launch-blue);
  color: white;
}
.mode-card strong {
  font-size: 18px;
}
.mode-card p,
.mode-card small {
  color: #757575;
  font-size: 13px;
  line-height: 1.7;
}
.selected small {
  color: #2862d8;
}
.launch-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: calc(38 * var(--launch-unit));
}
.configuration-card,
.launch-preview {
  min-width: 0;
  min-height: calc(380 * var(--launch-unit));
  border-radius: 16px;
  border: 1px solid var(--launch-line);
  box-shadow: 0 3px 8px #6784b525;
  padding: calc(30 * var(--launch-unit));
}
.configuration-card h2 {
  font-size: 16px;
  color: #767676;
  margin: 0 0 8px;
}
.configuration-card > label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 600;
}
.configuration-card .version-label {
  font-size: 13px;
  margin: 14px 0 6px;
  color: #6d7d83;
}
.single-blueprint {
  display: grid;
  gap: 8px;
  margin-top: 14px;
}
.single-blueprint strong {
  color: #208c9c;
  font-size: 17px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.single-blueprint .version-label {
  margin: 0;
}
select {
  display: block;
  width: 100%;
  min-width: 0;
  height: 62px;
  padding: 12px 15px;
  font-size: 17px;
  font-weight: 600;
  color: #208c9c;
  border: 2px solid #80c6d3;
  border-radius: 8px;
  background: white;
  margin-top: 22px;
}
.version-label + select {
  margin-top: 0;
}
.coverage-note {
  display: flex;
  gap: 10px;
  color: #287f8e;
  font-size: 16px;
  margin-top: 22px;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #6d7d83;
  font-size: 13px;
  margin-top: 8px;
}
.configuration-notice {
  font-size: 13px;
  line-height: 1.7;
  margin-top: 12px;
}
.launch-preview {
  display: flex;
  flex-direction: column;
  background: #cce7eb;
  border-color: #67c1d1;
  color: #208c9c;
  padding: calc(29 * var(--launch-unit)) calc(40 * var(--launch-unit));
}
.preview-label {
  font-size: 18px;
  font-weight: 600;
}
.launch-preview h2 {
  font-size: 30px;
  line-height: 1.3;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.preview-scenario {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
}
.preview-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  background: #a7d7df;
  padding: 0;
  margin: 0;
}
.preview-facts > div {
  display: flex;
  flex-direction: column-reverse;
  justify-content: center;
  padding: 12px 12px 10px 24px;
  border-right: 1px solid #219bac;
  min-width: 0;
}
.preview-facts > div:last-child {
  border: 0;
}
.preview-facts dt {
  font-size: 16px;
  font-weight: 600;
}
.preview-facts dd {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
}
.preview-facts .single-type-name {
  font-size: 17px;
}
.type-coverage {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 18px;
  font-size: 16px;
  font-weight: 600;
}
.type-coverage i {
  height: 1px;
  flex: 1;
  background: #4fa6b3;
  max-width: 70px;
}
.minimum-note,
.dimension-details {
  font-size: 12px;
  line-height: 1.8;
  margin-top: 10px;
  color: #446b73;
}
.dimension-details summary {
  cursor: pointer;
}
.experience-label {
  display: block;
  color: #765c31;
  font-size: 12px;
  line-height: 1.6;
  margin-top: 8px;
}
.timing-ack {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  line-height: 1.7;
  margin-top: 15px;
  color: #624e29;
}
.timing-ack input {
  margin-top: 5px;
  flex: none;
}
.primary-button {
  align-self: flex-end;
  margin-top: auto;
  min-height: 40px;
  border-radius: 5px;
  background: #219bac;
  padding: 10px 16px;
  color: #fff;
  border: 0;
  font-size: 13px;
}
.empty-preview {
  font-size: 14px;
  line-height: 1.8;
  margin: 20px 0;
}
.loading-state,
.assessment-alert {
  padding: 18px;
  border-radius: 10px;
  background: #eff6f8;
  margin-bottom: 18px;
}
.assessment-alert {
  background: #fff3ed;
  color: #96392c;
}
.assessment-alert button {
  border: 1px solid currentColor;
  border-radius: 6px;
  background: transparent;
  padding: 6px 10px;
  color: inherit;
  cursor: pointer;
}
button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
select:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 3px solid #347fff;
  outline-offset: 3px;
}
@media (max-width: 1250px) {
  .mode-grid {
    gap: 20px;
  }
  .mode-card {
    padding: 22px;
    min-height: 210px;
  }
  .mode-card.selected {
    padding: 21px;
  }
  .resume-strip {
    flex-wrap: wrap;
  }
  .launch-preview {
    padding: 24px;
  }
  .preview-facts > div {
    padding: 12px;
  }
  .launch-preview h2 {
    font-size: 26px;
  }
}
@media (max-width: 1050px) {
  .mode-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .launch-grid {
    grid-template-columns: 1fr;
  }
  .configuration-card,
  .launch-preview {
    min-height: 340px;
  }
  .primary-button {
    margin-top: 24px;
  }
}
@media (max-width: 560px) {
  .assessment-heading h1 {
    font-size: 28px;
  }
  .mode-grid {
    gap: 12px;
    margin-bottom: 24px;
  }
  .mode-card {
    padding: 18px 14px;
    min-height: 210px;
  }
  .mode-card.selected {
    padding: 17px 13px;
  }
  .mode-card strong {
    font-size: 17px;
  }
  .selected-check {
    right: 12px;
    top: 17px;
  }
  .resume-strip {
    padding: 18px;
    gap: 12px;
    margin-bottom: 24px;
  }
  .resume-copy {
    gap: 12px;
  }
  .resume-choice {
    max-width: 100%;
    width: 100%;
  }
  .configuration-card,
  .launch-preview {
    padding: 22px 18px;
  }
  .preview-facts > div {
    padding: 12px 8px;
  }
  .preview-facts dt {
    font-size: 13px;
  }
  .preview-facts dd {
    font-size: 19px;
  }
  .type-coverage {
    font-size: 13px;
  }
  .launch-preview h2 {
    font-size: 25px;
  }
  select {
    font-size: 15px;
  }
  .text-action {
    margin-left: auto;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mode-card {
    transition: none;
  }
}
</style>
