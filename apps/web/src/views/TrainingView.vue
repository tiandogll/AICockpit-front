<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TrainingOverview from '../components/TrainingOverview.vue'
import TrainingTaskContent from '../components/TrainingTaskContent.vue'
import TrainingTaskReview from '../components/TrainingTaskReview.vue'
import TrainingLessons from '../components/TrainingLessons.vue'
import SelfStudyLibrary from '../components/SelfStudyLibrary.vue'
import {
  hasTrainingEvidence,
  hasTrainingTarget,
  LEARNING_GUIDANCE,
} from '../domain/learningGuidance'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  RefreshCw,
  Sprout,
} from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
import {
  createTrainingPlan,
  getTrainingPlan,
  getTrainingPlans,
  linkTrainingRetest,
  startTrainingRetest,
  submitTrainingTask,
  trainingUnavailableReason,
  type TrainingMutation,
  type TrainingPlan,
} from '../services/trainingApi'
import {
  dimensionLabels,
  formatWorkspaceDate,
  getWorkspaceReports,
  modeLabels,
  scenarioLabels,
  type ReportSummary,
} from '../services/workspaceApi'

const access = useAccessStore()
const auth = useAuthStore()
const features = useFeatureStore()
const route = useRoute()
const router = useRouter()
const requestedPlan = computed(() => (typeof route.query.plan === 'string' ? route.query.plan : ''))
const requestedReport = computed(() =>
  typeof route.query.report === 'string' ? route.query.report : '',
)
const requestedLearning = computed(() => {
  // A read-only catalog route follows the same no-mutation path as method links.
  if (route.query.view === 'library') return 'catalog'
  const code = route.query.learn
  return typeof code === 'string' && LEARNING_GUIDANCE.some((item) => item.code === code)
    ? code
    : undefined
})
const sourceWarning = ref('')
const enabled = computed(() => features.trainingEnabled)
const plans = ref<TrainingPlan[]>([])
const selected = ref<TrainingPlan | null>(null)
const reports = ref<ReportSummary[]>([])
const sourceId = ref('')
const replacementConfirmed = ref(false)
const offset = ref(0)
const total = ref(0)
const loading = ref(false)
const detailLoading = ref(false)
const saving = ref(false)
const error = ref('')
const detailError = ref('')
const writeError = ref('')
const notice = ref('')
const lastSavedTaskId = ref('')
const latestFeedback = computed(() =>
  selected.value?.privacy_redacted
    ? null
    : selected.value?.tasks.find(
        (task) => task.id === lastSavedTaskId.value && task.status === 'completed',
      ),
)
const draft = reactive({ response: '', application: '', verification: '', sessionId: '' })
let generation = 0
let detailGeneration = 0
// A same-user feature refresh temporarily denies new writes, but is not a
// change of training context. Keep drafts and in-flight idempotency keys intact.
let recordsContextStarted = false
const operationKeys = new Map<string, string>()
const automaticLinks = new Set<string>()
const source = computed(() => reports.value.find((report) => report.id === sourceId.value))
const trainingGoal = ref<'auto' | 'consolidate' | 'challenge'>('auto')
const sourceHasTarget = computed(() => hasTrainingEvidence(source.value?.dimensions ?? []))
const sourceHasWeakness = computed(() => hasTrainingTarget(source.value?.dimensions ?? []))
const suggestedGoal = computed(() =>
  trainingGoal.value === 'challenge'
    ? '进阶挑战'
    : trainingGoal.value === 'consolidate'
      ? '巩固训练'
      : sourceHasWeakness.value
        ? '针对提升'
        : '巩固训练',
)
const sourceEligibilityNote = computed(() => {
  if (!source.value || sourceHasTarget.value) return ''
  const measured = source.value.dimensions.filter(
    (row) => typeof row.index === 'number' && Number.isFinite(row.index) && row.index >= 0,
  )
  if (!measured.length)
    return '这份报告尚无可用于训练的维度证据。可以先阅读学习方法，不会强行生成短板计划。'
  return '当前维度的证据还不足两项，暂不生成个人计划。可先阅读通用资料，再通过测评补充证据。'
})
const replacement = ref<TrainingPlan | null>(null)
const replacementLoading = ref(false)
const replacementError = ref('')
let sourceGeneration = 0
const currentTask = computed(() => selected.value?.tasks.find((task) => task.status === 'pending'))
function openCurrentTask() {
  const panel = document.getElementById('current-training-task')
  panel?.scrollIntoView({ block: 'start' })
  panel?.focus({ preventScroll: true })
}
const kindLabels = {
  learning: '学习',
  exercise: '练习',
  application: '应用核验',
  retest: '同方案复测',
}
const taskIcons = {
  learning: BookOpen,
  exercise: ClipboardCheck,
  application: Check,
  retest: RefreshCw,
}
const canCreate = computed(() =>
  Boolean(
    !requestedLearning.value &&
    enabled.value &&
    access.ready &&
    !access.error &&
    source.value &&
    sourceHasTarget.value &&
    access.organizationId &&
    !saving.value &&
    !detailLoading.value &&
    !replacementLoading.value &&
    !replacementError.value &&
    !replacement.value?.privacy_redacted &&
    (!replacement.value || replacementConfirmed.value),
  ),
)
const candidates = computed(() =>
  reports.value.filter(
    (report) =>
      selected.value &&
      report.session_id !== selected.value.source_session_id &&
      (!access.singlePlatform ||
        !report.organization_id ||
        report.organization_id === selected.value.organization_id) &&
      report.mode === selected.value.assessment.mode &&
      report.scenario === selected.value.assessment.scenario &&
      report.completed_at &&
      new Date(report.completed_at) > new Date(selected.value.created_at),
  ),
)
const boundRetest = computed(() => selected.value?.retest ?? null)
const continuingRetest = computed(
  () => boundRetest.value?.status === 'active' && !boundRetest.value.expired,
)
const canStartRetest = computed(() =>
  Boolean(
    !requestedLearning.value &&
    enabled.value &&
    access.ready &&
    !access.error &&
    !saving.value &&
    !detailLoading.value &&
    selected.value?.retest_available &&
    !selected.value.privacy_redacted &&
    currentTask.value?.kind === 'retest' &&
    (!boundRetest.value || boundRetest.value.status === 'abandoned' || boundRetest.value.expired),
  ),
)
const canLinkRetest = computed(() =>
  Boolean(
    !boundRetest.value &&
    (selected.value?.retest_available ||
      selected.value?.retest_unavailable_reason === 'legacy_platform_baseline'),
  ),
)
const boundReportFinal = computed(() =>
  Boolean(
    boundRetest.value?.status === 'completed' &&
    boundRetest.value.report_id &&
    boundRetest.value.report_is_complete &&
    (boundRetest.value.report_status === 'complete' || boundRetest.value.report_status === null),
  ),
)
const comparison = computed(() =>
  selected.value?.status === 'completed' && !selected.value.privacy_redacted
    ? selected.value.comparison
    : null,
)
const comparisonRows = computed(
  () =>
    comparison.value?.dimensions.filter(
      (row) =>
        [row.before_index, row.after_index, row.change].every(Number.isFinite) &&
        row.before_index >= 0 &&
        row.before_index <= 100 &&
        row.after_index >= 0 &&
        row.after_index <= 100,
    ) ?? [],
)
const canSubmit = computed(() => {
  if (
    requestedLearning.value ||
    !enabled.value ||
    !access.ready ||
    access.error ||
    saving.value ||
    !currentTask.value ||
    selected.value?.privacy_redacted
  )
    return false
  if (currentTask.value.kind === 'retest')
    return Boolean(
      draft.sessionId &&
      canLinkRetest.value &&
      candidates.value.some((report) => report.session_id === draft.sessionId),
    )
  if (currentTask.value.kind === 'application')
    return draft.application.trim().length >= 30 && draft.verification.trim().length >= 30
  return draft.response.trim().length >= 20
})

