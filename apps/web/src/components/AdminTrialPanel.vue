<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../services/apiClient'
import { createTrialExpiryGuard, pastTrialRetention } from '../domain/trialExpiry'
import {
  assignContentTrial,
  listTrialResults,
  type TrialAssignment,
  type TrialPage,
  type TrialResult,
} from '../services/contentTrialApi'
import { TRIAL_STATUS, trialAnswerSections, trialDate } from '../domain/contentTrial'

const props = defineProps<{
  packetId: string
  digest: string
  eligible: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const auth = useAuthStore(),
  access = useAccessStore()
const allowed = computed(
  () =>
    auth.isAuthenticated &&
    !!auth.user?.id &&
    access.ready &&
    !access.error &&
    access.can('content'),
)
const organization = computed(() =>
  access.organizations.find((row) => row.id === access.organizationId),
)
const page = ref<TrialPage<TrialResult> | null>(null),
  username = ref('')
const busy = ref(false),
  loading = ref(false),
  error = ref(''),
  resultError = ref(''),
  notice = ref('')
const intent = ref<{ body: TrialAssignment; key: string } | null>(null)
const offset = ref(0)
let epoch = 0,
  loadTicket = 0
const locked = computed(() => busy.value || !!props.disabled)
const expiry = createTrialExpiryGuard((now) => {
  const deadlines: number[] = []
  for (const row of page.value?.items ?? []) {
    if (row.status !== 'withdrawn' && pastTrialRetention(row.expires_at, now))
      row.status = 'expired'
    if (row.status !== 'submitted') {
      row.response = null
      row.feedback = null
    }
    if (row.status !== 'withdrawn' && row.status !== 'expired')
      deadlines.push(Date.parse(row.expires_at))
  }
  return deadlines.length ? Math.min(...deadlines) : null
})
function current(scope: number) {
  return scope === epoch && allowed.value
}
function reset() {
  expiry.cancel()
  epoch += 1
  loadTicket += 1
  page.value = null
  username.value = ''
  intent.value = null
  busy.value = false
  loading.value = false
  error.value = ''
  resultError.value = ''
  notice.value = ''
  offset.value = 0
  emit('busy', false)
}
async function load(nextOffset = offset.value) {
  if (!allowed.value) return
  const scope = epoch,
    ticket = ++loadTicket
  loading.value = true
  resultError.value = ''
  page.value = null
  expiry.cancel()
  try {
    const data = await listTrialResults(props.packetId, nextOffset)
    if (current(scope) && ticket === loadTicket) {
      if (!Array.isArray(data.items) || !Number.isInteger(data.total))
        throw new Error('试答记录响应不完整，请重新读取。')
      page.value = data
      offset.value = data.offset
      expiry.refresh()
    }
  } catch (caught) {
    if (current(scope) && ticket === loadTicket)
      resultError.value = caught instanceof Error ? caught.message : '试答记录读取失败，请重试。'
  } finally {
    if (current(scope) && ticket === loadTicket) loading.value = false
  }
}
function prepare() {
  if (!allowed.value || locked.value || !props.eligible || !organization.value || intent.value)
    return
  error.value = ''
  notice.value = ''
  const learner = username.value.trim()
  if (!learner || learner.length > 100) {
    error.value = '请填写已注册学员的准确用户名（最多 100 字），不是显示名或邮箱。'
    return
  }
  intent.value = {
    body: {
      expected_digest: props.digest,
      organization_id: organization.value.id,
      learner_username: learner,
    },
    key: `content-trial-assign-${crypto.randomUUID()}`,
  }
}
async function assign() {
  if (!allowed.value || locked.value || !props.eligible || !organization.value || !intent.value)
    return
  const scope = epoch,
    pending = intent.value
  busy.value = true
  emit('busy', true)
  error.value = ''
  notice.value = ''
  try {
    const data = await assignContentTrial(props.packetId, pending.body, pending.key)
    if (!current(scope)) return
    if (
      !data.id ||
      data.packet_id !== props.packetId ||
      data.organization_id !== pending.body.organization_id ||
      data.purpose !== 'content_quality_trial' ||
      !(data.status in TRIAL_STATUS)
    )
      throw new Error('指派响应不完整，请重试同一次操作或重新读取记录，暂未确认成功。')
    notice.value =
      data.status === 'withdrawn' || data.status === 'expired'
        ? `该学员已有${TRIAL_STATUS[data.status]}的任务，本次没有重新开放试答。`
        : data.status === 'submitted'
          ? '该学员已提交过本题试答，本次未重复指派。'
          : `已指派题质试答给 ${pending.body.learner_username}；学员可从“测评中心 → 我的题质试答”进入。`
    intent.value = null
    username.value = ''
    await load()
  } catch (caught) {
    if (!current(scope)) return
    if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
      page.value = null
      intent.value = null
      username.value = ''
    }
    error.value =
      caught instanceof Error ? caught.message : '试答指派未确认成功，请重试同一次指派。'
  } finally {
    if (current(scope)) {
      busy.value = false
      emit('busy', false)
    }
  }
}
function readable(row: TrialResult) {
  return row.status === 'submitted'
}
function organizationName(id: string) {
  return access.organizations.find((row) => row.id === id)?.name ?? id
}
watch(
  () => [
    props.packetId,
    props.digest,
    props.eligible,
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
    access.can('content'),
    JSON.stringify(access.organizations),
    JSON.stringify(access.globalCapabilities),
  ],
  () => {
    reset()
    if (allowed.value) void load()
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => {
  reset()
  expiry.dispose()
})
</script>

<template>
  <section v-if="allowed" class="admin-trial-panel" aria-label="指定学员题质试答">
    <header>
      <h3>指定学员题质试答</h3>
      <span class="trial-tag">不发布 · 不计分</span>
    </header>
    <p>
      当前版本获得一位审核人通过即可指派。接收者须为指定组织的有效学员，且没有本题审稿或题族答案权限。
    </p>
    <div class="trial-scope">
      <strong>这是独立题质试答，不是完整正式测评。</strong>
      <p>
        对话题使用两条固定追问；实操只收集拆解、文本 / 代码、验证、反思。无 AI
        调用、代码执行、文件上传或自动评分；不改变正式派题、成绩或报告。
      </p>
    </div>
    <p v-if="!eligible" class="blocked-note">
      当前版本尚不满足一位审核人通过、无退回且未换版的条件，不能指派试答。
    </p>
    <p v-else-if="!organization" class="blocked-note">
      请先在顶部选择接收学员所属的有效组织，再进行指派。
    </p>
    <form v-else @submit.prevent="prepare">
      <label
        >接收组织<span class="organization-name">{{ organization.name }}</span></label
      >
      <label
        >已注册学员的用户名<input
          v-model="username"
          data-testid="trial-learner-username"
          autocomplete="off"
          maxlength="100"
          placeholder="准确用户名，不是显示名或邮箱"
          :disabled="locked || !!intent"
      /></label>
      <button
        type="button"
        class="secondary-button"
        data-testid="trial-assignment-prepare"
        :disabled="locked || !!intent"
        @click="prepare"
      >
        核对并指派试答
      </button>
    </form>
    <p class="hint">
      不创建账号、不发送站外通知。学员须知情同意后打开题面；提交前的草稿不向管理员展示。指派后最多保留
      90 天，学员可主动撤回清除原文。
    </p>
    <p v-if="error" class="trial-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="trial-notice" role="status">{{ notice }}</p>
    <section v-if="intent" class="trial-confirm" aria-label="确认指派题质试答">
      <h4>确认指定 {{ intent.body.learner_username }} 试答？</h4>
      <p>
        组织：{{
          organizationName(intent.body.organization_id)
        }}。将绑定本次审核版本，学员仅获得试答题面，不会获得答案、量规或锚例。
      </p>
      <p>管理员可读取已提交的回答与题质反馈；不会产生正式成绩。</p>
      <div class="actions">
        <button type="button" class="secondary-button" :disabled="locked" @click="intent = null">
          取消</button
        ><button
          type="button"
          class="primary-button"
          data-testid="trial-assignment-confirm"
          :disabled="locked"
          @click="assign"
        >
          {{ busy ? '正在指派…' : error ? '重试同一次指派' : '确认指派试答' }}
        </button>
      </div>
    </section>
    <section class="results" aria-label="本版本试答记录">
      <header>
        <h4>本版本试答记录</h4>
        <button type="button" class="text-button" :disabled="locked || loading" @click="load()">
          刷新记录
        </button>
      </header>
      <p v-if="loading" role="status">正在读取试答记录…</p>
      <p v-if="resultError" class="trial-error" role="alert">
        {{ resultError }} 请使用“刷新记录”重试。
      </p>
      <p v-if="page && !page.items.length && !resultError">本版本尚无试答指派。</p>
      <article v-for="row in page?.items ?? []" :key="row.id" class="result-row">
        <header>
          <strong>{{ row.learner_username || '账号信息不可用' }}</strong
          ><span class="trial-tag">{{ TRIAL_STATUS[row.status] }}</span>
        </header>
        <p>{{ organizationName(row.organization_id) }} · 保留至 {{ trialDate(row.expires_at) }}</p>
        <details v-if="readable(row) && row.response">
          <summary>查看已提交回答与题质反馈</summary>
          <dl>
            <template v-for="[label, answer] in trialAnswerSections(row.response)" :key="label"
              ><dt>{{ label }}</dt>
              <dd>{{ answer }}</dd></template
            >
            <dt>题质反馈</dt>
            <dd>{{ row.feedback || '未填写' }}</dd>
          </dl>
        </details>
        <p v-else class="hint">
          {{
            row.status === 'assigned' || row.status === 'in_progress'
              ? '学员尚未提交，草稿不对管理员开放。'
              : '原文已撤回或到期，不再显示。'
          }}
        </p>
      </article>
      <nav v-if="page && page.total > page.limit" class="actions" aria-label="试答结果分页">
        <button
          type="button"
          class="secondary-button"
          :disabled="offset === 0 || loading || locked"
          @click="load(Math.max(0, offset - 20))"
        >
          上一页</button
        ><span>共 {{ page.total }} 项</span
        ><button
          type="button"
          class="secondary-button"
          :disabled="offset + page.limit >= page.total || loading || locked"
          @click="load(offset + 20)"
        >
          下一页
        </button>
      </nav>
    </section>
  </section>
</template>

<style scoped>
.admin-trial-panel {
  border-top: 1px solid #d8e6ea;
  margin-top: 26px;
  padding-top: 24px;
  color: #183b46;
  font-size: 14px;
  line-height: 1.75;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
h3 {
  font-size: 17px;
  margin: 0;
}
h4 {
  font-size: 14px;
  margin: 0;
}
p {
  color: #5d727a;
  font-size: 13px;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
.trial-tag {
  color: #137f91;
  background: #eaf5f7;
  border-radius: 7px;
  padding: 3px 8px;
  font-size: 12px;
}
.trial-scope {
  border-left: 3px solid #137f91;
  border-radius: 0 8px 8px 0;
  background: #eaf5f7;
  padding: 14px 16px;
  margin: 16px 0;
}
.trial-scope p {
  margin-bottom: 0;
}
.blocked-note {
  border: 1px solid #d8e6ea;
  border-radius: 8px;
  padding: 14px;
}
form {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 20px;
}
label {
  display: grid;
  gap: 7px;
  font-size: 13px;
  flex: 1;
  min-width: 200px;
}
.organization-name {
  padding: 10px 0;
  min-height: 42px;
  font-weight: 700;
}
input {
  width: 100%;
  padding: 11px 12px;
  border: 1px solid #d8e6ea;
  border-radius: 8px;
  background: white;
  color: #183b46;
  font: inherit;
}
.trial-error,
.trial-notice {
  border-radius: 9px;
  padding: 13px 16px;
}
.trial-error {
  color: #923628;
  background: #fff0ed;
}
.trial-notice {
  color: #137f91;
  background: #eaf5f7;
}
.trial-confirm {
  border: 1px solid #137f91;
  border-radius: 10px;
  background: #eaf5f7;
  padding: 18px;
  margin-top: 18px;
}
.actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
}
.results {
  margin-top: 24px;
}
.result-row {
  border: 1px solid #d8e6ea;
  border-radius: 9px;
  padding: 16px;
  margin-top: 12px;
}
.text-button {
  background: none;
  border: 0;
  color: #137f91;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
summary {
  cursor: pointer;
  color: #137f91;
  font-size: 13px;
}
dt {
  margin-top: 14px;
  font-size: 13px;
  font-weight: 700;
}
dd {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 6px 0 0;
  padding: 10px;
  background: #f6f9fa;
  border-radius: 7px;
}
button {
  min-height: 40px;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
:is(button, input, summary):focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
@media (max-width: 700px) {
  label {
    min-width: 100%;
  }
}
</style>
