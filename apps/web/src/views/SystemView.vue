<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { AlertTriangle, Building2, Cpu, RefreshCw, ShieldCheck } from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import {
  executeRetention,
  previewRetention,
  readOrganizationAudit,
  readOrganizationSecurity,
  readProviderHealth,
  type AuditEvent,
  type PrivacyPreview,
  type PrivacyRun,
  type ProviderHealth,
  type SecurityStatus,
} from '../services/adminWorkspaceApi'
import { formatWorkspaceDate } from '../services/workspaceApi'

const access = useAccessStore()
const auth = useAuthStore()
const canSystem = computed(() => access.ready && access.can('system'))
const canGovernance = computed(
  () => access.ready && Boolean(access.organizationId) && access.can('governance'),
)
const canReadOrganization = computed(
  () =>
    access.ready &&
    Boolean(access.organizationId) &&
    (canSystem.value || canGovernance.value || access.can('analytics')),
)
const allowed = computed(() => canSystem.value || canGovernance.value)
const provider = ref<ProviderHealth | null>(null)
const security = ref<SecurityStatus | null>(null)
const events = ref<AuditEvent[]>([])
const loading = ref(false)
const providerError = ref('')
const securityError = ref('')
const auditError = ref('')
const privacyError = ref('')
const preview = ref<PrivacyPreview | null>(null)
const run = ref<PrivacyRun | null>(null)
const privacyBusy = ref(false)
const confirmedName = ref('')
const confirmedRisk = ref(false)
const pendingKey = ref('')
const pendingAttempt = ref(false)
let generation = 0
let requestGeneration = 0
const errorText = (caught: unknown) =>
  caught instanceof Error ? caught.message : '读取失败，请稍后重试。'
const countLabels: Record<string, string> = {
  answers: '回答记录',
  dialogue_turns: '对话轮次',
  practical_events: '实操过程',
  ai_interactions: 'AI 交互',
  artifacts: '实操附件',
  scoring_tasks: '评分原始数据',
  scoring_evidence: '评分证据文本',
  human_reviews: '人工复核备注',
  expert_ratings: '专家评价备注',
}
const outcomeLabels: Record<string, string> = {
  succeeded: '成功',
  denied: '已拒绝',
  failed: '失败',
}
const providerUsed = computed(() =>
  provider.value && provider.value.daily_token_quota > 0
    ? Math.min(
        100,
        Math.max(0, (provider.value.tokens_used_today / provider.value.daily_token_quota) * 100),
      )
    : null,
)
const canExecute = computed(
  () =>
    canGovernance.value &&
    Boolean(auth.user?.id) &&
    preview.value?.organization_id === access.organizationId &&
    confirmedRisk.value &&
    confirmedName.value.trim() === access.organization?.name &&
    !privacyBusy.value,
)
const attemptStorageKey = () =>
  `ai-measure:privacy-request:${auth.user?.id ?? ''}:${access.organizationId}`

