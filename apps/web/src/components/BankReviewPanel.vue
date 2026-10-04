<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { DIMENSIONS } from '../domain/capabilities'
import { ApiError } from '../services/apiClient'
import ContentAssignmentPanel from './ContentAssignmentPanel.vue'
import AdminTrialPanel from './AdminTrialPanel.vue'
import ReviewPublicationPanel from './ReviewPublicationPanel.vue'
import {
  getContentReview,
  listContentReviews,
  submitContentReview,
  type ReviewChecks,
  type ReviewDecision,
  type ReviewDetail,
  type ReviewRow,
  type ReviewStatus,
  type SubmitReview,
  type PublicationReceipt,
  type PublicationFilter,
  type ReviewFilters,
} from '../services/contentReviewApi'

const emit = defineEmits<{ busy: [value: boolean] }>()
const auth = useAuthStore(),
  access = useAccessStore()
const admin = computed(() => access.can('content'))
const allowed = computed(
  () =>
    auth.isAuthenticated &&
    access.ready &&
    !access.error &&
    (admin.value || access.can('content_author')),
)
const rows = ref<ReviewRow[]>([]),
  total = ref(0),
  offset = ref(0)
const status = ref(''),
  dimension = ref(''),
  itemType = ref('')
const publicationFilter = ref<PublicationFilter>('')
const selected = ref<ReviewDetail | null>(null)
const loading = ref(false),
  detailLoading = ref(false),
  busy = ref(false),
  assignmentBusy = ref(false),
  trialBusy = ref(false),
  publicationBusy = ref(false)
const publicationPanel = ref<InstanceType<typeof ReviewPublicationPanel> | null>(null)
const knownPublications = new Map<string, string | null>()
const error = ref(''),
  notice = ref('')
const pane = ref<'content' | 'rubric' | 'sources'>('content')
const decision = ref<ReviewDecision>('approve'),
  comment = ref('')
const emptyChecks = (): ReviewChecks => ({
  source: false,
  answer: false,
  rubric: false,
  fairness: false,
})
const checks = ref(emptyChecks())
const pending = ref<{ id: string; fingerprint: string; body: SubmitReview; key: string } | null>(
  null,
)
const confirming = ref(false)
const statusLabels: Record<ReviewStatus, string> = {
  pending: '待人审',
  in_review: '审核中',
  reviewed: '审核通过',
  changes_requested: '退回修改',
  superseded: '已有新稿',
}
const typeLabels: Record<string, string> = {
  objective: '客观题',
  dialogue: '对话题',
  practical: '实操题',
}
const checkLabels: Array<[keyof ReviewChecks, string]> = [
  ['source', '已核对参考来源、定位与使用许可'],
  ['answer', '已校对参考答案、选项或任务可执行性'],
  ['rubric', '已检查评分规则、量规及锚例；客观题核对确定性判分'],
  ['fairness', '已检查歧义、公平性、先修要求与题目泄露风险'],
]
const dirty = computed(
  () =>
    Boolean(comment.value.trim()) ||
    decision.value !== 'approve' ||
    Object.values(checks.value).some(Boolean),
)
const locked = computed(
  () => busy.value || assignmentBusy.value || trialBusy.value || publicationBusy.value,
)
const revision = computed(() => selected.value?.revision_content)
const progressMessage = computed(() => {
  const row = selected.value
  if (!row) return ''
  const publicationMessage =
    row.publication_status === 'published'
      ? '本题已有正式发布记录，审核状态变化不会撤销该历史记录；是否可抽取仍以启用计划范围为准。'
      : row.publication_status === 'unpublished'
        ? '本题尚未正式发布。管理员可另行核对兼容计划并确认发布。'
        : '发布状态未确认，请重新读取最新题目状态。'
  if (row.status === 'superseded')
    return `这份题稿已有新版本。旧意见保留留痕，请审核最新题稿。${publicationMessage}`
  if (row.status === 'changes_requested')
    return `存在退回修改意见，暂不能指派试答。须修订为新版本并重新审核。${publicationMessage}`
  if (row.status === 'reviewed')
    return `${row.own_decision === 'approve' ? '你的通过意见已保存，' : ''}已满足一位审核人通过的要求，可由管理员指派题目试答。审核通过本身不是正式发布，也不代表准确度已验证。${publicationMessage}`
  if (row.own_decision === 'approve')
    return `你的通过意见已保存；请刷新确认当前题稿状态，无需重复提交。${publicationMessage}`
  return `尚未完成审核。一位有权限的审核人核对来源、答案、量规与公平性并通过后，即可由管理员指派试答。${publicationMessage}`
})
let epoch = 0,
  listTicket = 0,
  detailTicket = 0
