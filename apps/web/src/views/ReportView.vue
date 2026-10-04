<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, X, ChevronRight, Check } from '@lucide/vue'
import SixDimensionChart from '../components/SixDimensionChart.vue'
import ReportEvidencePanel from '../components/ReportEvidencePanel.vue'
import AssessmentOriginNotice from '../components/AssessmentOriginNotice.vue'
import { DIMENSIONS, LEVEL_NAMES, MODE_NAMES, SCENARIO_NAMES } from '../domain/capabilities'
import { hasTrainingEvidence, LEARNING_GUIDANCE } from '../domain/learningGuidance'
import {
  downloadReportPdf,
  getReport,
  type DimensionReport,
  type TrustedReport,
} from '../services/reportApi'
import { getAssessmentSession, type AssessmentSession } from '../services/assessmentApi'
import { getTrainingPlans, type TrainingPlan } from '../services/trainingApi'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
const route = useRoute(),
  auth = useAuthStore(),
  features = useFeatureStore()
const report = ref<TrustedReport | null>(null),
  session = ref<AssessmentSession | null>(null)
const loading = ref(true),
  error = ref(''),
  exportError = ref(''),
  exporting = ref(false)
const metadataError = ref(''),
  trainingError = ref(''),
  trainingLoading = ref(false),
  plan = ref<TrainingPlan | null>(null)
const shareDialog = ref<HTMLDialogElement | null>(null),
  adviceDialog = ref<HTMLDialogElement | null>(null)
const shareFile = ref<File | null>(null),
  shareNotice = ref('')
const refreshing = ref(false),
  refreshNotice = ref('')