function clearDraft() {
  lastSavedTaskId.value = ''
  draft.response = ''
  draft.application = ''
  draft.verification = ''
  draft.sessionId = ''
  writeError.value = ''
  notice.value = ''
}
function keyFor(operation: string, payload: unknown) {
  const identity = `${auth.user?.id ?? ''}:${access.organizationId}:${operation}:${JSON.stringify(payload)}`
  let key = operationKeys.get(identity)
  if (!key) {
    key = `training:${crypto.randomUUID()}`
    operationKeys.set(identity, key)
  }
  return key
}
async function loadReplacement() {
  const ticket = ++sourceGeneration
  const context = generation
  const previousReplacementId = replacement.value?.id
  replacement.value = null
  replacementError.value = ''
  replacementLoading.value = false
  if (requestedLearning.value || !sourceId.value || !enabled.value || !access.ready || access.error)
    return
  replacementLoading.value = true
  try {
    const page = await getTrainingPlans(access.organizationId, 1, 0, sourceId.value)
    if (ticket === sourceGeneration && context === generation && !requestedLearning.value) {
      replacement.value = page.items[0] ?? null
      // A confirmation applies to the plan the learner actually saw, not a
      // different plan created in another tab while status was refreshing.
      if (replacement.value?.id !== previousReplacementId) replacementConfirmed.value = false
    }
  } catch (cause) {
    if (ticket === sourceGeneration && context === generation)
      replacementError.value =
        cause instanceof Error ? cause.message : '无法确认此报告是否已有训练计划。'
  } finally {
    if (ticket === sourceGeneration && context === generation) replacementLoading.value = false
  }
}
async function choosePlan(id: string) {
  if (requestedLearning.value) return
  const ticket = ++detailGeneration
  const context = generation
  selected.value = null
  detailError.value = ''
  detailLoading.value = true
  saving.value = false
  clearDraft()
  try {
    const plan = await getTrainingPlan(id)
    if (ticket === detailGeneration && context === generation && !requestedLearning.value) {
      if (!access.singlePlatform && plan.organization_id !== access.organizationId)
        throw new Error('这份训练计划不属于当前组织，请切换到对应组织后重试。')
      selected.value = plan
    }
  } catch (cause) {
    if (ticket === detailGeneration && context === generation)
      detailError.value = cause instanceof Error ? cause.message : '无法读取这份训练计划。'
  } finally {
    if (ticket === detailGeneration && context === generation) detailLoading.value = false
  }
}
async function load() {
  recordsContextStarted = false
  const ticket = ++generation
  detailGeneration += 1
  sourceGeneration += 1
  replacement.value = null
  replacementError.value = ''
  replacementLoading.value = false
  plans.value = []
  selected.value = null
  reports.value = []
  sourceId.value = ''
  sourceWarning.value = ''
  total.value = 0
  error.value = ''
  detailError.value = ''
  loading.value = false
  detailLoading.value = false
  saving.value = false
  replacementConfirmed.value = false
  clearDraft()
  // A method-reading link must never load a plan or auto-link a completed retest.
  if (requestedLearning.value || !enabled.value || !access.ready || access.error) return
  recordsContextStarted = true
  loading.value = true
  try {
    const [page, reportPage] = await Promise.all([
      getTrainingPlans(access.organizationId, 20, offset.value),
      getWorkspaceReports({
        organization_id: access.organizationId,
        status: 'complete',
        limit: 100,
        offset: 0,
      }),
    ])
    if (ticket !== generation || requestedLearning.value) return
    plans.value = page.items
    total.value = page.total
    reports.value = reportPage.items
    if (requestedReport.value) {
      sourceId.value = reportPage.items.some((report) => report.id === requestedReport.value)
        ? requestedReport.value
        : ''
      if (!sourceId.value)
        sourceWarning.value =
          '指定报告不在最近 100 份可访问且已完成评分的报告中。请确认报告状态，或另选来源；不会自动替换为其他报告。'
    } else sourceId.value = reportPage.items[0]?.id ?? ''
    const initialPlan =
      page.items.find((plan) => plan.source_report_id === sourceId.value) ?? page.items[0]
    if (requestedPlan.value) await choosePlan(requestedPlan.value)
    else if (initialPlan) await choosePlan(initialPlan.id)
  } catch (cause) {
    if (ticket === generation)
      error.value = cause instanceof Error ? cause.message : '无法读取训练计划，请稍后重试。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function applyMutation(result: TrainingMutation, context: number, detail = detailGeneration) {
  if (
    requestedLearning.value ||
    context !== generation ||
    detail !== detailGeneration ||
    (features.ready && !enabled.value)
  )
    return
  const plan = result.replayed ? await getTrainingPlan(result.plan.id) : result.plan
  if (requestedLearning.value || context !== generation || detail !== detailGeneration) return
  const existingIndex = plans.value.findIndex((item) => item.id === plan.id)
  if (existingIndex >= 0) plans.value[existingIndex] = plan
  else {
    // A replay may already be included in the last server count. Read the list
    // instead of inventing a new total from the mutation response.
    const page = await getTrainingPlans(access.organizationId, 20, offset.value)
    if (requestedLearning.value || context !== generation || detail !== detailGeneration) return
    plans.value = page.items
    total.value = page.total
  }
  selected.value = plan
  clearDraft()
  notice.value = result.replayed ? '已确认先前保存的记录，并读取最新进度。' : '训练记录已保存。'
  return plan
}
function sameSelection(context: number, detail: number, planId: string) {
  return (
    context === generation &&
    detail === detailGeneration &&
    selected.value?.id === planId &&
    !requestedLearning.value &&
    // An already authorized request may finish during a status refresh. Only a
    // confirmed shutdown (or a changed scope above) makes its receipt stale.
    (!features.ready || enabled.value)
  )
}
async function launchRetest() {
  if (!canStartRetest.value || !selected.value) return
  const planId = selected.value.id
  const context = generation
  const detail = detailGeneration
  // A failed/lost response reuses this key; a known ended attempt gets a new one.
  const key = keyFor(`${planId}/retest/start`, {
    previous_session_id: boundRetest.value?.session_id ?? null,
  })
  saving.value = true
  writeError.value = ''
  try {
    const result = await startTrainingRetest(planId, key)
    if (!sameSelection(context, detail, planId)) return
    if (result.plan.id !== planId) throw new Error('复测计划响应不一致，请重新读取计划。')
    const plan = await applyMutation(result, context, detail)
    if (!sameSelection(context, detail, planId)) return
    if (plan?.retest?.status === 'active' && !plan.retest.expired)
      await router.push(`/assessment/${encodeURIComponent(plan.retest.session_id)}`)
  } catch (cause) {
    if (sameSelection(context, detail, planId))
      writeError.value =
        cause instanceof Error ? cause.message : '同方案复测未能开始，请保持计划不变后重试。'
  } finally {
    if (sameSelection(context, detail, planId)) saving.value = false
  }
}
async function finalizeBoundRetest() {
  if (
    requestedLearning.value ||
    !enabled.value ||
    !access.ready ||
    access.error ||
    saving.value ||
    !selected.value ||
    selected.value.privacy_redacted ||
    currentTask.value?.kind !== 'retest' ||
    !boundReportFinal.value
  )
    return
  const planId = selected.value.id
  const sessionId = boundRetest.value!.session_id
  const context = generation
  const detail = detailGeneration
  automaticLinks.add(`${planId}:${sessionId}`)
  saving.value = true
  writeError.value = ''
  try {
    const result = await linkTrainingRetest(
      planId,
      sessionId,
      keyFor(`${planId}/retest`, { session_id: sessionId }),
    )
    if (!sameSelection(context, detail, planId)) return
    if (result.plan.id !== planId) throw new Error('关联计划响应不一致，请重新读取计划。')
    await applyMutation(result, context, detail)
  } catch (cause) {
    if (sameSelection(context, detail, planId))
      writeError.value =
        cause instanceof Error ? cause.message : '定稿报告暂未关联，请重试；不会新建另一场测评。'
  } finally {
    if (sameSelection(context, detail, planId)) saving.value = false
  }
}
watch(
  () => [
    selected.value,
    boundReportFinal.value,
    currentTask.value?.kind,
    saving.value,
    detailLoading.value,
    enabled.value,
  ],
  () => {
    if (
      !selected.value ||
      !boundReportFinal.value ||
      detailLoading.value ||
      saving.value ||
      automaticLinks.has(`${selected.value.id}:${boundRetest.value!.session_id}`)
    )
      return
    void finalizeBoundRetest()
  },
)
async function createPlan() {
  if (!canCreate.value || !source.value) return
  const context = generation
  const detail = detailGeneration
  const payload = {
    goal: trainingGoal.value,
    organization_id: access.singlePlatform
      ? source.value.organization_id || access.organizationId
      : access.organizationId,
    source_report_id: source.value.id,
    expected_report_revision: source.value.revision,
    ...(replacement.value ? { replaces_plan_id: replacement.value.id } : {}),
  }
  saving.value = true
  writeError.value = ''
  notice.value = ''
  try {
    await applyMutation(
      await createTrainingPlan(payload, keyFor('create', payload)),
      context,
      detail,
    )
    if (context === generation && detail === detailGeneration) {
      replacementConfirmed.value = false
      await loadReplacement()
    }
  } catch (cause) {
    if (context === generation && detail === detailGeneration)
      writeError.value = cause instanceof Error ? cause.message : '训练计划未能生成。'
  } finally {
    if (context === generation && detail === detailGeneration) saving.value = false
  }
}
async function submitTask() {
  if (!canSubmit.value || !selected.value || !currentTask.value) return
  const context = generation
  const detail = detailGeneration
  const planId = selected.value.id
  const task = currentTask.value
  saving.value = true
  writeError.value = ''
  notice.value = ''
  try {
    let result: TrainingMutation
    if (task.kind === 'retest')
      result = await linkTrainingRetest(
        planId,
        draft.sessionId,
        keyFor(`${planId}/retest`, { session_id: draft.sessionId }),
      )
    else {
      const payload =
        task.kind === 'application'
          ? { application: draft.application.trim(), verification: draft.verification.trim() }
          : { response: draft.response.trim() }
      result = await submitTrainingTask(
        planId,
        task.id,
        payload,
        keyFor(`${planId}/${task.id}`, payload),
      )
    }
    await applyMutation(result, context, detail)
    if (sameSelection(context, detail, planId)) lastSavedTaskId.value = task.id
  } catch (cause) {
    if (sameSelection(context, detail, planId))
      writeError.value =
        cause instanceof Error ? cause.message : '训练记录未能保存，请保持内容不变后重试。'
  } finally {
    if (sameSelection(context, detail, planId)) saving.value = false
  }
}
function resetContext() {
  recordsContextStarted = false
  operationKeys.clear()
  automaticLinks.clear()
  if (offset.value) offset.value = 0
  else void load()
}
watch(
  () => [
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
    requestedReport.value,
    requestedPlan.value,
    requestedLearning.value,
  ],
  resetContext,
  { immediate: true, flush: 'sync' },
)
watch(
  () => [features.ready, enabled.value] as const,
  ([ready, available]) => {
    // Unknown/failed refreshes keep local state, while existing write guards
    // remain fail-closed. A verified disable still clears the private context.
    if (!ready) return
    if (!available) resetContext()
    else if (!recordsContextStarted) void load()
    // A report/list may have arrived while readiness blocked this read.
    else void loadReplacement()
  },
  { immediate: true, flush: 'sync' },
)
watch(offset, load, { flush: 'sync' })
watch(sourceId, () => {
  replacementConfirmed.value = false
  writeError.value = ''
  if (sourceId.value && sourceId.value !== requestedReport.value) sourceWarning.value = ''
  void loadReplacement()
})
function loadContext() {
  if (requestedLearning.value) return
  if (!access.ready && !access.error) void access.load()
  void features.load(true)
}
watch(requestedLearning, (code, previous) => {
  if (!code && previous) loadContext()
})
onMounted(loadContext)
onBeforeUnmount(() => {
  generation += 1
  detailGeneration += 1
  sourceGeneration += 1
})
</script>

<template>
  <div class="training-page">
    <header class="page-heading">
      <div>
        <p class="kicker">PERSONAL GROWTH PATH</p>
        <h1>{{ requestedLearning ? '通用学习资料' : '个人训练计划' }}</h1>
        <p>
          {{
            requestedLearning
              ? '先了解方法，再选择一个日常任务练习。阅读不会更改你的训练记录。'
              : '按顺序学习、练习和应用，再通过正式复测了解能力变化。'
          }}
        </p>
      </div>
      <RouterLink class="quiet-button" to="/reports"><FileText :size="16" />能力报告</RouterLink>
    </header>
    <nav class="training-tabs" aria-label="训练与资料">
      <RouterLink to="/training" :aria-current="!requestedLearning ? 'page' : undefined"
        >个人训练计划</RouterLink
      >
      <RouterLink to="/training?view=library" :aria-current="requestedLearning ? 'page' : undefined"
        >通用学习资料</RouterLink
      >
    </nav>
    <aside v-if="!selected && !requestedLearning" class="boundary-note">
      <Sprout :size="20" />
      <p>
        训练记录独立保存，不直接改变正式能力分数。训练内容为形成性指导，不替代正式测评与专家判断。
      </p>
    </aside>
    <template v-if="requestedLearning">
      <RouterLink class="quiet-button" data-testid="return-to-training" to="/training">
        <ChevronLeft :size="16" />返回训练计划
      </RouterLink>
      <SelfStudyLibrary id="self-study" :initial-code="requestedLearning" />
    </template>
    <section
      v-else-if="features.loading || (!features.ready && !features.error)"
      class="state-panel"
      role="status"
    >
      正在确认训练服务状态…
    </section>
    <section v-else-if="features.error" class="state-panel" role="alert">
      <p>{{ features.error }}</p>
      <button
        class="quiet-button"
        data-testid="retry-training-availability"
        @click="features.load(true)"
      >
        重试服务检查
      </button>
    </section>
    <template v-else-if="!enabled">
      <section class="service-note" role="status">
        <BookOpen :size="25" aria-hidden="true" />
        <div>
          <h2>训练记录保存尚未开放</h2>
          <p>
            训练服务尚未启用，暂不能生成或保存个人计划。下方学习方法可以直接阅读，不需要等待服务开放。
          </p>
        </div>
        <button
          class="quiet-button"
          data-testid="retry-training-availability"
          @click="features.load(true)"
        >
          <RefreshCw :size="16" />重新检查服务
        </button>
      </section>
      <SelfStudyLibrary id="self-study" :initial-code="requestedLearning" />
    </template>
    <div v-else-if="access.error" class="state-panel" role="alert">
      <p>{{ access.error }}</p>
      <button class="quiet-button" @click="access.load()">重新读取权限</button>
    </div>
    <div v-else-if="error" class="state-panel" role="alert">
      <p>{{ error }}</p>
      <button class="quiet-button" @click="load">重新加载</button>
    </div>
    <div v-else-if="loading || !access.ready" class="state-panel" role="status">
      正在读取你的训练记录…
    </div>
    <template v-else>
      <p v-if="!selected" class="revision-warning">
        形成性训练预览：材料由工程团队编写，尚未经专家审定。练习反馈是核验清单提示，不是 AI
        判分或能力等级结论。
      </p>
      <p v-if="writeError" class="feedback error" role="alert">{{ writeError }}</p>
      <p v-if="notice" class="feedback" role="status">{{ notice }}</p>
      <TrainingOverview
        v-if="selected && !detailLoading && !detailError"
        :plan="selected"
        @start="openCurrentTask"
      />
      <aside v-if="selected" class="boundary-note">
        <Sprout :size="20" />
        <p>
          形成性训练预览：材料由工程团队编写，尚未经专家审定。练习反馈是核验清单提示，不是 AI
          判分或能力等级结论。训练记录独立保存，不直接改变正式能力分数。
        </p>
      </aside>
      <div class="training-layout">
        <aside class="plan-rail">
          <section class="panel create-panel">
            <h2>从报告生成计划</h2>
            <p>
              选择已评分报告和训练目标，匹配有依据的练习。生成后保存进度，不会每次打开就换内容。
            </p>
            <p v-if="sourceWarning" class="revision-warning" role="status">{{ sourceWarning }}</p>
            <template v-if="reports.length"
              ><label class="field"
                >来源报告<select v-model="sourceId" data-testid="source-report" :disabled="saving">
                  <option value="">选择来源报告</option>
                  <option v-for="report in reports" :key="report.id" :value="report.id">
                    {{ report.name }} · {{ formatWorkspaceDate(report.completed_at) }}
                  </option>
                </select></label
              >
              <p class="small-note">显示最近 100 份已完成报告；证据条件由服务端校验。</p>
              <label class="field"
                >训练目标
                <select v-model="trainingGoal" data-testid="training-goal" :disabled="saving">
                  <option value="auto">智能匹配 · 优先提升，否则巩固</option>
                  <option value="consolidate">巩固训练 · 熟练应用已测能力</option>
                  <option value="challenge">进阶挑战 · 增加综合应用难度</option>
                </select>
              </label>
              <p v-if="sourceHasTarget" class="eligibility-note">
                本次将生成：{{ suggestedGoal }}。只依据有证据的维度，不把未测能力当作短板。
              </p>
              <p v-if="replacementLoading" class="small-note" role="status">
                正在确认该报告的最新训练计划…
              </p>
              <div v-if="replacementError" class="revision-warning" role="alert">
                <p>{{ replacementError }}</p>
                <button class="quiet-button" @click="loadReplacement">重试计划检查</button>
              </div>
              <p v-if="sourceEligibilityNote" class="eligibility-note" role="status">
                {{ sourceEligibilityNote }}
                <RouterLink to="/training?view=library" v-if="!selected"
                  >选择自主学习方向 <ArrowRight :size="14"
                /></RouterLink>
              </p>
              <label v-if="replacement && sourceHasTarget" class="confirmation"
                ><input
                  v-model="replacementConfirmed"
                  type="checkbox"
                  data-testid="confirm-replacement"
                  :disabled="saving"
                />我确认重新生成此报告的训练计划。旧计划和已提交记录将保留。</label
              ><button
                v-if="!source || sourceHasTarget"
                class="action-button"
                data-testid="create-plan"
                :disabled="!canCreate"
                @click="createPlan"
              >
                {{ saving ? '正在保存…' : replacement ? '重新生成计划' : '生成训练计划'
                }}<ArrowRight :size="15" />
              </button>
              <p v-if="!access.organizationId" class="small-note">
                {{
                  access.singlePlatform
                    ? '平台尚未初始化，请联系管理员。'
                    : '请先选择一个可访问的组织。'
                }}
              </p></template
            >
            <div v-else class="no-reports">
              <FileText :size="24" />
              <p>暂无已完成评分的报告。</p>
              <RouterLink class="text-link" to="/assessment"
                >先完成一次测评<ArrowRight :size="14"
              /></RouterLink>
            </div>
          </section>
          <section class="panel saved-plans">
            <header>
              <h2>已保存计划</h2>
              <span>{{ total }} 份</span>
            </header>
            <p v-if="!plans.length" class="small-note">尚未生成训练计划。</p>
            <button
              v-for="plan in plans"
              :key="plan.id"
              class="plan-button"
              :class="{ selected: plan.id === selected?.id }"
              :disabled="saving || detailLoading"
              @click="choosePlan(plan.id)"
            >
              <strong>{{
                plan.dimensions
                  .map((dimension) => dimensionLabels[dimension.code] || dimension.code)
                  .join(' · ')
              }}</strong
              ><span>{{ formatWorkspaceDate(plan.created_at) }}</span
              ><small
                >已完成 {{ plan.completed_tasks }} / {{ plan.total_tasks }} 项{{
                  plan.status === 'completed' ? ' · 计划完成' : ''
                }}</small
              >
            </button>
            <nav v-if="total > 20" class="plan-pages" aria-label="训练计划分页">
              <button
                class="quiet-button"
                :disabled="offset === 0 || saving"
                aria-label="上一页"
                @click="offset = Math.max(0, offset - 20)"
              >
                <ChevronLeft :size="15" /></button
              ><span>{{ Math.floor(offset / 20) + 1 }} / {{ Math.ceil(total / 20) }}</span
              ><button
                class="quiet-button"
                :disabled="offset + 20 >= total || saving"
                aria-label="下一页"
                @click="offset += 20"
              >
                <ChevronRight :size="15" />
              </button>
            </nav>
          </section>
        </aside>
        <div class="plan-detail">
          <div v-if="detailLoading" class="state-panel" role="status">正在读取计划详情…</div>
          <div v-else-if="detailError" class="state-panel" role="alert">
            <p>{{ detailError }}</p>
            <button v-if="requestedPlan" class="quiet-button" @click="choosePlan(requestedPlan)">
              重试指定计划
            </button>
            <p>也可选择左侧可访问计划，不会自动替换指定记录。</p>
          </div>
          <section v-else-if="!selected" class="panel personal-empty">
            <p class="kicker">YOUR NEXT STEP</p>
            <h2>
              {{ sourceHasTarget ? `从这份报告开始${suggestedGoal}` : '你的个人计划还未生成' }}
            </h2>
            <p>这里展示根据你的报告生成并保存的计划，不是所有人共用的学习目录。</p>
            <ol>
              <li>
                <strong>确认来源</strong
                ><span>{{ source?.name || '先完成测评，获得有证据的能力报告' }}</span>
              </li>
              <li>
                <strong>匹配练习</strong
                ><span>结合已测能力、客观题错题线索、场景及已完成练习选择内容。</span>
              </li>
              <li>
                <strong>记录与复测</strong
                ><span>保留练习和核验记录，通过正式复测观察变化，不因做完训练直接加分。</span>
              </li>
            </ol>
            <button
              class="action-button"
              data-testid="generate-personal-plan"
              :disabled="!canCreate"
              @click="createPlan"
            >
              {{ saving ? '正在生成…' : `生成${suggestedGoal}计划` }}<ArrowRight :size="16" />
            </button>
            <p v-if="sourceEligibilityNote">{{ sourceEligibilityNote }}</p>
            <RouterLink class="text-link" to="/training?view=library"
              >只想先了解方法？浏览通用学习资料<ArrowRight :size="15"
            /></RouterLink>
          </section>
          <template v-else>
            <section class="panel plan-summary">
              <header>
                <div>
                  <p class="kicker">
                    {{ modeLabels[selected.assessment.mode] || selected.assessment.mode }} ·
                    {{
                      scenarioLabels[selected.assessment.scenario] || selected.assessment.scenario
                    }}
                  </p>
                  <h2>
                    {{
                      selected.dimensions
                        .map((dimension) => dimensionLabels[dimension.code] || dimension.code)
                        .join('与')
                    }}训练计划
                  </h2>
                </div>
                <span class="status-badge">{{
                  selected.status === 'completed' ? '计划完成' : '进行中'
                }}</span>
              </header>
              <div class="plan-meta">
                <span>已完成 {{ selected.completed_tasks }} / {{ selected.total_tasks }} 项</span
                ><RouterLink class="text-link" :to="`/reports/${selected.source_session_id}`"
                  >来源报告 · 修订 {{ selected.source_report_revision }}<ArrowRight :size="14"
                /></RouterLink>
              </div>
              <p class="provenance">{{ selected.content_provenance }}</p>
              <section
                v-if="selected.generation_basis && !selected.privacy_redacted"
                class="generation-basis"
                data-testid="generation-basis"
              >
                <h3>为什么给你这份计划 · {{ selected.generation_basis.goal_label }}</h3>
                <p>{{ selected.generation_basis.method }}</p>
                <div
                  v-for="target in selected.generation_basis.targets"
                  :key="target.code"
                  class="basis-target"
                >
                  <strong
                    >{{ dimensionLabels[target.code] || target.code }} · 指数 {{ target.index }} ·
                    {{ target.evidence_count }} 项证据</strong
                  >
                  <p>{{ target.reason }}</p>
                  <p v-if="target.objective_count">
                    客观题 {{ target.objective_count }} 道，其中
                    {{ target.incorrect_count }} 道未答对<span
                      v-if="target.question_sequences.length"
                      >：来源测评第 {{ target.question_sequences.join('、') }} 题</span
                    >。
                  </p>
                  <p v-if="target.focus_labels.length">
                    相关题目考查点：{{
                      target.focus_labels.join('、')
                    }}。这是练习选择线索，不推断你的错误动机。
                  </p>
                </div>
                <p>
                  参考最近
                  {{
                    selected.generation_basis.completed_exercises
                  }}
                  项已完成情境练习，优先选择未练材料。{{
                    selected.generation_basis.material_revisited
                      ? '当前候选材料已练过，本次结合目标再次应用。'
                      : '本次使用尚未完成的练习材料。'
                  }}
                </p>
              </section>
              <p v-if="selected.source_report_changed" class="revision-warning">
                来源报告已更新。当前训练仍保留原修订快照，不会自动覆盖；需要时请确认重新生成。
              </p>
              <ol class="task-steps">
                <li
                  v-for="task in selected.tasks"
                  :key="task.id"
                  :class="{
                    completed: task.status === 'completed',
                    current: task.id === currentTask?.id,
                  }"
                >
                  <span
                    ><Check v-if="task.status === 'completed'" :size="15" /><component
                      :is="taskIcons[task.kind]"
                      v-else
                      :size="15" /></span
                  ><strong>{{ kindLabels[task.kind] }}</strong
                  ><small>{{
                    task.status === 'completed'
                      ? '已完成'
                      : task.id === currentTask?.id
                        ? '当前任务'
                        : '待前项完成'
                  }}</small>
                </li>
              </ol>
            </section>
            <section
              v-if="latestFeedback?.feedback"
              class="panel latest-feedback"
              data-testid="latest-training-feedback"
              aria-label="刚刚保存的任务反馈"
            >
              <header>
                <h2>
                  {{
                    latestFeedback.content.feedback_mode === 'local_checklist_v2'
                      ? '本次规则自查反馈'
                      : '本次保存反馈'
                  }}
                </h2>
                <button type="button" @click="lastSavedTaskId = ''">收起反馈</button>
              </header>
              <p class="small-note">
                {{ latestFeedback.title }} · 记录已保存；未调用大模型，不代表能力已经提升。
              </p>
              <p class="feedback-copy">{{ latestFeedback.feedback }}</p>
              <button
                v-if="currentTask"
                type="button"
                class="button button-secondary"
                @click="openCurrentTask"
              >
                前往下一项：{{ currentTask.title }} <ArrowRight :size="16" />
              </button>
            </section>
            <section v-if="selected.privacy_redacted" class="panel revision-warning" role="status">
              <h2>训练记录已进行隐私处理</h2>
              <p>
                证据内容已移除，这份记录不能继续提交或重新生成。已有状态仅用于保留必要的审计信息。
              </p>
            </section>
            <section
              v-else-if="currentTask"
              id="current-training-task"
              tabindex="-1"
              class="panel task-panel"
            >
              <p class="kicker">
                {{ kindLabels[currentTask.kind] }} · 第 {{ currentTask.sequence }} 项
              </p>
              <h2>{{ currentTask.title }}</h2>
              <TrainingTaskContent :task="currentTask" />
              <details v-if="currentTask.supplemental_lessons?.length" class="training-supplement">
                <summary>补充学习材料 · 新版案例与方法</summary>
                <p class="small-note">以下为后来补充的阅读，不替换原任务，也不改写原有记录。</p>
                <TrainingLessons :lessons="currentTask.supplemental_lessons" />
              </details>
              <form data-testid="submit-task" @submit.prevent="submitTask">
                <template v-if="currentTask.kind === 'learning' || currentTask.kind === 'exercise'"
                  ><label class="field"
                    >{{ currentTask.kind === 'learning' ? '记录你的理解' : '写下练习过程与结论'
                    }}<textarea
                      v-model="draft.response"
                      data-testid="task-response"
                      rows="6"
                      minlength="20"
                      maxlength="4000"
                      required
                      :disabled="saving"
                      :placeholder="currentTask.content.response_outline"
                    />
                  </label>
                  <p class="small-note">
                    至少 20 字，最多 4000 字。请勿填写个人敏感信息。
                  </p></template
                ><template v-else-if="currentTask.kind === 'application'"
                  ><label class="field"
                    >应用过程<textarea
                      v-model="draft.application"
                      data-testid="application-record"
                      rows="5"
                      minlength="30"
                      maxlength="4000"
                      required
                      :disabled="saving"
                      :placeholder="currentTask.content.response_outline"
                    /></label
                  ><label class="field"
                    >核验依据与结果<textarea
                      v-model="draft.verification"
                      data-testid="verification-record"
                      rows="5"
                      minlength="30"
                      maxlength="4000"
                      required
                      :disabled="saving"
                      :placeholder="currentTask.content.verification_outline"
                    />
                  </label>
                  <p class="small-note">
                    两项各至少 30 字，最多 4000 字。练习材料不会自动成为正式评分证据。
                  </p></template
                ><template v-else>
                  <p class="retest-note">
                    同方案复测使用本计划冻结的模式、场景和题卷版本，无需重新选卷。完成后等待报告定稿，再关联真实结果。
                  </p>
                  <p
                    v-if="
                      !boundRetest &&
                      selected.retest_unavailable_reason === 'legacy_platform_baseline'
                    "
                    class="retest-note"
                  >
                    已有兼容复测记录仍可关联：迁移前已开始的测评完成评分后，可选择其报告。服务端仍校验原口径、题卷版本与任务时间，不将新平台的不同口径成绩当成可比复测。
                  </p>
                  <p v-if="!selected.retest_available" class="revision-warning" role="status">
                    {{ trainingUnavailableReason(selected.retest_unavailable_reason) }}
                  </p>
                  <template v-if="continuingRetest">
                    <p v-if="boundRetest?.paused" class="small-note">
                      本次复测已暂存，进入后明确继续即可；限时规则不变。
                    </p>
                    <RouterLink
                      data-testid="continue-retest"
                      class="quiet-button"
                      :to="`/assessment/${encodeURIComponent(boundRetest!.session_id)}`"
                      >继续同方案复测<ArrowRight :size="15"
                    /></RouterLink>
                  </template>
                  <template v-else-if="boundRetest?.status === 'completed'">
                    <p role="status" class="retest-note">
                      {{
                        boundReportFinal
                          ? saving
                            ? '报告已定稿，正在关联本计划…'
                            : '报告已定稿，等待确认关联结果。'
                          : boundRetest.report_status === 'needs_review'
                            ? '等待人工复核；本次复测已封存，无需重新作答。'
                            : '等待评分定稿；本次复测已封存，无需重新作答。'
                      }}
                    </p>
                    <RouterLink
                      v-if="boundRetest.report_id"
                      data-testid="bound-retest-report"
                      class="quiet-button"
                      :to="`/reports/${encodeURIComponent(boundRetest.session_id)}`"
                      >查看本次复测报告<ArrowRight :size="15"
                    /></RouterLink>
                    <button
                      type="button"
                      class="quiet-button"
                      data-testid="refresh-retest"
                      :disabled="saving"
                      @click="choosePlan(selected.id)"
                    >
                      刷新复测状态
                    </button>
                    <button
                      v-if="boundReportFinal && !saving"
                      type="button"
                      class="quiet-button"
                      data-testid="retry-link-retest"
                      @click="finalizeBoundRetest"
                    >
                      重试关联定稿报告
                    </button>
                  </template>
                  <template v-else>
                    <p v-if="boundRetest" class="small-note">
                      {{
                        boundRetest.expired ? '上次复测已超时' : '上次复测已提前结束'
                      }}，原记录保留，不作为能力变化依据。
                    </p>
                    <button
                      v-if="selected.retest_available"
                      type="button"
                      class="quiet-button"
                      data-testid="start-retest"
                      :disabled="!canStartRetest"
                      @click="launchRetest"
                    >
                      {{
                        saving
                          ? '正在确认复测…'
                          : boundRetest
                            ? '重新开始同方案复测'
                            : '开始同方案复测'
                      }}<ArrowRight :size="15" />
                    </button>
                  </template>
                  <label v-if="canLinkRetest" class="field"
                    >关联已有兼容复测（历史记录）<select
                      v-model="draft.sessionId"
                      data-testid="manual-retest"
                      :disabled="saving"
                      required
                    >
                      <option value="">选择已完成的正式测评</option>
                      <option
                        v-for="report in candidates"
                        :key="report.id"
                        :value="report.session_id"
                      >
                        {{ report.name }} · {{ formatWorkspaceDate(report.completed_at) }}
                      </option>
                    </select></label
                  >
                  <p v-if="canLinkRetest && !candidates.length" class="small-note">
                    当前最近 100 份报告中暂无候选复测。完成后请重新加载页面。
                  </p></template
                ><button
                  v-if="currentTask.kind !== 'retest' || !boundRetest"
                  class="action-button"
                  type="submit"
                  :disabled="!canSubmit"
                >
                  {{
                    saving
                      ? '正在保存…'
                      : currentTask.kind === 'retest'
                        ? '关联正式复测'
                        : '保存并继续下一项'
                  }}<ArrowRight :size="15" />
                </button>
                <p v-if="currentTask.kind !== 'retest' || !boundRetest" class="small-note">
                  提交完成后该任务记录不可修改，请检查内容后再保存。
                </p>
              </form>
            </section>
            <section v-else class="panel completed-panel">
              <span class="complete-mark"><Check :size="28" /></span>
              <h2>本次训练计划已完成</h2>
              <p>练习完成不等于能力分数提升，请以关联的正式复测报告为准。</p>
              <RouterLink
                v-if="selected.tasks.find((task) => task.kind === 'retest')?.submission?.session_id"
                class="text-link"
                :to="`/reports/${selected.tasks.find((task) => task.kind === 'retest')?.submission?.session_id}`"
                >查看复测报告<ArrowRight :size="15"
              /></RouterLink>
            </section>
            <section
              v-if="comparison"
              class="panel comparison-panel"
              data-testid="training-comparison"
              aria-label="本计划同口径前后对比"
            >
              <h2>本计划的同口径前后对比</h2>
              <p>
                来源报告 · 修订 {{ comparison.source_report_revision }} → 复测报告 · 修订
                {{ comparison.retest_report_revision }}
              </p>
              <table v-if="comparisonRows.length">
                <caption class="small-note">
                  已关联定稿报告的真实证据指数；仅比较本计划的目标维度。
                </caption>
                <thead>
                  <tr>
                    <th scope="col">维度</th>
                    <th scope="col">训练前</th>
                    <th scope="col">复测</th>
                    <th scope="col">指数变化</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in comparisonRows" :key="row.code">
                    <th scope="row">{{ dimensionLabels[row.code] ?? row.code }}</th>
                    <td>{{ row.before_index.toFixed(1) }}</td>
                    <td>{{ row.after_index.toFixed(1) }}</td>
                    <td>{{ row.change > 0 ? '+' : '' }}{{ row.change.toFixed(1) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-else>当前没有证据充分的可比维度，不计算指数变化。</p>
              <p class="small-note">
                这是两次测量观察到的差异，不代表训练的因果效果，也不等于综合能力涨分。训练记录不计入正式成绩。
              </p>
            </section>
            <p
              v-else-if="selected.status === 'completed' && !selected.privacy_redacted"
              class="panel small-note"
              data-testid="training-comparison-unavailable"
              role="status"
            >
              当前记录不满足同口径对比条件，暂不计算指数变化；可查看复测报告。
            </p>
            <section
              v-if="
                !selected.privacy_redacted &&
                selected.tasks.some((task) => task.status === 'completed')
              "
              class="panel completed-records"
            >
              <h2>已完成记录</h2>
              <details
                v-for="task in selected.tasks.filter((task) => task.status === 'completed')"
                :key="task.id"
              >
                <summary>
                  <span>{{ task.title }}</span
                  ><small>{{ formatWorkspaceDate(task.completed_at) }}</small>
                </summary>
                <TrainingTaskReview :task="task" />
              </details>
            </section>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.training-tabs {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 20px 0;
  border-bottom: 1px solid var(--line);
}
.training-tabs a {
  min-height: 44px;
  padding: 12px 18px;
  color: var(--muted);
  border-bottom: 3px solid transparent;
  text-decoration: none;
}
.training-tabs a[aria-current='page'] {
  color: var(--signal-dark);
  border-bottom-color: var(--signal-dark);
  font-weight: 700;
}
.personal-empty h2 {
  margin: 14px 0;
}
.personal-empty p,
.generation-basis p {
  line-height: 1.8;
}
.personal-empty ol {
  padding: 0;
  list-style: none;
  margin: 28px 0;
}
.personal-empty li {
  display: grid;
  gap: 8px;
  padding: 18px 0;
  border-bottom: 1px solid var(--line);
}
.personal-empty li span {
  color: var(--muted);
  line-height: 1.7;
}
.personal-empty .text-link {
  display: flex;
  margin-top: 24px;
}
.generation-basis {
  margin: 24px 0;
  padding: 20px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}
.generation-basis h3 {
  margin: 0 0 12px;
}
.basis-target {
  border-top: 1px solid var(--line);
  padding-top: 14px;
  margin-top: 14px;
}
.service-note {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 20px 24px;
  border: 1px solid #cee4ea;
  border-radius: 12px;
  background: #f1fbfd;
}
.service-note > svg,
.service-note > button {
  flex: none;
}
.service-note > div {
  flex: 1;
}
.service-note h2 {
  font-size: 18px;
  margin: 0 0 6px;
}
.service-note p {
  font-size: 14px;
  line-height: 1.8;
  color: #607b8b;
  margin: 0;
}
.eligibility-note {
  padding: 12px 14px;
  background: #f1fbfd;
  border-radius: 8px;
  color: #376779;
  line-height: 1.8;
  font-size: 13px;
}
.eligibility-note a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  color: #137f91;
}
#self-study {
  scroll-margin-top: 100px;
}
@media (max-width: 600px) {
  .service-note {
    flex-wrap: wrap;
    align-items: flex-start;
    padding: 18px;
  }
  .service-note > div {
    min-width: 180px;
  }
  .service-note > button {
    width: 100%;
  }
}
.latest-feedback {
  border-left: 3px solid #007b95;
}
.latest-feedback header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}
.latest-feedback header button {
  background: none;
  border: 0;
  color: #007b95;
  cursor: pointer;
  white-space: nowrap;
}
.feedback-copy {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.9;
}
.training-supplement {
  margin: 20px 0;
  border-top: 1px solid #bde8f1;
  padding-top: 16px;
}
.training-supplement summary {
  color: #007b95;
  cursor: pointer;
  padding: 8px 0;
  font-weight: 700;
}
.training-supplement summary:focus-visible,
.latest-feedback button:focus-visible {
  outline: 2px solid #007b95;
  outline-offset: 3px;
}
.training-page {
  color: #183b46;
  font-size: 15px;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}
