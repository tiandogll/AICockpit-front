<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArrowRight, Check, CircleDot, FileText, Plus } from '@lucide/vue'
import WorkspaceAbilityChart from '../components/WorkspaceAbilityChart.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
import {
  getTrainingPlans,
  trainingUnavailableReason,
  type TrainingPlan,
} from '../services/trainingApi'
import {
  dimensionLabels,
  formatWorkspaceDate,
  getWorkspaceOverview,
  modeLabels,
  reportStatusLabels,
  scenarioLabels,
  type WorkspaceOverview,
} from '../services/workspaceApi'

const access = useAccessStore()
const auth = useAuthStore()
const features = useFeatureStore()
const hasLearningScope = computed(
  () =>
    !access.organizations ||
    access.organizations.some((row) => row.can_participate_assessment !== false),
)
const overview = ref<WorkspaceOverview | null>(null)
const loading = ref(false)
const error = ref('')
let generation = 0
const selectedSessionId = ref('')
const current = computed(
  () =>
    overview.value?.active_sessions.find((session) => session.id === selectedSessionId.value) ??
    overview.value?.active_sessions[0],
)
const recentReports = computed(() => overview.value?.recent_reports.slice(0, 3) ?? [])
const latest = computed(() => recentReports.value[0])
const progress = computed(() =>
  current.value?.mode === 'fixed' && current.value.max_items
    ? Math.min(100, (current.value.answered / current.value.max_items) * 100)
    : null,
)
const now = new Date()
const greeting =
  now.getHours() < 11
    ? '上午好'
    : now.getHours() < 14
      ? '中午好'
      : now.getHours() < 18
        ? '下午好'
        : '晚上好'
const today = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(now)
const trainingEnabled = computed(() => features.trainingEnabled)
const training = ref<TrainingPlan | null>(null)
const trainingLoading = ref(false)
const trainingError = ref('')
const trainingSteps = computed(() =>
  training.value && !training.value.privacy_redacted
    ? [...training.value.tasks]
        .sort((a, b) => a.sequence - b.sequence)
        .map((task) => ({
          id: task.id,
          title: task.title,
          done: task.status === 'completed',
          status: task.status === 'completed' ? '已完成' : '待完成',
        }))
    : [],
)
function reportDate(value: string | null) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '时间未记录'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(value))
    .replace(/\//g, '–')
}
const modeInitials: Record<string, string> = {
  standard: '标',
  specialized: '专',
  rapid: '速',
  fixed: '固',
}
let trainingGeneration = 0
async function loadTraining() {
  const request = ++trainingGeneration
  training.value = null
  trainingError.value = ''
  trainingLoading.value = false
  if (!trainingEnabled.value || !access.ready || access.error || !hasLearningScope.value) return
  trainingLoading.value = true
  try {
    const page = await getTrainingPlans(access.organizationId, 1, 0)
    if (request === trainingGeneration) training.value = page.items[0] ?? null
  } catch (cause) {
    if (request === trainingGeneration)
      trainingError.value = cause instanceof Error ? cause.message : '无法读取训练进度，请重试。'
  } finally {
    if (request === trainingGeneration) trainingLoading.value = false
  }
}

