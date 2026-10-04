<script setup lang="ts">
import '../assets/admin-workspaces.css'
import {
  ArrowRight,
  Beaker,
  Check,
  CircleDashed,
  Download,
  Fingerprint,
  FlaskConical,
  LockKeyhole,
  Play,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { useOrganizationScope } from '../domain/organizationScope'
import { useAccessStore } from '../stores/access'

import { listOrganizations, type OrganizationOption } from '../services/analyticsApi'
import { getLaunchContext, type LaunchBlueprint } from '../services/assessmentApi'
import {
  advancePilot,
  adjudicatePilotGold,
  consentPilot,
  createExpertAssignment,
  createPilotCampaign,
  exportPilotEvidence,
  freezePilot,
  getPilotOverview,
  getMyPilotParticipation,
  linkPilotSession,
  listAvailablePilotCampaigns,
  listCandidateAnswers,
  listMyPilotAssignments,
  listPilotCampaigns,
  listPilotExperts,
  recordPilotEfficiency,
  runPilotMetrics,
  submitPilotRating,
  withdrawPilot,
  type BlindAssignment,
  type CandidateAnswer,
  type ExpertOption,
  type PilotCampaign,
  type PilotOrigin,
  type PilotOverview,
  type PilotParticipant,
  type PilotStatus,
} from '../services/pilotApi'

const organizations = ref<OrganizationOption[]>([])
const access = useAccessStore()
const { organizationId, initialOrganization } = useOrganizationScope()
const campaigns = ref<PilotCampaign[]>([])
const campaignId = ref('')
const overview = ref<PilotOverview | null>(null)
const campaignLoaded = ref(false)
const candidates = ref<CandidateAnswer[]>([])
const experts = ref<ExpertOption[]>([])
const assignments = ref<BlindAssignment[]>([])
const selectedAssignmentId = ref('')
const loading = ref(true)
const busy = ref('')
const error = ref('')
const notice = ref('')
const showCreate = ref(false)
const newName = ref('A01高校真实首轮试测')
const newOrigin = ref<PilotOrigin>('real')
const selectedAnswerId = ref('')
const selectedExpertId = ref('')
const ratingScore = ref(3)
const ratingRationale = ref('')
const ratingEvidence = ref('')
const ratingIdempotencyKey = ref(`pilot-rating-${crypto.randomUUID()}`)
const participant = ref<PilotParticipant | null>(null)
const consentScene = ref('higher_education')
const consentAccepted = ref(false)
const completedSessionId = ref('')
const efficiencyParticipantId = ref('')
const efficiencyCatSessionId = ref('')
const efficiencyFixedSessionId = ref('')
const adjudicationAnswerId = ref('')
const adjudicationScore = ref(2)
const adjudicationRationale = ref('')
const comparisonBlueprints = ref<LaunchBlueprint[]>([])
const newCatBlueprintId = ref('')
const newFixedBlueprintId = ref('')
const blindingReviewConfirmed = ref(false)

const selectedOrganization = computed(() =>
  organizations.value.find((item) => item.id === organizationId.value),
)
const canAdmin = computed(() =>
  ['org_admin', 'system_admin'].includes(selectedOrganization.value?.role ?? ''),
)
const isExpert = computed(
  () => selectedOrganization.value?.role === 'evaluator' || assignments.value.length > 0,
)
const pageTitle = computed(() =>
  canAdmin.value ? '真实试测与指标验证' : isExpert.value ? '试测任务与盲评' : '我的试测任务',
)
const pageDescription = computed(() =>
  canAdmin.value
    ? '组织试测、专家盲评、金标准仲裁与版本冻结，让每个指标都有证据。'
    : isExpert.value
      ? '查看分派给你的独立评分任务，或了解当前可参与的试测。'
      : '查看当前可参与的试测，了解说明后自主决定是否加入。日常能力测评不需要参加试测。',
)
const selectedAssignment = computed(() =>
  assignments.value.find((item) => item.id === selectedAssignmentId.value),
)
const pendingAssignments = computed(() =>
  assignments.value.filter((item) => item.status === 'assigned'),
)
const selectedCampaign = computed(() =>
  campaigns.value.find((item) => item.id === campaignId.value),
)
const selectedCandidate = computed(() =>
  candidates.value.find((item) => item.answer_id === selectedAnswerId.value),
)
const failedGates = computed(() => overview.value?.gates.filter((gate) => !gate.passed) ?? [])
const scoreMetrics = computed(() => overview.value?.latest_metric_run?.results.score_validation)
const catMetrics = computed(() => overview.value?.latest_metric_run?.results.cat_efficiency)
const passedGateCount = computed(
  () => overview.value?.gates.filter((gate) => gate.passed).length ?? 0,
)
const goldProgress = computed(() => {
  const total = overview.value?.campaign.target_open_answers ?? 0
  return total > 0
    ? Math.min(100, Math.round(((overview.value?.gold_standard_count ?? 0) / total) * 100))
    : 0
})
const remainingGold = computed(() =>
  Math.max(
    0,
    (overview.value?.campaign.target_open_answers ?? 0) -
      (overview.value?.gold_standard_count ?? 0),
  ),
)
const pendingAdjudications = computed(
  () => candidates.value.filter((row) => row.gold_status === 'needs_adjudication').length,
)
const nextStatus = computed<PilotStatus | null>(() => {
  const status = overview.value?.campaign.status
  return status === 'draft'
    ? 'recruiting'
    : status === 'recruiting'
      ? 'rating'
      : status === 'rating'
        ? 'analyzing'
        : null
})
const statusLabels: Record<PilotStatus, string> = {
  draft: '规格草案',
  recruiting: '真实招募',
  rating: '专家盲评',
  analyzing: '指标验证',
  frozen: '版本冻结',
}
const participantStatusLabels: Record<PilotStatus, string> = {
  draft: '准备中',
  recruiting: '可报名参加',
  rating: '报名已结束',
  analyzing: '结果整理中',
  frozen: '本次试测已结束',
}
const dimensionLabels: Record<string, string> = {
  foundations: '基础认知',
  prompting: '提示词工程',
  tool_use: '工具使用',
  evaluation: '结果评估',
  collaboration: '人机协同',
  ethics: '伦理合规',
}

function percentage(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined ? '—' : `${(value * 100).toFixed(digits)}%`
}

function gateValue(code: string, value: number | string | null) {
  if (value === null) return '—'
  if (typeof value === 'string') return value
  if (
    [
      'linear_weighted_kappa',
      'adjacent_agreement',
      'question_reduction',
      'level_agreement',
    ].includes(code)
  ) {
    return code === 'linear_weighted_kappa' ? value.toFixed(2) : percentage(value)
  }
  return String(value)
}

async function loadOrganizationsAndCampaigns() {
  loading.value = true
  error.value = ''
  try {
    const [organizationValues, launchContext] = await Promise.all([
      listOrganizations(),
      getLaunchContext(),
    ])
    organizations.value = organizationValues
    comparisonBlueprints.value = launchContext.blueprints.filter(
      (item) => item.scenario === 'higher_education',
    )
    newCatBlueprintId.value =
      comparisonBlueprints.value.find((item) => ['rapid', 'standard'].includes(item.mode))?.id ?? ''
    newFixedBlueprintId.value =
      comparisonBlueprints.value.find((item) => item.mode === 'fixed')?.id ?? ''
    organizationId.value = initialOrganization(organizations.value)
    await loadCampaigns()
    assignments.value =
      access.singlePlatform && !access.can('system') ? [] : await listMyPilotAssignments()
    selectedAssignmentId.value =
      assignments.value.find((item) => item.status === 'assigned')?.id ?? ''
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '试测实验台读取失败。'
  } finally {
    loading.value = false
  }
}

async function loadCampaigns() {
  campaigns.value = []
  campaignId.value = ''
  await loadCampaign()
  if (!organizationId.value) {
    return
  }
  campaigns.value = canAdmin.value
    ? await listPilotCampaigns(organizationId.value)
    : await listAvailablePilotCampaigns(organizationId.value)
  campaignId.value = campaigns.value[0]?.id ?? ''
  await loadCampaign()
}

async function loadCampaign() {
  campaignLoaded.value = false
  overview.value = null
  participant.value = null
  candidates.value = []
  experts.value = []
  consentAccepted.value = false
  completedSessionId.value = ''
  if (!campaignId.value) {
    return
  }
  if (canAdmin.value) {
    overview.value = await getPilotOverview(campaignId.value)
    participant.value = null
    ;[candidates.value, experts.value] = await Promise.all([
      listCandidateAnswers(campaignId.value),
      listPilotExperts(campaignId.value),
    ])
    selectedAnswerId.value =
      candidates.value.find((item) => item.gold_status === 'assigning')?.answer_id ?? ''
    selectedExpertId.value = experts.value[0]?.user_id ?? ''
    adjudicationAnswerId.value =
      candidates.value.find((item) => item.gold_status === 'needs_adjudication')?.answer_id ?? ''
    blindingReviewConfirmed.value = false
  } else {
    overview.value = null
    participant.value = await getMyPilotParticipation(campaignId.value)
  }
  campaignLoaded.value = true
}

async function changeSelection(kind: 'organization' | 'campaign') {
  loading.value = true
  error.value = ''
  notice.value = ''
  showCreate.value = false
  try {
    if (kind === 'organization') await loadCampaigns()
    else await loadCampaign()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '无法读取试测任务，请重新加载。'
  } finally {
    loading.value = false
  }
}

async function consent() {
  if (!campaignId.value || !consentAccepted.value) return
  busy.value = 'consent'
  try {
    participant.value = await consentPilot(campaignId.value, consentScene.value)
    notice.value = '知情同意已记录；原始交互默认保留90天，撤回后不再进入统计。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '加入试测失败。'
  } finally {
    busy.value = ''
  }
}

async function linkSession() {
  if (!campaignId.value || !completedSessionId.value.trim()) return
  busy.value = 'link'
  try {
    participant.value = await linkPilotSession(campaignId.value, completedSessionId.value.trim())
    notice.value = '已完成的测评记录已关联到本次试测。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '关联失败。'
  } finally {
    busy.value = ''
  }
}

async function withdraw() {
  if (!campaignId.value) return
  busy.value = 'withdraw'
  try {
    participant.value = await withdrawPilot(campaignId.value)
    notice.value = '你已撤回；该记录将从指标数据集排除。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '撤回失败。'
  } finally {
    busy.value = ''
  }
}

async function recordEfficiency() {
  if (!overview.value) return
  busy.value = 'efficiency'
  try {
    await recordPilotEfficiency(overview.value.campaign.id, {
      participant_id: efficiencyParticipantId.value.trim(),
      cat_session_id: efficiencyCatSessionId.value.trim(),
      fixed_session_id: efficiencyFixedSessionId.value.trim(),
    })
    await loadCampaign()
    notice.value = 'CAT与同构固定卷的真实完成记录已形成配对证据。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '配对登记失败。'
  } finally {
    busy.value = ''
  }
}

async function adjudicate() {
  if (!overview.value || !adjudicationAnswerId.value) return
  busy.value = 'adjudicate'
  try {
    await adjudicatePilotGold(overview.value.campaign.id, adjudicationAnswerId.value, {
      score: adjudicationScore.value,
      rationale: adjudicationRationale.value,
    })
    adjudicationRationale.value = ''
    await loadCampaign()
    notice.value = '专家分歧已由管理员说明理由并封存为金标准。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '仲裁失败。'
  } finally {
    busy.value = ''
  }
}

async function createCampaign() {
  if (
    !organizationId.value ||
    !newName.value.trim() ||
    (newOrigin.value === 'real' && (!newCatBlueprintId.value || !newFixedBlueprintId.value))
  )
    return
  busy.value = 'create'
  error.value = ''
  try {
    const created = await createPilotCampaign({
      organization_id: organizationId.value,
      name: newName.value.trim(),
      scenario: 'higher_education',
      data_origin: newOrigin.value,
      cat_blueprint_version_id: newCatBlueprintId.value,
      fixed_blueprint_version_id: newFixedBlueprintId.value,
    })
    showCreate.value = false
    await loadCampaigns()
    campaignId.value = created.id
    await loadCampaign()
    notice.value = '试测批次已按预注册阈值建立。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '创建失败。'
  } finally {
    busy.value = ''
  }
}

async function advance() {
  if (!overview.value || !nextStatus.value) return
  busy.value = 'advance'
  try {
    await advancePilot(overview.value.campaign.id, nextStatus.value)
    await loadCampaign()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '阶段推进失败。'
  } finally {
    busy.value = ''
  }
}

async function runMetrics() {
  if (!overview.value) return
  busy.value = 'metrics'
  try {
    await runPilotMetrics(overview.value.campaign.id)
    await loadCampaign()
    notice.value = '新的不可变指标快照已生成。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '指标运行失败。'
  } finally {
    busy.value = ''
  }
}

async function freeze() {
  if (!overview.value || failedGates.value.length) return
  busy.value = 'freeze'
  try {
    await freezePilot(overview.value.campaign.id)
    await loadCampaign()
    notice.value = '题目、量规、模型、提示词、阈值与数据集版本已冻结。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '冻结失败。'
  } finally {
    busy.value = ''
  }
}

async function exportEvidence() {
  if (!overview.value) return
  busy.value = 'export'
  try {
    const blob = await exportPilotEvidence(overview.value.campaign.id)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `pilot-${overview.value.campaign.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    notice.value = '去标识化实验报告已导出，来源声明与数据集哈希已包含。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '实验报告导出失败。'
  } finally {
    busy.value = ''
  }
}

async function assign() {
  if (!overview.value || !selectedAnswerId.value || !selectedExpertId.value) return
  const candidate = candidates.value.find((item) => item.answer_id === selectedAnswerId.value)
  if (!candidate) return
  busy.value = 'assign'
  try {
    await createExpertAssignment(overview.value.campaign.id, {
      answer_id: candidate.answer_id,
      expert_id: selectedExpertId.value,
      seat: candidate.assigned_seats + 1,
      blinding_review_confirmed: blindingReviewConfirmed.value,
    })
    blindingReviewConfirmed.value = false
    await loadCampaign()
    notice.value = '新的盲评席位已分派，专家不会看到AI建议分。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '分派失败。'
  } finally {
    busy.value = ''
  }
}

async function sealRating() {
  if (!selectedAssignment.value || (access.singlePlatform && !access.can('system'))) return
  busy.value = 'rating'
  try {
    await submitPilotRating(
      selectedAssignment.value.id,
      {
        score: ratingScore.value,
        rationale: ratingRationale.value,
        evidence: ratingEvidence.value,
      },
      ratingIdempotencyKey.value,
    )
    assignments.value = await listMyPilotAssignments()
    selectedAssignmentId.value =
      assignments.value.find((item) => item.status === 'assigned')?.id ?? ''
    ratingRationale.value = ''
    ratingEvidence.value = ''
    ratingIdempotencyKey.value = `pilot-rating-${crypto.randomUUID()}`
    notice.value = '专家评分已封存，不能覆盖或改写。'
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '评分提交失败。'
  } finally {
    busy.value = ''
  }
}

onMounted(loadOrganizationsAndCampaigns)
</script>

<template>
  <section class="pilot-lab shell admin-workspace">
    <header class="lab-head">
      <div>
        <span class="eyebrow">{{ canAdmin ? 'Real-world pilot' : '试测参与' }}</span>
        <h1>{{ pageTitle }}</h1>
        <p>{{ pageDescription }}</p>
      </div>
      <div
        v-if="
          (!access.singlePlatform && organizations.length > 1) || campaigns.length > 1 || canAdmin
        "
        class="selectors"
      >
        <label v-if="!access.singlePlatform && organizations.length > 1"
          >组织<select
            v-model="organizationId"
            :disabled="loading || !!busy"
            @change="changeSelection('organization')"
          >
            <option v-for="item in organizations" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <label v-if="campaigns.length > 1"
          >{{ canAdmin ? '批次' : '选择试测'
          }}<select
            v-model="campaignId"
            :disabled="loading || !!busy"
            @change="changeSelection('campaign')"
          >
            <option v-for="item in campaigns" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </select></label
        >
        <button
          v-if="canAdmin"
          type="button"
          :disabled="loading || !!busy"
          @click="showCreate = !showCreate"
        >
          <Beaker :size="16" />新建批次
        </button>
      </div>
    </header>

    <form
      v-if="showCreate && canAdmin"
      class="create-strip surface"
      @submit.prevent="createCampaign"
    >
      <label>批次名称<input v-model="newName" maxlength="160" /></label>
      <label
        >数据来源<select v-model="newOrigin">
          <option value="real">真实试测</option>
          <option value="synthetic">合成演示</option>
        </select></label
      >
      <label
        >CAT卷版本<select v-model="newCatBlueprintId">
          <option value="">选择已发布极速/标准卷</option>
          <option
            v-for="item in comparisonBlueprints.filter((row) =>
              ['rapid', 'standard'].includes(row.mode),
            )"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }} · {{ item.min_items }}–{{ item.max_items }}题
          </option>
        </select></label
      >
      <label
        >固定卷版本<select v-model="newFixedBlueprintId">
          <option value="">选择已发布固定卷</option>
          <option
            v-for="item in comparisonBlueprints.filter((row) => row.mode === 'fixed')"
            :key="item.id"
            :value="item.id"
          >
            {{ item.name }} · {{ item.max_items }}题
          </option>
        </select></label
      >
      <p>默认预注册：50名用户、60份开放回答、3名专家；Kappa≥0.75。</p>
      <button
        type="submit"
        :disabled="
          busy === 'create' ||
          (newOrigin === 'real' && (!newCatBlueprintId || !newFixedBlueprintId))
        "
      >
        建立预注册批次
      </button>
    </form>

    <p v-if="error" class="alert" role="alert">
      <TriangleAlert :size="17" /><span>{{ error }}</span
      ><button type="button" :disabled="loading || !!busy" @click="loadOrganizationsAndCampaigns">
        重新加载
      </button>
    </p>
    <p v-if="notice" class="notice"><Check :size="17" />{{ notice }}</p>
    <div v-if="loading" class="loading" role="status">
      {{ canAdmin ? '正在核对试测批次与数据集哈希……' : '正在读取你的试测任务……' }}
    </div>

    <section v-if="!loading && pendingAssignments.length" class="expert-desk surface">
      <header>
        <div>
          <span>My blinded dossier</span>
          <h2>我的专家盲评任务</h2>
        </div>
        <select v-model="selectedAssignmentId">
          <option value="">选择待评任务</option>
          <option
            v-for="item in pendingAssignments"
            :key="item.id"
            :value="item.id"
            :disabled="item.status !== 'assigned'"
          >
            {{ item.campaign_name }} · 席位{{ item.seat }} ·
            {{ item.status === 'assigned' ? '待评' : '已封存' }}
          </option>
        </select>
      </header>
      <div v-if="selectedAssignment" class="blind-grid">
        <article>
          <span>匿名题目</span>
          <h3>{{ selectedAssignment.item_stem }}</h3>
          <pre>{{ JSON.stringify(selectedAssignment.answer_response, null, 2) }}</pre>
        </article>
        <form @submit.prevent="sealRating">
          <label
            >0–4最终评分<input v-model.number="ratingScore" type="number" min="0" max="4" /></label
          ><label
            >量规依据<textarea
              v-model="ratingRationale"
              rows="3"
              required
              minlength="8"
            ></textarea></label
          ><label
            >回答证据<textarea
              v-model="ratingEvidence"
              rows="3"
              required
              minlength="2"
            ></textarea></label
          ><button type="submit" :disabled="busy === 'rating'">封存独立评分</button>
        </form>
      </div>
    </section>

    <section
      v-if="!loading && campaignLoaded && selectedCampaign && !canAdmin"
      class="participant-desk surface"
    >
      <header>
        <div>
          <span>{{ isExpert ? 'PARTICIPANT WORKFLOW' : '参与说明' }}</span>
          <h2>{{ selectedCampaign.name }}</h2>
        </div>
        <strong>{{ participantStatusLabels[selectedCampaign.status] }}</strong>
      </header>
      <div v-if="!participant && selectedCampaign.status === 'recruiting'" class="participant-grid">
        <div>
          <h3>加入真实试测</h3>
          <p>数据仅用于初步效度验证，不形成正式常模；原始交互默认保留90天，你可以随时撤回。</p>
        </div>
        <form @submit.prevent="consent">
          <label
            >你的使用场景<select v-model="consentScene">
              <option value="higher_education">高校学习</option>
              <option value="enterprise">企业办公</option>
            </select></label
          >
          <label class="consent-check"
            ><input
              v-model="consentAccepted"
              type="checkbox"
            />我已阅读并自愿参加，且知道可以撤回</label
          >
          <button type="submit" :disabled="!consentAccepted || busy === 'consent'">
            确认知情同意
          </button>
        </form>
      </div>
      <div v-else-if="!participant" class="participant-grid">
        <div>
          <h3>本批次已停止招募</h3>
          <p>本次报名已经结束。你仍可前往能力测评，自主选择测评方式。</p>
          <RouterLink to="/assessment">前往能力测评 <ArrowRight :size="15" /></RouterLink>
        </div>
      </div>
      <div v-else class="participant-grid">
        <div>
          <h3>
            {{
              participant.withdrawn_at
                ? '已撤回试测'
                : participant.completed_at
                  ? '测评记录已关联'
                  : '完成并关联测评记录'
            }}
          </h3>
          <p v-if="participant.session_id">
            会话证据：<code>{{ participant.session_id }}</code>
          </p>
          <p v-else-if="!participant.withdrawn_at">
            先按本次试测要求完成标准测或极速测，再填写结果页地址中的测评记录ID。
          </p>
          <p v-else>你已退出本次试测，该记录不再进入试测统计；日常能力测评仍可使用。</p>
          <RouterLink v-if="!participant.session_id && !participant.withdrawn_at" to="/assessment"
            >前往能力测评 <ArrowRight :size="15"
          /></RouterLink>
        </div>
        <form
          v-if="!participant.session_id && !participant.withdrawn_at"
          @submit.prevent="linkSession"
        >
          <label
            >已完成的测评记录ID<input
              v-model="completedSessionId"
              required
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" /></label
          ><button type="submit" :disabled="busy === 'link'">关联完成记录</button>
        </form>
        <button
          v-if="!participant.withdrawn_at"
          class="withdraw-button"
          type="button"
          :disabled="!!busy"
          @click="withdraw"
        >
          撤回并排除数据
        </button>
      </div>
    </section>

    <template v-if="!loading && overview">
      <section class="batch-seal surface" :class="overview.campaign.data_origin">
        <div class="origin-stamp">
          <FlaskConical :size="22" /><span
            ><small>DATA ORIGIN</small
            ><strong>{{
              overview.campaign.data_origin === 'real' ? '真实试测' : '合成演示'
            }}</strong></span
          >
        </div>
        <div class="batch-description">
          <h2>{{ overview.campaign.name }}</h2>
          <p>
            目标 {{ overview.campaign.target_participants }} 名参与者 ·
            {{ overview.campaign.target_open_answers }} 份开放回答 ·
            {{ overview.campaign.required_experts }} 名独立专家
          </p>
          <small v-if="overview.campaign.data_origin === 'real'"
            >当前结果仅用于初步效度验证，样本量有限，不构成正式常模。</small
          >
          <small v-else>仅用于验证软件流程与答辩演示，不得写入真实实验结论。</small>
        </div>
        <div class="status-chip">
          <CircleDashed :size="15" />{{ statusLabels[overview.campaign.status] }}
        </div>
      </section>

      <div class="lab-title">
        <div>
          <span>Evidence gate</span>
          <h2>证据闸门</h2>
        </div>
        <p v-if="failedGates.length">尚有 {{ failedGates.length }} 项门禁未通过</p>
        <p v-else-if="overview.gates.length">
          全部门禁通过{{
            overview.campaign.status === 'frozen' ? '，版本已冻结' : '，可进入冻结检查'
          }}
        </p>
        <p v-else>尚未返回门禁检查结果</p>
      </div>
      <p class="gate-summary">
        {{ passedGateCount }} / {{ overview.gates.length }} 项已通过 · 以当前批次的服务端检查为准
      </p>
      <section class="gate-rail surface">
        <article
          v-for="gate in overview.gates"
          :key="gate.code"
          :data-testid="`gate-${gate.code}`"
          :class="{ passed: gate.passed }"
        >
          <div>
            <ShieldCheck v-if="gate.passed" :size="17" /><LockKeyhole v-else :size="17" /><span>{{
              gate.passed ? '已通过' : '待完成'
            }}</span>
          </div>
          <strong>{{ gate.label }}</strong>
          <p>
            <b>{{ gateValue(gate.code, gate.current) }}</b
            ><i>/</i>{{ gateValue(gate.code, gate.target) }}
          </p>
        </article>
      </section>

      <section class="ledger-grid">
        <article class="metric-ledger surface">
          <header>
            <Fingerprint :size="19" />
            <div>
              <span>Immutable metric snapshot</span>
              <h2>指标证据账本</h2>
            </div>
          </header>
          <div class="metric-cards">
            <div class="metric-row">
              <span>线性加权Kappa</span
              ><strong>{{ scoreMetrics?.linear_weighted_kappa?.toFixed(3) ?? '—' }}</strong
              ><small>目标 ≥ 0.750 · n={{ scoreMetrics?.sample_size ?? 0 }}</small>
            </div>
            <div class="metric-row">
              <span>相邻等级一致率</span
              ><strong>{{ percentage(scoreMetrics?.adjacent_agreement) }}</strong
              ><small>目标 ≥ 90%</small>
            </div>
            <div class="metric-row">
              <span>CAT题量缩减</span
              ><strong data-testid="metric-question-reduction">{{
                percentage(catMetrics?.question_reduction)
              }}</strong
              ><small>目标 ≥ 30% · 配对n={{ catMetrics?.sample_size ?? 0 }}</small>
            </div>
            <div class="metric-row">
              <span>CAT等级一致率</span
              ><strong>{{ percentage(catMetrics?.level_agreement) }}</strong
              ><small>目标 ≥ 85%</small>
            </div>
          </div>
          <footer v-if="overview.latest_metric_run">
            <code>{{ overview.latest_metric_run.dataset_hash.slice(0, 24) }}…</code
            ><span>{{ overview.latest_metric_run.algorithm_version }}</span>
          </footer>
          <footer v-else><span>尚未生成指标快照</span></footer>
          <details v-if="overview.latest_metric_run" class="snapshot-detail">
            <summary>查看运行快照与版本</summary>
            <dl>
              <div>
                <dt>运行时间</dt>
                <dd>
                  {{ new Date(overview.latest_metric_run.completed_at).toLocaleString('zh-CN') }}
                </dd>
              </div>
              <div>
                <dt>数据集 SHA-256</dt>
                <dd>
                  <code>{{ overview.latest_metric_run.dataset_hash }}</code>
                </dd>
              </div>
            </dl>
            <pre>{{
              JSON.stringify(
                {
                  parameters: overview.latest_metric_run.parameters,
                  exclusions: overview.latest_metric_run.exclusions,
                  versions: overview.campaign.version_bundle,
                },
                null,
                2,
              )
            }}</pre>
          </details>
        </article>

        <article class="panel-ledger surface">
          <header>
            <UsersRound :size="19" />
            <div>
              <span>Blind expert panel</span>
              <h2>专家盲评流水线</h2>
            </div>
          </header>
          <dl>
            <div>
              <dt>开放回答</dt>
              <dd>
                {{ overview.assigned_answer_count
                }}<small>/ {{ overview.campaign.target_open_answers }}</small>
              </dd>
            </div>
            <div>
              <dt>已交评分</dt>
              <dd>{{ overview.submitted_rating_count }}</dd>
            </div>
            <div>
              <dt>金标准</dt>
              <dd>
                {{ overview.gold_standard_count
                }}<small>/ {{ overview.campaign.target_open_answers }}</small>
              </dd>
            </div>
          </dl>
          <ol class="expert-pipeline" aria-label="盲评流程">
            <li><span>01</span><strong>匿名化核验</strong><small>分派前人工确认</small></li>
            <li>
              <span>02</span><strong>{{ overview.campaign.required_experts }} 位专家独立评分</strong
              ><small>提交前意见隔离</small>
            </li>
            <li><span>03</span><strong>金标准封存</strong><small>分歧须说明仲裁理由</small></li>
          </ol>
          <form
            v-if="canAdmin && overview.campaign.status === 'rating'"
            class="assign-form"
            @submit.prevent="assign"
          >
            <label
              >待分派回答<select
                v-model="selectedAnswerId"
                @change="blindingReviewConfirmed = false"
              >
                <option value="">选择回答</option>
                <option
                  v-for="item in candidates.filter((row) => row.gold_status === 'assigning')"
                  :key="item.answer_id"
                  :value="item.answer_id"
                >
                  {{ dimensionLabels[item.dimension_code] ?? item.dimension_code }} ·
                  {{ item.assigned_seats }}/{{ item.required_experts }}席
                </option>
              </select></label
            >
            <div v-if="selectedCandidate" class="blinding-review">
              <strong>人工脱敏复核</strong>
              <p v-if="selectedCandidate.identity_risk_flags.length">
                风险提示：{{ selectedCandidate.identity_risk_flags.join('、') }}
              </p>
              <p v-else>自动检测未命中；仍须人工阅读全文。</p>
              <pre>{{ JSON.stringify(selectedCandidate.blinding_preview, null, 2) }}</pre>
              <label class="consent-check"
                ><input
                  v-model="blindingReviewConfirmed"
                  type="checkbox"
                />我已核对匿名预览，不含可识别参与者的信息</label
              >
            </div>
            <label
              >盲评专家<select v-model="selectedExpertId">
                <option value="">选择专家</option>
                <option v-for="item in experts" :key="item.user_id" :value="item.user_id">
                  {{ item.display_name }}
                </option>
              </select></label
            >
            <button
              type="submit"
              :disabled="
                !selectedAnswerId ||
                !selectedExpertId ||
                !blindingReviewConfirmed ||
                busy === 'assign'
              "
            >
              分派下一席<ArrowRight :size="15" />
            </button>
          </form>
          <p v-else class="pipeline-note">
            每位专家只看到题干、匿名回答和量规；AI建议分与同伴意见在提交前物理隔离。
          </p>
        </article>
        <aside class="pilot-context">
          <section class="pilot-context-card surface">
            <span class="admin-caption">Participants</span>
            <h2>参与者与样本</h2>
            <dl class="participant-summary">
              <div>
                <dt>参与人数</dt>
                <dd>{{ overview.participant_count }}</dd>
              </div>
              <div>
                <dt>完成试测</dt>
                <dd>{{ overview.completed_participant_count }}</dd>
              </div>
              <div>
                <dt>已撤回人数</dt>
                <dd>{{ overview.withdrawn_participant_count }}</dd>
              </div>
              <div>
                <dt>CAT / 固定卷配对</dt>
                <dd>{{ overview.efficiency_observation_count }}</dd>
              </div>
            </dl>
            <p class="admin-note">
              仅展示当前批次汇总。撤回数据不进入后续统计；无真实样本时，不生成验证结论。
            </p>
          </section>
          <section class="pilot-context-card freeze-summary surface">
            <span class="admin-caption">Version freeze</span>
            <h2>{{ overview.campaign.status === 'frozen' ? '实验版本已冻结' : '版本冻结检查' }}</h2>
            <strong class="freeze-number">{{ remainingGold }}<small>份金标准待补齐</small></strong>
            <progress
              class="admin-progress"
              :value="goldProgress"
              max="100"
              aria-label="金标准封存进度"
            ></progress>
            <p>
              金标准 {{ overview.gold_standard_count }} /
              {{ overview.campaign.target_open_answers }} · 待仲裁 {{ pendingAdjudications }} 份
            </p>
            <p class="freeze-caution">
              此进度仅代表金标准数量。所有证据门禁及批次状态满足要求后，才能冻结。
            </p>
            <a href="#pilot-controls" class="secondary-button"
              >查看实验控制 <ArrowRight :size="15"
            /></a>
          </section>
        </aside>
      </section>

      <section
        v-if="canAdmin && overview.campaign.status === 'rating'"
        class="evidence-entry surface"
      >
        <header>
          <div>
            <span>PAIR &amp; ADJUDICATE</span>
            <h2>配对与仲裁</h2>
          </div>
          <p>只接受同一能力模型、六维覆盖与三题型一致的已完成CAT/固定卷。</p>
        </header>
        <form @submit.prevent="recordEfficiency">
          <label>参与者ID<input v-model="efficiencyParticipantId" required /></label
          ><label>CAT会话ID<input v-model="efficiencyCatSessionId" required /></label
          ><label>固定卷会话ID<input v-model="efficiencyFixedSessionId" required /></label
          ><button type="submit" :disabled="busy === 'efficiency'">登记效率配对</button>
        </form>
        <form @submit.prevent="adjudicate">
          <label
            >待仲裁回答<select v-model="adjudicationAnswerId">
              <option value="">选择三专家分歧回答</option>
              <option
                v-for="item in candidates.filter((row) => row.gold_status === 'needs_adjudication')"
                :key="item.answer_id"
                :value="item.answer_id"
              >
                {{ dimensionLabels[item.dimension_code] ?? item.dimension_code }} ·
                {{ item.answer_id.slice(0, 8) }}
              </option>
            </select></label
          ><label
            >仲裁分<input v-model.number="adjudicationScore" type="number" min="0" max="4" /></label
          ><label
            >仲裁理由<textarea
              v-model="adjudicationRationale"
              required
              minlength="8"
              rows="2"
            ></textarea></label
          ><button type="submit" :disabled="!adjudicationAnswerId || busy === 'adjudicate'">
            封存金标准
          </button>
        </form>
      </section>

      <section v-if="canAdmin" id="pilot-controls" class="control-strip surface">
        <div>
          <span>实验控制</span>
          <p>每一步都保留版本、数据集和操作者证据。</p>
        </div>
        <button v-if="nextStatus" type="button" :disabled="!!busy" @click="advance">
          <Play :size="15" />进入{{ statusLabels[nextStatus] }}
        </button>
        <button
          v-if="overview.campaign.status === 'analyzing'"
          type="button"
          :disabled="!!busy"
          @click="runMetrics"
        >
          <Fingerprint :size="15" />运行指标
        </button>
        <button type="button" :disabled="!!busy" @click="exportEvidence">
          <Download :size="15" />导出证据
        </button>
        <button
          data-testid="freeze-campaign"
          type="button"
          :disabled="
            !!busy ||
            !overview.gates.length ||
            !!failedGates.length ||
            overview.campaign.status !== 'analyzing'
          "
          @click="freeze"
        >
          <LockKeyhole :size="15" />冻结版本
        </button>
      </section>
    </template>

    <section
      v-else-if="!loading && !selectedCampaign && !pendingAssignments.length && !error"
      class="empty surface"
    >
      <div class="empty-icon"><Beaker :size="30" /></div>
      <div class="empty-content">
        <h2>
          {{
            canAdmin
              ? '还没有试测批次'
              : isExpert
                ? '暂无待评任务或可参与的试测'
                : '暂时没有可参与的试测'
          }}
        </h2>
        <p v-if="canAdmin">先通过“新建批次”确定试测方案，再开放报名和安排专家评分。</p>
        <p v-else-if="isExpert">
          分派给你的待评任务会显示在这里。当前无需提交评分，也不影响你进行日常测评。
        </p>
        <p v-else>这里仅展示已开放的试测报名和你的参与记录，不是开始日常测评的必经步骤。</p>
        <div class="empty-actions">
          <button v-if="canAdmin" type="button" class="primary-button" @click="showCreate = true">
            <Beaker :size="16" />新建批次
          </button>
          <RouterLink v-else class="primary-button" to="/assessment"
            >前往能力测评 <ArrowRight :size="16"
          /></RouterLink>
          <RouterLink class="empty-back" to="/workspace">返回工作台</RouterLink>
        </div>
      </div>
    </section>
  </section>
</template>

<style scoped>
.pilot-lab {
  min-height: calc(100vh - 180px);
  padding: 4px 0 40px;
}
.lab-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
}
.lab-head h1 {
  margin-top: 12px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 28px;
  line-height: 1.4;
  letter-spacing: -0.02em;
}
.lab-head h1 em {
  color: var(--signal-dark);
  font-style: normal;
}
.lab-head > div > p {
  max-width: 620px;
  margin-top: 8px;
  color: var(--muted);
  line-height: 1.8;
}
.selectors {
  display: grid;
  min-width: 280px;
  max-width: 480px;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.selectors label,
.create-strip label,
.assign-form label,
.blind-grid form label {
  display: grid;
  color: var(--muted);
  font-size: 13px;
  gap: 5px;
}
.selectors select,
.create-strip select,
.create-strip input,
.assign-form select,
.expert-desk select,
.blind-grid input,
.blind-grid textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--ink-950);
  background: white;
}
.selectors button,
.create-strip button,
.assign-form button,
.control-strip button,
.blind-grid button {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border: 0;
  border-radius: 9px;
  color: white;
  background: var(--signal-dark);
  font-weight: 750;
  gap: 7px;
  cursor: pointer;
}
.create-strip {
  display: grid;
  margin-top: 28px;
  padding: 18px;
  grid-template-columns: 1.3fr 0.7fr 1.5fr auto;
  align-items: end;
  gap: 14px;
}
.create-strip p {
  color: var(--muted);
  font-size: 13px;
}
.batch-seal {
  display: grid;
  margin-top: 24px;
  padding: 24px;
  border-left: 4px solid var(--signal-dark);
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 24px;
  background: var(--mist);
}
.batch-description {
  min-width: 0;
}
.batch-description h2 {
  font-size: 20px;
}
.batch-description p {
  margin-top: 6px;
  color: var(--text);
  font-size: 13px;
}
.batch-description small {
  display: block;
  margin-top: 8px;
  color: var(--muted);
  font-size: 12px;
}
.batch-seal.synthetic {
  border-left-color: #b47718;
}
.origin-stamp {
  display: flex;
  align-items: center;
  color: var(--signal-dark);
  gap: 10px;
}
.synthetic .origin-stamp {
  color: #9a6415;
}
.origin-stamp span {
  display: grid;
}
.origin-stamp small,
.lab-title span,
.metric-ledger header span,
.panel-ledger header span,
.expert-desk header span,
.control-strip span {
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.12em;
}
.origin-stamp strong {
  color: var(--ink-950);
  font-size: 13px;
}
.batch-seal > p {
  color: var(--muted);
  font-size: 13px;
}
.status-chip {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--ink-950);
  font-size: 13px;
  gap: 6px;
}
.lab-title {
  display: flex;
  margin-top: 24px;
  align-items: end;
  justify-content: space-between;
}
.lab-title span,
.metric-ledger header span,
.panel-ledger header span,
.expert-desk header span,
.control-strip span {
  color: var(--signal-dark);
}
.lab-title h2,
.metric-ledger h2,
.panel-ledger h2,
.expert-desk h2 {
  margin-top: 5px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 20px;
}
.lab-title > p {
  color: #9a6415;
  font-size: 13px;
}
.gate-rail {
  display: grid;
  margin-top: 12px;
  overflow: hidden;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
}
.gate-rail article {
  min-height: 124px;
  padding: 16px;
  border-right: 1px solid var(--line);
  border-bottom: 3px solid #b47718;
}
.gate-rail article.passed {
  border-bottom-color: var(--signal-dark);
}
.gate-rail article > div {
  display: flex;
  align-items: center;
  color: #9a6415;
  gap: 6px;
}
.gate-rail article.passed > div {
  color: var(--signal-dark);
}
.gate-rail article > div span {
  font:
    700 13px 'Cascadia Mono',
    monospace;
}
.gate-rail strong {
  display: block;
  margin-top: 16px;
  color: var(--ink-950);
  font-size: 14px;
}
.gate-rail p {
  display: flex;
  align-items: baseline;
  margin-top: 8px;
  color: var(--muted);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  gap: 6px;
}
.gate-rail p b {
  color: var(--ink-950);
  font-size: 20px;
}
.gate-rail p i {
  font-style: normal;
  color: var(--line);
}
.ledger-grid {
  display: grid;
  margin-top: 22px;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
}
.metric-ledger,
.panel-ledger {
  padding: 25px;
  min-width: 0;
}
.metric-ledger,
.panel-ledger {
  grid-column: 1;
}
.gate-summary {
  margin-top: 6px;
  color: var(--muted);
  font-size: 12px;
}
.metric-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 20px;
}
.pilot-context {
  display: grid;
  grid-column: 2;
  grid-row: 1 / 3;
  align-content: start;
  gap: 20px;
  min-width: 0;
}
.pilot-context-card {
  padding: 24px;
}
.pilot-context-card h2 {
  margin: 6px 0 20px;
  font-size: 18px;
}
.participant-summary {
  display: grid;
  gap: 16px;
  margin-bottom: 20px;
}
.participant-summary div {
  display: flex;
  justify-content: space-between;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.participant-summary dt {
  color: var(--muted);
  font-size: 13px;
}
.participant-summary dd {
  color: var(--signal-dark);
  font: 700 20px var(--admin-number-font);
}
.freeze-summary {
  background: var(--mist);
}
.freeze-number {
  display: block;
  margin-bottom: 16px;
  color: var(--signal-dark);
  font: 700 36px var(--admin-number-font);
}
.freeze-number small {
  margin-left: 8px;
  color: var(--muted);
  font: 13px/1.6 sans-serif;
}
.freeze-summary p {
  margin-top: 12px;
  font-size: 13px;
  color: var(--muted);
}
.freeze-summary .freeze-caution {
  margin-top: 16px;
  font-size: 12px;
}
.freeze-summary a {
  margin-top: 20px;
  width: 100%;
  font-size: 13px;
}
.expert-pipeline {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  padding: 0;
  margin-top: 24px;
  list-style: none;
}
.expert-pipeline li {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
}
.expert-pipeline span {
  color: var(--signal-dark);
  font: 700 12px var(--admin-number-font);
}
.expert-pipeline strong {
  display: block;
  margin-top: 8px;
  font-size: 13px;
}
.expert-pipeline small {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}
.snapshot-detail {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
  font-size: 13px;
}
.snapshot-detail summary {
  color: var(--signal-dark);
}
.snapshot-detail dl {
  margin-top: 12px;
}
.snapshot-detail dt {
  color: var(--muted);
}
.snapshot-detail dd {
  margin: 4px 0 12px;
  overflow-wrap: anywhere;
}
.snapshot-detail pre {
  max-height: 260px;
  overflow: auto;
  padding: 12px;
  background: var(--paper);
  white-space: pre-wrap;
  font-size: 12px;
}
.metric-ledger header,
.panel-ledger header {
  display: flex;
  color: var(--signal-dark);
  gap: 10px;
}
.metric-row {
  display: grid;
  padding: 20px;
  border-radius: 12px;
  background: var(--paper);
  grid-template-columns: minmax(0, 1fr);
  align-items: end;
}
.metric-row span {
  color: var(--ink-950);
  font-size: 13px;
}
.metric-row strong {
  margin: 8px 0;
  color: var(--signal-dark);
  font:
    800 28px 'Cascadia Mono',
    monospace;
}
.metric-row small {
  grid-column: 1/-1;
  margin-top: 3px;
  color: var(--muted);
  font-size: 13px;
}
.metric-ledger footer {
  display: flex;
  margin-top: 20px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
  justify-content: space-between;
  color: var(--muted);
  font-size: 13px;
}
.metric-ledger code {
  color: var(--signal-dark);
}
.panel-ledger dl {
  display: grid;
  margin-top: 24px;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.panel-ledger dl div {
  padding-left: 11px;
  border-left: 2px solid var(--signal);
}
.panel-ledger dt {
  color: var(--muted);
  font-size: 13px;
}
.panel-ledger dd {
  margin-top: 4px;
  color: var(--ink-950);
  font:
    800 25px 'Cascadia Mono',
    monospace;
}
.panel-ledger dd small {
  color: var(--muted);
  font-size: 13px;
}
.assign-form {
  display: grid;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
  gap: 10px;
}
.assign-form button {
  justify-self: start;
}
.pipeline-note {
  margin-top: 24px;
  padding: 16px;
  border-left: 3px solid var(--signal);
  color: var(--muted);
  background: rgba(19, 127, 145, 0.05);
  font-size: 13px;
  line-height: 1.7;
}
.expert-desk {
  margin-top: 20px;
  padding: 25px;
}
.expert-desk > header {
  display: flex;
  align-items: end;
  justify-content: space-between;
}
.blind-grid {
  display: grid;
  margin-top: 22px;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 22px;
}
.blind-grid article {
  padding: 18px;
  background: #f0f3f0;
}
.blind-grid article > span {
  color: var(--signal-dark);
  font-size: 13px;
}
.blind-grid h3 {
  margin-top: 8px;
  color: var(--ink-950);
}
.blind-grid pre {
  max-height: 210px;
  overflow: auto;
  margin-top: 14px;
  font:
    13px/1.6 'Cascadia Mono',
    monospace;
  white-space: pre-wrap;
}
.blind-grid form {
  display: grid;
  gap: 10px;
}
.blind-grid textarea {
  resize: vertical;
}
.control-strip {
  display: flex;
  margin-top: 20px;
  padding: 18px;
  align-items: center;
  gap: 10px;
}
.control-strip > div {
  margin-right: auto;
}
.control-strip p {
  margin-top: 4px;
  color: var(--muted);
  font-size: 13px;
}
.control-strip button:disabled,
.selectors button:disabled,
.assign-form button:disabled,
.blind-grid button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.alert,
.notice,
.loading {
  display: flex;
  margin-top: 20px;
  padding: 13px 16px;
  border-left: 3px solid #a63d32;
  color: #8d3028;
  background: rgba(166, 61, 50, 0.07);
  gap: 8px;
}
.alert {
  align-items: center;
  flex-wrap: wrap;
}
.alert > span {
  flex: 1;
  min-width: 160px;
  overflow-wrap: anywhere;
}
.alert button {
  min-height: 44px;
  border: 1px solid currentColor;
  border-radius: 8px;
  padding: 8px 12px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.notice {
  border-color: var(--signal-dark);
  color: var(--signal-dark);
  background: rgba(19, 127, 145, 0.07);
}
.loading {
  border-color: var(--line);
  color: var(--muted);
  background: white;
}
.empty {
  display: flex;
  margin-top: 28px;
  padding: 32px;
  align-items: flex-start;
  gap: 20px;
  color: var(--signal-dark);
}
.empty-icon {
  display: grid;
  place-items: center;
  flex: 0 0 58px;
  width: 58px;
  height: 58px;
  border-radius: 16px;
  background: var(--mist);
}
.empty-content {
  min-width: 0;
}
.empty h2 {
  margin: 0;
  color: var(--ink-950);
  font-size: 22px;
}
.empty p {
  max-width: 700px;
  margin-top: 10px;
  color: var(--muted);
  line-height: 1.8;
}
.empty-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 24px;
  margin-top: 22px;
}
.empty-actions .primary-button {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border: 0;
  border-radius: 9px;
  background: var(--signal-dark);
  color: white;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}
.empty-back {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  color: var(--signal-dark);
}
.empty-actions :is(a, button):focus-visible {
  outline: 3px solid var(--signal);
  outline-offset: 3px;
}
.participant-desk,
.evidence-entry {
  margin-top: 30px;
  padding: 28px;
}
.participant-desk header,
.evidence-entry header {
  display: flex;
  align-items: end;
  justify-content: space-between;
}
.participant-desk header span,
.evidence-entry header span {
  color: var(--signal-dark);
  font:
    700 13px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.12em;
}
.participant-desk h2,
.evidence-entry h2 {
  margin-top: 6px;
  color: var(--ink-950);
  font-family: 'Source Han Serif SC', 'Songti SC', serif;
  font-size: 30px;
}
.participant-grid {
  display: grid;
  margin-top: 24px;
  padding-top: 22px;
  border-top: 1px solid var(--line);
  grid-template-columns: 1fr 1fr;
  align-items: start;
  gap: 28px;
}
.participant-grid h3 {
  color: var(--ink-950);
}
.participant-grid p {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.participant-grid code {
  overflow-wrap: anywhere;
}
.participant-grid form,
.evidence-entry form {
  display: grid;
  gap: 10px;
}
.participant-grid label,
.evidence-entry label {
  display: grid;
  color: var(--muted);
  font-size: 13px;
  gap: 5px;
}
.participant-grid input,
.participant-grid select,
.evidence-entry input,
.evidence-entry select,
.evidence-entry textarea {
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
}
.participant-grid button,
.evidence-entry button,
.withdraw-button {
  padding: 10px 14px;
  border: 0;
  border-radius: 999px;
  color: white;
  background: var(--ink-950);
  font-weight: 750;
  cursor: pointer;
}
.consent-check {
  display: flex !important;
  align-items: center;
  grid-template-columns: auto 1fr;
}
.participant-grid a {
  display: inline-flex;
  margin-top: 15px;
  align-items: center;
  color: var(--signal-dark);
  font-weight: 750;
  gap: 6px;
}
.withdraw-button {
  align-self: end;
  background: #8d3028;
}
.evidence-entry {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 22px;
}
.evidence-entry header {
  grid-column: 1/-1;
}
.evidence-entry header p {
  max-width: 480px;
  color: var(--muted);
  font-size: 13px;
}
@media (max-width: 900px) {
  .lab-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .selectors {
    width: 100%;
    min-width: 0;
    max-width: none;
  }
  .create-strip {
    grid-template-columns: 1fr 1fr;
  }
  .create-strip p {
    grid-column: 1/-1;
  }
  .ledger-grid,
  .blind-grid,
  .participant-grid,
  .evidence-entry {
    grid-template-columns: 1fr;
  }
  .pilot-context {
    grid-column: 1;
    grid-row: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .evidence-entry header {
    grid-column: 1;
  }
  .batch-seal {
    grid-template-columns: 1fr;
  }
  .control-strip {
    align-items: stretch;
    flex-direction: column;
  }
  .control-strip > div {
    margin-right: 0;
  }
  .expert-desk > header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .expert-desk select {
    width: 100%;
  }
}
@media (max-width: 540px) {
  .pilot-lab {
    padding-top: 4px;
  }
  .pilot-context,
  .metric-cards,
  .expert-pipeline {
    grid-template-columns: minmax(0, 1fr);
  }
  .lab-head h1 {
    font-size: 25px;
  }
  .empty {
    padding: 22px;
    flex-direction: column;
    gap: 16px;
  }
  .empty h2 {
    font-size: 20px;
  }
  .participant-desk {
    padding: 20px;
  }
  .participant-desk header {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .participant-desk h2 {
    font-size: 24px;
    overflow-wrap: anywhere;
  }
  .metric-ledger,
  .panel-ledger,
  .pilot-context-card {
    padding: 18px;
  }
  .create-strip {
    grid-template-columns: 1fr;
  }
  .create-strip p {
    grid-column: 1;
  }
  .gate-rail {
    grid-template-columns: 1fr 1fr;
  }
  .panel-ledger dl {
    grid-template-columns: 1fr;
  }
  .batch-seal {
    margin-top: 22px;
  }
  .lab-title {
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
