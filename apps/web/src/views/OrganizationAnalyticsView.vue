<script setup lang="ts">
import {
  Activity,
  ArchiveRestore,
  ArrowDownToLine,
  CheckCircle2,
  DatabaseZap,
  Fingerprint,
  Gauge,
  ShieldCheck,
  TriangleAlert,
} from '@lucide/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useOrganizationScope } from '../domain/organizationScope'
import { useAccessStore } from '../stores/access'
import { DIMENSIONS } from '../domain/capabilities'

import {
  downloadAnalyticsCsv,
  getAnalyticsOverview,
  getAuditEvents,
  getItemQuality,
  getSecurityStatus,
  listCohorts,
  listOrganizations,
  previewPrivacyRun,
  type AnalyticsOverview,
  type AuditEvent,
  type CohortOption,
  type ItemQuality,
  type OrganizationOption,
  type PrivacyPreview,
  type SecurityStatus,
} from '../services/analyticsApi'

const organizations = ref<OrganizationOption[]>([])
const access = useAccessStore()
const cohorts = ref<CohortOption[]>([])
const { organizationId, initialOrganization } = useOrganizationScope()
const cohortId = ref('')
const overview = ref<AnalyticsOverview | null>(null)
const items = ref<ItemQuality[]>([])
const security = ref<SecurityStatus | null>(null)
const audits = ref<AuditEvent[]>([])
const privacyPreview = ref<PrivacyPreview | null>(null)
const loading = ref(true)
const error = ref('')
const exporting = ref(false)
const privacyBusy = ref(false)
const notice = ref('')
let loadGeneration = 0
onBeforeUnmount(() => {
  loadGeneration += 1
})
function beginLoad() {
  loading.value = true
  error.value = ''
  notice.value = ''
  overview.value = null
  items.value = []
  security.value = null
  audits.value = []
  privacyPreview.value = null
  return ++loadGeneration
}

const dimensionNames = Object.fromEntries(DIMENSIONS.map((row) => [row.code, row.name]))
const typeNames = { objective: '客观题', dialogue: '对话题', practical: '实操题' }
const selectedOrganization = computed(() =>
  organizations.value.find((item) => item.id === organizationId.value),
)
const canGovern = computed(() =>
  ['org_admin', 'system_admin'].includes(selectedOrganization.value?.role ?? ''),
)
const quotaPercent = computed(() => {
  if (!security.value?.model_daily_token_quota) return 0
  return Math.min(
    100,
    Math.round(
      (security.value.model_tokens_used_today / security.value.model_daily_token_quota) * 100,
    ),
  )
})
const privacyTotal = computed(() =>
  Object.values(privacyPreview.value?.result_counts ?? {}).reduce((sum, count) => sum + count, 0),
)

function levelWidth(levels: DimensionAggregateLevels, level: keyof DimensionAggregateLevels) {
  const total = Object.values(levels).reduce((sum, value) => sum + value, 0)
  return `${total ? (levels[level] / total) * 100 : 0}%`
}
type DimensionAggregateLevels = Record<'L1' | 'L2' | 'L3' | 'L4', number>

async function loadOrganizations() {
  const ticket = beginLoad()
  try {
    const rows = await listOrganizations()
    if (ticket !== loadGeneration) return
    organizations.value = rows.filter((item) => item.role !== 'learner')
    organizationId.value = initialOrganization(organizations.value)
    if (organizationId.value) await loadOrganization()
    else loading.value = false
  } catch (caught) {
    if (ticket !== loadGeneration) return
    error.value = caught instanceof Error ? caught.message : '组织列表读取失败，请重试。'
    loading.value = false
  }
}

async function loadOrganization() {
  if (!organizationId.value) return
  const ticket = beginLoad(),
    organization = organizationId.value
  cohorts.value = []
  cohortId.value = ''
  try {
    const rows = await listCohorts(organization)
    if (ticket !== loadGeneration) return
    cohorts.value = rows
    await loadMetrics(ticket, organization, '')
  } catch (caught) {
    if (ticket === loadGeneration)
      error.value = caught instanceof Error ? caught.message : '组织分析读取失败。'
  } finally {
    if (ticket === loadGeneration) loading.value = false
  }
}