const statusCopy = {
  complete: {
    label: '可信评分完成',
    note: '已有证据已完成评分；未覆盖维度仍显示证据不足，不代表完整常模。',
  },
  needs_review: {
    label: '等待人工复核',
    note: '当前报告尚未定稿；模型建议不作为最终分。请等待评审人员复核，无需重复测评，可稍后刷新查看。',
  },
  pending: {
    label: '评分处理中',
    note: '回答已保存，尚未裁决的回答不计入最终分。页面会自动读取最新状态，无需重复提交。',
  },
  retrying: {
    label: '评分暂未成功',
    note: '部分评分任务暂未成功，回答已保存，系统将按重试策略继续处理。当前报告尚未定稿，无需重复测评。',
  },
  paused: {
    label: '自动评分已暂停',
    note: '自动评分服务当前未开启，回答已保存，当前报告尚未定稿。请联系管理员确认服务状态，或稍后刷新查看。',
  },
  blocked: {
    label: '评分配置异常',
    note: '部分开放题缺少已发布的评分量规，请联系管理员。已提交回答已封存，当前报告尚未定稿，不代表最终能力结论。',
  },
}
const reportFinal = computed(() => {
  const value = report.value
  return (
    !!value?.is_complete &&
    [undefined, null, 'complete'].includes(value.payload.measurement_status) &&
    ['pending_scoring', 'needs_review', 'failed_scoring', 'blocked_scoring'].every(
      (key) => (value.payload.summary?.[key] ?? 0) === 0,
    ) &&
    !value.payload.scoring_setup_issues?.length &&
    (!value.processing ||
      (value.processing.state === 'complete' &&
        value.processing.pending_answers === 0 &&
        value.processing.review_answers === 0 &&
        value.processing.failed_answers === 0))
  )
})
const processingState = computed<keyof typeof statusCopy>(() => {
  const value = report.value
  if (reportFinal.value) return 'complete'
  if (value?.processing?.state && value.processing.state !== 'complete')
    return value.processing.state
  if (
    (value?.payload.summary?.blocked_scoring ?? 0) > 0 ||
    value?.payload.scoring_setup_issues?.length
  )
    return 'blocked'
  if (
    value?.payload.measurement_status === 'needs_review' ||
    (value?.payload.summary?.needs_review ?? 0) > 0
  )
    return 'needs_review'
  // A contradictory final flag is not permission to train or promise a final score.
  if (value?.processing?.state === 'complete') return 'needs_review'
  return 'pending'
})
const scoringBlocked = computed(() => processingState.value === 'blocked')
const currentStatus = computed(() => statusCopy[processingState.value])
const canAutoRefresh = computed(() => ['pending', 'retrying'].includes(processingState.value))
const trainingAvailable = computed(
  () => features.ready && features.trainingEnabled && !features.error && !features.loading,
)
const trainingAvailabilityNote = computed(() =>
  features.error
    ? '无法确认训练服务状态，请重试；能力报告仍可查看。'
    : !features.ready || features.loading
      ? '正在确认训练服务状态…'
      : !features.trainingEnabled
        ? '训练服务当前未启用，可先阅读报告建议。'
        : '',
)
function projection(value: DimensionReport | undefined) {
  if (!value) return { index: null, level: 'insufficient', evidence_count: 0 }
  const trusted = 'synthesis' in value || 'objective_measurement' in value
  const source = trusted ? value.synthesis : value
  const count = source?.evidence_count ?? 0
  const raw = trusted
    ? value.synthesis?.index
    : typeof value.theta === 'number'
      ? 100 / (1 + Math.exp(-value.theta))
      : null
  const index =
    typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 100 && count > 0
      ? raw
      : null
  return {
    index,
    level: index === null ? 'insufficient' : (source?.level ?? 'insufficient'),
    evidence_count: count,
  }
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
const assessment = computed(() => report.value?.payload.assessment)
const configuration = computed(
  () =>
    asRecord(assessment.value?.blueprint?.configuration) ??
    asRecord(session.value?.blueprint_snapshot?.configuration),
)
const specialized = computed(() => assessment.value?.mode === 'specialized')
const configuredDimensions = computed(() => {
  const targets = asRecord(configuration.value?.dimensions)
  if (!targets) return null
  const codes = DIMENSIONS.filter(
    ({ code }) => typeof targets[code] === 'number' && Number(targets[code]) > 0,
  ).map(({ code }) => code)
  return codes.length ? codes : null
})
const rows = computed(() =>
  DIMENSIONS.filter((dimension) => {
    if (!specialized.value || !configuredDimensions.value) return true
    const value = report.value?.payload.dimensions?.[dimension.code]
    // Retain any unexpected real evidence as well as every required dimension.
    return (
      configuredDimensions.value.includes(dimension.code) ||
      projection(value).evidence_count > 0 ||
      (value?.objective_measurement?.evidence_count ?? 0) > 0 ||
      (value?.rubric_measurement?.completed ?? 0) > 0 ||
      (value?.rubric_measurement?.pending ?? 0) > 0
    )
  }).map((dimension) => {
    const value = report.value?.payload.dimensions?.[dimension.code]
    return {
      ...dimension,
      ...projection(value),
      value,
      objective:
        value?.objective_measurement ??
        (!value?.synthesis && typeof value?.theta === 'number' ? value : null),
    }
  }),
)
const traceCount = computed(() =>
  rows.value.reduce((total, row) => total + (row.value?.rubric_measurement?.completed ?? 0), 0),
)
const covered = computed(() => rows.value.filter((row) => row.index !== null).length)
const profileTitle = computed(() => (specialized.value ? '专项能力结果' : '六维能力画像'))
const objectiveOnly = computed(() => {
  const minimums = asRecord(configuration.value?.item_type_minimums)
  // Unknown configuration must not be treated as proof that open scoring is irrelevant.
  if (
    !minimums ||
    !(typeof minimums.objective === 'number' && minimums.objective > 0) ||
    minimums.dialogue !== 0 ||
    minimums.practical !== 0
  )
    return false
  const summary = report.value?.payload.summary
  return (
    reportFinal.value &&
    summary?.pending_scoring === 0 &&
    traceCount.value === 0 &&
    [
      'pending_scoring',
      'needs_review',
      'failed_scoring',
      'blocked_scoring',
      'scored_open_answers',
    ].every((key) => (summary?.[key] ?? 0) === 0) &&
    !rows.value.some((row) => (row.value?.rubric_measurement?.pending ?? 0) > 0)
  )
})
const title = computed(
  () => 'AI能力' + (MODE_NAMES[assessment.value?.mode ?? ''] ?? '测评') + '报告',
)
const completedTime = computed(() => {
  if (!session.value?.completed_at) return '完成时间未记录'
  const date = new Date(session.value.completed_at)
  return Number.isFinite(date.getTime())
    ? '完成于' + date.toLocaleDateString('zh-CN')
    : '完成时间未记录'
})
const weakest = computed(
  () =>
    [...rows.value]
      .filter((row) => row.index !== null && row.evidence_count >= 2)
      .sort((a, b) => a.index! - b.index!)[0],
)
const eligible = computed(() => reportFinal.value && !!weakest.value && weakest.value.index! < 50)
const trainingEligible = computed(() => reportFinal.value && hasTrainingEvidence(rows.value))
const recommendation = computed(
  () =>
    report.value?.payload.recommendations?.find(
      (row) => row.dimension_code === weakest.value?.code,
    ) ?? report.value?.payload.recommendations?.[0],
)
const guidance = computed(() =>
  LEARNING_GUIDANCE.filter((item) => rows.value.some((row) => row.code === item.code)),
)
const suggestedGuidance = computed(() =>
  guidance.value.find((item) => eligible.value && item.code === weakest.value?.code),
)
const adviceTitle = computed(() =>
  !reportFinal.value
    ? '先等评分完成，\n再确定学习重点。'
    : eligible.value
      ? '下一步，\n练好' + weakest.value!.name + '。'
      : '巩固已学，\n选择进阶方向。',
)
const adviceSummary = computed(() =>
  !reportFinal.value
    ? currentStatus.value.note
    : eligible.value
      ? recommendation.value?.action || suggestedGuidance.value?.summary
      : '本次没有符合短板训练条件的维度。可以生成巩固或进阶计划，不把最低分自动认定为能力短板。',
)
const targetNote = computed(() =>
  !reportFinal.value
    ? '报告尚未定稿，不据此生成短板训练计划。'
    : eligible.value
      ? `${weakest.value!.name}指数 ${weakest.value!.index!.toFixed(1)}，有 ${weakest.value!.evidence_count} 项证据，可进一步检查计划生成条件。`
      : weakest.value
        ? '已有至少两项证据的维度，可生成巩固或进阶计划，无需强行认定短板。'
        : '目前没有同时满足指数低于 50、至少两项证据的维度；不能把证据不足当作能力不足。',
)
const selfStudyLink = computed(() => ({
  path: '/training',
  query: { learn: suggestedGuidance.value?.code || guidance.value[0]?.code || 'foundations' },
}))
const nextActionNote = computed(() => {
  if (!reportFinal.value) return '等待定稿期间，可以查看原回答或阅读通用学习方法。'
  if (!trainingEligible.value) return '证据不足时可先阅读通用资料，不会强行推断短板。'
  if (!trainingAvailable.value || trainingError.value || trainingLoading.value || !session.value)
    return '可以先阅读对应方法；训练计划需要服务与来源信息可用后，再检查生成条件。'
  return eligible.value
    ? '可以生成针对性训练，或先阅读对应方法。'
    : '可以生成巩固或进阶计划，或先阅读通用资料。'
})
const trainingLink = computed(() => ({
  path: '/training',
  query: plan.value ? { plan: plan.value.id } : { report: report.value?.id ?? '' },
}))
const currentTask = computed(() => plan.value?.tasks.find((task) => task.status === 'pending'))
let generation = 0
let trainingGeneration = 0
let refreshTimer: ReturnType<typeof setTimeout> | undefined
let reportController: AbortController | undefined
let refreshStartedAt = 0
let refreshCount = 0
const REFRESH_INTERVAL = 5000
const REFRESH_WINDOW = 5 * 60 * 1000
const MAX_REFRESHES = 60
function cancelRefresh() {
  if (refreshTimer !== undefined) clearTimeout(refreshTimer)
  refreshTimer = undefined
}
function scheduleRefresh(ticket: number) {
  cancelRefresh()
  if (ticket !== generation || !canAutoRefresh.value) return
  if (refreshCount >= MAX_REFRESHES || Date.now() - refreshStartedAt >= REFRESH_WINDOW) {
    refreshNotice.value = '自动刷新已暂停，报告尚未定稿。可稍后点击“刷新报告”继续查看。'
    return
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = undefined
    if (ticket !== generation) return
    if (Date.now() - refreshStartedAt >= REFRESH_WINDOW) {
      refreshNotice.value = '自动刷新已暂停，报告尚未定稿。可稍后点击“刷新报告”继续查看。'
      return
    }
    refreshCount += 1
    void readReport(ticket)
  }, REFRESH_INTERVAL)
}
async function loadTraining() {
  const ticket = generation
  const request = ++trainingGeneration
  plan.value = null
  trainingError.value = ''
  trainingLoading.value = false
  if (
    !trainingAvailable.value ||
    !reportFinal.value ||
    !session.value?.organization_id ||
    !report.value
  )
    return
  trainingLoading.value = true
  try {
    const page = await getTrainingPlans(session.value.organization_id, 1, 0, report.value.id)
    if (ticket === generation && request === trainingGeneration && trainingAvailable.value)
      plan.value = page.items?.[0] ?? null
  } catch (cause) {
    if (ticket === generation && request === trainingGeneration)
      trainingError.value = cause instanceof Error ? cause.message : '训练计划暂不可用。'
  } finally {
    if (ticket === generation && request === trainingGeneration) trainingLoading.value = false
  }
}
async function loadMetadata(ticket = generation) {
  metadataError.value = ''
  try {
    const value = await getAssessmentSession(String(route.params.sessionId))
    if (ticket === generation && value.id === report.value?.session_id) {
      session.value = value
    }
  } catch {
    if (ticket === generation)
      metadataError.value = '测评时间与训练关联暂未读取；能力报告仍可查看。'
  }
}
async function readReport(ticket: number) {
  if (ticket !== generation || refreshing.value) return
  const sessionId = String(route.params.sessionId)
  const controller = new AbortController()
  reportController = controller
  refreshing.value = true
  try {
    const value = await getReport(sessionId, controller.signal)
    if (ticket !== generation) return
    if (value.session_id !== sessionId) throw new Error('报告与当前测评不匹配，请重新读取。')
    report.value = value
    refreshNotice.value = ''
    error.value = ''
    if (!session.value && !metadataError.value) void loadMetadata(ticket)
    scheduleRefresh(ticket)
  } catch (cause) {
    if (ticket !== generation) return
    const message = cause instanceof Error ? cause.message : '报告读取失败。'
    if (report.value)
      refreshNotice.value = `自动刷新已暂停：${message} 已保留上次读取的报告，请手动刷新重试。`
    else error.value = message
  } finally {
    if (ticket === generation) {
      refreshing.value = false
      loading.value = false
      reportController = undefined
    }
  }
}
function refreshReport() {
  if (refreshing.value) return
  cancelRefresh()
  refreshCount = 0
  refreshStartedAt = Date.now()
  refreshNotice.value = ''
  void readReport(generation)
}
function load() {
  const ticket = ++generation
  cancelRefresh()
  reportController?.abort()
  reportController = undefined
  trainingGeneration += 1
  refreshing.value = false
  refreshNotice.value = ''
  refreshCount = 0
  refreshStartedAt = Date.now()
  report.value = null
  session.value = null
  plan.value = null
  trainingError.value = ''
  metadataError.value = ''
  shareFile.value = null
  exporting.value = false
  exportError.value = ''
  trainingLoading.value = false
  loading.value = true
  error.value = ''
  shareNotice.value = ''
  shareDialog.value?.close?.()
  adviceDialog.value?.close?.()
  if (!auth.isAuthenticated || !auth.user?.id) {
    loading.value = false
    error.value = '请登录后查看本人的能力报告。'
    return
  }
  if (typeof route.params.sessionId !== 'string' || !route.params.sessionId) {
    loading.value = false
    error.value = '未指定测评，请返回能力报告列表选择。'
    return
  }
  void readReport(ticket)
}
function download(blob: Blob) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'AI-Measure-report.pdf'
  anchor.click()
  URL.revokeObjectURL(url)
}
async function preparePdf(sharing = false) {
  if (!report.value || exporting.value) return
  const ticket = generation
  exporting.value = true
  exportError.value = ''
  try {
    const blob = await downloadReportPdf(report.value.session_id)
    if (ticket !== generation) return
    if (!blob.size || !blob.type.includes('pdf'))
      throw new Error('导出内容不是有效 PDF，请稍后重试。')
    if (sharing)
      shareFile.value = new File([blob], 'AI-Measure-report.pdf', { type: 'application/pdf' })
    else download(blob)
  } catch (cause) {
    if (ticket === generation)
      exportError.value = cause instanceof Error ? cause.message : '报告 PDF 导出失败。'
  } finally {
    if (ticket === generation) exporting.value = false
  }
}
const nativeShare = computed(
  () =>
    !!shareFile.value &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [shareFile.value] }),
)
function openShare() {
  exportError.value = ''
  shareNotice.value = ''
  shareFile.value = null
  shareDialog.value?.showModal()
}
async function share() {
  if (!shareFile.value || exporting.value) return
  const ticket = generation
  if (!nativeShare.value) {
    download(shareFile.value)
    shareNotice.value = 'PDF 已下载，请自行选择接收人。没有生成公开链接。'
    return
  }
  exporting.value = true
  try {
    await navigator.share({ files: [shareFile.value], title: 'AI Measure 能力报告' })
    if (ticket === generation) shareNotice.value = '已完成系统分享操作。'
  } catch (cause) {
    if (ticket === generation)
      shareNotice.value =
        cause instanceof DOMException && cause.name === 'AbortError'
          ? '已取消分享，文件未公开。'
          : '系统分享失败，可以下载 PDF 后手动分享。'
  } finally {
    if (ticket === generation) exporting.value = false
  }
}
watch([() => route.params.sessionId, () => auth.user?.id, () => auth.isAuthenticated], load, {
  immediate: true,
  flush: 'sync',
})
watch(
  [
    trainingAvailable,
    reportFinal,
    () => report.value?.id,
    () => report.value?.revision,
    () => session.value?.organization_id,
  ],
  loadTraining,
  { flush: 'sync' },
)
onMounted(() => {
  void features.load(true)
})
onBeforeUnmount(() => {
  generation++
  trainingGeneration++
  cancelRefresh()
  reportController?.abort()
})
</script>
<template>
  <section class="report-page shell">
    <div v-if="loading" class="state-panel" role="status">正在读取报告版本与证据链……</div>
    <div v-else-if="error" class="state-panel error" role="alert">
      {{ error }} <button @click="load">重新读取</button>
    </div>
    <template v-else-if="report">
      <RouterLink class="back-link" to="/reports"><ArrowLeft :size="24" /> 返回能力报告</RouterLink>
      <header class="report-heading">
        <div>
          <h1>{{ title }}</h1>
          <p>
            {{ SCENARIO_NAMES[assessment?.scenario ?? ''] ?? '场景未记录' }} · {{ completedTime }} ·
            报告版本 R{{ report.revision }}
          </p>
        </div>
        <div class="heading-actions">
          <button class="share-button" @click="openShare">分享报告</button
          ><button class="pdf-button" :disabled="exporting" @click="preparePdf()">
            {{ exporting ? '导出中…' : '导出PDF' }}
          </button>
        </div>
      </header>
      <AssessmentOriginNotice :origin="report.payload.data_origin ?? assessment?.data_origin" />
      <p v-if="scoringBlocked" class="inline-error" role="alert">
        评分配置异常：{{ currentStatus.note }}
      </p>
      <p class="inline-notice" role="status" aria-live="polite">
        {{
          refreshNotice ||
          (canAutoRefresh
            ? '正在自动读取评分状态（最多持续 5 分钟），不会重新提交答案或触发评分。'
            : currentStatus.note)
        }}
        <button data-testid="refresh-report" :disabled="refreshing" @click="refreshReport">
          {{ refreshing ? '正在刷新…' : '刷新报告' }}
        </button>
      </p>
      <p v-if="metadataError" class="inline-notice" role="status">
        {{ metadataError }} <button @click="loadMetadata()">重试信息读取</button>
      </p>
      <p v-if="exportError && !shareDialog?.open" class="inline-error" role="alert">
        {{ exportError }}
      </p>
      <section class="report-summary" aria-label="报告摘要">
        <div class="profile">
          <span class="profile-avatar" aria-hidden="true">{{
            (auth.user?.display_name ?? '我').slice(0, 1)
          }}</span>
          <div>
            <strong>{{ auth.user?.display_name ?? '我的能力报告' }}</strong>
            <p>{{ SCENARIO_NAMES[assessment?.scenario ?? ''] ?? '能力测评' }}</p>
            <span class="status-pill" :class="{ pending: !reportFinal }">{{
              currentStatus.label
            }}</span>
          </div>
        </div>
        <dl>
          <div>
            <dt>能力覆盖</dt>
            <dd class="blue">
              {{ covered
              }}<small v-if="!specialized || configuredDimensions">/{{ rows.length }}</small
              ><small v-else>维</small>
            </dd>
            <p>{{ specialized ? '本次专项维度 · 非总分' : '已覆盖维度 · 非总分' }}</p>
          </div>
          <div v-if="!objectiveOnly" data-testid="open-scoring-progress">
            <dt>评分进度</dt>
            <dd>{{ traceCount }}<small>项</small></dd>
            <p>开放题已完成裁决</p>
          </div>
          <div>
            <dt>同组比较</dt>
            <dd class="no-metric">暂无</dd>
            <p>暂无同口径可比样本</p>
          </div>
          <div>
            <dt>测评效率</dt>
            <dd class="no-metric">待验证</dd>
            <p>需固定卷配对记录</p>
          </div>
        </dl>
      </section>
      <div class="report-grid">
        <div class="report-column report-main">
          <section class="profile-card" :class="{ specialized }" :aria-label="profileTitle">
            <div class="radar-column">
              <h2>{{ profileTitle }}</h2>
              <p>
                {{
                  specialized
                    ? '仅解读本次专项范围，不把未测维度当作零分或能力短板。'
                    : '分数同时展示测量差异，不把单次结果解释为绝对能力。'
                }}
              </p>
              <p v-if="specialized && !configuredDimensions">
                测评范围信息暂不可用，缺失结果不能判定为未测。
              </p>
              <SixDimensionChart v-if="!specialized" :dimensions="rows" radar-only />
            </div>
            <div class="dimension-rails">
              <div
                v-for="row in rows"
                :key="row.code"
                class="dimension-row"
                :class="{
                  weak: row.code === weakest?.code && row.index !== null && row.index < 50,
                }"
                :data-testid="'dimension-' + row.code"
                :style="{ '--score': (row.index ?? 0) + '%' }"
              >
                <strong>{{ row.name }}</strong
                ><span class="level" :title="LEVEL_NAMES[row.level]">{{
                  row.index === null ? '—' : row.level
                }}</span>
                <div
                  class="score-rail"
                  :aria-label="
                    row.index === null ? row.name + '证据不足' : row.name + '证据指数' + row.index
                  "
                >
                  <i v-if="row.index !== null"></i>
                </div>
                <span class="score-value"
                  >{{ row.index === null ? '证据不足' : row.index.toFixed(1)
                  }}<small v-if="row.index !== null">{{ row.evidence_count }}项证据</small></span
                >
              </div>
              <details class="measurement-note">
                <summary>查看测量说明与等级定义</summary>
                <p>
                  {{
                    report.payload.measurement_note ||
                    '指数综合客观 EAP 与已裁决量规证据，不代表正式人群常模。'
                  }}
                </p>
                <p v-for="(label, key) in LEVEL_NAMES" :key="key">{{ key }} · {{ label }}</p>
                <p>客观 θ 和标准误、原始量规证据见下方“评分过程”。</p>
              </details>
            </div>
          </section>
          <ReportEvidencePanel
            :key="report.id + ':' + report.revision"
            :report="report"
            :objective-only="objectiveOnly"
            :dimension-codes="
              specialized && configuredDimensions ? rows.map((row) => row.code) : undefined
            "
          />
        </div>
        <div class="report-column report-sidebar">
          <section
            class="priority-card"
            :class="{ consolidation: !eligible }"
            aria-label="学习建议"
          >
            <span>{{ eligible ? '优先提升项' : reportFinal ? '巩固与进阶' : '等待评分定稿' }}</span>
            <h2>{{ adviceTitle }}</h2>
            <p>{{ adviceSummary }}</p>
            <div class="priority-note">
              <strong>{{ eligible ? '为什么建议关注这个方向' : '本次报告说明' }}</strong>
              <p>{{ targetNote }}</p>
            </div>
            <RouterLink
              v-if="
                trainingAvailable &&
                reportFinal &&
                (trainingEligible || plan) &&
                !trainingError &&
                !trainingLoading &&
                session
              "
              class="training-button"
              :to="trainingLink"
              >{{
                plan
                  ? plan.privacy_redacted || plan.status === 'completed'
                    ? '查看训练计划'
                    : '继续训练计划'
                  : eligible
                    ? '生成专项训练计划'
                    : '生成巩固／进阶计划'
              }}</RouterLink
            >
            <button v-else class="training-button" @click="adviceDialog?.showModal()">
              查看提升建议
            </button>
          </section>
          <section class="learning-card" :aria-label="plan ? '我的训练计划' : '下一步行动'">
            <header>
              <h2>{{ plan ? '我的训练计划' : '下一步行动' }}</h2>
              <span>{{
                plan ? plan.completed_tasks + '/' + plan.total_tasks + ' 已完成' : '按需选择'
              }}</span>
            </header>
            <p v-if="trainingAvailabilityNote" class="plan-note" role="status">
              {{ trainingAvailabilityNote }}
              <button
                v-if="features.error"
                class="full-plan"
                :disabled="features.loading"
                @click="features.load(true)"
              >
                重试服务状态
              </button>
            </p>
            <p v-if="trainingLoading" role="status">正在读取训练计划…</p>
            <p v-if="trainingError" class="training-error" role="alert">
              {{ trainingError }} <button @click="loadTraining()">重试</button>
            </p>
            <ol v-if="plan">
              <li
                v-for="(task, index) in plan.tasks"
                :key="index"
                :class="{
                  done: 'status' in task && task.status === 'completed',
                  current: 'id' in task && task.id === currentTask?.id,
                }"
              >
                <span class="step"
                  ><Check
                    v-if="'status' in task && task.status === 'completed'"
                    :size="16"
                  /><template v-else>{{ index + 1 }}</template></span
                >
                <div>
                  <strong>{{ task.title }}</strong
                  ><small>{{ task.status === 'completed' ? '已完成' : '待完成' }}</small>
                </div>
                <RouterLink
                  v-if="
                    trainingAvailable &&
                    reportFinal &&
                    'id' in task &&
                    task.id === currentTask?.id &&
                    !plan?.privacy_redacted &&
                    plan?.status !== 'completed'
                  "
                  :to="trainingLink"
                  >开始</RouterLink
                >
              </li>
            </ol>
            <div v-else class="next-actions">
              <p>{{ nextActionNote }}</p>
              <RouterLink :to="selfStudyLink"
                ><strong>阅读学习方法</strong><small>案例、操作步骤与自查清单</small
                ><ChevronRight :size="18"
              /></RouterLink>
              <RouterLink to="/assessment"
                ><strong>选择下一次测评</strong><small>先确认测评方式与方案，不会立即开始</small
                ><ChevronRight :size="18"
              /></RouterLink>
            </div>
            <RouterLink
              v-if="trainingAvailable && reportFinal && plan"
              class="full-plan"
              :to="trainingLink"
              >查看完整训练计划 <ChevronRight :size="16"
            /></RouterLink>
          </section>
        </div>
      </div>
      <dialog ref="shareDialog" class="report-dialog" aria-label="分享报告">
        <header>
          <h2>分享报告</h2>
          <button aria-label="关闭分享" @click="shareDialog?.close()"><X :size="21" /></button>
        </header>
        <p>PDF 可能包含你的能力数据、作答引用和评分依据，请确认接收人。不会自动创建公开链接。</p>
        <p>导出服务器当前版本；未完成报告会保留待评分／待复核说明。</p>
        <p v-if="exportError" role="alert">{{ exportError }}</p>
        <p v-if="shareNotice" role="status">{{ shareNotice }}</p>
        <button
          v-if="!shareFile"
          class="pdf-button"
          :disabled="exporting"
          @click="preparePdf(true)"
        >
          {{ exporting ? '正在准备PDF…' : '确认并准备PDF' }}
        </button>
        <template v-else
          ><button class="pdf-button" :disabled="exporting" @click="share">
            {{ nativeShare ? '选择接收人分享' : '下载PDF后分享' }}</button
          ><button v-if="nativeShare" class="share-button" @click="download(shareFile)">
            仅下载PDF
          </button></template
        >
      </dialog>
      <dialog ref="adviceDialog" class="report-dialog advice-dialog" aria-label="学习建议与下一步">
        <header>
          <h2>学习建议与下一步</h2>
          <button aria-label="关闭提升建议" @click="adviceDialog?.close()"><X :size="21" /></button>
        </header>
        <p class="advice-state">{{ targetNote }}</p>
        <article
          v-for="item in reportFinal ? report.payload.recommendations : []"
          :key="item.dimension_code"
        >
          <h3>
            {{
              DIMENSIONS.find((row) => row.code === item.dimension_code)?.name ??
              item.dimension_code
            }}
          </h3>
          <p>{{ item.action }}</p>
        </article>
        <section class="advice-methods">
          <h3>{{ suggestedGuidance ? '先从一个具体方法开始' : '可以自主练习的方法' }}</h3>
          <p>以下是通用学习建议，不是新的评分结论，也不会改变正式成绩。</p>
          <article
            v-for="item in suggestedGuidance ? [suggestedGuidance] : guidance"
            :key="item.code"
          >
            <h4>{{ item.name }} · {{ item.title }}</h4>
            <p>{{ item.summary }}</p>
            <RouterLink
              :to="{ path: '/training', query: { learn: item.code } }"
              @click="adviceDialog?.close()"
              >阅读案例与步骤 <ChevronRight :size="15"
            /></RouterLink>
          </article>
        </section>
        <details class="measurement-note">
          <summary>个人计划依据什么生成？</summary>
          <p>{{ targetNote }}</p>
          <p>
            计划需基于最终报告，目标维度至少有两项证据，同时满足来源题卷可复测、训练服务开启等条件。
            智能匹配优先选择指数低于 50 的维度，否则安排巩固；也可主动选择进阶挑战。 50
            不是通用及格线；练习按证据、场景和已完成材料匹配，不会直接改变成绩。
          </p>
        </details>
        <p v-if="trainingError" role="alert">{{ trainingError }}</p>
        <p v-if="trainingAvailabilityNote">{{ trainingAvailabilityNote }}</p>
        <RouterLink
          v-if="trainingAvailable && reportFinal && (trainingEligible || plan)"
          class="pdf-button"
          :to="trainingLink"
          @click="adviceDialog?.close()"
          >{{ plan ? '查看训练计划' : '前往生成训练计划' }}</RouterLink
        >
      </dialog>
    </template>
  </section>
