<script setup lang="ts">
import '../assets/admin-workspaces.css'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AssessmentQuestionMedia from '../components/AssessmentQuestionMedia.vue'
import ReviewPracticalMaterials from '../components/ReviewPracticalMaterials.vue'
import ReviewDialogueAttachments from '../components/ReviewDialogueAttachments.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { DIMENSIONS } from '../domain/capabilities'
import { CheckCircle2, FileSearch, Scale, ShieldCheck, ArrowRight, Filter } from '@lucide/vue'

import { operationKey } from '../services/assessmentApi'
import {
  getReview,
  listReviews,
  resolveReview,
  type ReviewDetail,
  type ReviewQueueItem,
} from '../services/reviewApi'

const access = useAccessStore()
const auth = useAuthStore()
// Participation membership is not management authority. Use the same server
// capabilities as the shell; the review API still authorizes every operation.
const organizations = computed(() =>
  access.ready ? access.organizations.filter((item) => item.capabilities.includes('reviews')) : [],
)
const organizationId = computed({
  get: () => access.organizationId,
  set: (id: string) => {
    void access.selectOrganization(id)
  },
})
const allowed = computed(
  () =>
    auth.isAuthenticated &&
    Boolean(auth.user?.id) &&
    access.ready &&
    Boolean(organizationId.value) &&
    access.can('reviews'),
)
const queue = ref<ReviewQueueItem[]>([])
const selectedId = ref('')
const detail = ref<ReviewDetail | null>(null)
const score = ref(0)
const rationale = ref('')
const evidence = ref('')
const reviewKey = ref(operationKey('human-review'))
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const detailLoading = ref(false)
const reasonFilter = ref('')
const visibleQueue = computed(() => queue.value.filter((item) =>
  !reasonFilter.value || item.review_reasons.includes(reasonFilter.value),
))
const queueStats = computed(() => [
  { label: '已加载待复核', value: queue.value.length, hint: '当前组织 · 本次读取' },
  { label: '双模型分差', value: queue.value.filter((item) => item.review_reasons.includes('score_disagreement')).length, hint: '需要核对评分依据' },
  { label: '低置信度', value: queue.value.filter((item) => item.review_reasons.includes('low_confidence')).length, hint: '需要补充人工判断' },
  { label: '安全标记', value: queue.value.filter((item) => item.review_reasons.includes('safety_flag')).length, hint: '先核验，再形成结论' },
])
const reviewGuide = ref(false)
let detailGeneration = 0
let queueGeneration = 0
let scopeGeneration = 0

const dimensions = Object.fromEntries(DIMENSIONS.map((row) => [row.code, row.name]))
const canResolve = computed(
  () =>
    allowed.value &&
    detail.value &&
    detail.value.state === 'needs_review' &&
    !busy.value &&
    rationale.value.trim() &&
    evidence.value.trim() &&
    score.value >= 0 &&
    score.value <= 4,
)
const answerText = computed(() => JSON.stringify(detail.value?.answer ?? {}, null, 2))
const rubricText = computed(() => JSON.stringify(detail.value?.rubric.criteria ?? {}, null, 2))
const reasonLabels: Record<string, string> = {
  score_disagreement: '双模型分差',
  low_confidence: '低置信度',
  unverified_evidence: '证据未定位',
  safety_flag: '安全标记',
  provider_degraded: '模型降级',
  model_mismatch: '模型版本不符',
  dialogue_attachment_requires_human_review: '对话附件需人工查看',
}

