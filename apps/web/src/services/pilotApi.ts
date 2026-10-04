import { useAuthStore } from '../stores/auth'
import { requireJson } from './apiClient'

export type PilotOrigin = 'real' | 'synthetic'
export type PilotStatus = 'draft' | 'recruiting' | 'rating' | 'analyzing' | 'frozen'

export type PilotCampaign = {
  id: string
  organization_id: string
  name: string
  scenario: string
  data_origin: PilotOrigin
  status: PilotStatus
  target_participants: number
  target_open_answers: number
  required_experts: number
  preregistration: Record<string, unknown>
  version_bundle: Record<string, unknown>
  freeze_bundle: Record<string, unknown> | null
  freeze_hash: string | null
  frozen_at: string | null
  created_at: string
}

export type PilotGate = {
  code: string
  label: string
  passed: boolean
  current: number | string | null
  target: number | string | null
}

export type MetricRun = {
  id: string
  campaign_id: string
  data_origin: PilotOrigin
  dataset_hash: string
  algorithm_version: string
  seed: number
  parameters: Record<string, unknown>
  exclusions: Record<string, unknown>
  results: {
    score_validation?: {
      sample_size: number
      linear_weighted_kappa: number | null
      quadratic_weighted_kappa?: number | null
      adjacent_agreement: number
      exact_agreement?: number
      mae: number
      linear_kappa_ci?: { low: number; high: number } | null
    } | null
    cat_efficiency?: {
      sample_size: number
      question_reduction: number
      level_agreement: number
      adjacent_level_agreement?: number
      theta_mae?: number
    } | null
    notice?: string
  }
  completed_at: string
}

export type PilotOverview = {
  campaign: PilotCampaign
  participant_count: number
  completed_participant_count: number
  withdrawn_participant_count: number
  assigned_answer_count: number
  submitted_rating_count: number
  expert_count: number
  gold_standard_count: number
  score_pair_count: number
  efficiency_observation_count: number
  latest_metric_run: MetricRun | null
  gates: PilotGate[]
}

export type CandidateAnswer = {
  answer_id: string
  participant_id: string
  item_type: string
  dimension_code: string
  submitted_at: string
  assigned_seats: number
  required_experts: number
  gold_status: string
  blinding_preview: Record<string, unknown>
  identity_risk_flags: string[]
}

export type ExpertOption = { user_id: string; display_name: string; role: string }

export type PilotParticipant = {
  id: string
  campaign_id: string
  user_id: string
  session_id: string | null
  consented_at: string
  withdrawn_at: string | null
  completed_at: string | null
  stratum: Record<string, string>
}

export type BlindAssignment = {
  id: string
  campaign_name: string
  seat: number
  status: string
  item_stem: string
  item_type: string
  dimension_code: string
  answer_response: Record<string, unknown>
  rubric_title: string
  rubric_criteria: Record<string, unknown>
}