</template>
<style scoped>
.report-page {
  --report-u: var(--reference-unit, 1px);
  color: #555;
  padding: 4px 0 0;
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  font-size: 18px;
  color: #737373;
  margin-bottom: 18px;
  min-height: 30px;
}
.report-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 22px;
}
.report-page .report-heading h1 {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.3;
  margin: 0 0 9px;
}
.report-heading p {
  font-size: 15px;
  color: #757575;
}
.heading-actions {
  display: flex;
  gap: 26px;
  flex: none;
}
.share-button,
.pdf-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 9px 20px;
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid #bfc1c5;
  background: #fafafa;
  color: #444;
}
.pdf-button {
  background: #527fe3;
  border-color: #81a5fc;
  color: white;
}
.report-summary {
  display: flex;
  align-items: center;
  background: #cce4e8;
  border: 1px solid #94cbd6;
  border-radius: 30px;
  padding: 11px 23px;
  min-height: 128px;
  margin-bottom: 24px;
  color: #208c9c;
}
.profile {
  display: flex;
  align-items: center;
  gap: 19px;
  min-width: 30%;
  padding-right: 22px;
}
.profile-avatar {
  display: grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: #e9f4f6;
  font-size: 30px;
  flex: none;
}
.profile strong {
  font-size: 23px;
}
.profile p {
  font-size: 13px;
  margin: 3px 0 8px;
}
.status-pill {
  display: inline-block;
  border-radius: 22px;
  padding: 8px 12px;
  font-size: 13px;
  background: #94cbd5;
  color: #176879;
}
.status-pill.pending {
  background: #ffedce;
  color: #795626;
}
.report-summary dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(125px, 1fr));
  flex: 1;
  min-width: 0;
}
.report-summary dl > div {
  border-left: 1px solid #219bac;
  padding: 3px 15px 3px 35px;
  min-width: 0;
}
.report-summary dt {
  font-size: 16px;
  font-weight: 600;
}
.report-summary dd {
  font-size: 34px;
  font-weight: 700;
  line-height: 1.5;
  margin: 0;
}
.report-summary dd.small,
.report-summary dd.no-metric {
  font-size: 29px;
}
.report-summary dd small {
  font-size: 17px;
  margin-left: 4px;
}
.report-summary .blue {
  color: #527fe3;
}
.report-summary dl p {
  font-size: 13px;
  line-height: 1.7;
}
.report-grid {
  display: grid;
  grid-template-columns: minmax(0, 3.12fr) minmax(275px, 1fr);
  gap: 22px 32px;
  align-items: start;
}
.report-column {
  min-width: 0;
  display: grid;
  gap: inherit;
  align-content: start;
}
.profile-card {
  min-width: 0;
  display: grid;
  grid-template-columns: 30% minmax(0, 1fr);
  gap: 25px;
  padding: 18px 24px;
  border: 1px solid #bdcde7;
  border-radius: 18px;
  box-shadow: 0 3px 7px #5574a733;
  min-height: 385px;
}
.profile-card.specialized {
  min-height: 0;
}
.radar-column h2 {
  font-size: 21px;
}
.radar-column > p {
  font-size: 14px;
  color: #777;
  line-height: 1.7;
  margin: 4px 0 12px;
}
.dimension-rails {
  min-width: 0;
}
.dimension-row {
  display: grid;
  grid-template-columns: 96px 28px minmax(40px, 1fr) 78px;
  align-items: center;
  gap: 13px;
  min-height: 52px;
  border-bottom: 1px solid #bfc1c5;
  font-size: 16px;
}
.dimension-row:last-of-type {
  border-bottom: 0;
}
.level {
  color: #527fe3;
  font-weight: 600;
}
.score-rail {
  height: 5px;
  background: #e7e7e8;
  border-radius: 4px;
  overflow: hidden;
}
.score-rail i {
  display: block;
  height: 100%;
  width: var(--score);
  border-radius: 4px;
  background: #219bac;
}
.score-value {
  text-align: right;
  font-size: 16px;
  font-weight: 600;
}
.score-value small {
  font-size: 12px;
  color: #757575;
  display: block;
  font-weight: 400;
}
.dimension-row.weak {
  color: #db8a35;
}
.weak .score-rail i {
  background: #e79943;
}
.measurement-note {
  font-size: 12px;
  line-height: 1.8;
  color: #737373;
  margin-top: 7px;
}
.measurement-note summary {
  cursor: pointer;
}
.priority-card {
  min-height: 385px;
  padding: 22px 19px;
  border: 1px solid #ffd2a2;
  border-radius: 18px;
  box-shadow: 0 3px 7px #eaa75a26;
  background: #fffbf5;
}
.priority-card.consolidation {
  background: #f5fbfc;
  border-color: #c7e4ea;
  box-shadow: none;
}
.priority-card.consolidation > span {
  color: #208c9c;
}
.consolidation .priority-note {
  background: #e7f3f6;
}
.consolidation .priority-note p {
  color: #526e7c;
}
.consolidation .training-button {
  background: #137f91;
}
.priority-card > span {
  font-size: 14px;
  font-weight: 700;
  color: #c77d24;
}
.report-page .priority-card h2 {
  font-size: 30px;
  line-height: 1.4;
  white-space: pre-line;
  margin: 14px 0;
}
.priority-card > p {
  font-size: 13px;
  line-height: 1.7;
  color: #777;
}
.priority-note {
  padding: 12px;
  background: #fbedda;
  border-radius: 11px;
  margin: 18px 0;
  font-size: 13px;
}
.priority-note p {
  font-size: 12px;
  color: #796b57;
  line-height: 1.6;
  margin-top: 5px;
}
.training-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 43px;
  border: 0;
  border-radius: 8px;
  background: #eda347;
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  padding: 10px;
}
.learning-card {
  border: 1px solid #bdcde7;
  border-radius: 14px;
  box-shadow: 0 3px 7px #5574a733;
  padding: 15px 21px;
  min-height: 316px;
  min-width: 0;
}
.next-actions {
  margin: 18px 0 0;
}
.next-actions > p {
  font-size: 13px;
  color: #607785;
  line-height: 1.8;
}
.next-actions > a {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-top: 1px solid #d8e9ee;
  padding: 16px 0;
  gap: 5px 10px;
  min-height: 70px;
  color: #137f91;
}
.next-actions strong {
  font-size: 15px;
}
.next-actions small {
  grid-column: 1;
  color: #607785;
  font-size: 12px;
  line-height: 1.6;
}
.next-actions svg {
  grid-column: 2;
  grid-row: 1 / 3;
}
.learning-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.learning-card h2 {
  font-size: 19px;
}
.learning-card header > span {
  font-size: 14px;
  color: #777;
  white-space: nowrap;
}
.learning-card ol {
  list-style: none;
  padding: 0;
  margin: 14px 0 8px;
}
.learning-card li {
  display: flex;
  align-items: flex-start;
  gap: 13px;
  min-height: 44px;
  position: relative;
}
.learning-card li:not(:last-child)::after {
  content: '';
  position: absolute;
  left: 15px;
  top: 34px;
  bottom: 3px;
  width: 1px;
  background: #c9c9c9;
}
.step {
  display: grid;
  place-items: center;
  width: 31px;
  height: 31px;
  border-radius: 50%;
  border: 1px solid #bfc1c5;
  color: #888;
  flex: none;
}
.current .step {
  border-color: #427eff;
  color: #427eff;
}
.done .step {
  background: #219bac;
  color: white;
  border-color: #219bac;
}
.learning-card li strong {
  display: block;
  font-size: 14px;
  color: #696969;
}
.learning-card li small {
  display: block;
  font-size: 12px;
  color: #777;
}
.learning-card li a {
  margin-left: auto;
  white-space: nowrap;
  font-size: 13px;
  background: #e6edff;
  color: #427eff;
  padding: 6px 12px;
  border-radius: 5px;
}
.full-plan {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  background: none;
  border: 0;
  border-top: 1px solid #c4c4c4;
  padding: 12px 0 0;
  color: #427eff;
  font-size: 13px;
  cursor: pointer;
}
.plan-note {
  font-size: 12px;
  color: #777;
  line-height: 1.7;
  margin-bottom: 10px;
}
.training-error {
  font-size: 13px;
  line-height: 1.6;
  color: #983c31;
}
.inline-notice {
  font-size: 13px;
  padding: 10px;
  background: #f5f8fa;
  margin: 10px 0;
}
.inline-notice button,
.training-error button {
  color: #427eff;
  border: 0;
  background: none;
  cursor: pointer;
  padding: 5px;
}
.inline-error {
  font-size: 14px;
  color: #983c31;
  margin: 10px 0;
}
.state-panel {
  padding: 28px;
  border: 1px solid #bdcde7;
  border-radius: 15px;
  background: white;
}
.state-panel.error {
  color: #983c31;
}
.report-dialog {
  margin: auto;
  max-height: 85vh;
  width: min(600px, calc(100vw - 32px));
  padding: 25px;
  border: 1px solid #bdcde7;
  border-radius: 18px;
  color: #555;
}
.report-dialog::backdrop {
  background: #173a4966;
}
.report-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.report-dialog header button {
  border: 0;
  background: none;
  min-width: 44px;
  min-height: 44px;
  cursor: pointer;
}
.report-dialog p {
  font-size: 14px;
  line-height: 1.8;
  margin: 15px 0;
}
.report-dialog article {
  border-top: 1px solid #d7dfe8;
  padding: 12px 0;
}
.report-dialog h3 {
  font-size: 17px;
}
.report-dialog .pdf-button {
  margin-right: 12px;
}
.advice-dialog {
  width: min(780px, calc(100vw - 28px));
}
.advice-dialog .advice-state {
  background: #edf7fa;
  color: #285d70;
  border-radius: 10px;
  padding: 14px 16px;
}
.advice-methods {
  margin: 20px 0;
}
.advice-methods > p {
  font-size: 13px;
}
.advice-methods h4 {
  font-size: 15px;
  line-height: 1.6;
  margin: 0;
}
.advice-methods article p {
  margin: 7px 0;
}
.advice-methods article a {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  color: #137f91;
  min-height: 44px;
  font-size: 14px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:focus-visible,
a:focus-visible,
summary:focus-visible {
  outline: 3px solid #427eff;
  outline-offset: 3px;
}
@media (max-width: 1450px) {
  .report-grid {
    gap: 24px;
    grid-template-columns: minmax(0, 2.8fr) minmax(250px, 1fr);
  }
  .report-summary dl > div {
    padding-left: 20px;
  }
  .profile {
    min-width: 27%;
    gap: 12px;
  }
  .profile-card {
    gap: 16px;
    padding: 20px;
  }
  .dimension-row {
    grid-template-columns: 82px 23px minmax(35px, 1fr) 64px;
    gap: 8px;
    font-size: 14px;
  }
  .priority-card {
    padding: 20px 16px;
  }
  .report-page .priority-card h2 {
    font-size: 26px;
  }
  .learning-card {
    padding: 18px;
  }
}
@media (max-width: 1150px) {
  .report-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .priority-card,
  .learning-card {
    min-height: 0;
  }
  .report-summary {
    flex-wrap: wrap;
    gap: 20px;
  }
  .profile {
    width: 100%;
  }
  .report-summary dl > div:first-child {
    border: 0;
  }
  .profile-card {
    grid-template-columns: 30% minmax(0, 1fr);
  }
  .report-heading {
    align-items: flex-start;
  }
  .heading-actions {
    gap: 10px;
  }
  .report-page .report-heading h1 {
    font-size: 29px;
  }
}
@media (max-width: 600px) {
  .report-heading {
    flex-direction: column;
  }
  .report-summary {
    padding: 18px;
    border-radius: 20px;
  }
  .report-summary dl {
    grid-template-columns: 1fr 1fr;
    gap: 16px 0;
  }
  .report-summary dl > div {
    padding: 0 12px;
  }
  .report-summary dl > div:nth-child(3) {
    border: 0;
  }
  .profile-card {
    grid-template-columns: 1fr;
    padding: 18px;
  }
  .radar-column {
    max-width: 300px;
    margin: auto;
  }
  .dimension-row {
    grid-template-columns: 78px 22px minmax(35px, 1fr) 62px;
    font-size: 14px;
  }
  .back-link {
    font-size: 16px;
  }
  .report-page .report-heading h1 {
    font-size: 27px;
  }
  .report-grid {
    gap: 20px;
  }
  .learning-card li {
    min-height: 56px;
  }
}
</style>
