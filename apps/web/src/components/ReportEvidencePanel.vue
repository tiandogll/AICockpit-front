<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { X, ChevronRight } from '@lucide/vue'
import { DIMENSIONS, LEVEL_NAMES } from '../domain/capabilities'
import {
  getAssessmentReview,
  getAssessmentWorkspace,
  type AssessmentReview,
  type IssuedAssessmentItem,
} from '../services/assessmentWorkspaceApi'
import type { TrustedReport, DecisionTrace, EvidenceTrace } from '../services/reportApi'
import AssessmentReadOnlyAttachments from './AssessmentReadOnlyAttachments.vue'
import ReportPracticalEvidence from './ReportPracticalEvidence.vue'
import AssessmentQuestionMedia from './AssessmentQuestionMedia.vue'
const props = defineProps<{
  report: TrustedReport
  objectiveOnly?: boolean
  dimensionCodes?: string[]
}>()
const tab = ref<'key' | 'answers' | 'process'>('key')
const dialog = ref<HTMLDialogElement | null>(null)
const selectedEvidence = ref<{
  dimension: string
  decision: DecisionTrace
  evidence: EvidenceTrace
} | null>(null)
const review = ref<AssessmentReview | null>(null)
const selectedItem = ref('')
const items = ref<IssuedAssessmentItem[]>([])
const loading = ref(false),
  reviewLoading = ref(false),
  error = ref(''),
  reviewError = ref('')
const loaded = ref(false),
  page = ref(0)