function readPendingAttempt() {
  pendingKey.value = ''
  pendingAttempt.value = false
  if (!auth.user?.id || !access.organizationId) return
  try {
    const value = sessionStorage.getItem(attemptStorageKey())
    if (value && /^[0-9a-f-]{36}$/i.test(value)) {
      pendingKey.value = value
      pendingAttempt.value = true
    }
  } catch {
    privacyError.value = '无法读取操作重试标识。请允许会话存储后再执行清理。'
  }
}
async function loadStatus() {
  const ticket = ++requestGeneration
  const scope = generation
  const org = access.organizationId
  provider.value = null
  security.value = null
  events.value = []
  providerError.value = ''
  securityError.value = ''
  auditError.value = ''
  if (!allowed.value) {
    loading.value = false
    return
  }
  loading.value = true
  const results = await Promise.allSettled([
    canSystem.value ? readProviderHealth() : Promise.resolve(null),
    canReadOrganization.value ? readOrganizationSecurity(org) : Promise.resolve(null),
    canReadOrganization.value ? readOrganizationAudit(org) : Promise.resolve([]),
  ])
  if (scope !== generation || ticket !== requestGeneration || !allowed.value) return
  const [modelResult, securityResult, auditResult] = results
  if (modelResult.status === 'fulfilled') provider.value = modelResult.value
  else providerError.value = errorText(modelResult.reason)
  if (securityResult.status === 'fulfilled') security.value = securityResult.value
  else securityError.value = errorText(securityResult.reason)
  if (auditResult.status === 'fulfilled') events.value = auditResult.value
  else auditError.value = errorText(auditResult.reason)
  loading.value = false
}
async function previewCleanup() {
  if (!canGovernance.value || privacyBusy.value) return
  const scope = generation
  const org = access.organizationId
  privacyBusy.value = true
  privacyError.value = ''
  preview.value = null
  run.value = null
  confirmedName.value = ''
  confirmedRisk.value = false
  try {
    const result = await previewRetention(org)
    if (scope !== generation || !canGovernance.value) return
    if (result.organization_id !== org) throw new Error('预览组织不匹配，请重新读取。')
    preview.value = result
    if (!pendingKey.value) pendingKey.value = crypto.randomUUID()
  } catch (caught) {
    if (scope === generation) privacyError.value = errorText(caught)
  } finally {
    if (scope === generation) privacyBusy.value = false
  }
}
async function executeCleanup() {
  if (!canExecute.value || !pendingKey.value) return
  const scope = generation
  const org = access.organizationId
  const key = pendingKey.value
  const storageKey = attemptStorageKey()
  privacyBusy.value = true
  privacyError.value = ''
  try {
    // Store only the request identifier, not credentials, preview counts or private records.
    // If storage fails, do not start an irreversible operation with an unrecoverable retry key.
    try {
      sessionStorage.setItem(storageKey, key)
    } catch {
      throw new Error('无法保存操作重试标识，尚未发起清理。请允许会话存储后重试。')
    }
    pendingAttempt.value = true
    const result = await executeRetention(org, key)
    if (result.organization_id !== org)
      throw new Error('清理响应组织不匹配。请保留原请求标识并联系管理员。')
    if (result.status === 'completed' && sessionStorage.getItem(storageKey) === key)
      sessionStorage.removeItem(storageKey)
    if (scope !== generation || !canGovernance.value) return
    run.value = result
    if (result.status === 'completed') {
      preview.value = null
      pendingKey.value = ''
      pendingAttempt.value = false
      confirmedName.value = ''
      confirmedRisk.value = false
      await loadStatus()
    } else
      privacyError.value = `清理尚未完成（${result.failure_code || result.status}）。请使用原请求重试。`
  } catch (caught) {
    if (scope === generation) privacyError.value = `${errorText(caught)} 请保留当前请求并重试。`
  } finally {
    if (scope === generation) privacyBusy.value = false
  }
}
watch(
  () => [access.organizationId, access.ready, canSystem.value, canGovernance.value, auth.user?.id],
  () => {
    generation += 1
    privacyBusy.value = false
    preview.value = null
    run.value = null
    privacyError.value = ''
    confirmedName.value = ''
    confirmedRisk.value = false
    readPendingAttempt()
    void loadStatus()
  },
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  void access.load()
})
onUnmounted(() => {
  generation += 1
  requestGeneration += 1
})
</script>