function idempotentJson(method: 'POST', body?: unknown): RequestInit {
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

export async function listPilotCampaigns(organizationId: string) {
  const response = await useAuthStore().request(
    `/admin/pilots?organization_id=${encodeURIComponent(organizationId)}`,
  )
  return requireJson<PilotCampaign[]>(response, '无法读取试测批次。')
}

export async function listAvailablePilotCampaigns(organizationId: string) {
  const response = await useAuthStore().request(
    `/pilot-campaigns?organization_id=${encodeURIComponent(organizationId)}`,
  )
  return requireJson<PilotCampaign[]>(response, '无法读取可参加的试测批次。')
}

export async function getMyPilotParticipation(campaignId: string) {
  const response = await useAuthStore().request(`/pilot-campaigns/${campaignId}/me`)
  return requireJson<PilotParticipant | null>(response, '无法读取我的试测状态。')
}

export async function consentPilot(campaignId: string, scene: string) {
  const response = await useAuthStore().request(
    `/pilot-campaigns/${campaignId}/consent`,
    idempotentJson('POST', { accepted: true, stratum: { scene } }),
  )
  return requireJson<PilotParticipant>(response, '加入试测失败。')
}

export async function linkPilotSession(campaignId: string, sessionId: string) {
  const response = await useAuthStore().request(
    `/pilot-campaigns/${campaignId}/link-session`,
    idempotentJson('POST', { session_id: sessionId }),
  )
  return requireJson<PilotParticipant>(response, '关联已完成测评失败。')
}

export async function withdrawPilot(campaignId: string) {
  const response = await useAuthStore().request(
    `/pilot-campaigns/${campaignId}/withdraw`,
    idempotentJson('POST'),
  )
  return requireJson<PilotParticipant>(response, '撤回试测数据失败。')
}

export async function getPilotOverview(campaignId: string) {
  const response = await useAuthStore().request(`/admin/pilots/${campaignId}`)
  return requireJson<PilotOverview>(response, '无法读取试测证据。')
}

export async function createPilotCampaign(body: {
  organization_id: string
  name: string
  scenario: string
  data_origin: PilotOrigin
  cat_blueprint_version_id: string
  fixed_blueprint_version_id: string
}) {
  const response = await useAuthStore().request(
    '/admin/pilots',
    idempotentJson('POST', {
      organization_id: body.organization_id,
      name: body.name,
      scenario: body.scenario,
      data_origin: body.data_origin,
      target_participants: 50,
      target_open_answers: 60,
      required_experts: 3,
      preregistration: {
        linear_weighted_kappa: 0.75,
        adjacent_agreement: 0.9,
        question_reduction: 0.3,
        level_agreement: 0.85,
      },
      version_bundle: {
        cat_blueprint_version_id: body.cat_blueprint_version_id,
        fixed_blueprint_version_id: body.fixed_blueprint_version_id,
      },
    }),
  )
  return requireJson<PilotCampaign>(response, '创建试测批次失败。')
}

export async function advancePilot(campaignId: string, target: PilotStatus) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/advance`,
    idempotentJson('POST', { target }),
  )
  return requireJson<PilotCampaign>(response, '推进试测阶段失败。')
}

export async function runPilotMetrics(campaignId: string) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/metric-runs`,
    idempotentJson('POST', { bootstrap_iterations: 2000, seed: 20260825 }),
  )
  return requireJson<MetricRun>(response, '指标运行失败。')
}

export async function freezePilot(campaignId: string) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/freeze`,
    idempotentJson('POST'),
  )
  return requireJson<PilotCampaign>(response, '证据尚未达到冻结门槛。')
}

export async function exportPilotEvidence(campaignId: string) {
  const response = await useAuthStore().request(`/admin/pilots/${campaignId}/export.json`, {
    headers: { 'X-Request-ID': crypto.randomUUID() },
  })
  if (!response.ok) throw new Error('实验报告导出失败。')
  return response.blob()
}

export async function listCandidateAnswers(campaignId: string) {
  const response = await useAuthStore().request(`/admin/pilots/${campaignId}/candidate-answers`)
  return requireJson<CandidateAnswer[]>(response, '无法读取开放回答样本。')
}

export async function listPilotExperts(campaignId: string) {
  const response = await useAuthStore().request(`/admin/pilots/${campaignId}/experts`)
  return requireJson<ExpertOption[]>(response, '无法读取专家名单。')
}

export async function createExpertAssignment(
  campaignId: string,
  body: {
    answer_id: string
    expert_id: string
    seat: number
    blinding_review_confirmed: boolean
  },
) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/assignments`,
    idempotentJson('POST', body),
  )
  return requireJson<{ id: string }>(response, '专家分派失败。')
}

export async function listMyPilotAssignments() {
  const response = await useAuthStore().request('/expert/pilot-assignments')
  return requireJson<BlindAssignment[]>(response, '无法读取专家盲评任务。')
}

export async function submitPilotRating(
  assignmentId: string,
  body: { score: number; rationale: string; evidence: string },
  idempotencyKey?: string,
) {
  const response = await useAuthStore().request(
    `/expert/pilot-assignments/${assignmentId}/ratings`,
    {
      ...idempotentJson('POST', body),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey ?? crypto.randomUUID(),
      },
    },
  )
  return requireJson<{ id: string; score: number }>(response, '盲评分提交失败。')
}

export async function recordPilotEfficiency(
  campaignId: string,
  body: { participant_id: string; cat_session_id: string; fixed_session_id: string },
) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/efficiency`,
    idempotentJson('POST', body),
  )
  return requireJson<{ id: string }>(response, 'CAT与固定卷配对登记失败。')
}

export async function adjudicatePilotGold(
  campaignId: string,
  answerId: string,
  body: { score: number; rationale: string },
) {
  const response = await useAuthStore().request(
    `/admin/pilots/${campaignId}/gold-standards/${answerId}/adjudicate`,
    idempotentJson('POST', body),
  )
  return requireJson<{ id: string }>(response, '专家分歧仲裁失败。')
}