async function loadMetrics(ticket: number, organization: string, cohort: string) {
  const result = await Promise.all([
    getAnalyticsOverview(organization, cohort),
    getItemQuality(organization, cohort),
    getSecurityStatus(organization),
    getAuditEvents(organization),
  ])
  if (ticket !== loadGeneration) return
  ;[overview.value, items.value, security.value, audits.value] = result
}

async function changeCohort() {
  const ticket = beginLoad()
  try {
    await loadMetrics(ticket, organizationId.value, cohortId.value)
  } catch (caught) {
    if (ticket === loadGeneration)
      error.value = caught instanceof Error ? caught.message : '分组分析读取失败。'
  } finally {
    if (ticket === loadGeneration) loading.value = false
  }
}

async function exportCsv() {
  exporting.value = true
  try {
    const blob = await downloadAnalyticsCsv(organizationId.value, cohortId.value)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'zhijian-analytics.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '导出失败。'
  } finally {
    exporting.value = false
  }
}

async function previewPrivacy() {
  privacyBusy.value = true
  try {
    privacyPreview.value = await previewPrivacyRun(organizationId.value)
    notice.value = `预览估计 ${privacyTotal.value} 条待匿名化原始记录，尚未执行；实际范围以执行时截止日期为准。`
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '预览失败。'
  } finally {
    privacyBusy.value = false
  }
}

onMounted(loadOrganizations)
</script>