.kicker {
  color: #137f91;
  font-size: 12px;
  font-weight: 700;
}
.page-heading h1 {
  font-size: 28px;
  margin: 5px 0 8px;
  letter-spacing: -0.035em;
}
.page-heading p:last-child {
  font-size: 13px;
  color: #5d727a;
}
.action-button,
.quiet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 42px;
  padding: 9px 14px;
  border-radius: 9px;
  border: 1px solid transparent;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.action-button {
  background: #137f91;
  color: #fff;
}
.quiet-button {
  background: #fff;
  color: #183b46;
  border-color: #dce7eb;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.boundary-note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 15px 18px;
  margin-bottom: 24px;
  border-radius: 10px;
  background: #eaf5f7;
  color: #466570;
  font-size: 12px;
}
.boundary-note svg {
  flex: none;
  color: #137f91;
}
.training-layout {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.panel {
  padding: 24px;
  background: #fff;
  border: 1px solid #e3edf0;
  border-radius: 15px;
  min-width: 0;
}
.panel h2 {
  font-size: 18px;
  line-height: 1.5;
}
.comparison-panel table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 13px;
}
.comparison-panel th,
.comparison-panel td {
  text-align: left;
  padding: 10px 6px;
  border-bottom: 1px solid #e3edf0;
  overflow-wrap: anywhere;
}
.comparison-panel caption {
  text-align: left;
  margin-bottom: 8px;
}
.plan-rail,
.plan-detail {
  display: grid;
  gap: 20px;
  min-width: 0;
}
.create-panel > p {
  font-size: 13px;
  color: #5d727a;
  margin-top: 12px;
  line-height: 1.8;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 20px;
  font-size: 13px;
  color: #183b46;
  font-weight: 600;
}
.field select,
.field textarea {
  display: block;
  width: 100%;
  padding: 10px 11px;
  border: 1px solid #dce7eb;
  border-radius: 8px;
  background: #fff;
  color: #183b46;
  font-size: 13px;
  font-weight: 400;
  line-height: 1.8;
}
.field select {
  min-height: 42px;
}
.field textarea {
  resize: vertical;
  min-height: 120px;
}
.small-note {
  font-size: 12px;
  color: #5d727a;
  line-height: 1.8;
  margin-top: 10px;
}
.confirmation {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 18px;
  font-size: 12px;
  color: #8b652e;
  line-height: 1.8;
}
.confirmation input {
  margin-top: 5px;
  flex: none;
  width: 15px;
  height: 15px;
  accent-color: #137f91;
}
.create-panel > .action-button {
  width: 100%;
  margin-top: 18px;
}
.saved-plans > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.saved-plans > header > span {
  font-size: 12px;
  color: #5d727a;
}
.plan-button {
  display: block;
  width: 100%;
  padding: 13px;
  text-align: left;
  border: 1px solid #e5edef;
  border-radius: 9px;
  margin-top: 10px;
  background: #fff;
  cursor: pointer;
}
.plan-button.selected {
  border-color: #9dcbd2;
  background: #f0f8f9;
}
.plan-button strong {
  display: block;
  font-size: 13px;
  color: #183b46;
  font-weight: 600;
  line-height: 1.8;
}
.plan-button span,
.plan-button small {
  display: block;
  font-size: 12px;
  color: #5d727a;
  margin-top: 4px;
}
.plan-button small {
  color: #137f91;
}
.plan-pages {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  font-size: 12px;
  color: #5d727a;
}
.plan-pages .quiet-button {
  padding: 8px;
}
.plan-summary > header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
}
.plan-summary h2 {
  margin-top: 7px;
  font-size: 21px;
}
.status-badge {
  padding: 4px 10px;
  background: #edf7f3;
  color: #287765;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
}
.plan-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 24px;
  font-size: 13px;
  color: #5d727a;
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #137f91;
}
.provenance {
  font-size: 12px;
  color: #5d727a;
  line-height: 1.8;
  border-top: 1px solid #edf2f4;
  padding-top: 14px;
  margin-top: 18px;
}
.revision-warning {
  font-size: 12px;
  color: #916b2d;
  background: #fff8ec;
  border: 1px solid #f1e3c5;
  border-radius: 8px;
  padding: 12px;
  margin-top: 14px;
  line-height: 1.8;
}
.task-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  list-style: none;
  padding: 0;
  margin: 23px 0 0;
}
.task-steps li {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 7px;
  text-align: center;
  padding: 14px 4px;
  background: #f7f9fa;
  border-radius: 8px;
  color: #7b8e95;
}
.task-steps li > span {
  display: grid;
  place-items: center;
  width: 29px;
  height: 29px;
  background: #eaf0f2;
  border-radius: 50%;
  color: #8ba1a9;
}
.task-steps strong,
.task-steps small {
  font-size: 12px;
  font-weight: 500;
}
.task-steps li.current {
  background: #eaf5f7;
  color: #137f91;
}
.task-steps li.current > span {
  background: #137f91;
  color: #fff;
}
.task-steps li.completed > span {
  background: #e0f1ea;
  color: #287765;
}
.task-panel h2 {
  font-size: 21px;
  margin-top: 6px;
}
.instructions {
  font-size: 14px;
  color: #5d727a;
  margin: 14px 0 18px;
  line-height: 1.9;
}
.material {
  font-size: 14px;
  line-height: 1.95;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  padding: 18px;
  background: #f5f9fa;
  border-left: 3px solid #abd3da;
  border-radius: 0 8px 8px 0;
  margin-top: 12px;
}
.checklist {
  padding-left: 22px;
  margin-top: 18px;
  color: #5d727a;
  font-size: 13px;
  line-height: 2;
}
.task-panel form > .action-button {
  margin-top: 22px;
}
.retest-note {
  font-size: 13px;
  line-height: 1.9;
  color: #5d727a;
  margin: 15px 0;
}
.feedback {
  padding: 14px 18px;
  margin-bottom: 20px;
  border-radius: 9px;
  background: #edf7f3;
  color: #287765;
  font-size: 13px;
  line-height: 1.8;
}
.feedback.error {
  background: #fff3ed;
  color: #9a4e36;
}
.state-panel {
  display: grid;
  justify-items: start;
  gap: 15px;
  padding: 34px;
  border: 1px solid #e3edf0;
  border-radius: 14px;
  background: #fff;
  color: #5d727a;
}
.state-panel[role='alert'] {
  color: #9a4e36;
}
.empty-state {
  justify-items: center;
  text-align: center;
  padding: 65px 26px;
}
.empty-state > svg {
  color: #137f91;
}
.empty-state h2 {
  color: #183b46;
  font-size: 19px;
}
.empty-state p {
  font-size: 13px;
  max-width: 530px;
  line-height: 1.9;
}
.no-reports {
  display: grid;
  gap: 12px;
  margin-top: 20px;
  font-size: 13px;
  color: #5d727a;
}
.no-reports svg {
  color: #137f91;
}
.completed-panel {
  text-align: center;
  display: grid;
  justify-items: center;
  gap: 15px;
}
.complete-mark {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #e9f5ef;
  color: #287765;
}
.completed-panel p {
  font-size: 13px;
  color: #5d727a;
}
.completed-records details {
  padding-top: 17px;
  margin-top: 17px;
  border-top: 1px solid #e8eff1;
}
.completed-records summary {
  cursor: pointer;
  line-height: 1.8;
  font-size: 14px;
}
.completed-records summary small {
  display: block;
  font-size: 12px;
  color: #5d727a;
  margin: 5px 0;
}
.completed-records h3 {
  font-size: 13px;
  margin-top: 15px;
}
.submitted-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.9;
  color: #5d727a;
  margin-top: 12px;
}
.formative-feedback {
  padding: 12px 14px;
  margin-top: 14px;
  border-radius: 8px;
  background: #edf7f3;
  color: #386b5c;
  font-size: 13px;
  line-height: 1.9;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible {
  outline: 3px solid #137f9160;
  outline-offset: 3px;
}
@media (max-width: 1150px) {
  .training-layout {
    grid-template-columns: 260px minmax(0, 1fr);
    gap: 18px;
  }
  .panel {
    padding: 20px;
  }
  .plan-summary h2 {
    font-size: 18px;
  }
  .task-steps {
    gap: 5px;
  }
  .task-steps small {
    font-size: 12px;
  }
}
@media (max-width: 850px) {
  .training-layout {
    grid-template-columns: 1fr;
  }
  .plan-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .page-heading {
    align-items: flex-start;
  }
  .plan-meta {
    align-items: flex-start;
  }
}
@media (max-width: 580px) {
  .page-heading {
    flex-direction: column;
    gap: 16px;
  }
  .page-heading h1 {
    font-size: 25px;
  }
  .plan-rail {
    grid-template-columns: 1fr;
  }
  .panel {
    padding: 20px 16px;
  }
  .task-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .task-steps li {
    padding: 12px 7px;
  }
  .plan-summary > header {
    flex-direction: column;
  }
  .boundary-note {
    padding: 15px;
  }
  .empty-state {
    padding: 45px 20px;
  }
}
</style>
<style scoped>
.training-page {
  color: #073b59;
}
.page-heading {
  margin-bottom: 2px;
}
.page-heading h1 {
  line-height: 1.25;
  margin: 5px 0 4px;
}
.page-heading h1 {
  font-size: 32px;
  color: #073b59;
}
.page-heading .kicker {
  font-size: 12px;
  letter-spacing: 1px;
  color: #6683a3;
}
.boundary-note {
  background: #f1fbfd;
  border-color: #bde8f1;
  padding: 10px 16px;
  margin-bottom: 12px;
  font-size: 12px;
}
.training-page > .revision-warning {
  font-size: 12px;
  padding: 8px 12px;
}
.training-layout {
  grid-template-columns: minmax(0, 1fr) 310px;
  align-items: start;
}
.plan-rail {
  grid-column: 2;
  grid-row: 1;
}
.plan-detail {
  grid-column: 1;
  grid-row: 1;
}
.panel {
  border-color: #bde8f1;
  border-radius: 12px;
  box-shadow: none;
}
.task-panel {
  scroll-margin-top: 110px;
}
.plan-summary {
  background: #f2fbfd;
}
.plan-summary .task-steps {
  display: none;
}
@media (max-width: 1000px) {
  .training-layout {
    grid-template-columns: 1fr;
  }
  .plan-rail,
  .plan-detail {
    grid-column: auto;
    grid-row: auto;
  }
  .plan-detail {
    order: -1;
  }
}
@media (max-width: 560px) {
  .page-heading h1 {
    font-size: 28px;
  }
}
</style>