<template>
  <section class="system-page shell">
    <header class="page-header">
      <div>
        <span class="eyebrow">验证与治理</span>
        <h1>模型与数据安全</h1>
        <p>查看当前模型服务、用量与组织数据保留状态。</p>
      </div>
      <button
        v-if="allowed"
        class="secondary-button"
        :disabled="loading || privacyBusy"
        @click="loadStatus"
      >
        <RefreshCw :size="17" aria-hidden="true" />刷新状态
      </button>
    </header>
    <section
      v-if="!access.ready"
      class="surface state-panel"
      :role="access.error ? 'alert' : 'status'"
    >
      <p>{{ access.error || '正在确认访问权限…' }}</p>
      <button v-if="access.error" class="secondary-button" @click="access.load(true)">
        重试权限读取
      </button>
    </section>
    <section v-else-if="!allowed" class="surface state-panel">
      <h2>没有系统或数据治理权限</h2>
      <p>请联系当前组织管理员确认可访问范围。</p>
    </section>
    <template v-else>
      <section v-if="canSystem" class="surface panel provider-panel">
        <header class="panel-header">
          <div>
            <Cpu :size="21" aria-hidden="true" />
            <h2>模型服务</h2>
          </div>
          <span class="read-only">只读状态</span>
        </header>
        <p v-if="loading" class="empty" role="status">正在读取模型状态…</p>
        <div v-else-if="providerError" class="error-panel" role="alert">
          {{ providerError }}<button @click="loadStatus">重试</button>
        </div>
        <template v-else-if="provider"
          ><div class="provider-state">
            <span :class="['status-light', { ready: provider.ready }]" aria-hidden="true"></span>
            <div>
              <strong>{{ provider.ready ? '服务已就绪' : '服务尚未就绪' }}</strong>
              <p v-if="provider.active_provider !== provider.requested_provider">
                当前使用降级提供方：{{ provider.active_provider }}。这不是原模型的正常服务状态。
              </p>
              <p v-else>当前提供方：{{ provider.active_provider }} · 模型：{{ provider.model }}</p>
            </div>
          </div>
          <div class="model-grid">
            <dl>
              <div>
                <dt>请求提供方</dt>
                <dd>{{ provider.requested_provider }}</dd>
              </div>
              <div>
                <dt>实际提供方</dt>
                <dd>{{ provider.active_provider }}</dd>
              </div>
              <div>
                <dt>当前模型</dt>
                <dd>{{ provider.model }}</dd>
              </div>
              <div>
                <dt>是否已配置</dt>
                <dd>{{ provider.configured ? '已配置' : '未配置' }}</dd>
              </div>
            </dl>
            <dl>
              <div>
                <dt>熔断状态</dt>
                <dd>{{ provider.circuit_state }}</dd>
              </div>
              <div>
                <dt>记录的失败次数</dt>
                <dd>{{ provider.failure_count }}</dd>
              </div>
              <div>
                <dt>允许降级</dt>
                <dd>{{ provider.fallback_enabled ? '是' : '否' }}</dd>
              </div>
              <div>
                <dt>重试等待</dt>
                <dd>
                  {{
                    provider.retry_after_seconds === null
                      ? '暂无等待时间'
                      : `${provider.retry_after_seconds} 秒`
                  }}
                </dd>
              </div>
            </dl>
            <div class="quota-panel">
              <span>今日全局模型用量</span
              ><strong
                >{{ provider.tokens_used_today.toLocaleString() }} <small>tokens</small></strong
              >
              <p>每日额度 {{ provider.daily_token_quota.toLocaleString() }} tokens</p>
              <progress
                v-if="providerUsed !== null"
                :value="providerUsed"
                max="100"
                aria-label="今日模型额度使用比例"
              ></progress>
              <p v-else>额度为 0，无法计算使用比例。</p>
              <p>超时 {{ provider.timeout_seconds }} 秒 · 最多重试 {{ provider.max_retries }} 次</p>
            </div>
          </div>
          <p class="support-note">
            此页面不修改模型配置、API 密钥、额度或降级策略。状态由服务端返回，不代表内容质量认证。
          </p></template
        >
      </section>
      <section v-else class="surface state-panel">
        <h2>模型全局状态仅向系统管理员开放</h2>
        <p>你仍可在下方管理已获授权组织的数据安全。</p>
      </section>
      <div class="organization-heading">
        <Building2 :size="20" aria-hidden="true" />
        <h2>{{ access.organization?.name || '组织数据安全' }}</h2>
      </div>
      <section v-if="!access.organizationId" class="surface state-panel">
        <h2>尚未选择组织</h2>
        <p>全局模型状态不依赖组织。组织审计与清理操作需要先选择可访问的组织。</p>
      </section>
      <template v-else-if="canReadOrganization">
        <div class="governance-grid">
          <section class="surface panel">
            <header class="panel-header">
              <div>
                <ShieldCheck :size="20" aria-hidden="true" />
                <h2>组织安全状态</h2>
              </div>
            </header>
            <p v-if="loading" class="empty">正在读取组织状态…</p>
            <div v-else-if="securityError" class="error-panel" role="alert">
              {{ securityError }}<button @click="loadStatus">重试</button>
            </div>
            <dl v-else-if="security">
              <div>
                <dt>今日组织模型用量</dt>
                <dd>{{ security.model_tokens_used_today.toLocaleString() }} tokens</dd>
              </div>
              <div>
                <dt>每日组织额度</dt>
                <dd>{{ security.model_daily_token_quota.toLocaleString() }} tokens</dd>
              </div>
              <div>
                <dt>原始交互保留期</dt>
                <dd>{{ security.retention_days }} 天</dd>
              </div>
              <div>
                <dt>最小聚合群体</dt>
                <dd>{{ security.minimum_group_size }} 人</dd>
              </div>
              <div>
                <dt>近期审计事件</dt>
                <dd>{{ security.recent_audit_events }} 条</dd>
              </div>
            </dl>
            <p class="support-note">
              小于最小群体规模的数据不展示聚合能力结论。日志与额度统计不显示原始回答内容。
            </p>
          </section>
          <section class="surface panel privacy-panel">
            <header class="panel-header">
              <div>
                <AlertTriangle :size="20" aria-hidden="true" />
                <h2>保留期清理</h2>
              </div>
            </header>
            <p>
              匿名化超出保留期的原始交互、证据文本，并删除符合条件的实操附件。原始内容与已删除附件无法通过本页面恢复。
            </p>
            <p class="support-note">
              预览是估计范围；执行以服务器当时的保留期截止时间为准。不会在后台自动启动清理。
              仅处理预览列出的类别，不等同于删除账号或全部个人信息。
            </p>
            <template v-if="canGovernance"
              ><p v-if="pendingAttempt" class="pending-notice" role="status">
                存在尚未确认完成的清理请求。重新预览并确认后，将使用原请求恢复其原始范围，不创建新任务。
              </p>
              <button
                class="secondary-button"
                data-testid="privacy-preview"
                :disabled="privacyBusy || !auth.user?.id"
                @click="previewCleanup"
              >
                {{ privacyBusy ? '正在处理…' : '预览清理范围' }}
              </button>
              <div v-if="privacyError" class="error-panel" role="alert">{{ privacyError }}</div>
              <div v-if="preview" class="preview-box">
                <h3>请确认清理范围</h3>
                <p>
                  组织：<strong>{{ access.organization?.name }}</strong>
                </p>
                <p>
                  保留期 {{ preview.retention_days }} 天 · 预览截止
                  {{ formatWorkspaceDate(preview.cutoff_at) }}
                </p>
                <dl>
                  <div v-for="(count, kind) in preview.result_counts" :key="kind">
                    <dt>{{ countLabels[kind] || kind }}</dt>
                    <dd>{{ count }} 条</dd>
                  </div>
                </dl>
                <p v-if="pendingAttempt" class="support-note">
                  这是重试：实际清理范围沿用原请求截止时间，本次预览不会扩大原请求范围。
                </p>
                <label
                  >输入当前组织名称以确认<input
                    v-model="confirmedName"
                    data-testid="privacy-confirm-name"
                    :placeholder="access.organization?.name"
                    :disabled="privacyBusy"
                    autocomplete="off" /></label
                ><label class="checkbox-label"
                  ><input
                    v-model="confirmedRisk"
                    data-testid="privacy-confirm-ack"
                    type="checkbox"
                    :disabled="privacyBusy"
                  /><span
                    >我确认拥有此组织的数据处理授权，理解原始内容和附件清理后不可恢复。</span
                  ></label
                ><button
                  class="danger-button"
                  data-testid="privacy-execute"
                  :disabled="!canExecute"
                  @click="executeCleanup"
                >
                  {{
                    privacyBusy
                      ? '正在执行…'
                      : pendingAttempt
                        ? '使用原请求重试清理'
                        : '确认执行清理'
                  }}
                </button>
              </div>
              <div v-if="run?.status === 'completed'" class="completed-note" role="status">
                <h3>清理已完成</h3>
                <p>完成时间：{{ formatWorkspaceDate(run.completed_at) }}</p>
                <p>实际截止：{{ formatWorkspaceDate(run.cutoff_at) }}</p>
                <p v-if="run.replayed">本次返回了同一清理请求的已完成结果。</p>
                <dl>
                  <div v-for="(count, kind) in run.result_counts" :key="kind">
                    <dt>{{ countLabels[kind] || kind }}</dt>
                    <dd>{{ count }} 条</dd>
                  </div>
                </dl>
              </div></template
            >
            <p v-else class="support-note">当前账号没有此组织的数据清理权限。</p>
          </section>
        </div>
        <section class="surface panel audit-panel">
          <header class="panel-header">
            <div>
              <ShieldCheck :size="20" aria-hidden="true" />
              <h2>组织审计记录</h2>
            </div>
            <span class="read-only">最近 50 条</span>
          </header>
          <p v-if="loading" class="empty">正在读取审计记录…</p>
          <div v-else-if="auditError" class="error-panel" role="alert">
            {{ auditError }}<button @click="loadStatus">重试</button>
          </div>
          <div
            v-else-if="events.length"
            class="table-scroll"
            tabindex="0"
            aria-label="组织审计记录，可横向滚动"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">操作</th>
                  <th scope="col">对象类型</th>
                  <th scope="col">结果</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="event in events" :key="event.id">
                  <td>{{ formatWorkspaceDate(event.occurred_at) }}</td>
                  <td>{{ event.action }}</td>
                  <td>{{ event.resource_type }}</td>
                  <td>{{ outcomeLabels[event.outcome] || event.outcome }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty">暂无可显示的审计事件。</p>
          <p class="support-note">此处仅列出操作摘要，不展开可能包含敏感内容的事件元数据。</p>
        </section>
      </template>
      <section v-else class="surface state-panel">
        <h2>当前组织的数据安全不可访问</h2>
        <p>请确认组织选择与权限后重试。</p>
      </section>
    </template>
  </section>
</template>

<style scoped>
.system-page {
  padding: 32px 0 60px;
  max-width: 1440px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  margin-bottom: 28px;
}
.page-header h1 {
  font-size: 28px;
  margin: 6px 0 8px;
}
.page-header p {
  color: var(--muted);
}
.page-header button {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.panel {
  padding: 26px;
  min-width: 0;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.panel-header > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.panel h2,
.state-panel h2,
.organization-heading h2 {
  font-size: 20px;
}
.panel-header svg,
.organization-heading svg {
  color: var(--signal-dark);
  flex-shrink: 0;
}
.read-only {
  font-size: 13px;
  padding: 4px 10px;
  background: var(--mist);
  border-radius: 6px;
  color: var(--signal-dark);
  white-space: nowrap;
}
.provider-state {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: var(--paper);
  padding: 18px 20px;
  border-radius: 12px;
  margin-bottom: 24px;
}
.provider-state strong {
  font-size: 18px;
}
.provider-state p {
  color: var(--muted);
  margin-top: 4px;
}
.status-light {
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  margin-top: 10px;
  border-radius: 50%;
  background: #ba7222;
}
.status-light.ready {
  background: var(--signal-dark);
}
.model-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  gap: 28px;
}
dl > div {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
dt {
  color: var(--muted);
  font-size: 13px;
}
dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
  font-size: 15px;
}
.quota-panel {
  background: var(--mist);
  border-radius: 12px;
  padding: 20px;
}
.quota-panel > span,
.quota-panel p,
.quota-panel small {
  font-size: 13px;
  color: var(--muted);
}
.quota-panel > strong {
  display: block;
  margin: 10px 0;
  font-size: 24px;
}
.quota-panel progress {
  width: 100%;
  height: 10px;
  accent-color: var(--signal-dark);
  margin: 14px 0;
}
.support-note {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.85;
  margin-top: 16px;
}
.organization-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 32px 0 20px;
}
.governance-grid {
  display: grid;
  align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: 24px;
}
.privacy-panel {
  border-top: 3px solid #ba7222;
}
.privacy-panel > p {
  line-height: 1.8;
}
.privacy-panel > button {
  margin-top: 20px;
}
.privacy-panel h3 {
  font-size: 18px;
  margin-bottom: 12px;
}
.preview-box {
  margin-top: 22px;
  border-top: 1px solid var(--line);
  padding-top: 20px;
}
.preview-box > p,
.completed-note > p {
  font-size: 13px;
  color: var(--muted);
  margin-top: 8px;
}
.preview-box label {
  display: grid;
  gap: 8px;
  margin: 18px 0;
  font-size: 13px;
  font-weight: 600;
}
.preview-box input:not([type='checkbox']) {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px 12px;
  width: 100%;
  min-height: 44px;
  font-size: 15px;
  background: white;
  color: var(--text);
}
.preview-box .checkbox-label {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-weight: 400;
  line-height: 1.8;
}
.checkbox-label input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  margin-top: 3px;
  accent-color: var(--signal-dark);
}
.danger-button {
  border: 1px solid #a74d35;
  background: #a74d35;
  color: white;
  border-radius: 9px;
  padding: 11px 16px;
  font-size: 15px;
  min-height: 44px;
  cursor: pointer;
}
.pending-notice {
  background: #fff5e7;
  color: #7f4e14;
  font-size: 13px;
  padding: 12px 14px;
  border-radius: 8px;
  margin-top: 16px;
}
.completed-note {
  padding: 18px;
  background: var(--mist);
  border-radius: 10px;
  margin-top: 22px;
}
.audit-panel {
  margin-top: 24px;
}
.table-scroll {
  max-width: 100%;
  overflow-x: auto;
}
table {
  width: 100%;
  min-width: 720px;
  text-align: left;
  border-collapse: collapse;
}
td,
th {
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
}
th {
  font-size: 13px;
  color: var(--muted);
  background: var(--paper);
}
td {
  font-size: 15px;
  overflow-wrap: anywhere;
}
.empty {
  padding: 20px 0;
  color: var(--muted);
}
.state-panel {
  padding: 28px;
}
.state-panel p {
  color: var(--muted);
  margin-top: 10px;
}
.state-panel button {
  margin-top: 14px;
}
.error-panel {
  background: #fff3f0;
  color: #8b3e30;
  padding: 14px 16px;
  border: 1px solid #e9c7bf;
  border-radius: 10px;
  display: flex;
  gap: 16px;
  justify-content: space-between;
  margin-top: 16px;
}
.error-panel button {
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
  white-space: nowrap;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 1100px) {
  .model-grid {
    grid-template-columns: 1fr 1fr;
  }
  .quota-panel {
    grid-column: 1/-1;
  }
  .governance-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 600px) {
  .system-page {
    padding-top: 24px;
  }
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .panel {
    padding: 20px 16px;
  }
  .model-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .quota-panel {
    grid-column: auto;
  }
  .provider-state {
    padding: 16px;
  }
  .page-header button {
    width: 100%;
    justify-content: center;
  }
  .error-panel {
    flex-direction: column;
  }
  .panel-header {
    gap: 10px;
  }
}
</style>