async function loadDetail(id: string) {
  if (!allowed.value || !queue.value.some((item) => item.decision_id === id)) return
  const scope = scopeGeneration
  const ticket = ++detailGeneration
  selectedId.value = id
  detail.value = null
  detailLoading.value = true
  rationale.value = ''
  evidence.value = ''
  error.value = ''
  try {
    const result = await getReview(id)
    if (ticket !== detailGeneration || scope !== scopeGeneration || !allowed.value) return
    detail.value = result
    score.value = result.provisional_score ?? 0
    reviewKey.value = operationKey('human-review')
  } catch (caught) {
    if (ticket === detailGeneration && scope === scopeGeneration)
      error.value = caught instanceof Error ? caught.message : '评分卷宗读取失败。'
  } finally {
    if (ticket === detailGeneration && scope === scopeGeneration) detailLoading.value = false
  }
}
async function loadQueue() {
  const scope = scopeGeneration
  const org = organizationId.value
  const ticket = ++queueGeneration
  detailGeneration += 1
  queue.value = []
  reasonFilter.value = ''
  detail.value = null
  selectedId.value = ''
  detailLoading.value = false
  rationale.value = ''
  evidence.value = ''
  score.value = 0
  error.value = ''
  loading.value = false
  if (!allowed.value) return
  loading.value = true
  try {
    const result = await listReviews(org)
    if (ticket !== queueGeneration || scope !== scopeGeneration || !allowed.value) return
    queue.value = result
    if (result.length) await loadDetail(result[0]!.decision_id)
  } catch (caught) {
    if (ticket === queueGeneration && scope === scopeGeneration)
      error.value = caught instanceof Error ? caught.message : '复核队列读取失败。'
  } finally {
    if (ticket === queueGeneration && scope === scopeGeneration) loading.value = false
  }
}
async function sealReview() {
  if (!detail.value || !canResolve.value) return
  const scope = scopeGeneration
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await resolveReview(
      detail.value.decision_id,
      { score: score.value, rationale: rationale.value.trim(), evidence: evidence.value.trim() },
      reviewKey.value,
    )
    if (scope !== scopeGeneration || !allowed.value) return
    notice.value = '最终评分已封存。'
    await loadQueue()
  } catch (caught) {
    if (scope === scopeGeneration)
      error.value = caught instanceof Error ? caught.message : '最终评分未能封存。'
  } finally {
    if (scope === scopeGeneration) busy.value = false
  }
}
watch(
  () => [auth.user?.id, auth.isAuthenticated, access.ready, organizationId.value, allowed.value],
  () => {
    scopeGeneration += 1
    busy.value = false
    notice.value = ''
    void loadQueue()
  },
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  void access.load()
})
onBeforeUnmount(() => {
  scopeGeneration += 1
  detailGeneration += 1
  queueGeneration += 1
})
</script>