let generation = 0
let reviewGeneration = 0
const evidenceRows = computed(() =>
  DIMENSIONS.flatMap((dimension) =>
    (
      props.report.payload.dimensions?.[dimension.code]?.rubric_measurement?.decisions ?? []
    ).flatMap((decision) =>
      (decision.tasks ?? []).flatMap((task) =>
        (task.evidence ?? []).map((evidence) => ({
          dimension: dimension.name,
          color: dimension.color,
          decision,
          task,
          evidence,
        })),
      ),
    ),
  ),
)
const pageRows = computed(() => items.value.slice(page.value * 6, page.value * 6 + 6))
const decisions = computed(() =>
  DIMENSIONS.flatMap((dimension) =>
    (props.report.payload.dimensions?.[dimension.code]?.rubric_measurement?.decisions ?? []).map(
      (decision) => ({ dimension: dimension.name, decision }),
    ),
  ),
)
const hasOpenEvidence = computed(
  () =>
    Object.values(props.report.payload.dimensions ?? {}).some(
      (dimension) =>
        (dimension.rubric_measurement?.completed ?? 0) > 0 ||
        (dimension.rubric_measurement?.pending ?? 0) > 0 ||
        (dimension.rubric_measurement?.decisions?.length ?? 0) > 0,
    ) ||
    ['scored_open_answers', 'pending_scoring', 'needs_review', 'blocked_scoring'].some(
      (key) => (props.report.payload.summary?.[key] ?? 0) > 0,
    ) ||
    (props.report.processing?.pending_answers ?? 0) > 0 ||
    (props.report.processing?.review_answers ?? 0) > 0 ||
    (props.report.processing?.failed_answers ?? 0) > 0,
)
const onlyObjective = computed(() => props.objectiveOnly && !hasOpenEvidence.value)
const processDimensions = computed(() =>
  DIMENSIONS.filter((dimension) => {
    if (!props.dimensionCodes) return true
    const value = props.report.payload.dimensions?.[dimension.code]
    return (
      props.dimensionCodes.includes(dimension.code) ||
      (value?.objective_measurement?.evidence_count ?? value?.evidence_count ?? 0) > 0 ||
      (value?.synthesis?.evidence_count ?? 0) > 0 ||
      (value?.rubric_measurement?.completed ?? 0) > 0 ||
      (value?.rubric_measurement?.pending ?? 0) > 0 ||
      (value?.rubric_measurement?.decisions?.length ?? 0) > 0
    )
  }),
)
const openScoringPending = computed(
  () =>
    !onlyObjective.value &&
    (props.report.payload.measurement_status === 'pending_scoring' ||
      props.report.payload.measurement_status === 'needs_review' ||
      (props.report.processing?.pending_answers ?? 0) > 0 ||
      (props.report.processing?.review_answers ?? 0) > 0 ||
      ['pending_scoring', 'needs_review', 'blocked_scoring'].some(
        (key) => (props.report.payload.summary?.[key] ?? 0) > 0,
      ) ||
      Object.values(props.report.payload.dimensions ?? {}).some(
        (dimension) => (dimension.rubric_measurement?.pending ?? 0) > 0,
      )),
)
async function loadAnswers() {
  if (loading.value) return
  const ticket = ++generation
  error.value = ''
  loading.value = true
  try {
    const data = await getAssessmentWorkspace(props.report.session_id)
    if (ticket === generation) {
      items.value = data.items.filter((item) => Boolean(item.answered_at))
      loaded.value = true
      page.value = 0
    }
  } catch (cause) {
    if (ticket === generation)
      error.value = cause instanceof Error ? cause.message : '回答目录读取失败。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function selectTab(value: typeof tab.value) {
  tab.value = value
  if (value === 'answers' && !loaded.value) void loadAnswers()
}
function showEvidence(row: (typeof evidenceRows.value)[number]) {
  reviewGeneration++
  reviewLoading.value = false
  selectedItem.value = ''
  selectedEvidence.value = row
  review.value = null
  reviewError.value = ''
  dialog.value?.showModal()
}
async function showAnswer(itemId: string) {
  const ticket = ++reviewGeneration
  selectedEvidence.value = null
  selectedItem.value = itemId
  review.value = null
  reviewError.value = ''
  reviewLoading.value = true
  if (!dialog.value?.open) dialog.value?.showModal()
  try {
    const data = await getAssessmentReview(props.report.session_id, itemId)
    if (ticket === reviewGeneration) review.value = data
  } catch (cause) {
    if (ticket === reviewGeneration)
      reviewError.value = cause instanceof Error ? cause.message : '原回答读取失败。'
  } finally {
    if (ticket === reviewGeneration) reviewLoading.value = false
  }
}
function close() {
  reviewGeneration++
  reviewLoading.value = false
  review.value = null
  selectedEvidence.value = null
  selectedItem.value = ''
  reviewError.value = ''
  dialog.value?.close()
}
function openAnswerDirectory() {
  close()
  selectTab('answers')
}
function dimensionName(code: string) {
  return DIMENSIONS.find((d) => d.code === code)?.name ?? code
}
function fieldName(key: string) {
  return (
    (
      {
        selected_option: '选择的选项',
        final_response: '最终回答',
        final_output: '最终产物',
        final_reflection: '最终反思',
        reflection: '反思',
        content: '内容',
        response: '回答',
        artifact: '最终产物',
        transcript: '对话记录',
        text: '文字内容',
      } as Record<string, string>
    )[key] ?? key
  )
}
function formatValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}
onBeforeUnmount(() => {
  generation++
  reviewGeneration++
})
watch(
  [() => props.report.session_id, () => props.report.id, () => props.report.revision],
  () => {
    generation++
    close()
    loaded.value = false
    loading.value = false
    items.value = []
    review.value = null
    selectedEvidence.value = null
    error.value = ''
    page.value = 0
    tab.value = evidenceRows.value.length ? 'key' : 'answers'
    if (tab.value === 'answers') void loadAnswers()
  },
  { immediate: true },
)
watch(evidenceRows, (rows) => {
  if (!rows.length && tab.value === 'key') selectTab('answers')
})
</script>
<template>
  <section class="report-evidence" aria-label="评分证据">
    <header>
      <div>
        <h2>评分证据</h2>
        <p>
          {{
            onlyObjective
              ? '查看本人已提交回答，以及各维度的能力估计与测量说明。'
              : '查看本人已提交回答、评分引用与裁决过程。'
          }}
        </p>
      </div>
      <div class="evidence-tabs" aria-label="证据视图">
        <button v-if="evidenceRows.length" :aria-pressed="tab === 'key'" @click="selectTab('key')">
          关键证据 {{ evidenceRows.length }}
        </button>
        <button :aria-pressed="tab === 'answers'" @click="selectTab('answers')">
          全部回答 {{ report.payload.summary?.answered ?? '—' }}
        </button>
        <button :aria-pressed="tab === 'process'" @click="selectTab('process')">评分过程</button>
      </div>
    </header>
    <div v-if="tab === 'key'" class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>能力维度</th>
            <th>回答证据</th>
            <th>评分依据</th>
            <th>结果</th>
            <th><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, index) in evidenceRows.slice(0, 3)"
            :key="row.task.id + ':' + row.evidence.evidence_hash + ':' + index"
          >
            <th><i :style="{ background: row.color }"></i>{{ row.dimension }}</th>
            <td class="quote">“{{ row.evidence.quote }}”</td>
            <td class="reason">{{ row.evidence.rationale }}</td>
            <td>
              <strong>{{ row.decision.score }}/4</strong
              ><small :title="row.evidence.verified ? '证据已校验' : '证据待确认'">{{
                row.decision.source === 'human' ? '人工已裁决' : '自动裁决'
              }}</small>
            </td>
            <td>
              <button class="text-action" @click="showEvidence(row)">
                查看证据 <ChevronRight :size="15" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!evidenceRows.length" class="empty">
        暂无可展示的开放题裁决证据。客观题依据见测量说明；待评分或待复核不代表零分。
      </p>
    </div>
    <div v-else-if="tab === 'answers'" class="answers-directory">
      <p v-if="openScoringPending" class="scoring-note">
        开放题仍在评分或复核中，待处理不代表零分；可先回看已提交回答。
      </p>
      <p v-if="loading" role="status">正在读取本人已提交回答…</p>
      <p v-if="error" role="alert">
        {{ error }} <button class="text-action" @click="loadAnswers">重新读取回答</button>
      </p>
      <div v-if="!loading && !error" class="table-scroll">
        <table v-if="items.length" class="answers-table">
          <thead>
            <tr>
              <th>题号</th>
              <th>能力维度</th>
              <th>题型</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in pageRows" :key="item.item_version_id">
              <td data-label="题号">第 {{ item.sequence }} 题</td>
              <td data-label="能力维度">{{ dimensionName(item.dimension_code) }}</td>
              <td data-label="题型">
                {{
                  { objective: '客观题', dialogue: '对话题', practical: '实操任务' }[item.item_type]
                }}
              </td>
              <td data-label="状态">已提交 · 只读</td>
              <td class="answer-action">
                <button class="text-action" @click="showAnswer(item.item_version_id)">
                  查看原回答 <ChevronRight :size="15" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!items.length" class="empty">没有可读取的已提交回答；清理后的原文可能不再保留。</p>
      </div>
      <nav v-if="items.length > 6" class="pagination" aria-label="回答分页">
        <button :disabled="page === 0" @click="page--">上一页</button
        ><span>{{ page + 1 }} / {{ Math.ceil(items.length / 6) }}</span
        ><button :disabled="(page + 1) * 6 >= items.length" @click="page++">下一页</button>
      </nav>
    </div>
    <div v-else class="process-ledger">
      <p>
        评分策略：{{ report.payload.scoring_policy_version ?? 'objective-measurement-v1' }} · 报告
        R{{ report.revision }}
      </p>
      <details open>
        <summary>
          {{
            onlyObjective
              ? '测量说明：客观题能力估计'
              : '测量说明：客观能力估计与开放题量规分开呈现'
          }}
        </summary>
        <p>0–100为证据指数，不是正式人群常模；标准误属于客观θ尺度，不是整个报告可信率。</p>
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>维度</th>
                <th>客观 θ</th>
                <th>标准误</th>
                <th>客观证据</th>
                <th>等级</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="dimension in processDimensions" :key="dimension.code">
                <th>{{ dimension.name }}</th>
                <td>
                  {{
                    (
                      report.payload.dimensions?.[dimension.code]?.objective_measurement?.theta ??
                      report.payload.dimensions?.[dimension.code]?.theta
                    )?.toFixed(2) ?? '—'
                  }}
                </td>
                <td>
                  {{
                    (
                      report.payload.dimensions?.[dimension.code]?.objective_measurement
                        ?.standard_error ??
                      report.payload.dimensions?.[dimension.code]?.standard_error
                    )?.toFixed(2) ?? '—'
                  }}
                </td>
                <td>
                  {{
                    report.payload.dimensions?.[dimension.code]?.objective_measurement
                      ?.evidence_count ??
                    report.payload.dimensions?.[dimension.code]?.evidence_count ??
                    0
                  }}
                </td>
                <td>
                  {{
                    LEVEL_NAMES[
                      report.payload.dimensions?.[dimension.code]?.synthesis?.level ?? ''
                    ] ?? '见维度说明'
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
      <details v-for="row in decisions" :key="row.decision.decision_id">
        <summary>
          {{ row.dimension }} · {{ row.decision.score }} / 4 ·
          {{ row.decision.source === 'human' ? '人工仲裁' : '自动裁决' }}
        </summary>
        <p>
          裁决 {{ row.decision.decision_id }} · 策略 {{ row.decision.policy_version ?? '未记录' }}
        </p>
        <section v-for="task in row.decision.tasks" :key="task.id">
          <h3>{{ task.role }} · {{ task.model }}</h3>
          <p>
            提示词 {{ task.prompt_version }} · 结果哈希 <code>{{ task.result_hash }}</code>
          </p>
          <blockquote v-for="evidence in task.evidence" :key="evidence.evidence_hash">
            <strong>{{ evidence.criterion_code }} · {{ evidence.score }} / 4</strong>
            <p>{{ evidence.quote }}</p>
            <p>{{ evidence.rationale }}</p>
            <small
              >{{ evidence.verified ? '证据已校验' : '证据未确认' }} · 模型自报置信度
              {{ evidence.confidence }}（非准确率）</small
            >
            <p>
              <code>{{ evidence.evidence_hash }}</code>
            </p>
          </blockquote>
        </section>
      </details>
      <p v-if="!onlyObjective && !decisions.length" class="empty">
        {{
          openScoringPending
            ? '开放题仍在评分或复核中，待处理不代表零分。'
            : '当前没有已完成的开放题最终裁决；已提交原文可在「全部回答」中查看。'
        }}
      </p>
    </div>
    <dialog ref="dialog" class="evidence-dialog" aria-label="只读证据详情" @cancel="close">
      <header>
        <h2>{{ selectedEvidence ? '评分引用与依据' : '原回答 · 只读' }}</h2>
        <button class="close-button" aria-label="关闭证据详情" @click="close">
          <X :size="22" />
        </button>
      </header>
      <template v-if="selectedEvidence"
        ><h3>{{ selectedEvidence.dimension }} · {{ selectedEvidence.evidence.criterion_code }}</h3>
        <blockquote>{{ selectedEvidence.evidence.quote }}</blockquote>
        <p>{{ selectedEvidence.evidence.rationale }}</p>
        <p>
          量规分 {{ selectedEvidence.evidence.score }}/4 ·
          {{ selectedEvidence.evidence.verified ? '引用已校验' : '引用待确认' }}
        </p>
        <p>模型自报置信度 {{ selectedEvidence.evidence.confidence }}，不代表测评准确率。</p>
        <p>
          证据哈希 <code>{{ selectedEvidence.evidence.evidence_hash }}</code>
        </p>
        <p class="empty">这是评分引用，不等于完整回答。</p>
        <button class="text-action" @click="openAnswerDirectory">
          进入全部回答，查看原文
        </button></template
      >
      <p v-if="reviewLoading" role="status">正在读取已提交原文…</p>
      <p v-if="reviewError" role="alert">
        {{ reviewError }} <button @click="showAnswer(selectedItem)">重试原回答</button>
      </p>
      <template v-if="review"
        ><h3>{{ review.item.stem }}</h3>
        <AssessmentQuestionMedia :media="review.item.configuration.media" />
        <p class="empty">已提交回答不可修改；不展示标准答案或隐藏评分提示。</p>
        <article v-for="turn in review.dialogue_turns" :key="turn.sequence">
          <h4>第 {{ turn.sequence }} 轮回答</h4>
          <p class="answer-text">{{ turn.user_content }}</p>
          <h4>面试官</h4>
          <p class="answer-text">{{ turn.assistant_content ?? '此轮没有已保存的追问' }}</p>
        </article>
        <template v-if="!review.dialogue_turns.length"
          ><article v-for="(value, key) in review.response" :key="key">
            <h4>{{ fieldName(String(key)) }}</h4>
            <pre>{{ formatValue(value) }}</pre>
          </article>
          <p v-if="!review.response">原文未提供或已按保留期清理。</p></template
        ><ReportPracticalEvidence
          v-if="review.item.item_type === 'practical'"
          :session-id="report.session_id"
          :item-id="selectedItem" /><AssessmentReadOnlyAttachments
          v-if="review.item.item_type === 'dialogue'"
          :session-id="report.session_id"
          :item-id="selectedItem"
      /></template>
    </dialog>
  </section>
</template>
<style scoped>
.report-evidence {
  border: 1px solid #bdcde7;
  border-radius: 18px;
  padding: 20px 28px;
  box-shadow: 0 3px 7px #5574a733;
  min-width: 0;
  background: white;
  min-height: 316px;
  color: #555;
}
.report-evidence > header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 14px;
}
h2 {
  font-size: 20px;
  margin: 0;
}
header p {
  font-size: 14px;
  color: #737373;
  margin-top: 7px;
}
.evidence-tabs {
  display: flex;
  gap: 10px;
  flex: none;
}
.evidence-tabs button {
  border: 0;
  background: none;
  color: #747474;
  padding: 10px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 5px;
  cursor: pointer;
}
.evidence-tabs button[aria-pressed='true'] {
  color: #427eff;
  background: #e6edff;
}
.table-scroll {
  position: relative;
  overflow-x: auto;
  max-width: 100%;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  text-align: left;
  min-width: 800px;
  table-layout: fixed;
}
th:nth-child(1) {
  width: 14%;
}
th:nth-child(2) {
  width: 28%;
}
th:nth-child(3) {
  width: 28%;
}
th:nth-child(4) {
  width: 15%;
}
th:nth-child(5) {
  width: 15%;
}
th,
td {
  border-top: 1px solid #bfc1c5;
  padding: 8px 5px;
  line-height: 1.4;
  vertical-align: middle;
}
thead th {
  color: #777;
  font-size: 13px;
}
tbody th {
  white-space: nowrap;
}
td.quote,
td.reason {
  max-width: 245px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
th i {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 8px;
}
td strong {
  color: #219bac;
}
td small {
  display: block;
  color: #757575;
  font-size: 12px;
}
.text-action {
  display: inline-flex;
  align-items: center;
  color: #427eff;
  font-size: 13px;
  background: none;
  border: 0;
  cursor: pointer;
  min-height: 36px;
  white-space: nowrap;
}
.empty {
  font-size: 13px;
  color: #757575;
  line-height: 1.8;
  margin: 16px 0;
}
.scoring-note {
  margin: 0 0 14px;
  padding: 12px 14px;
  border-radius: 8px;
  color: #795d24;
  background: #fff8e9;
  font-size: 14px;
  line-height: 1.7;
}
.answers-table {
  min-width: 620px;
}
.answers-table th:nth-child(1) {
  width: 12%;
}
.answers-table th:nth-child(2) {
  width: 24%;
}
.answers-table th:nth-child(3) {
  width: 18%;
}
.answers-table th:nth-child(4),
.answers-table th:nth-child(5) {
  width: 23%;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 14px;
  margin-top: 15px;
}
.pagination button {
  padding: 8px;
  border: 1px solid #bdcde7;
  border-radius: 5px;
  background: white;
  cursor: pointer;
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.process-ledger {
  font-size: 14px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.process-ledger details {
  border-top: 1px solid #ccd4de;
  padding: 14px 0;
}
.process-ledger summary {
  cursor: pointer;
  font-weight: 600;
}
.process-ledger h3 {
  font-size: 15px;
}
.process-ledger section {
  padding: 14px;
  background: #f6f8fa;
  margin-top: 14px;
}
.process-ledger blockquote {
  border-left: 3px solid #219bac;
  padding: 12px;
  background: white;
  margin-top: 12px;
}
.evidence-dialog {
  width: min(850px, calc(100vw - 32px));
  max-height: 85vh;
  margin: auto;
  padding: 28px;
  border: 1px solid #bdcde7;
  border-radius: 18px;
  color: #555;
}
.evidence-dialog::backdrop {
  background: #173a4966;
}
.evidence-dialog header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}
.close-button {
  border: 0;
  background: none;
  cursor: pointer;
  min-width: 44px;
  min-height: 44px;
}
.evidence-dialog p,
.evidence-dialog blockquote {
  line-height: 1.8;
  margin: 12px 0;
}
.evidence-dialog article {
  padding: 15px 0;
  border-top: 1px solid #dae1e9;
}
.evidence-dialog pre,
.answer-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: inherit;
  font-size: 14px;
}
code {
  overflow-wrap: anywhere;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
button:focus-visible,
summary:focus-visible {
  outline: 2px solid #427eff;
  outline-offset: 3px;
}
@media (max-width: 1350px) {
  .report-evidence > header {
    flex-direction: column;
  }
  .evidence-tabs {
    flex-wrap: wrap;
    gap: 5px;
  }
  .report-evidence {
    padding: 20px;
  }
}
@media (max-width: 560px) {
  .report-evidence {
    padding: 18px 14px;
  }
  .evidence-tabs button {
    font-size: 13px;
    padding: 8px;
  }
  .evidence-dialog {
    padding: 18px;
  }
  .answers-table,
  .answers-table tbody,
  .answers-table tr,
  .answers-table td {
    display: block;
    min-width: 0;
    width: 100%;
  }
  .answers-table thead {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
  .answers-table tr {
    border-top: 1px solid #dae1e9;
    padding: 12px 0;
  }
  .answers-table td {
    border: 0;
    padding: 4px 0;
  }
  .answers-table td[data-label]::before {
    content: attr(data-label);
    display: inline-block;
    width: 82px;
    color: #757575;
  }
  .answer-action .text-action {
    min-height: 44px;
  }
}
</style>