<template>
  <section class="observatory shell">
    <header class="observatory-head">
      <div>
        <span class="eyebrow">Organization intelligence</span>
        <h1>{{ access.singlePlatform ? '学员能力' : '组织能力' }}<br /><em>观测站</em></h1>
        <p>看见群体分布, 但不暴露任何一位学员。所有指标经过最小样本门槛与版本化报告校验。</p>
      </div>
      <div class="scope-console surface">
        <label v-if="!access.singlePlatform"
          >组织域<select
            v-model="organizationId"
            data-testid="organization-select"
            @change="loadOrganization"
          >
            <option v-for="item in organizations" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <label
          >观察分组<select v-model="cohortId" data-testid="cohort-select" @change="changeCohort">
            <option value="">全部成员</option>
            <option v-for="cohort in cohorts" :key="cohort.id" :value="cohort.id">
              {{ cohort.kind === 'class' ? '班级' : '部门' }} · {{ cohort.name }}
            </option>
          </select></label
        >
        <button
          type="button"
          :disabled="loading || !!error || exporting || !overview || overview.suppressed"
          @click="exportCsv"
        >
          <ArrowDownToLine :size="16" />{{ exporting ? '正在导出' : '导出聚合CSV' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="analytics-state surface">正在校验组织边界与统计发布门槛……</div>
    <div v-else-if="error" class="analytics-state is-error" role="alert">
      <TriangleAlert :size="18" />{{ error }}<button @click="loadOrganizations">重新读取</button>
    </div>
    <div v-else-if="!organizationId" class="analytics-state surface">
      当前账号没有组织分析权限。
    </div>
    <template v-else-if="overview && security">
      <section class="sample-seal" :class="{ suppressed: overview.suppressed }">
        <div>
          <Fingerprint :size="20" /><span
            ><strong>{{
              overview.participant_count ?? `不足${overview.minimum_group_size}`
            }}</strong>
            名去重参与者</span
          >
        </div>
        <p v-if="overview.suppressed">
          样本未达到 k={{ overview.minimum_group_size }}, 六维与题目指标已自动抑制。
        </p>
        <p v-else>{{ overview.measurement_count }} 份冻结报告 · 专家先验测量 · 非正式人口常模</p>
        <span><ShieldCheck :size="15" />隐私门槛 k={{ overview.minimum_group_size }}</span>
      </section>

      <div class="observatory-grid">
        <div class="analytics-panels">
          <section class="terrain surface" data-testid="ability-terrain">
            <header>
              <div>
                <span>ABILITY TERRAIN / 06</span>
                <h2>六维能力地形带</h2>
              </div>
              <p>L1—L4 分布与平均能力值</p>
            </header>
            <div v-if="overview.suppressed" class="terrain-empty">
              <ShieldCheck :size="28" /><strong>统计已保护</strong>
              <p>增加有效样本后自动开放群体轮廓。</p>
            </div>
            <article
              v-for="row in overview.dimensions"
              v-else
              :key="row.code"
              :data-testid="`terrain-${row.code}`"
            >
              <div class="terrain-name">
                <span>0{{ overview.dimensions.indexOf(row) + 1 }}</span
                ><strong>{{ dimensionNames[row.code] ?? row.code }}</strong
                ><small
                  >n={{ row.sample_size }} · SE {{ row.mean_standard_error.toFixed(2) }}</small
                >
              </div>
              <div class="terrain-band" :aria-label="`${dimensionNames[row.code]}等级分布`">
                <i class="l1" :style="{ width: levelWidth(row.levels, 'L1') }">{{
                  row.levels.L1
                }}</i
                ><i class="l2" :style="{ width: levelWidth(row.levels, 'L2') }">{{
                  row.levels.L2
                }}</i
                ><i class="l3" :style="{ width: levelWidth(row.levels, 'L3') }">{{
                  row.levels.L3
                }}</i
                ><i class="l4" :style="{ width: levelWidth(row.levels, 'L4') }">{{
                  row.levels.L4
                }}</i>
              </div>
              <div class="theta">
                <small>MEAN θ</small
                ><strong>{{ row.mean_theta > 0 ? '+' : '' }}{{ row.mean_theta.toFixed(2) }}</strong>
              </div>
            </article>
            <footer>
              <span v-for="level in ['L1 起步', 'L2 应用', 'L3 熟练', 'L4 引领']" :key="level">{{
                level
              }}</span>
            </footer>
          </section>

          <section class="quality surface">
            <header>
              <div>
                <span>ITEM SIGNALS</span>
                <h2>题目质量信号</h2>
              </div>
              <p>只发布达到k门槛的聚合指标</p>
            </header>
            <div class="quality-table">
              <div class="quality-row heading">
                <span>题目/维度</span><span>题型</span><span>样本</span><span>难度/均分</span
                ><span>区分度/复核</span>
              </div>
              <div v-for="item in items.slice(0, 8)" :key="item.item_id" class="quality-row">
                <span
                  ><strong>{{ dimensionNames[item.dimension_code] ?? item.dimension_code }}</strong
                  ><small>{{ item.item_id.slice(0, 8) }} · v{{ item.version }}</small></span
                ><span>{{ typeNames[item.item_type] }}</span
                ><span>{{
                  item.suppressed
                    ? `不足${overview.minimum_group_size}人`
                    : `${item.participant_count}人 / ${item.response_count}次`
                }}</span
                ><span v-if="item.suppressed">已抑制</span
                ><span v-else>{{
                  item.item_type === 'objective'
                    ? `${Math.round((item.objective_correct_rate ?? 0) * 100)}%`
                    : `${(item.mean_final_score ?? 0).toFixed(2)}/4`
                }}</span
                ><span v-if="item.suppressed">—</span
                ><span v-else>{{
                  item.item_type === 'objective'
                    ? (item.objective_discrimination?.toFixed(2) ?? '样本方差不足')
                    : `${Math.round((item.human_review_rate ?? 0) * 100)}%`
                }}</span>
              </div>
              <p v-if="!items.length">暂无已完成测评的题目质量数据。</p>
            </div>
          </section>
        </div>

        <aside class="governance surface">
          <header>
            <span>GOVERNANCE RAIL</span>
            <h2>安全治理栏</h2>
          </header>
          <section class="quota">
            <div class="quota-ring" :style="{ '--quota': `${quotaPercent * 3.6}deg` }">
              <span
                ><strong>{{ quotaPercent }}%</strong><small>今日模型预算</small></span
              >
            </div>
            <p>
              {{ security.model_tokens_used_today.toLocaleString() }} /
              {{ security.model_daily_token_quota.toLocaleString() }} tokens
            </p>
          </section>
          <dl>
            <div>
              <dt><ShieldCheck :size="15" />最小发布样本</dt>
              <dd>k = {{ security.minimum_group_size }}</dd>
            </div>
            <div>
              <dt><ArchiveRestore :size="15" />原始交互保留</dt>
              <dd>{{ security.retention_days }} 天</dd>
            </div>
            <div>
              <dt><Activity :size="15" />近7日审计</dt>
              <dd>{{ security.recent_audit_events }} 条</dd>
            </div>
          </dl>
          <section class="gaps">
            <span>COMMON GAPS</span>
            <article v-for="(gap, index) in overview.common_gaps" :key="gap.code">
              <b>0{{ index + 1 }}</b>
              <div>
                <strong>{{ dimensionNames[gap.code] ?? gap.code }}</strong
                ><small>平均 θ {{ gap.mean_theta.toFixed(2) }}</small>
              </div>
            </article>
            <p v-if="!overview.common_gaps.length">样本不足, 不生成短板排名。</p>
          </section>
          <section v-if="canGovern" class="privacy">
            <span>RETENTION CONTROL</span>
            <p>先预览, 再执行。匿名化保留分数与报告, 清除回答、证据原文和对象文件。</p>
            <button type="button" :disabled="privacyBusy" @click="previewPrivacy">
              <DatabaseZap :size="15" />{{ privacyBusy ? '正在核对' : '预览90天清理' }}
            </button>
            <div v-if="privacyPreview" class="privacy-confirm">
              <strong>{{ privacyTotal }} 条记录将被匿名化</strong
              ><small
                >cutoff {{ new Date(privacyPreview.cutoff_at).toLocaleDateString('zh-CN') }}</small
              ><RouterLink class="primary-button" to="/system">进入数据安全确认执行</RouterLink>
            </div>
          </section>
          <section class="audit">
            <span>AUDIT PULSE</span>
            <article v-for="event in audits.slice(0, 5)" :key="event.id">
              <component
                :is="event.outcome === 'succeeded' ? CheckCircle2 : TriangleAlert"
                :size="14"
              />
              <div>
                <strong>{{ event.action }}</strong
                ><small>{{ new Date(event.occurred_at).toLocaleString('zh-CN') }}</small>
              </div>
            </article>
            <p v-if="!audits.length">暂无治理操作记录。</p>
          </section>
        </aside>
      </div>
      <p v-if="notice" class="notice" role="status"><Gauge :size="15" />{{ notice }}</p>
    </template>
  </section>
</template>

<style scoped>
.observatory {
  min-width: 0;
  min-height: calc(100vh - 180px);
  padding: 54px 0 100px;
}
.observatory-head {
  display: grid;
  align-items: end;
  grid-template-columns: 1fr 460px;
  gap: 70px;
}
.observatory-head h1 {
  margin-top: 13px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: clamp(52px, 7vw, 82px);
  line-height: 0.98;
  letter-spacing: -0.06em;
}
.observatory-head h1 em {
  color: var(--signal-dark);
  font-style: normal;
}
.observatory-head > div > p {
  max-width: 600px;
  margin-top: 20px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
}
.scope-console {
  display: grid;
  padding: 20px;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.scope-console label {
  color: var(--muted);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.08em;
}
.scope-console select {
  width: 100%;
  margin-top: 7px;
  padding: 11px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-950);
  background: white;
  font: 650 12px inherit;
}
.scope-console button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  grid-column: 1/-1;
  padding: 11px;
  border: 0;
  border-radius: 8px;
  color: white;
  background: var(--ink-950);
  font-weight: 750;
  cursor: pointer;
}
.scope-console button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.sample-seal {
  display: grid;
  align-items: center;
  margin: 48px 0 16px;
  padding: 14px 18px;
  border: 1px solid rgba(7, 128, 95, 0.18);
  border-left: 4px solid var(--signal-dark);
  background: rgba(255, 255, 255, 0.74);
  grid-template-columns: auto 1fr auto;
  gap: 24px;
}
.sample-seal.suppressed {
  border-left-color: #c48122;
}
.sample-seal > div,
.sample-seal > span {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sample-seal strong {
  font:
    800 19px 'Cascadia Mono',
    monospace;
}
.sample-seal p {
  color: var(--muted);
  font-size: 13px;
}
.sample-seal > span {
  color: var(--signal-dark);
  font-size: 13px;
  font-weight: 750;
}
.observatory-grid {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1fr) 310px;
  gap: 16px;
}
.observatory-grid .analytics-panels {
  display: grid;
  min-width: 0;
  gap: 16px;
}
.terrain,
.quality,
.governance {
  padding: 24px;
  min-width: 0;
}
.terrain > header,
.quality > header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--line);
}
.terrain header span,
.quality header span,
.governance > header span,
.gaps > span,
.privacy > span,
.audit > span {
  color: var(--signal-dark);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.11em;
}
.terrain h2,
.quality h2,
.governance h2 {
  margin-top: 5px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 22px;
}
.terrain header p,
.quality header p {
  color: var(--muted);
  font-size: 13px;
}
.terrain article {
  display: grid;
  min-height: 80px;
  align-items: center;
  border-bottom: 1px solid var(--line);
  grid-template-columns: 178px 1fr 80px;
  gap: 20px;
}
.terrain-name {
  display: grid;
  grid-template-columns: 24px 1fr;
}
.terrain-name > span {
  grid-row: 1/3;
  color: var(--signal-dark);
  font:
    800 13px 'Cascadia Mono',
    monospace;
}
.terrain-name strong {
  font-size: 12px;
}
.terrain-name small {
  margin-top: 4px;
  color: var(--muted);
  font:
    600 13px 'Cascadia Mono',
    monospace;
}
.terrain-band {
  display: flex;
  overflow: hidden;
  height: 20px;
  border-radius: 5px;
  background: #eef1ef;
}
.terrain-band i {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: rgba(7, 26, 36, 0.75);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  font-style: normal;
}
.terrain-band .l1 {
  background: #e5e8e5;
}
.terrain-band .l2 {
  background: #cfe0d6;
}
.terrain-band .l3 {
  background: #85d8b9;
}
.terrain-band .l4 {
  color: #fff;
  background: #07805f;
}
.theta {
  text-align: right;
}
.theta small,
.theta strong {
  display: block;
}
.theta small {
  color: var(--muted);
  font:
    700 7px 'Cascadia Mono',
    monospace;
}
.theta strong {
  margin-top: 5px;
  font:
    800 18px 'Cascadia Mono',
    monospace;
}
.terrain footer {
  display: flex;
  justify-content: center;
  gap: 24px;
  padding-top: 16px;
  color: var(--muted);
  font-size: 13px;
}
.terrain-empty {
  display: flex;
  min-height: 300px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 8px;
  color: var(--signal-dark);
}
.terrain-empty p {
  color: var(--muted);
  font-size: 13px;
}
.quality-table {
  overflow: auto;
}
.quality-row {
  display: grid;
  min-width: 680px;
  align-items: center;
  padding: 13px 8px;
  border-bottom: 1px solid var(--line);
  grid-template-columns: 1.6fr 0.7fr 0.5fr 0.8fr 1fr;
  gap: 10px;
  color: var(--muted);
  font-size: 13px;
}
.quality-row.heading {
  color: var(--muted);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.06em;
}
.quality-row strong,
.quality-row small {
  display: block;
}
.quality-row strong {
  color: var(--ink-950);
  font-size: 13px;
}
.quality-row small {
  margin-top: 3px;
  font:
    600 7px 'Cascadia Mono',
    monospace;
}
.quality-table > p,
.gaps > p,
.audit > p {
  padding: 20px 0;
  color: var(--muted);
  font-size: 13px;
}
.governance {
  position: sticky;
  top: 16px;
}
.governance > header {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
}
.quota {
  padding: 24px 0;
  text-align: center;
}
.quota-ring {
  display: grid;
  width: 132px;
  height: 132px;
  margin: auto;
  place-items: center;
  border-radius: 50%;
  background: conic-gradient(var(--signal-dark) var(--quota), #e8ece9 0);
}
.quota-ring:before {
  position: absolute;
  width: 104px;
  height: 104px;
  border-radius: 50%;
  background: #fff;
  content: '';
}
.quota-ring span {
  z-index: 1;
}
.quota-ring strong,
.quota-ring small {
  display: block;
}
.quota-ring strong {
  font:
    800 25px 'Cascadia Mono',
    monospace;
}
.quota-ring small {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
}
.quota > p {
  margin-top: 10px;
  color: var(--muted);
  font:
    600 13px 'Cascadia Mono',
    monospace;
}
.governance dl {
  border-block: 1px solid var(--line);
}
.governance dl div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 0;
  border-bottom: 1px solid var(--line);
}
.governance dl div:last-child {
  border: 0;
}
.governance dt {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 13px;
}
.governance dd {
  font:
    750 13px 'Cascadia Mono',
    monospace;
}
.gaps,
.privacy,
.audit {
  padding-top: 22px;
}
.gaps article,
.audit article {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.gaps b {
  color: var(--signal-dark);
  font:
    800 13px 'Cascadia Mono',
    monospace;
}
.gaps strong,
.gaps small,
.audit strong,
.audit small {
  display: block;
}
.gaps strong,
.audit strong {
  font-size: 13px;
}
.gaps small,
.audit small {
  margin-top: 3px;
  color: var(--muted);
  font-size: 7px;
}
.privacy > p {
  margin: 10px 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}
.privacy > button,
.privacy-confirm button {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: white;
  font-size: 13px;
  font-weight: 750;
  cursor: pointer;
}
.privacy-confirm {
  margin-top: 9px;
  padding: 10px;
  border-left: 3px solid #c48122;
  background: #fff8ea;
}
.privacy-confirm strong,
.privacy-confirm small {
  display: block;
}
.privacy-confirm strong {
  font-size: 13px;
}
.privacy-confirm small {
  margin: 4px 0 8px;
  color: var(--muted);
  font-size: 7px;
}
.privacy-confirm button {
  color: white;
  background: #8c5a12;
}
.audit article > svg {
  color: var(--signal-dark);
}
.analytics-state {
  margin-top: 48px;
  padding: 24px;
  color: var(--muted);
}
.analytics-state.is-error {
  display: flex;
  align-items: center;
  gap: 9px;
  border-left: 3px solid #b34736;
  color: #8f3427;
  background: white;
}
.analytics-state button {
  margin-left: auto;
  border: 0;
  background: none;
  text-decoration: underline;
  cursor: pointer;
}
.notice {
  position: fixed;
  right: 24px;
  bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 13px 17px;
  border-radius: 8px;
  color: white;
  background: var(--ink-950);
  box-shadow: 0 12px 30px rgba(7, 26, 36, 0.2);
  font-size: 13px;
}
@media (max-width: 980px) {
  .observatory-head {
    grid-template-columns: 1fr;
  }
  .observatory-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .governance {
    position: static;
  }
  .scope-console {
    max-width: none;
  }
}
@media (max-width: 620px) {
  .observatory {
    padding-top: 35px;
  }
  .scope-console {
    grid-template-columns: 1fr;
  }
  .scope-console button {
    grid-column: 1;
  }
  .sample-seal {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .terrain,
  .quality,
  .governance {
    padding: 17px;
  }
  .terrain article {
    grid-template-columns: 1fr 60px;
    padding: 16px 0;
    gap: 10px;
  }
  .terrain-band {
    grid-column: 1;
  }
  .theta {
    grid-column: 2;
    grid-row: 2;
  }
  .terrain footer {
    flex-wrap: wrap;
  }
  .observatory-head h1 {
    font-size: 52px;
  }
}
</style>