<template>
  <section class="review-page shell admin-workspace">
    <header class="review-heading">
      <div>
        <span class="eyebrow">Human review</span>
        <h1>评分复核工作台</h1>
        <p>核对原始回答与评分证据，由评估员确认最终结论。</p>
      </div>
      <label v-if="!access.singlePlatform"
        >当前组织<select
          v-model="organizationId"
          :disabled="busy || !access.ready || !organizations.length"
        >
          <option v-if="!allowed" :value="organizationId" disabled>请选择有复核权限的组织</option>
          <option
            v-for="organization in organizations"
            :key="organization.id"
            :value="organization.id"
          >
            {{ organization.name }}
          </option>
        </select></label
      >
      <button class="secondary-button" :aria-expanded="reviewGuide" @click="reviewGuide = !reviewGuide">复核规范</button>
    </header>
    <div v-if="reviewGuide" class="admin-note review-guide">
      <strong>先看证据，再给结论。</strong>核对冻结量规、学员原始回答及附件；说明最终评分、判断依据与核验证据。
      模型建议不是最终分。提交会封存人工结论并保留审计记录，不改写学员回答。
    </div>
    <section v-if="allowed" class="admin-stats" aria-label="当前复核队列摘要">
      <article v-for="stat in queueStats" :key="stat.label" class="admin-stat">
        <span>{{ stat.label }}</span><strong>{{ loading || error ? '—' : stat.value }}</strong><small>{{ stat.hint }}</small>
      </article>
    </section>
    <div v-if="error" class="review-alert" role="alert">
      {{ error }}
      <button :disabled="busy || loading" @click="loadQueue">重新读取队列</button>
    </div>
    <div v-if="notice" class="review-notice" role="status">
      <CheckCircle2 :size="17" />{{ notice }}
    </div>
    <div v-if="!auth.isAuthenticated || !auth.user" class="review-empty surface" role="status">
      <h2>请先登录</h2>
      <p>登录后按账号的实际权限读取评分复核队列。</p>
    </div>
    <div
      v-else-if="!access.ready"
      class="review-empty surface"
      :role="access.error ? 'alert' : 'status'"
    >
      <h2>{{ access.error ? '访问权限读取失败' : '正在确认访问权限…' }}</h2>
      <p>{{ access.error || '请稍候，正在读取当前账号可复核的组织。' }}</p>
      <button v-if="access.error" @click="access.load(true)">重试权限读取</button>
    </div>
    <div v-else-if="!organizationId && organizations.length" class="review-empty surface">
      <h2>请选择组织</h2>
      <p>在上方选择有复核权限的组织后读取待复核评分。</p>
    </div>
    <div v-else-if="!allowed" class="review-empty surface">
      <ShieldCheck :size="32" />
      <h2>当前组织没有评分复核权限</h2>
      <p>需由系统管理员或当前组织的评估员、组织管理员读取复核证据。</p>
      <p v-if="!access.singlePlatform && organizations.length">你在其他组织有复核权限，可从上方切换组织。</p>
      <button @click="access.load(true)">重新核对权限</button>
    </div>
    <div v-else-if="loading" class="review-loading" role="status">正在读取待复核证据卷宗……</div>
    <div v-else class="desk">
      <aside class="queue surface">
        <header>
          <FileSearch :size="17" /><strong>复核队列</strong><span>{{ queue.length }}</span>
        </header>
        <label class="queue-filter"><Filter :size="15" /><span class="filter-label">复核原因</span>
          <select v-model="reasonFilter" :disabled="busy" aria-label="筛选复核原因">
            <option value="">全部原因</option>
            <option v-for="(label, key) in reasonLabels" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <button
          v-for="item in visibleQueue"
          :key="item.decision_id"
          :class="{ active: selectedId === item.decision_id }"
          :aria-current="selectedId === item.decision_id ? 'true' : undefined"
          :disabled="busy"
          @click="loadDetail(item.decision_id)"
        >
          <span>{{ dimensions[item.dimension_code] }}</span
          ><strong
            >{{ item.item_type === 'dialogue' ? '对话题' : '实操题' }} ·
            {{
              item.provisional_score === null
                ? '待人工评分'
                : `建议 ${item.provisional_score.toFixed(1)}`
            }}</strong
          ><small>{{
            item.review_reasons.map((reason) => reasonLabels[reason] ?? reason).join(' / ')
          }}</small>
          <time>{{ new Date(item.updated_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</time>
        </button>
        <p v-if="!queue.length">当前组织没有等待人工处理的评分。</p>
        <p v-else-if="!visibleQueue.length">当前筛选下没有待复核回答。</p>
        <footer class="queue-footnote">显示 {{ visibleQueue.length }} / {{ queue.length }} 份已加载记录。原因可重叠，不代表历史总量。</footer>
      </aside>
      <div v-if="detail" class="dossier surface">
        <header>
          <div>
            <span>回答卷宗 · {{ detail.decision_id.slice(0, 8) }}</span>
            <h2>{{ detail.item.stem }}</h2>
            <p>
              {{ dimensions[detail.item.dimension_code] }} · {{ detail.rubric.title }} v{{
                detail.rubric.version
              }}
            </p>
          </div>
          <div class="provisional">
            <small>模型建议</small
            ><strong>{{ detail.provisional_score?.toFixed(2) ?? '待定' }}</strong
            ><span v-if="detail.provisional_score !== null">/ 4</span>
          </div>
        </header>
        <div class="review-dossier-body"><div class="review-evidence-column">
        <div class="dossier-reasons"><span v-for="reason in detail.review_reasons" :key="reason" class="admin-chip">{{ reasonLabels[reason] ?? reason }}</span></div>
        <AssessmentQuestionMedia :media="detail.item.media" />
        <details class="answer-sheet">
          <summary>查看冻结评分量规与 0–4 分行为锚点</summary>
          <pre>{{ rubricText }}</pre>
        </details>
        <section class="answer-sheet">
          <span>学员原始回答 · 按提交内容展示</span>
          <pre>{{ answerText }}</pre>
        </section>
        <ReviewPracticalMaterials
          v-if="detail.item.item_type === 'practical'"
          :key="detail.decision_id"
          :decision-id="detail.decision_id"
        />
        <ReviewDialogueAttachments
          v-if="detail.item.item_type === 'dialogue'"
          :key="detail.decision_id"
          :decision-id="detail.decision_id"
        />
        <section class="model-columns">
          <article v-for="task in detail.tasks" :key="task.id">
            <header>
              <span>{{ task.role === 'primary' ? '主评分' : '证据校验' }}</span
              ><strong>{{ task.score?.toFixed(2) ?? '—' }} <small>/ 4</small></strong>
            </header>
            <p>{{ task.model }} · {{ task.prompt_version }}</p>
            <div class="model-confidence"><span>置信度</span><strong>{{ task.confidence == null ? '未提供' : `${Math.round(task.confidence * 100)}%` }}</strong></div>
            <progress v-if="task.confidence != null" class="admin-progress" max="1" :value="task.confidence" :aria-label="`${task.role === 'primary' ? '主评分' : '证据校验'}模型置信度`"></progress>
            <p v-if="!task.evidence.length" class="admin-note">本次模型未返回可展示的逐项证据，请核对原始回答与量规。</p>
            <div v-for="item in task.evidence" :key="item.evidence_hash" class="evidence">
              <div>
                <strong>{{ item.criterion_code }}</strong
                ><span>{{ item.score }}分 · {{ Math.round(item.confidence * 100) }}%</span>
              </div>
              <blockquote>“{{ item.quote }}”</blockquote>
              <p>{{ item.rationale }}</p>
              <small :class="{ verified: item.verified }">{{
                item.verified ? '原回答已定位' : '需要人工定位'
              }}</small>
            </div>
          </article>
        </section>
        </div>
        <form class="verdict" @submit.prevent="sealReview">
          <header>
            <Scale :size="20" />
            <div>
              <strong>人工复核结论</strong>
              <p>确认后封存最终分与判断依据，保留评分版本。</p>
            </div>
          </header>
          <label
            >最终评分<input
              v-model.number="score"
              data-testid="review-score"
              type="number"
              min="0"
              max="4"
              step="0.5" /></label
          ><label
            >判断依据<textarea
              v-model="rationale"
              data-testid="review-rationale"
              rows="3"
              placeholder="说明与量规行为锚点的对应关系"
            ></textarea></label
          ><label
            >人工核验证据<textarea
              v-model="evidence"
              data-testid="review-evidence"
              rows="3"
              placeholder="说明你核对了回答中的哪些内容"
            ></textarea></label
          ><button data-testid="resolve-review" type="submit" :disabled="!canResolve || busy">
            <ShieldCheck :size="17" />{{ busy ? '正在封存…' : '确认最终评分' }}<ArrowRight :size="16" />
          </button>
          <p class="verdict-note">提交成功后自动读取下一份待复核回答。审计记录已开启。</p>
        </form>
        </div>
      </div>
      <div v-else-if="detailLoading || error" class="dossier-empty surface">
        <h2>{{ detailLoading ? '正在读取评分卷宗…' : '评分卷宗暂不可用' }}</h2>
        <p>
          {{ detailLoading ? '请稍候，正在核对访问权限。' : '请重新选择答卷后重试。' }}
        </p>
      </div>
      <div v-else class="dossier-empty surface">
        <Scale :size="34" />
        <h2>当前组织暂无待复核评分</h2>
        <p>你已有评分复核权限；需要人工处理的作答会出现在这里。</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.review-page {
  min-height: calc(100vh - 180px);
  padding: 4px 0 40px;
}
.review-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.review-heading > div { margin-right: auto; }
.review-guide { margin-top: 16px; }
.review-heading h1 {
  margin-top: 12px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 28px;
  letter-spacing: -0.05em;
}
.review-heading h1 em {
  color: var(--signal-dark);
  font-style: normal;
}
.review-heading p {
  margin-top: 8px;
  color: var(--muted);
}
.review-heading label {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 13px;
}
.review-heading select {
  padding: 10px 34px 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  color: var(--ink-950);
}
.desk {
  display: grid;
  margin-top: 24px;
  align-items: start;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 18px;
}
.queue {
  overflow: hidden;
  align-self: start;
}
.queue-filter { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--line); color: var(--signal-dark); }
.queue-filter select { width: 100%; padding: 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper-strong); font-size: 13px; }
.filter-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.queue time { margin-top: 10px; color: var(--muted); font-size: 11px; }
.queue-footnote { padding: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; line-height: 1.7; }
.queue > header {
  display: flex;
  align-items: center;
  padding: 17px;
  border-bottom: 1px solid var(--line);
  gap: 8px;
  color: var(--signal-dark);
}
.queue > header strong {
  color: var(--ink-950);
  font-size: 12px;
}
.queue > header span {
  margin-left: auto;
  font:
    800 13px 'Cascadia Mono',
    monospace;
}
.queue button {
  display: flex;
  width: 100%;
  align-items: flex-start;
  padding: 16px 17px;
  border: 0;
  border-bottom: 1px solid var(--line);
  flex-direction: column;
  text-align: left;
  background: white;
  cursor: pointer;
}
.queue button.active {
  box-shadow: inset 3px 0 var(--signal-dark);
  background: rgba(19, 127, 145, 0.07);
}
.queue button span {
  color: var(--signal-dark);
  font-size: 13px;
}
.queue button strong {
  margin-top: 5px;
  color: var(--ink-950);
  font-size: 12px;
}
.queue button small {
  margin-top: 7px;
  color: #9a6415;
  font-size: 13px;
}
.queue > p {
  padding: 25px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.dossier {
  min-width: 0;
  padding: 24px;
}
.review-dossier-body { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.review-evidence-column { min-width: 0; }
.dossier-reasons { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
.model-confidence { display: flex; justify-content: space-between; margin: 16px 0 8px; font-size: 12px; color: var(--muted); }
.model-confidence strong { color: var(--signal-dark); }
.dossier > header {
  display: flex;
  justify-content: space-between;
  gap: 30px;
}
.dossier > header > div > span,
.answer-sheet > span {
  color: var(--signal-dark);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.1em;
}
.dossier h2 {
  max-width: 720px;
  margin-top: 10px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 22px;
  line-height: 1.35;
}
.dossier > header p {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
}
.provisional {
  display: grid;
  align-self: start;
  padding-left: 20px;
  border-left: 1px solid var(--line);
  grid-template-columns: auto auto;
  align-items: end;
}
.provisional small {
  grid-column: 1/-1;
  color: var(--muted);
  font-size: 13px;
}
.provisional strong {
  margin-top: 5px;
  color: #9a6415;
  font:
    800 34px/1 'Cascadia Mono',
    monospace;
}
.provisional span {
  color: var(--muted);
  font-size: 13px;
}
.answer-sheet {
  margin-top: 20px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
}
.answer-sheet pre {
  overflow: auto;
  margin-top: 10px;
  color: var(--ink-950);
  font:
    13px/1.7 'Cascadia Mono',
    monospace;
  white-space: pre-wrap;
}
.model-columns {
  display: grid;
  margin-top: 18px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.model-columns > article {
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.model-columns article > header {
  display: flex;
  align-items: end;
  justify-content: space-between;
}
.model-columns article > header span {
  color: var(--signal-dark);
  font-size: 13px;
  font-weight: 750;
}
.model-columns article > header strong {
  color: var(--ink-950);
  font:
    800 22px 'Cascadia Mono',
    monospace;
}
.model-columns article > header small {
  color: var(--muted);
  font-size: 13px;
}
.model-columns article > p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 13px;
}
.evidence {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.evidence > div {
  display: flex;
  justify-content: space-between;
  color: var(--ink-950);
  font-size: 13px;
}
.evidence blockquote {
  margin-top: 9px;
  padding: 9px;
  border-left: 2px solid var(--signal);
  color: var(--ink-950);
  background: rgba(19, 127, 145, 0.05);
  font-size: 13px;
}
.evidence > p {
  margin-top: 7px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.evidence > small {
  display: inline-block;
  margin-top: 8px;
  color: #9a6415;
  font-size: 13px;
}
.evidence > small.verified {
  color: var(--signal-dark);
}
.verdict {
  display: grid;
  margin-top: 0;
  padding: 22px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: rgba(19, 127, 145, 0.05);
  grid-template-columns: minmax(0, 1fr);
  align-content: start;
  gap: 14px;
}
.verdict header {
  display: flex;
  grid-column: 1/-1;
  gap: 9px;
  color: var(--signal-dark);
}
.verdict header strong {
  color: var(--ink-950);
  font-size: 16px;
}
.verdict header p {
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}
.verdict label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--muted);
  font-size: 13px;
}
.verdict label:nth-of-type(2),
.verdict label:nth-of-type(3) {
  grid-column: 1;
}
.verdict input,
.verdict textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: white;
  color: var(--ink-950);
  font: inherit;
  resize: vertical;
}
.verdict input {
  font:
    800 18px 'Cascadia Mono',
    monospace;
}
.verdict button {
  display: flex;
  align-items: center;
  justify-content: center;
  grid-column: 1;
  width: 100%;
  gap: 7px;
  padding: 11px 16px;
  border: 0;
  border-radius: 9px;
  color: white;
  background: var(--signal-dark);
  cursor: pointer;
}
.verdict button:disabled {
  opacity: 0.45;
}
.verdict-note { color: var(--muted); font-size: 12px; line-height: 1.7; }
@media (min-width: 1700px) {
  .review-dossier-body { grid-template-columns: minmax(0, 1fr) 280px; }
  .verdict { margin-top: 20px; position: sticky; top: 20px; align-self: start; }
}
.review-alert,
.review-notice,
.review-loading {
  display: flex;
  align-items: center;
  margin-top: 18px;
  padding: 13px 16px;
  border-left: 3px solid #b34736;
  color: #8f3427;
  background: rgba(179, 71, 54, 0.07);
  gap: 7px;
}
.review-notice {
  border-color: var(--signal-dark);
  color: var(--signal-dark);
  background: rgba(19, 127, 145, 0.08);
}
.review-loading {
  border-color: var(--line);
  color: var(--muted);
  background: white;
}
.review-empty,
.dossier-empty {
  display: grid;
  margin-top: 24px;
  justify-items: center;
  padding: 55px;
  color: var(--signal-dark);
  text-align: center;
}
.review-empty h2,
.dossier-empty h2 {
  margin-top: 12px;
  color: var(--ink-950);
}
.review-empty p,
.dossier-empty p {
  margin-top: 6px;
  color: var(--muted);
}
.dossier-empty {
  margin: 0;
}
@media (max-width: 860px) {
  .review-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .review-heading h1 {
    font-size: 28px;
  }
  .desk {
    grid-template-columns: 1fr;
  }
  .queue {
    max-height: 360px;
    overflow-y: auto;
  }
  .queue > header {
    min-width: 150px;
  }
  .queue button {
    min-width: 0;
  }
  .model-columns {
    grid-template-columns: 1fr;
  }
  .verdict {
    grid-template-columns: 1fr;
  }
  .verdict label:nth-of-type(2),
  .verdict label:nth-of-type(3),
  .verdict button {
    grid-column: 1;
  }
  .dossier {
    padding: 22px;
  }
}
@media (max-width: 520px) {
  .dossier > header {
    flex-direction: column;
  }
  .provisional {
    align-self: auto;
  }
  .verdict button {
    width: 100%;
    justify-self: stretch;
  }
}
</style>