async function load() {
  const request = ++generation
  overview.value = null
  selectedSessionId.value = ''
  error.value = ''
  loading.value = false
  if (!access.ready || access.error || !hasLearningScope.value) return
  loading.value = true
  try {
    const data = await getWorkspaceOverview(access.organizationId)
    if (request === generation) {
      overview.value = data
      selectedSessionId.value = data.active_sessions[0]?.id ?? ''
    }
  } catch (cause) {
    if (request === generation)
      error.value = cause instanceof Error ? cause.message : '无法读取工作台，请稍后重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}
watch(() => [access.organizationId, access.ready, access.error, hasLearningScope.value], load, {
  immediate: true,
})
watch(
  () => [
    access.organizationId,
    access.ready,
    access.error,
    trainingEnabled.value,
    hasLearningScope.value,
  ],
  loadTraining,
  { immediate: true },
)
onMounted(() => {
  if (!access.ready && !access.error) void access.load()
  void features.load(true)
})
onBeforeUnmount(() => {
  generation += 1
  trainingGeneration += 1
})
</script>

<template>
  <div class="workspace-page">
    <header class="page-heading">
      <div class="welcome-copy">
        <p class="kicker">{{ today }}</p>
        <h1>{{ greeting }}，{{ auth.user?.display_name ?? '欢迎回来' }}</h1>
        <p class="welcome-note">
          {{
            current
              ? current.mode === 'fixed'
                ? '继续完成测评，固定题卷按已发布的题目顺序进行。'
                : '继续完成测评，系统会根据你的回答实时调整题目难度。'
              : '了解你的 AI 能力，从一次有证据的测评开始。'
          }}
        </p>
      </div>
    </header>
    <div v-if="access.error" class="state-panel" role="alert">
      <p>{{ access.error }}</p>
      <button class="quiet-button" @click="access.load()">重新读取权限</button>
    </div>
    <div v-else-if="access.ready && !hasLearningScope" class="state-panel" role="status">
      <h2>当前账号暂无测评参与资格</h2>
      <p>请使用学员账号登录，或联系管理员确认账号状态。</p>
      <RouterLink class="quiet-button" to="/help">查看账号帮助</RouterLink>
    </div>
    <div v-else-if="error" class="state-panel" role="alert">
      <p>{{ error }}</p>
      <button class="quiet-button" data-testid="retry-workspace" @click="load">重新加载</button>
    </div>
    <div v-else-if="loading || !access.ready" class="state-panel" role="status">
      正在读取你的测评与报告…
    </div>
    <template v-else-if="overview">
      <div class="workspace-grid">
        <section class="panel assessment-panel" aria-labelledby="current-title">
          <div class="assessment-topline">
            <span class="assessment-badge"
              ><CircleDot :size="17" />{{ current ? '进行中' : '开始了解自己' }}</span
            >
            <RouterLink
              class="detail-link"
              :to="current ? '/assessment/' + current.id : '/assessment'"
              >{{ current ? '查看详情' : '测评说明' }}</RouterLink
            >
          </div>
          <template v-if="current">
            <label v-if="overview.active_sessions.length > 1" class="session-picker"
              >选择进行中的测评
              <select v-model="selectedSessionId" data-testid="active-session-select">
                <option
                  v-for="session in overview.active_sessions"
                  :key="session.id"
                  :value="session.id"
                >
                  {{ session.name }} · {{ session.id.slice(0, 8) }}
                </option>
              </select>
            </label>
            <h2 id="current-title" class="assessment-name">{{ current.name }}</h2>
            <p v-if="current.data_origin === 'synthetic'" class="demo-origin">
              本地体验 · 非正式比赛题库
            </p>
            <p
              class="saved-note"
              :title="formatWorkspaceDate(current.last_saved_at, '暂无保存时间')"
            >
              {{ modeLabels[current.mode] || current.mode }} ·
              {{ scenarioLabels[current.scenario] || current.scenario }}
              <span>{{
                current.last_saved_at
                  ? '保存于 ' + formatWorkspaceDate(current.last_saved_at)
                  : '暂无保存时间'
              }}</span>
            </p>
            <ol
              v-if="current.mode !== 'specialized'"
              class="evidence-coverage"
              data-testid="evidence-coverage"
              aria-label="各维已保存证据，不代表顺序章节或能力达标"
            >
              <li
                v-for="(label, code, index) in dimensionLabels"
                :key="code"
                :class="{ collected: (current.dimension_counts[code] ?? 0) > 0 }"
              >
                <span class="evidence-node">{{ index + 1 }}</span>
                <strong>{{ label }}</strong>
                <span>{{
                  current.dimension_counts[code] === undefined
                    ? '未记录'
                    : current.dimension_counts[code] + ' 条证据'
                }}</span>
              </li>
            </ol>
            <p v-else class="training-message" data-testid="specialized-session-note">
              本次为专项测评，仅评估所选能力维度。题目与答题进度可在测评工作区查看。
            </p>
            <div class="assessment-footer">
              <div class="answer-count">
                <strong>{{ current.answered }} / {{ current.max_items ?? '—' }}</strong
                ><span>已保存 {{ current.answered }} 题</span>
              </div>
              <div class="assessment-progress">
                <template v-if="progress !== null"
                  ><progress
                    :value="progress"
                    max="100"
                    aria-label="固定题卷已保存回答比例"
                  ></progress
                  ><small>已完成 {{ Math.round(progress) }}%</small></template
                >
                <p v-else-if="current.mode === 'fixed'">固定题卷 · 题量上限未记录</p>
                <p v-else>
                  {{
                    current.max_items === null
                      ? '题量上限未记录'
                      : '最多 ' + current.max_items + ' 题'
                  }}
                  · 按证据覆盖结束<br /><small>自适应题量不代表完成比例</small>
                </p>
              </div>
              <RouterLink class="action-button" :to="'/assessment/' + current.id"
                >继续测评</RouterLink
              >
            </div>
          </template>
          <template v-else>
            <h2 id="current-title" class="assessment-name">从一次 AI 能力测评开始</h2>
            <p class="saved-note">客观题、对话测评与实操任务，建立六维能力画像。</p>
            <ol
              class="evidence-coverage initial-dimensions"
              data-testid="initial-dimensions"
              aria-label="六维能力待测评，尚无个人成绩"
            >
              <li v-for="(label, code, index) in dimensionLabels" :key="code">
                <span class="evidence-node">{{ index + 1 }}</span>
                <strong>{{ label }}</strong
                ><span>待测评</span>
              </li>
            </ol>
            <div class="assessment-footer initial-footer">
              <p>选择方案后进入答题工作区<br /><small>回答会自动保存，可随时继续。</small></p>
              <RouterLink class="action-button" to="/assessment"
                >开始测评<ArrowRight :size="17"
              /></RouterLink>
            </div>
          </template>
          <p
            v-if="overview.service_status.state !== 'available'"
            class="service-note"
            role="status"
          >
            {{ overview.service_status.label }}
          </p>
        </section>
        <section class="panel portrait-panel" aria-labelledby="dimensions-title">
          <header class="panel-heading">
            <div>
              <p class="panel-eyebrow">最近一次测评</p>
              <h2 id="dimensions-title">
                {{ latest?.mode === 'specialized' ? '专项能力概览' : '六维能力概览' }}
              </h2>
              <p v-if="latest?.data_origin === 'synthetic'" class="demo-origin">本地体验报告</p>
            </div>
            <RouterLink v-if="latest" class="text-link" :to="'/reports/' + latest.session_id"
              >完整报告<ArrowRight :size="26"
            /></RouterLink>
          </header>
          <WorkspaceAbilityChart
            v-if="latest?.mode !== 'specialized'"
            :dimensions="latest?.dimensions ?? []"
          />
          <div v-else class="specialized-overview">
            <p>本次为专项测评，不作六维整体能力判断。</p>
            <p>请打开完整报告，查看所选维度的结果、证据与评分状态。</p>
          </div>
          <footer class="portrait-status">
            <strong>评分状态</strong
            ><span>{{
              latest ? reportStatusLabels[latest.status] || latest.status : '尚无测评报告'
            }}</span>
          </footer>
        </section>
        <section class="panel reports-panel" aria-labelledby="recent-title">
          <header class="panel-heading">
            <h2 id="recent-title">最近报告</h2>
            <RouterLink class="text-link" to="/reports">查看全部</RouterLink>
          </header>
          <div class="reports-scroll" tabindex="0" aria-label="最近三份报告">
            <table class="reports-table">
              <thead>
                <tr>
                  <th>测评名称</th>
                  <th>模式</th>
                  <th>完成时间</th>
                  <th>状态</th>
                  <th><span class="visually-hidden">操作</span></th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!recentReports.length">
                  <td colspan="5">
                    <div class="empty-copy">
                      <FileText :size="26" />
                      <h3>暂无能力报告</h3>
                      <p>完成一次测评后，在这里查看结果和评分依据。</p>
                    </div>
                  </td>
                </tr>
                <tr v-for="report in recentReports" :key="report.id">
                  <td>
                    <RouterLink class="report-name" :to="'/reports/' + report.session_id"
                      ><span class="mode-symbol" :class="report.mode">{{
                        modeInitials[report.mode] ?? '测'
                      }}</span
                      ><span
                        ><strong>{{ report.name }}</strong
                        ><small
                          >{{ scenarioLabels[report.scenario] || report.scenario }} · 修订
                          {{ report.revision }}</small
                        ><small v-if="report.data_origin === 'synthetic'" class="demo-origin"
                          >本地体验 · 不计入正式统计</small
                        ></span
                      ></RouterLink
                    >
                  </td>
                  <td>{{ modeLabels[report.mode] || report.mode }}</td>
                  <td>{{ reportDate(report.completed_at) }}</td>
                  <td>
                    <span class="report-state" :class="report.status">{{
                      reportStatusLabels[report.status] || report.status
                    }}</span>
                  </td>
                  <td>
                    <RouterLink
                      class="report-open"
                      :to="'/reports/' + report.session_id"
                      :aria-label="'查看' + report.name"
                      >查看<ArrowRight :size="19"
                    /></RouterLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel training-panel" aria-labelledby="training-title">
          <header class="training-heading">
            <p>为你推荐</p>
            <h2 id="training-title">我的训练计划</h2>
          </header>
          <p
            v-if="features.loading || (!features.ready && !features.error)"
            class="training-message"
            role="status"
          >
            正在确认训练服务状态…
          </p>
          <div v-else-if="features.error" class="training-message" role="alert">
            <p>{{ features.error }}</p>
            <button
              class="quiet-button"
              data-testid="retry-training-availability"
              @click="features.load(true)"
            >
              重试服务检查
            </button>
          </div>
          <p v-else-if="trainingLoading" class="training-message" role="status">
            正在读取训练进度…
          </p>
          <div v-else-if="trainingError" class="training-message" role="alert">
            <p>{{ trainingError }}</p>
            <button class="quiet-button" data-testid="retry-training-summary" @click="loadTraining">
              重试训练进度
            </button>
          </div>
          <template v-else>
            <div class="training-focus">
              <span class="focus-symbol"><Plus :size="22" /></span>
              <div>
                <p>{{ training ? '当前重点' : '成长目标' }}</p>
                <strong>{{
                  training
                    ? training.dimensions.map((d) => dimensionLabels[d.code] || d.code).join('与') +
                      '训练计划'
                    : trainingEnabled
                      ? '从已完成的能力报告生成计划'
                      : '训练服务尚未启用'
                }}</strong>
                <small>{{
                  training
                    ? '已完成 ' + training.completed_tasks + ' / ' + training.total_tasks + ' 项'
                    : trainingEnabled
                      ? '形成性训练预览 · 非专家认证'
                      : '练习记录与正式测评分开保存'
                }}</small>
              </div>
            </div>
            <p v-if="training?.privacy_redacted" class="training-message">
              这份记录已进行隐私处理，不能继续提交。
            </p>
            <ol
              v-else-if="trainingSteps.length"
              class="training-steps"
              data-testid="training-steps"
            >
              <li
                v-for="(task, index) in trainingSteps"
                :key="task.id"
                :class="{ done: task.done }"
              >
                <span class="training-node"
                  ><Check v-if="task.done" :size="14" /><template v-else>{{
                    index + 1
                  }}</template></span
                ><strong>{{ task.title }}</strong
                ><small>{{ task.status }}</small>
              </li>
            </ol>
            <p v-if="training?.retest_available === false" class="training-message">
              {{ trainingUnavailableReason(training.retest_unavailable_reason) }}
            </p>
            <div class="training-actions">
              <RouterLink
                v-if="trainingEnabled"
                class="training-link"
                :to="training ? { path: '/training', query: { plan: training.id } } : '/training'"
                >{{
                  training
                    ? training.privacy_redacted || training.status === 'completed'
                      ? '查看训练记录'
                      : '继续训练'
                    : '建立训练计划'
                }}</RouterLink
              >
              <RouterLink
                v-else-if="latest"
                class="training-link"
                :to="'/reports/' + latest.session_id"
                >阅读成长建议</RouterLink
              >
              <RouterLink v-else class="training-link" to="/assessment">先完成测评</RouterLink>
            </div>
          </template>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.workspace-page {
  --u: var(--reference-unit, 1px);
  color: #208c9c;
}
.demo-origin {
  color: #8b662c;
  font-size: 12px;
  line-height: 1.5;
}
.page-heading {
  display: grid;
  grid-template-columns: minmax(0, 765fr) minmax(0, 545fr);
  gap: calc(28 * var(--u));
  min-height: calc(144 * var(--u));
}
.kicker {
  font-size: calc(20 * var(--u));
  letter-spacing: 0.06em;
  line-height: 1.2;
  color: #219bac;
}
.page-heading h1 {
  margin: calc(5 * var(--u)) 0 calc(3 * var(--u));
  font-size: calc(36 * var(--u));
  line-height: 1.5;
  letter-spacing: 0.08em;
  color: #219bac;
  font-weight: 700;
}
.welcome-note {
  font-size: calc(22 * var(--u));
  line-height: 1.5;
  letter-spacing: 0.05em;
  color: #219bac;
}
.hero-assistant {
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  gap: calc(20 * var(--u));
  padding-top: calc(10 * var(--u));
}
.hero-assistant > div:first-child {
  padding-top: calc(4 * var(--u));
  text-align: center;
}
.hero-assistant p {
  font-size: calc(24 * var(--u));
  color: #4aa9b9;
  margin-bottom: calc(4 * var(--u));
}
.hero-assistant strong {
  display: block;
  font-size: calc(28 * var(--u));
  line-height: 1.5;
  white-space: nowrap;
}
.robot-slot {
  flex: 0 0 calc(140 * var(--u));
  height: calc(140 * var(--u));
  margin-top: calc(-50 * var(--u));
}
.robot-slot img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 765fr) minmax(0, 545fr);
  gap: calc(14 * var(--u)) calc(28 * var(--u));
  align-items: stretch;
}
.panel {
  min-width: 0;
  background: #fff;
  border: 1px solid #bcbcbc;
  border-radius: calc(34 * var(--u));
}
.assessment-panel {
  min-height: calc(334 * var(--u));
  padding: calc(20 * var(--u)) calc(28 * var(--u)) calc(14 * var(--u));
  border: 2px solid #c7d2e9;
  background: linear-gradient(155deg, #e3e8f0 20%, #d9ebf0 100%);
  border-radius: calc(32 * var(--u));
}
.assessment-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.assessment-badge {
  display: inline-flex;
  align-items: center;
  gap: calc(9 * var(--u));
  height: calc(38 * var(--u));
  padding: 0 calc(14 * var(--u));
  background: #c4cdef;
  border: 1px solid #a4b5ec;
  color: #576fa2;
  border-radius: 99px;
  font-size: calc(15 * var(--u));
}
.detail-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: calc(36 * var(--u));
  padding: 0 calc(18 * var(--u));
  border: 1px solid #576fa2;
  border-radius: calc(12 * var(--u));
  font-size: max(12px, calc(14 * var(--u)));
  color: #576fa2;
}
.assessment-name {
  font-size: calc(24 * var(--u));
  color: #576fa2;
  font-weight: 700;
  line-height: 1.5;
  margin: calc(11 * var(--u)) 0 calc(2 * var(--u));
  overflow-wrap: anywhere;
}
.saved-note {
  display: flex;
  flex-wrap: wrap;
  gap: 0 calc(24 * var(--u));
  color: #576fa2;
  font-size: max(12px, calc(16 * var(--u)));
  line-height: 1.5;
}
.evidence-coverage {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  list-style: none;
  padding: 0;
  margin: calc(18 * var(--u)) calc(-24 * var(--u)) calc(14 * var(--u));
}
.evidence-coverage li {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  gap: calc(3 * var(--u));
  font-size: calc(17 * var(--u));
  font-variant-numeric: tabular-nums;
  text-align: center;
  line-height: 1.4;
}
.evidence-coverage li::after {
  content: '';
  position: absolute;
  height: 2px;
  background: #29a0b0;
  top: calc(15 * var(--u));
  left: calc(50% + 34 * var(--u));
  right: calc(-50% + 34 * var(--u));
}
.evidence-coverage li:last-child::after {
  display: none;
}
.evidence-node {
  display: grid;
  place-items: center;
  width: calc(29 * var(--u));
  height: calc(29 * var(--u));
  background: #8f969c;
  color: white;
  border-radius: 50%;
  font-size: calc(20 * var(--u));
  margin-bottom: calc(3 * var(--u));
}
.collected .evidence-node {
  background: #239daf;
}
.evidence-coverage strong {
  font-size: calc(17 * var(--u));
  white-space: nowrap;
  font-weight: 650;
}
.assessment-footer {
  display: flex;
  align-items: center;
  gap: calc(28 * var(--u));
  border-top: 1px solid #29a6b9;
  padding-top: calc(15 * var(--u));
}
.initial-dimensions {
  margin-top: calc(30 * var(--u));
  margin-bottom: calc(26 * var(--u));
}
.initial-dimensions .evidence-node {
  color: #577284;
  background: #f2f7fa;
  border: 1px solid #b1cbd6;
}
.initial-dimensions li::after {
  background: #afced8;
}
.initial-dimensions li > span:last-child {
  color: #637f8b;
  font-size: max(12px, calc(14 * var(--u)));
}
.initial-footer {
  justify-content: space-between;
}
.initial-footer p {
  color: #426c7d;
  font-size: max(13px, calc(16 * var(--u)));
}
.initial-footer small {
  color: #5d727a;
  font-size: max(12px, calc(13 * var(--u)));
}
.answer-count {
  display: flex;
  flex-direction: column;
  gap: calc(1 * var(--u));
  flex-shrink: 0;
  font-size: calc(17 * var(--u));
  font-weight: 650;
  line-height: 1.4;
}
.answer-count strong {
  letter-spacing: 0.08em;
  font-size: calc(19 * var(--u));
}
.assessment-progress {
  flex: 1;
  min-width: 0;
  font-size: max(12px, calc(14 * var(--u)));
  color: #248597;
}
.assessment-progress small {
  font-size: 12px;
  font-weight: 400;
  color: #5d727a;
}
progress {
  display: block;
  width: 100%;
  height: 5px;
  border: 0;
  appearance: none;
  border-radius: 10px;
  overflow: hidden;
  margin-bottom: 7px;
}
progress::-webkit-progress-bar {
  background: #eef4f5;
}
progress::-webkit-progress-value {
  background: #229cae;
}
progress::-moz-progress-bar {
  background: #229cae;
}
.action-button,
.quiet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: calc(38 * var(--u));
  padding: calc(8 * var(--u)) calc(18 * var(--u));
  border: 1px solid transparent;
  border-radius: calc(5 * var(--u));
  font-size: max(12px, calc(14 * var(--u)));
  font-weight: 650;
  cursor: pointer;
  text-align: center;
}
.action-button {
  background: #208c9c;
  color: #fff;
  flex-shrink: 0;
}
.action-button:hover {
  background: #137f91;
}
.quiet-button {
  color: #208c9c;
  border-color: #a8cbd3;
  background: #fff;
}
.session-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin-top: 10px;
  color: #576fa2;
}
.session-picker select {
  flex: 1;
  min-width: 0;
  padding: 6px;
  border: 1px solid #c7d2e9;
  border-radius: 6px;
  background: #fff;
  color: #183b46;
}
.service-note {
  margin-top: 10px;
  font-size: 12px;
  color: #98612e;
}
.portrait-panel {
  min-height: calc(334 * var(--u));
  padding: calc(20 * var(--u)) calc(20 * var(--u)) calc(13 * var(--u));
  display: flex;
  flex-direction: column;
}
.panel-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.panel-heading h2 {
  font-size: calc(24 * var(--u));
  line-height: 1.5;
  font-weight: 700;
}
.panel-eyebrow {
  font-size: calc(17 * var(--u));
  line-height: 1.5;
}
.portrait-panel .panel-heading {
  padding-left: calc(20 * var(--u));
  margin-bottom: calc(2 * var(--u));
}
.portrait-panel .panel-heading h2,
.portrait-panel .panel-eyebrow {
  line-height: 1.2;
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: calc(10 * var(--u));
  font-size: calc(18 * var(--u));
  font-weight: 650;
  white-space: nowrap;
}
.portrait-status {
  display: flex;
  align-items: center;
  gap: calc(14 * var(--u));
  margin-top: auto;
  padding-top: calc(4 * var(--u));
  font-size: calc(17 * var(--u));
  line-height: 1.3;
}
.portrait-status strong {
  font-size: calc(21 * var(--u));
}
.portrait-status span {
  margin-left: auto;
  color: #208c9c;
}
.reports-panel {
  min-height: calc(303 * var(--u));
  padding: calc(18 * var(--u)) calc(29 * var(--u));
  border: 2px solid #d3dbec;
}
.reports-panel .panel-heading {
  margin-bottom: calc(10 * var(--u));
}
.reports-panel .text-link {
  color: #909090;
}
.reports-scroll {
  position: relative;
  overflow-x: auto;
}
.reports-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
  color: #888;
  font-size: calc(16 * var(--u));
}
.reports-table th {
  font-weight: 650;
  text-align: left;
  padding: 0 0 calc(10 * var(--u));
  border-bottom: 1px solid #bdbdbd;
  white-space: nowrap;
}
.reports-table th:not(:first-child),
.reports-table td:not(:first-child) {
  padding-left: calc(12 * var(--u));
}
.reports-table td {
  padding-top: calc(11 * var(--u));
  vertical-align: middle;
  white-space: nowrap;
}
.report-name {
  display: flex;
  align-items: center;
  gap: calc(10 * var(--u));
  color: #666;
}
.report-name strong,
.report-name small {
  display: block;
}
.report-name strong {
  font-size: calc(16 * var(--u));
  max-width: calc(215 * var(--u));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.report-name small {
  font-size: max(12px, calc(13 * var(--u)));
  color: #929292;
}
.mode-symbol {
  display: grid;
  place-items: center;
  flex: 0 0 calc(42 * var(--u));
  height: calc(40 * var(--u));
  border-radius: calc(5 * var(--u));
  background: #9290c7;
  color: #fff;
  font-weight: 700;
}
.mode-symbol.specialized {
  background: #90b9e8;
}
.mode-symbol.rapid {
  background: #f7ba40;
}
.report-state {
  display: inline-block;
  padding: calc(3 * var(--u)) calc(10 * var(--u));
  border-radius: 999px;
  background: #fcf0d8;
  color: #976324;
  font-size: max(12px, calc(14 * var(--u)));
  font-weight: 650;
}
.report-state.complete {
  background: #91c980;
  color: #fff;
}
.report-open {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #909090;
}
.training-panel {
  min-height: calc(303 * var(--u));
  padding: calc(24 * var(--u)) calc(21 * var(--u)) calc(12 * var(--u));
}
.training-heading {
  color: #666;
  margin-bottom: calc(10 * var(--u));
}
.training-heading p {
  color: #929292;
  font-size: max(12px, calc(14 * var(--u)));
  font-weight: 650;
  line-height: 1.5;
}
.training-heading h2 {
  font-size: calc(17 * var(--u));
  font-weight: 700;
  line-height: 1.5;
}
.training-focus {
  display: flex;
  align-items: center;
  gap: calc(17 * var(--u));
  padding: calc(5 * var(--u)) calc(16 * var(--u));
  min-height: calc(74 * var(--u));
  border: 1px solid #c8dcfb;
  background: linear-gradient(#e8eff8, #fff);
  border-radius: calc(19 * var(--u));
  color: #666;
}
.focus-symbol {
  display: grid;
  place-items: center;
  width: calc(45 * var(--u));
  height: calc(45 * var(--u));
  border-radius: calc(12 * var(--u));
  background: #fff;
  box-shadow: 0 2px 8px #183b4633;
  color: #8aa1d1;
  flex-shrink: 0;
}
.training-focus p {
  color: #929292;
  font-size: max(12px, calc(14 * var(--u)));
  line-height: 1.5;
}
.training-focus strong {
  display: block;
  font-size: calc(15 * var(--u));
  line-height: 1.5;
}
.training-focus small {
  font-size: 12px;
  color: #219bac;
  line-height: 1.5;
  display: block;
}
.training-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding: 0;
  list-style: none;
  margin: calc(23 * var(--u)) calc(-12 * var(--u)) calc(7 * var(--u));
}
.training-steps li {
  display: flex;
  position: relative;
  flex-direction: column;
  align-items: center;
  min-width: 0;
  text-align: center;
  color: #858585;
}
.training-steps li::after {
  content: '';
  position: absolute;
  height: 1px;
  left: calc(50% + 15 * var(--u));
  right: calc(-50% + 15 * var(--u));
  top: calc(10 * var(--u));
  background: #c5c5c5;
}
.training-steps li:last-child::after {
  display: none;
}
.training-node {
  display: grid;
  place-items: center;
  width: calc(21 * var(--u));
  height: calc(21 * var(--u));
  border: 1px solid #c5c5c5;
  background: #fff;
  border-radius: 50%;
  color: #9ba0a3;
  font-size: 12px;
  margin-bottom: calc(9 * var(--u));
}
.training-steps strong {
  font-size: max(12px, calc(13 * var(--u)));
  line-height: 1.5;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-weight: 650;
}
.training-steps small {
  font-size: 12px;
  margin-top: calc(3 * var(--u));
}
.training-steps .done .training-node {
  background: #4bb0bd;
  color: #fff;
  border-color: #4bb0bd;
}
.training-actions {
  display: flex;
  justify-content: center;
}
.training-link {
  padding: calc(4 * var(--u)) calc(18 * var(--u));
  min-height: calc(32 * var(--u));
  background: #f5f8ff;
  border: 1px solid #568eff;
  border-radius: calc(10 * var(--u));
  color: #4285ff;
  font-size: max(12px, calc(14 * var(--u)));
  font-weight: 650;
}
.training-message {
  font-size: 13px;
  line-height: 1.7;
  padding: 9px 0;
  color: #5d727a;
}
.specialized-overview {
  display: grid;
  align-content: center;
  gap: 12px;
  min-height: calc(199 * var(--u));
  color: #5d727a;
  font-size: 14px;
  line-height: 1.7;
}
.training-message[role='alert'] {
  color: #925619;
}
.training-message button {
  margin-top: 8px;
}
.workspace-composer {
  margin-top: calc(20 * var(--u));
}
.empty-copy,
.start-state {
  display: grid;
  justify-items: center;
  align-content: center;
  gap: 12px;
  text-align: center;
  min-height: calc(208 * var(--u));
  color: #5d727a;
}
.empty-copy h3,
.start-state h2 {
  color: #208c9c;
  font-size: calc(20 * var(--u));
}
.empty-copy p,
.start-state p {
  font-size: 13px;
}
.state-panel {
  display: grid;
  justify-items: start;
  gap: 16px;
  padding: 32px;
  background: #fff;
  border: 1px solid #d3dbec;
  border-radius: 24px;
  color: #5d727a;
}
.state-panel[role='alert'] {
  color: #925619;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
a:focus-visible,
button:focus-visible,
select:focus-visible,
.reports-scroll:focus-visible {
  outline: 3px solid #137f91;
  outline-offset: 3px;
}
@media (max-width: 1279px) {
  .page-heading {
    min-height: 142px;
  }
  .hero-assistant strong {
    white-space: normal;
    font-size: 22px;
  }
  .robot-slot {
    flex-basis: 72px;
    height: 100px;
    margin-top: 0;
  }
  .workspace-grid {
    gap: 18px;
  }
  .assessment-panel,
  .portrait-panel {
    padding: 20px;
  }
  .assessment-footer {
    gap: 12px;
  }
  .saved-note {
    font-size: 12px;
  }
  .evidence-coverage {
    margin-left: -12px;
    margin-right: -12px;
  }
  .evidence-coverage strong {
    font-size: 12px;
  }
  .reports-panel {
    padding: 18px;
  }
  .reports-table {
    font-size: 13px;
    min-width: 610px;
  }
  .report-name strong {
    font-size: 13px;
    max-width: 160px;
  }
  .report-name small {
    font-size: 12px;
  }
}
@media (max-width: 1100px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
  .page-heading {
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 16px;
  }
  .welcome-note {
    font-size: 16px;
  }
  .hero-assistant {
    gap: 0;
  }
  .hero-assistant strong {
    font-size: 19px;
  }
  .hero-assistant p {
    font-size: 18px;
  }
  .robot-slot {
    flex-basis: 40px;
  }
  .assessment-panel,
  .portrait-panel,
  .reports-panel,
  .training-panel {
    min-height: auto;
  }
  .assessment-panel {
    padding-bottom: 20px;
  }
  .portrait-panel {
    min-height: 300px;
  }
  .reports-table {
    min-width: 620px;
  }
  .training-steps {
    margin-bottom: 12px;
  }
  .training-panel {
    padding: 22px;
  }
  .reports-panel {
    min-height: 220px;
  }
}
@media (max-width: 600px) {
  .page-heading {
    display: block;
    min-height: auto;
    padding-bottom: 22px;
  }
  .kicker {
    font-size: 14px;
  }
  .page-heading h1 {
    font-size: 27px;
    letter-spacing: 0.02em;
  }
  .welcome-note {
    font-size: 14px;
  }
  .hero-assistant {
    display: none;
  }
  .panel {
    border-radius: 22px;
  }
  .assessment-panel,
  .portrait-panel,
  .reports-panel,
  .training-panel {
    padding: 18px 15px;
  }
  .assessment-name {
    font-size: 19px;
  }
  .saved-note {
    gap: 3px;
  }
  .evidence-coverage {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 4px;
    margin: 20px 0;
  }
  .evidence-coverage li:nth-child(3)::after {
    display: none;
  }
  .evidence-coverage li {
    font-size: 13px;
  }
  .evidence-coverage strong {
    font-size: 13px;
  }
  .assessment-footer {
    flex-wrap: wrap;
    gap: 12px;
  }
  .assessment-progress {
    text-align: right;
  }
  .assessment-footer .action-button {
    width: 100%;
    min-height: 42px;
  }
  .panel-heading h2 {
    font-size: 20px;
  }
  .panel-eyebrow {
    font-size: 13px;
  }
  .text-link {
    font-size: 14px;
    gap: 5px;
  }
  .portrait-panel .panel-heading {
    padding-left: 0;
  }
  .portrait-status {
    font-size: 14px;
  }
  .portrait-status strong {
    font-size: 17px;
  }
  .training-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 8px;
  }
  .training-steps li:nth-child(2)::after {
    display: none;
  }
  .training-focus strong {
    font-size: 14px;
  }
  .session-picker {
    flex-direction: column;
    align-items: stretch;
  }
  .empty-copy h3,
  .start-state h2 {
    font-size: 18px;
  }
  .reports-table:has(.empty-copy) {
    min-width: 0;
    table-layout: fixed;
  }
  .reports-table:has(.empty-copy) th {
    white-space: normal;
    font-size: 12px;
    padding-left: 0;
  }
  .reports-table:has(.empty-copy) td {
    white-space: normal;
  }
}
</style>