function current(scope: number) {
  return scope === epoch && allowed.value
}
function filters(): ReviewFilters {
  return {
    status: status.value,
    dimension: dimension.value,
    item_type: itemType.value,
    publication_status: publicationFilter.value,
  }
}
function withPublication<T extends ReviewRow>(row: T): T {
  if (row.publication_status === 'published')
    knownPublications.set(row.id, row.published_at ?? knownPublications.get(row.id) ?? null)
  if (!knownPublications.has(row.id)) return row
  return {
    ...row,
    publication_status: 'published',
    published_at: knownPublications.get(row.id) ?? null,
  }
}
function publicationLabel(row: ReviewRow) {
  if (row.publication_status === 'published') return '正式已发布'
  if (row.publication_status === 'unpublished')
    return row.status === 'reviewed' ? '审核通过 · 待发布' : '未发布'
  return '发布状态未确认'
}
function publicationClass(row: ReviewRow) {
  if (row.publication_status === 'published') return 'publication-published'
  return row.publication_status === 'unpublished'
    ? 'publication-unpublished'
    : 'publication-unknown'
}
function receivePublication(value: PublicationReceipt | null) {
  if (!value || !selected.value) return
  knownPublications.set(selected.value.id, value.published_at)
  selected.value = withPublication(selected.value)
  rows.value = rows.value.map(withPublication)
}
async function afterPublication(value: PublicationReceipt) {
  if (!allowed.value || !selected.value) return
  const scope = epoch
  receivePublication(value)
  notice.value = '正式发布已完成。本次回执保留在右侧；队列刷新不影响发布结果。'
  await refreshQueueAfterSave(scope, 'publication')
}
function resetForm() {
  decision.value = 'approve'
  comment.value = ''
  checks.value = emptyChecks()
  pending.value = null
  confirming.value = false
}
function clear() {
  epoch += 1
  listTicket += 1
  detailTicket += 1
  rows.value = []
  selected.value = null
  total.value = 0
  offset.value = 0
  loading.value = false
  detailLoading.value = false
  busy.value = false
  assignmentBusy.value = false
  trialBusy.value = false
  publicationBusy.value = false
  knownPublications.clear()
  error.value = ''
  notice.value = ''
  resetForm()
  emit('busy', false)
}
function failure(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
    clear()
    error.value = '题目已不可访问或审题权限发生变化，题面、答案和未保存意见已清除。请重新读取队列。'
  } else error.value = caught instanceof Error ? caught.message : fallback
}
function mayLeave() {
  if (locked.value) return false
  if (publicationPanel.value && !publicationPanel.value.mayLeave()) return false
  return !dirty.value || window.confirm('审核意见尚未保存，离开将放弃本次填写。确定继续吗？')
}
defineExpose({ mayLeave })
async function load() {
  if (!allowed.value || locked.value || !mayLeave()) return
  const scope = epoch,
    ticket = ++listTicket
  detailTicket += 1
  selected.value = null
  rows.value = []
  resetForm()
  total.value = 0
  error.value = ''
  loading.value = true
  detailLoading.value = false
  try {
    const page = await listContentReviews(filters(), offset.value)
    if (current(scope) && ticket === listTicket) {
      rows.value = page.items.map(withPublication)
      total.value = page.total
    }
  } catch (caught) {
    if (current(scope) && ticket === listTicket) failure(caught, '待审核题目读取失败。')
  } finally {
    if (current(scope) && ticket === listTicket) loading.value = false
  }
}
async function open(id: string) {
  if (!allowed.value || locked.value || !mayLeave()) return
  const scope = epoch,
    ticket = ++detailTicket
  selected.value = null
  resetForm()
  detailLoading.value = true
  error.value = ''
  notice.value = ''
  pane.value = 'content'
  try {
    const result = await getContentReview(id)
    if (current(scope) && ticket === detailTicket) selected.value = withPublication(result)
  } catch (caught) {
    if (current(scope) && ticket === detailTicket) failure(caught, '审题资料读取失败。')
  } finally {
    if (current(scope) && ticket === detailTicket) detailLoading.value = false
  }
}
function changePage(next: number) {
  if (loading.value || locked.value || !mayLeave()) return
  resetForm()
  offset.value = Math.max(0, Math.min(10000, next))
  void load()
}
function prepare() {
  if (!selected.value?.can_review || !allowed.value || locked.value) return
  error.value = ''
  notice.value = ''
  if (comment.value.trim().length < 10 || comment.value.trim().length > 4000) {
    error.value = '请填写 10–4000 字的审核理由，指出核对依据或需要修改的位置。'
    return
  }
  if (decision.value === 'approve' && !Object.values(checks.value).every(Boolean)) {
    error.value = '通过前请完成全部四项核对；尚有问题时请选择“退回修改”。'
    return
  }
  const body: SubmitReview = {
    expected_digest: selected.value.digest,
    decision: decision.value,
    comment: comment.value.trim(),
    checks: { ...checks.value },
  }
  const fingerprint = JSON.stringify(body)
  if (
    !pending.value ||
    pending.value.id !== selected.value.id ||
    pending.value.fingerprint !== fingerprint
  )
    pending.value = {
      id: selected.value.id,
      fingerprint,
      body,
      key: `content-review-${crypto.randomUUID()}`,
    }
  confirming.value = true
}
async function save() {
  if (
    !allowed.value ||
    locked.value ||
    !confirming.value ||
    !pending.value ||
    !selected.value?.can_review
  )
    return
  const scope = epoch,
    intent = pending.value
  if (selected.value.id !== intent.id) return
  busy.value = true
  error.value = ''
  try {
    const value = await submitContentReview(intent.id, intent.body, intent.key)
    if (!current(scope)) return
    selected.value = withPublication(value)
    resetForm()
    notice.value = '审核意见已保存并留痕。本次只保存人审意见，不会自动发布或改变任何测评成绩。'
    await refreshDetailAfterSave(scope, value.id)
    if (!current(scope)) return
    await refreshQueueAfterSave(scope)
  } catch (caught) {
    if (current(scope)) failure(caught, '审核意见保存失败，请重试本次提交。')
  } finally {
    if (current(scope)) busy.value = false
  }
}
async function refreshDetailAfterSave(scope: number, id: string) {
  const ticket = ++detailTicket
  try {
    const latest = await getContentReview(id)
    if (current(scope) && ticket === detailTicket) selected.value = withPublication(latest)
  } catch (caught) {
    if (current(scope) && ticket === detailTicket) {
      failure(caught, '审核意见已保存，但最新状态未能刷新。')
      if (!(caught instanceof ApiError && [401, 403, 404].includes(caught.status)))
        error.value =
          '审核意见已保存，但最新状态未能刷新。当前显示提交回执，请重新打开题目核对最新审核记录。'
    }
  }
}
async function refreshQueueAfterSave(scope: number, action: 'review' | 'publication' = 'review') {
  const ticket = ++listTicket
  loading.value = true
  const currentFilters = filters()
  try {
    let page = await listContentReviews(currentFilters, offset.value)
    if (!current(scope) || ticket !== listTicket) return
    if (offset.value > 0 && offset.value >= page.total) {
      offset.value = Math.max(0, Math.floor((page.total - 1) / 20) * 20)
      page = await listContentReviews(currentFilters, offset.value)
    }
    if (current(scope) && ticket === listTicket) {
      rows.value = page.items.map(withPublication)
      total.value = page.total
    }
  } catch (caught) {
    if (current(scope) && ticket === listTicket) {
      if (action !== 'publication') {
        rows.value = []
        total.value = 0
      }
      failure(caught, '审核意见已保存，但队列刷新失败。请重新读取队列。')
      if (!(caught instanceof ApiError && [401, 403, 404].includes(caught.status)))
        error.value =
          action === 'publication'
            ? '正式发布已完成，但队列刷新失败。已保留发布状态与回执，请重新读取队列，不要重复发布。'
            : '审核意见已保存，但队列刷新失败。请重新读取队列；不要重复填写同一份意见。'
    }
  } finally {
    if (current(scope) && ticket === listTicket) loading.value = false
  }
}
function safeUrl(value: string | null) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
function date(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供'
}
function dimensionLabel(code: string) {
  return DIMENSIONS.find((row) => row.code === code)?.name ?? code
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !locked.value && !publicationPanel.value?.hasPending()) return
  event.preventDefault()
  event.returnValue = ''
}
watch(
  [comment, decision, checks],
  () => {
    confirming.value = false
  },
  { deep: true, flush: 'sync' },
)
watch(locked, (value) => emit('busy', value), { flush: 'sync' })
watch(
  () => [
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
    admin.value,
    access.can('content_author'),
    JSON.stringify(access.organizations),
    JSON.stringify(access.globalCapabilities),
  ],
  () => {
    clear()
    if (allowed.value) void load()
  },
  { immediate: true, flush: 'sync' },
)
onBeforeRouteLeave(mayLeave)
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => {
  clear()
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section
    class="bank-review"
    data-testid="bank-review-panel"
    aria-labelledby="bank-review-heading"
  >
    <header class="review-intro">
      <div>
        <p class="eyebrow">逐题核验 · 独立留痕</p>
        <h2 id="bank-review-heading">待审核题目</h2>
        <p>先核对来源、答案与量规，再留下你的独立判断。</p>
      </div>
      <span class="isolation-badge">人审与发布分离</span>
    </header>
    <p class="scope-note">
      一人审核通过后，可由管理员指派独立题质试答，或核对兼容计划并确认正式发布。
      试答不计入正式成绩；正式发布后，范围内学员可在新的自助测评中随机抽题。审核通过和发布均不代表信效度或准确度认证。
    </p>
    <div v-if="!allowed" class="review-state" role="status">
      {{
        access.error ||
        (!access.ready
          ? '正在核对访问权限…'
          : '仅系统管理员和获指派教师可进入审题。学员不可查看答案和量规。')
      }}
    </div>
    <template v-else>
      <form class="review-filters" @submit.prevent="changePage(0)">
        <label
          >审核状态<select v-model="status" :disabled="locked || loading">
            <option value="">全部状态</option>
            <option v-for="(label, key) in statusLabels" :key="key" :value="key">
              {{ label }}
            </option>
          </select></label
        >
        <label
          >发布状态<select
            v-model="publicationFilter"
            data-testid="review-publication-filter"
            :disabled="locked || loading"
          >
            <option value="">全部发布状态</option>
            <option value="published">已发布</option>
            <option value="ready">审核通过 · 待发布</option>
            <option value="unpublished">未发布</option>
          </select></label
        >
        <label
          >能力维度<select v-model="dimension" :disabled="locked || loading">
            <option value="">全部维度</option>
            <option v-for="row in DIMENSIONS" :key="row.code" :value="row.code">
              {{ row.name }}
            </option>
          </select></label
        >
        <label
          >题型<select v-model="itemType" :disabled="locked || loading">
            <option value="">全部题型</option>
            <option v-for="(label, key) in typeLabels" :key="key" :value="key">{{ label }}</option>
          </select></label
        >
        <button class="secondary-button" :disabled="locked || loading">筛选题目</button>
      </form>
      <p v-if="notice" class="review-notice" role="status">{{ notice }}</p>
      <div v-if="error" class="review-error" role="alert">
        {{ error }}
        <button
          v-if="!pending"
          type="button"
          class="text-button"
          :disabled="locked || loading"
          @click="load"
        >
          重新读取队列
        </button>
      </div>
      <div class="review-layout">
        <aside class="review-queue" aria-label="待审题目队列">
          <header class="queue-heading">
            <div class="queue-heading-title">
              <strong>题目列表</strong>
              <span class="queue-count">{{ loading ? '读取中…' : `共 ${total} 道题` }}</span>
            </div>
            <p>{{ admin ? '管理员可查看全部' : '仅显示已指派题目' }} · 点击查看完整资料</p>
          </header>
          <div class="queue-list" tabindex="0" aria-label="滚动浏览待审题目">
            <p v-if="loading" class="review-state" role="status">正在读取待审队列…</p>
            <p v-else-if="!rows.length" class="review-state">
              没有符合条件的题目。{{
                admin
                  ? '请调整筛选；尚未导入时，请先导入经过预检的修订包。'
                  : '请调整筛选，或联系管理员指派审题。'
              }}
            </p>
            <button
              v-for="row in rows"
              :key="row.id"
              type="button"
              class="queue-item"
              data-testid="bank-review-row"
              :aria-pressed="selected?.id === row.id"
              :disabled="locked"
              @click="open(row.id)"
            >
              <span class="queue-tags"
                >{{ dimensionLabel(row.dimension) }} ·
                {{ typeLabels[row.item_type] ?? row.item_type }}</span
              >
              <strong :title="row.stem">{{ row.stem }}</strong
              ><code>{{ row.code }}</code>
              <span class="queue-meta"
                ><span class="queue-statuses"
                  ><span :class="['status-pill', row.status]">{{ statusLabels[row.status] }}</span>
                  <span
                    :class="['status-pill', publicationClass(row)]"
                    data-testid="review-row-publication-status"
                    >{{ publicationLabel(row) }}</span
                  > </span
                ><span
                  >通过 {{ row.approval_count }} / {{ row.required_approvals ?? 1 }}</span
                ></span
              >
              <span v-if="row.own_decision" class="queue-own">
                {{ row.own_decision === 'approve' ? '我已通过 · 意见已保存' : '我已退回修改' }}
              </span>
            </button>
          </div>
          <footer class="review-pagination">
            <button
              type="button"
              class="text-button"
              :disabled="offset === 0 || locked || loading"
              @click="changePage(offset - 20)"
            >
              上一页</button
            ><span
              >{{ Math.floor(offset / 20) + 1 }} / {{ Math.max(1, Math.ceil(total / 20)) }}</span
            ><button
              type="button"
              class="text-button"
              :disabled="offset + 20 >= total || offset >= 10000 || locked || loading"
              @click="changePage(offset + 20)"
            >
              下一页
            </button>
          </footer>
        </aside>
        <div class="review-workspace">
          <p v-if="detailLoading" class="review-state" role="status">
            正在读取题面、答案和参考依据…
          </p>
          <article
            v-else-if="selected && revision"
            class="review-dossier"
            data-testid="bank-review-detail"
          >
            <header class="dossier-heading">
              <div>
                <p class="eyebrow">
                  {{ dimensionLabel(selected.dimension) }} · {{ typeLabels[selected.item_type] }} ·
                  修订 {{ selected.revision }}
                </p>
                <h3>{{ selected.code }}</h3>
                <p>
                  原题 {{ selected.original_code }} · {{ selected.review_count }} 人已审 /
                  {{ selected.approval_count }} 人通过
                </p>
              </div>
              <div class="dossier-statuses">
                <span :class="['status-pill', selected.status]">{{
                  statusLabels[selected.status]
                }}</span>
                <span
                  :class="['status-pill', publicationClass(selected)]"
                  data-testid="review-detail-publication-status"
                  >{{ publicationLabel(selected) }}</span
                >
                <time v-if="selected.publication_status === 'published' && selected.published_at"
                  >发布于 {{ date(selected.published_at) }}</time
                >
              </div>
            </header>
            <section class="review-progress" data-testid="review-progress" aria-label="审核进度">
              <strong
                >内容审核通过 {{ selected.approval_count }} /
                {{ selected.required_approvals ?? 1 }}</strong
              >
              <p>{{ progressMessage }}</p>
              <small
                >独立试答须管理员指派、学员本人同意；正式测评是否可抽取，以管理员正式发布及计划范围为准。</small
              >
            </section>
            <details class="digest">
              <summary>审题快照与留痕范围</summary>
              <p>
                意见绑定本次完整题稿和来源清单。题稿修改后必须生成新的修订包重新审核，不能用通用编辑器的其他版本替代此快照。
              </p>
              <code>SHA-256 {{ selected.digest }}</code>
              <p>导入时间：{{ date(selected.created_at) }}</p>
            </details>
            <nav class="dossier-tabs" aria-label="审题资料">
              <button
                type="button"
                data-testid="review-content-tab"
                :aria-pressed="pane === 'content'"
                @click="pane = 'content'"
              >
                题面与答案
              </button>
              <button
                type="button"
                data-testid="review-rubric-tab"
                :aria-pressed="pane === 'rubric'"
                @click="pane = 'rubric'"
              >
                量规与锚例
              </button>
              <button
                type="button"
                data-testid="review-sources-tab"
                :aria-pressed="pane === 'sources'"
                @click="pane = 'sources'"
              >
                来源与许可
              </button>
            </nav>
            <section v-if="pane === 'content'" class="dossier-content">
              <h4>题面</h4>
              <p class="pre-wrap stem">{{ revision.stem }}</p>
              <ol v-if="revision.options?.length" class="answer-options">
                <li v-for="(option, index) in revision.options" :key="index">
                  <strong>{{ String.fromCharCode(65 + index) }}.</strong> {{ option
                  }}<span v-if="index === revision.correct_index" class="status-pill"
                    >参考正确选项</span
                  >
                  <p v-if="revision.option_notes?.[index]">{{ revision.option_notes[index] }}</p>
                </li>
              </ol>
              <section class="reference-answer">
                <h4>参考答案 · 待人工校对</h4>
                <p class="pre-wrap">{{ revision.reference_answer }}</p>
              </section>
              <section v-if="revision.followups.length">
                <h4>标准化追问</h4>
                <ol>
                  <li v-for="question in revision.followups" :key="question">{{ question }}</li>
                </ol>
              </section>
              <details
                v-if="
                  revision.reference_sql ||
                  revision.reference_json ||
                  revision.verification_cases?.length
                "
              >
                <summary>参考产物与校验用例</summary>
                <pre v-if="revision.reference_sql">{{ revision.reference_sql }}</pre>
                <pre v-if="revision.reference_json">{{
                  JSON.stringify(revision.reference_json, null, 2)
                }}</pre>
                <pre v-if="revision.verification_cases?.length">{{
                  JSON.stringify(revision.verification_cases, null, 2)
                }}</pre>
              </details>
              <section>
                <h4>本轮修改说明</h4>
                <p>{{ revision.change_note }}</p>
                <p>
                  题目家族：<code>{{ revision.family }}</code> ·
                  {{ revision.tier === 'basic' ? '基础' : '进阶' }}
                </p>
              </section>
              <section class="attention">
                <h4>请重点核查</h4>
                <ul>
                  <li v-for="check in revision.human_checks" :key="check">{{ check }}</li>
                </ul>
              </section>
            </section>
            <section v-else-if="pane === 'rubric'" class="dossier-content">
              <p v-if="!revision.criteria.length" class="reference-answer">
                本题为确定性判分客观题。请核对正确选项的唯一性、各选项说明及参考答案，不使用开放题
                0–4 分量规。
              </p>
              <section
                v-for="criterion in revision.criteria"
                :key="criterion.name"
                class="criterion"
              >
                <h4>{{ criterion.name }}</h4>
                <dl>
                  <template v-for="(level, index) in criterion.levels" :key="index"
                    ><dt>{{ index }} 分</dt>
                    <dd>{{ level }}</dd></template
                  >
                </dl>
              </section>
              <section v-if="revision.examples.length">
                <h4>合成评分锚例</h4>
                <p>这些材料用于讨论评分规则，不是专家金标准，也不是真实学员或模型调用记录。</p>
                <article v-for="example in revision.examples" :key="example.label" class="example">
                  <h5>
                    {{ example.label }} <span>{{ example.scores.join(' / ') }} 分</span>
                  </h5>
                  <p class="pre-wrap">{{ example.answer }}</p>
                  <p class="muted">依据：{{ example.explanation }}</p>
                </article>
              </section>
            </section>
            <section v-else class="dossier-content">
              <section class="reference-answer">
                <h4>本题依据定位</h4>
                <p>{{ revision.source_locator }}</p>
              </section>
              <section v-if="revision.adaptation" class="adaptation">
                <h4>获许可改编声明</h4>
                <p>{{ revision.adaptation.attribution }}</p>
                <p>
                  许可：{{ revision.adaptation.license }} · 定位：{{ revision.adaptation.locator }}
                </p>
                <p>改动：{{ revision.adaptation.changes }}</p>
              </section>
              <article v-for="source in selected.sources" :key="source.id" class="source-record">
                <span class="status-pill">{{
                  source.use === 'licensed_adaptation'
                    ? '获许可改编'
                    : source.use === 'original_synthetic'
                      ? '原创合成材料'
                      : '参考依据 · 不等同题目授权'
                }}</span>
                <h4>
                  <a
                    v-if="safeUrl(source.url)"
                    :href="safeUrl(source.url)"
                    target="_blank"
                    rel="noopener noreferrer"
                    >{{ source.title }} ↗</a
                  ><span v-else>{{ source.title }}</span>
                </h4>
                <p>{{ source.authors }} · {{ source.version }}</p>
                <dl class="source-fields">
                  <dt>定位</dt>
                  <dd>{{ source.locator }}</dd>
                  <dt>许可</dt>
                  <dd>
                    {{ source.license }}
                    <a
                      v-if="safeUrl(source.license_url)"
                      :href="safeUrl(source.license_url)"
                      target="_blank"
                      rel="noopener noreferrer"
                      >查看许可 ↗</a
                    >
                  </dd>
                  <dt>核对记录</dt>
                  <dd>{{ source.license_evidence }}</dd>
                  <dt>适用限制</dt>
                  <dd>{{ source.limitations }}</dd>
                  <dt>使用规则</dt>
                  <dd>{{ source.delivery_rule }}</dd>
                </dl>
              </article>
            </section>
            <section class="decision-section" aria-labelledby="review-decision-heading">
              <h4 id="review-decision-heading">填写独立审核意见</h4>
              <p>
                以当前登录账号记录，每位审核人对同一修订稿只提交一次，提交后不可改写。退回意见须落实到新版本后再审。
              </p>
              <p v-if="!selected.can_review" class="review-notice">
                本账号已提交过此修订稿的意见，或该稿已有更新版本，当前不可再次提交。已有记录保留，正式发布状态另行核对。
              </p>
              <form v-else @submit.prevent="prepare">
                <fieldset :disabled="locked">
                  <legend>审核结论</legend>
                  <label class="radio"
                    ><input v-model="decision" type="radio" value="approve" />通过内容审核</label
                  ><label class="radio"
                    ><input
                      v-model="decision"
                      type="radio"
                      value="request_changes"
                    />退回修改</label
                  >
                </fieldset>
                <div class="checklist">
                  <label v-for="[key, label] in checkLabels" :key="key"
                    ><input
                      v-model="checks[key]"
                      :data-testid="`review-check-${key}`"
                      type="checkbox"
                      :disabled="locked"
                    />{{ label }}</label
                  >
                </div>
                <label class="comment-label"
                  >审核理由与修改建议<textarea
                    v-model="comment"
                    data-testid="review-comment"
                    rows="5"
                    minlength="10"
                    maxlength="4000"
                    :disabled="locked"
                    placeholder="请写清核对了哪些依据、发现什么问题、需要修改的具体位置。"
                  />
                </label>
                <div class="form-footer">
                  <span>{{ comment.trim().length }} / 4000 字 · 至少 10 字</span
                  ><button class="primary-button" data-testid="prepare-review" :disabled="locked">
                    核对并提交意见
                  </button>
                </div>
                <section
                  v-if="confirming"
                  class="review-confirm"
                  aria-labelledby="confirm-review-heading"
                >
                  <h5 id="confirm-review-heading">
                    确认{{ decision === 'approve' ? '通过内容审核' : '退回修改' }}：{{
                      selected.code
                    }}
                  </h5>
                  <p>
                    将保存本账号对修订
                    {{ selected.revision }}
                    的意见与核对记录，不发布题目、不改变已有成绩。提交后不可撤销或编辑。
                  </p>
                  <div>
                    <button
                      type="button"
                      class="secondary-button"
                      :disabled="locked"
                      @click="confirming = false"
                    >
                      返回核对</button
                    ><button
                      type="button"
                      class="primary-button"
                      data-testid="confirm-review"
                      :disabled="locked"
                      @click="save"
                    >
                      {{ busy ? '正在保存…' : '确认保存审核意见' }}
                    </button>
                  </div>
                </section>
              </form>
            </section>
            <section class="review-history">
              <h4>审核记录 · {{ selected.review_count }} 人已审</h4>
              <p v-if="!admin && selected.can_review">
                教师提交本人意见后才可查看已有意见；提交前不展示他人详细意见，上方人数与状态仍按实际显示。
              </p>
              <p v-else-if="!selected.reviews.length">暂无可显示的审核意见。</p>
              <article v-for="review in selected.reviews" :key="review.id">
                <header>
                  <strong>{{ review.reviewer_name }}</strong
                  ><span class="status-pill">{{
                    review.decision === 'approve' ? '通过内容审核' : '退回修改'
                  }}</span
                  ><time>{{ date(review.created_at) }}</time>
                </header>
                <p class="pre-wrap">{{ review.comment }}</p>
                <ul class="review-check-record">
                  <li v-for="[key, label] in checkLabels" :key="key">
                    {{ review.checks[key] ? '已核对' : '未确认' }} · {{ label.replace('已', '') }}
                  </li>
                </ul>
              </article>
            </section>
            <ReviewPublicationPanel
              v-if="admin"
              :key="selected.id"
              ref="publicationPanel"
              :packet-id="selected.id"
              :digest="selected.digest"
              :status="selected.status"
              :publication-status="selected.publication_status"
              :code="selected.code"
              :revision="selected.revision"
              :approval-count="selected.approval_count"
              :required-approvals="selected.required_approvals ?? 1"
              :disabled="busy || assignmentBusy || trialBusy"
              @busy="publicationBusy = $event"
              @publication="receivePublication"
              @published="afterPublication"
              @access-revoked="failure(new ApiError('publication access revoked', 403), '')"
            />
            <AdminTrialPanel
              v-if="admin"
              :key="selected.id"
              :packet-id="selected.id"
              :digest="selected.digest"
              :eligible="selected.trial_eligible === true && selected.status === 'reviewed'"
              :disabled="busy || assignmentBusy || publicationBusy"
              @busy="trialBusy = $event"
            />
            <ContentAssignmentPanel
              v-if="admin && !access.singlePlatform"
              :key="selected.item_version_id"
              :item-id="selected.item_version_id"
              :disabled="busy || trialBusy || publicationBusy"
              @busy="assignmentBusy = $event"
            />
          </article>
          <div v-else class="review-state dossier-empty">
            <span class="eyebrow">从一条可核对的依据开始</span>
            <h3>选择左侧题目，打开完整审题资料</h3>
            <p>题面、参考答案、量规锚例与来源许可并列呈现。你的意见会与本次题稿摘要一同留痕。</p>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.bank-review {
  --review-teal: #137f91;
  --review-ink: #183b46;
  --review-muted: #5d727a;
  --review-line: #d8e6ea;
  --review-pale: #eaf5f7;
  color: var(--review-ink);
  font-size: 14px;
  line-height: 1.75;
  container-type: inline-size;
  container-name: bank-review;
}
.queue-own {
  display: block;
  margin-top: 5px;
  color: #137f91;
  font-size: 12px;
}
.review-progress {
  margin: 20px 0;
  padding: 16px 20px;
  border: 1px solid #c3dfe4;
  border-radius: 14px;
  background: #eaf5f7;
}
.review-progress strong {
  color: #137f91;
  font-size: 16px;
}
.review-progress p {
  margin: 6px 0;
}
.review-progress small {
  color: #5d727a;
}
.review-intro,
.dossier-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}
.review-intro h2 {
  margin: 3px 0 6px;
  font-size: 24px;
}
.review-intro p,
.dossier-heading p {
  margin: 0;
  color: var(--review-muted);
}
.eyebrow {
  color: var(--review-teal) !important;
  font-size: 13px;
  font-weight: 700;
}
.isolation-badge,
.status-pill {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 7px;
  background: var(--review-pale);
  color: var(--review-teal);
  font-size: 13px;
  line-height: 1.6;
}
.isolation-badge {
  white-space: nowrap;
  border: 1px solid var(--review-line);
  margin-top: 6px;
}
.scope-note {
  background: var(--review-pale);
  border-left: 3px solid var(--review-teal);
  border-radius: 0 10px 10px 0;
  padding: 14px 18px;
  margin: 20px 0;
}
.review-filters {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: end;
  margin: 24px 0;
}
.review-filters label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
.review-filters select {
  min-width: 150px;
  border: 1px solid var(--review-line);
  padding: 10px 12px;
  border-radius: 8px;
  background: white;
  color: var(--review-ink);
  font: inherit;
}
.review-layout {
  display: grid;
  grid-template-columns: clamp(340px, 36%, 520px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.review-workspace {
  min-width: 0;
}
.review-queue,
.review-dossier,
.dossier-empty {
  background: white;
  border: 1px solid var(--review-line);
  border-radius: 16px;
  min-width: 0;
}
.review-queue {
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 88px;
  max-height: calc(100dvh - 112px);
  overflow: hidden;
}
.queue-list {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #9dbfc6 transparent;
  scrollbar-gutter: stable;
  scroll-padding-block: 8px;
}
.queue-list:focus-visible {
  outline: 2px solid var(--review-teal);
  outline-offset: -3px;
}
.queue-heading {
  flex-shrink: 0;
  padding: 18px 20px 16px;
  background: var(--review-pale);
  border-bottom: 1px solid var(--review-line);
}
.queue-heading-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.queue-heading-title strong {
  font-size: 17px;
}
.queue-heading .queue-count {
  padding: 2px 10px;
  border: 1px solid var(--review-line);
  border-radius: 999px;
  background: white;
  color: var(--review-teal);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.queue-heading p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--review-muted);
}
.queue-item {
  display: grid;
  width: 100%;
  gap: 9px;
  padding: 18px 20px;
  border: 0;
  border-bottom: 1px solid var(--review-line);
  border-left: 3px solid transparent;
  border-radius: 0;
  text-align: left;
  background: white;
  color: var(--review-ink);
  cursor: pointer;
  line-height: 1.6;
}
.queue-item:hover,
.queue-item[aria-pressed='true'] {
  background: #f2f9fa;
}
.queue-item[aria-pressed='true'] {
  border-left-color: var(--review-teal);
}
.queue-item strong {
  font-size: 15px;
  font-weight: 650;
  line-height: 1.75;
  overflow-wrap: anywhere;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.queue-tags,
.queue-item code {
  font-size: 13px;
  color: var(--review-muted);
}
.queue-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 13px;
  color: var(--review-muted);
}
.queue-meta > span:last-child {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.queue-statuses,
.dossier-statuses {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
.dossier-statuses {
  justify-content: flex-end;
}
.dossier-statuses time {
  flex-basis: 100%;
  text-align: right;
}
.publication-published {
  color: #11653b;
  background: #e2f5e9;
  border: 1px solid #8ccca6;
  font-weight: 700;
}
.publication-unpublished {
  color: #895411;
  background: #fff3d9;
  border: 1px solid #ead19b;
}
.publication-unknown {
  color: #5d6270;
  background: #f0f2f4;
}
.changes_requested {
  background: #fff1dd;
  color: #88501a;
}
.superseded {
  background: #f0f2f4;
  color: #5d6270;
}
.review-pagination {
  flex-shrink: 0;
  border-top: 1px solid var(--review-line);
  background: white;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 13px;
}
.text-button {
  padding: 6px 4px;
  background: none;
  border: 0;
  color: var(--review-teal);
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.review-state {
  padding: 28px 18px;
  color: var(--review-muted);
}
.dossier-empty {
  padding: 50px 34px;
  min-height: 300px;
}
.dossier-empty h3 {
  color: var(--review-ink);
  font-size: 20px;
}
.review-dossier {
  padding: 26px;
}
.dossier-heading h3 {
  margin: 6px 0;
  font-size: 19px;
  overflow-wrap: anywhere;
}
.dossier-heading > .status-pill {
  flex-shrink: 0;
}
.digest {
  margin-top: 18px;
  color: var(--review-muted);
  font-size: 13px;
}
summary {
  cursor: pointer;
  color: var(--review-teal);
  font-weight: 600;
}
code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.dossier-tabs {
  display: flex;
  gap: 22px;
  border-bottom: 1px solid var(--review-line);
  margin: 20px 0;
}
.dossier-tabs button {
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--review-muted);
  padding: 12px 0;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
}
.dossier-tabs button[aria-pressed='true'] {
  border-bottom-color: var(--review-teal);
  color: var(--review-teal);
  font-weight: 700;
}
h4 {
  font-size: 16px;
  margin: 0 0 10px;
}
h5 {
  font-size: 14px;
  margin: 0 0 10px;
}
.dossier-content p {
  margin: 8px 0;
}
.dossier-content section + section,
.dossier-content details {
  margin-top: 22px;
}
.pre-wrap {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.stem {
  font-size: 16px;
}
.answer-options {
  list-style: none;
  padding: 0;
}
.answer-options li {
  padding: 12px 0;
  border-bottom: 1px solid var(--review-line);
}
.answer-options .status-pill {
  margin-left: 8px;
}
.answer-options p,
.muted {
  color: var(--review-muted);
  font-size: 13px;
}
.reference-answer,
.attention {
  border-radius: 12px;
  background: var(--review-pale);
  padding: 18px;
  margin-top: 20px;
}
ul,
ol {
  padding-left: 22px;
}
li + li {
  margin-top: 8px;
}
.criterion dl {
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr);
  margin: 0;
  border: 1px solid var(--review-line);
  border-radius: 10px;
  overflow: hidden;
}
.criterion dt,
.criterion dd {
  padding: 12px;
  margin: 0;
  border-bottom: 1px solid var(--review-line);
}
.criterion dt {
  color: var(--review-teal);
  background: var(--review-pale);
  font-weight: 700;
}
.criterion dt:nth-last-child(2),
.criterion dd:last-child {
  border-bottom: 0;
}
.example,
.adaptation,
.source-record {
  border: 1px solid var(--review-line);
  border-radius: 12px;
  padding: 18px;
  margin-top: 16px;
}
.example h5 span {
  margin-left: 10px;
  color: var(--review-teal);
  font-variant-numeric: tabular-nums;
}
.source-record h4 {
  margin-top: 12px;
}
.source-fields {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 12px;
}
.source-fields dt {
  color: var(--review-muted);
}
.source-fields dd {
  margin: 0;
  overflow-wrap: anywhere;
}
a {
  color: var(--review-teal);
  text-underline-offset: 3px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f3f6f8;
  border-radius: 8px;
  padding: 16px;
  font-size: 13px;
  line-height: 1.7;
}
.decision-section,
.review-history {
  border-top: 1px solid var(--review-line);
  padding-top: 24px;
  margin-top: 28px;
}
.decision-section > p,
.review-history > p {
  font-size: 13px;
  color: var(--review-muted);
}
fieldset {
  border: 0;
  padding: 0;
  margin: 20px 0 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}
legend {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}
.radio,
.checklist label {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
input[type='checkbox'],
input[type='radio'] {
  accent-color: var(--review-teal);
  min-width: 17px;
  height: 17px;
  margin: 4px 0 0;
}
.checklist {
  display: grid;
  gap: 12px;
  background: #f6f9fa;
  padding: 16px;
  border-radius: 10px;
  font-size: 13px;
}
.comment-label {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  font-weight: 700;
}
textarea {
  width: 100%;
  border: 1px solid var(--review-line);
  border-radius: 10px;
  padding: 13px;
  resize: vertical;
  min-height: 140px;
  font: inherit;
  font-weight: 400;
  color: var(--review-ink);
}
.form-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 12px;
}
.form-footer span {
  font-size: 13px;
  color: var(--review-muted);
}
.review-confirm {
  padding: 18px;
  margin-top: 20px;
  border: 1px solid var(--review-teal);
  border-radius: 10px;
  background: var(--review-pale);
}
.review-confirm > div {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}
.review-notice,
.review-error {
  padding: 14px 18px;
  border-radius: 10px;
  font-size: 14px;
  margin: 16px 0;
}
.review-notice {
  color: var(--review-teal);
  background: var(--review-pale);
}
.review-error {
  color: #923628;
  background: #fff0ed;
}
.review-history article {
  padding: 18px 0;
  border-bottom: 1px solid var(--review-line);
}
.review-history article header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
time,
.review-check-record {
  font-size: 13px;
  color: var(--review-muted);
}
.review-check-record {
  list-style: none;
  padding: 0;
}
button {
  min-height: 40px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.58;
}
:is(button, input, select, textarea, summary, a):focus-visible {
  outline: 2px solid var(--review-teal);
  outline-offset: 3px;
}
@media (max-width: 1050px) {
  .review-dossier {
    padding: 20px;
  }
  .dossier-heading {
    flex-wrap: wrap;
  }
}
@media (max-width: 760px) {
  .review-layout {
    grid-template-columns: 1fr;
  }
  .review-queue {
    position: static;
    max-height: 480px;
  }
  .review-intro {
    flex-wrap: wrap;
  }
  .review-filters label {
    flex: 1;
    min-width: 130px;
  }
  .review-filters select {
    width: 100%;
    min-width: 0;
  }
  .dossier-tabs {
    gap: 15px;
  }
  .review-dossier {
    padding: 18px;
  }
  .source-fields {
    grid-template-columns: 1fr;
    gap: 5px;
  }
  .source-fields dd {
    margin-bottom: 10px;
  }
  .form-footer {
    align-items: stretch;
    flex-direction: column;
  }
}
/* Respond to the actual workspace width, including the app sidebar and browser zoom. */
@container bank-review (max-width: 960px) {
  .review-layout {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  .review-queue {
    position: static;
    max-height: 480px;
  }
  .dossier-heading {
    flex-wrap: wrap;
  }
}
</style>
