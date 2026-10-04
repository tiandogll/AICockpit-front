<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import ContentTrialAnswer from '../components/ContentTrialAnswer.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../services/apiClient'
import { createTrialExpiryGuard, pastTrialRetention } from '../domain/trialExpiry'
import {
  consentContentTrial,
  getContentTrial,
  listContentTrials,
  saveContentTrialDraft,
  submitContentTrial,
  withdrawContentTrial,
  type TrialDetail,
  type TrialPage,
  type TrialWrite,
} from '../services/contentTrialApi'
import {
  blankTrialFields,
  completeTrialResponse,
  restoreTrialFields,
  TRIAL_STATUS,
  TRIAL_TYPES,
  trialAnswerSections,
  trialDate,
  trialResponse,
  validTrialQuestion,
} from '../domain/contentTrial'

const route = useRoute(),
  auth = useAuthStore(),
  access = useAccessStore()
const allowed = computed(
  () => auth.isAuthenticated && !!auth.user?.id && access.ready && !access.error,
)
const trialId = computed(() =>
  typeof route.params.trialId === 'string' ? route.params.trialId : '',
)
const detail = ref<TrialDetail | null>(null),
  page = ref<TrialPage | null>(null)
const fields = ref(blankTrialFields()),
  feedback = ref(''),
  saved = ref('')
const loading = ref(false),
  busy = ref(false),
  error = ref(''),
  notice = ref('')
const consented = ref(false),
  confirmingSubmit = ref(false),
  confirmingWithdraw = ref(false),
  conflict = ref(false)
const pending = ref<{ action: 'draft' | 'submit'; body: TrialWrite; key: string } | null>(null)
const offset = ref(0)
let epoch = 0,
  loadTicket = 0,
  consentKey = '',
  withdrawKey = ''
const newKey = (action: string) => `content-trial-${action}-${crypto.randomUUID()}`
const snapshot = () =>
  JSON.stringify({
    response: detail.value ? trialResponse(detail.value.item_type, fields.value) : null,
    feedback: feedback.value,
  })
const unsaved = computed(() => !!detail.value?.can_edit && saved.value !== snapshot())
const editable = computed(
  () =>
    allowed.value &&
    !!detail.value?.can_edit &&
    !!detail.value?.consented_at &&
    validTrialQuestion(detail.value) &&
    !conflict.value,
)
const locked = computed(() => busy.value || !!pending.value || confirmingSubmit.value)
const mayWithdraw = computed(
  () => detail.value && !['withdrawn', 'expired'].includes(detail.value.status),
)
const answerSections = computed(() => trialAnswerSections(detail.value?.response ?? null))
const expiry = createTrialExpiryGuard((now) => {
  const deadlines: number[] = []
  if (detail.value && !['withdrawn', 'expired'].includes(detail.value.status)) {
    if (pastTrialRetention(detail.value.expires_at, now)) {
      // Invalidate pre-deadline in-flight writes as well as the visible editor.
      epoch += 1
      loadTicket += 1
      detail.value.status = 'expired'
      redactDetail(detail.value)
      eraseInputs()
      busy.value = false
      loading.value = false
      error.value = ''
      notice.value = '保留期限已到，题面、回答与反馈已从本页清除，不能继续作答。'
      consentKey = ''
      withdrawKey = ''
    } else deadlines.push(Date.parse(detail.value.expires_at))
  }
  for (const row of page.value?.items ?? []) {
    if (row.status === 'withdrawn' || row.status === 'expired') continue
    if (pastTrialRetention(row.expires_at, now)) row.status = 'expired'
    else deadlines.push(Date.parse(row.expires_at))
  }
  return deadlines.length ? Math.min(...deadlines) : null
})
function organizationName(id: string) {
  return access.organizations.find((row) => row.id === id)?.name ?? id
}
function current(scope: number) {
  return scope === epoch && allowed.value
}
function eraseInputs() {
  // A failed/in-flight mutation also captures this intent by reference. Scrub
  // its payload before releasing it, not merely its on-screen controls.
  if (pending.value) {
    pending.value.body.response = trialResponse(
      detail.value?.item_type ?? 'objective',
      blankTrialFields(),
    )
    pending.value.body.feedback = ''
  }
  fields.value.answers.fill('')
  Object.assign(fields.value, blankTrialFields())
  fields.value = blankTrialFields()
  feedback.value = ''
  saved.value = ''
  pending.value = null
  consented.value = false
  confirmingSubmit.value = false
  confirmingWithdraw.value = false
  conflict.value = false
}
function clearPrivate() {
  expiry.cancel()
  eraseInputs()
  detail.value = null
  page.value = null
}
function redactDetail(data: TrialDetail) {
  data.question = null
  data.response = null
  data.feedback = null
  data.can_edit = false
  if (data.status === 'expired') data.blocked_reason = '试答保留期限已到，原文不再提供。'
}
function reset() {
  epoch += 1
  loadTicket += 1
  clearPrivate()
  busy.value = false
  loading.value = false
  error.value = ''
  notice.value = ''
  consentKey = ''
  withdrawKey = ''
  offset.value = 0
}
function accept(data: TrialDetail) {
  if (
    data.id !== trialId.value ||
    data.purpose !== 'content_quality_trial' ||
    !(data.item_type in TRIAL_TYPES) ||
    !(data.status in TRIAL_STATUS) ||
    !Number.isInteger(data.revision) ||
    data.revision < 0
  )
    throw new Error('试答响应不完整，请重新读取；本页未确认保存。')
  if (data.status !== 'withdrawn' && pastTrialRetention(data.expires_at)) data.status = 'expired'
  const terminal = data.status === 'withdrawn' || data.status === 'expired'
  if (terminal) redactDetail(data)
  detail.value = data
  if (terminal) eraseInputs()
  else {
    fields.value = restoreTrialFields(data.response)
    feedback.value = data.feedback ?? ''
    saved.value = snapshot()
  }
  expiry.refresh()
}
function currentStateNotice(data: TrialDetail) {
  return `服务器当前状态：${TRIAL_STATUS[data.status]}。${data.blocked_reason || (data.status === 'withdrawn' || data.status === 'expired' ? '任务已关闭，不可继续作答。' : '请以当前显示的状态为准，本次未重新开放试答。')}`
}
function fail(caught: unknown) {
  if (caught instanceof ApiError && [401, 403, 404, 410].includes(caught.status)) clearPrivate()
  else if (caught instanceof ApiError && caught.status === 409) {
    conflict.value = true
    pending.value = null
    confirmingSubmit.value = false
  }
  error.value = caught instanceof Error ? caught.message : '操作未确认成功，请重试。'
}
async function load(nextOffset = offset.value, replaceLocal = false) {
  if (!allowed.value || busy.value) return
  if (
    replaceLocal &&
    (unsaved.value || pending.value || conflict.value) &&
    !window.confirm('读取服务器最新状态会替换本页尚未保存的输入，是否继续？')
  )
    return
  const scope = epoch,
    ticket = ++loadTicket
  loading.value = true
  error.value = ''
  notice.value = ''
  clearPrivate()
  try {
    if (trialId.value) {
      const data = await getContentTrial(trialId.value)
      if (current(scope) && ticket === loadTicket) accept(data)
    } else {
      const data = await listContentTrials(nextOffset)
      if (current(scope) && ticket === loadTicket) {
        if (!Array.isArray(data.items) || !Number.isInteger(data.total))
          throw new Error('试答任务列表不完整，请重新读取。')
        page.value = data
        offset.value = data.offset
        expiry.refresh()
      }
    }
  } catch (caught) {
    if (current(scope) && ticket === loadTicket) fail(caught)
  } finally {
    if (current(scope) && ticket === loadTicket) loading.value = false
  }
}
async function consent() {
  expiry.refresh()
  if (
    !allowed.value ||
    !detail.value ||
    !consented.value ||
    busy.value ||
    detail.value.blocked_reason
  )
    return
  const scope = epoch
  busy.value = true
  error.value = ''
  consentKey ||= newKey('consent')
  try {
    const data = await consentContentTrial(trialId.value, consentKey)
    if (!current(scope)) return
    accept(data)
    consentKey = ''
    notice.value =
      data.consented_at && data.can_edit && data.status === 'in_progress' && !data.blocked_reason
        ? '已保存知情确认。请自行作答，不输入个人敏感信息。'
        : currentStateNotice(data)
  } catch (caught) {
    if (current(scope)) fail(caught)
  } finally {
    if (current(scope)) busy.value = false
  }
}
function prepareSubmit() {
  expiry.refresh()
  if (!editable.value || locked.value || !detail.value) return
  error.value = ''
  notice.value = ''
  if (!completeTrialResponse(detail.value.item_type, fields.value)) {
    error.value = '请先完成本题的所有作答部分，再确认提交。'
    return
  }
  confirmingSubmit.value = true
}
function prepareWrite(action: 'draft' | 'submit') {
  expiry.refresh()
  if (!editable.value || busy.value || pending.value || !detail.value) return
  if (
    action === 'submit' &&
    (!confirmingSubmit.value || !completeTrialResponse(detail.value.item_type, fields.value))
  )
    return
  pending.value = {
    action,
    key: newKey(action),
    body: {
      expected_revision: detail.value.revision,
      response: trialResponse(detail.value.item_type, fields.value),
      feedback: feedback.value,
    },
  }
  confirmingSubmit.value = false
  void runWrite()
}
async function runWrite() {
  expiry.refresh()
  if (!allowed.value || busy.value || !pending.value || conflict.value) return
  const scope = epoch,
    intent = pending.value
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const data = await (intent.action === 'submit' ? submitContentTrial : saveContentTrialDraft)(
      trialId.value,
      intent.body,
      intent.key,
    )
    if (!current(scope)) return
    accept(data)
    pending.value = null
    notice.value =
      data.status === 'submitted'
        ? '已提交题质试答。管理员可读取提交稿；本次不产生分数。'
        : intent.action === 'draft' &&
            data.can_edit &&
            data.status === 'in_progress' &&
            !data.blocked_reason
          ? '草稿已保存，可退出后继续。'
          : currentStateNotice(data)
  } catch (caught) {
    if (current(scope)) fail(caught)
  } finally {
    if (current(scope)) busy.value = false
  }
}
async function withdraw() {
  expiry.refresh()
  if (!allowed.value || busy.value || !mayWithdraw.value || !confirmingWithdraw.value) return
  const scope = epoch
  busy.value = true
  error.value = ''
  notice.value = ''
  withdrawKey ||= newKey('withdraw')
  try {
    const data = await withdrawContentTrial(trialId.value, withdrawKey)
    if (!current(scope)) return
    accept(data)
    if (data.status !== 'withdrawn' && data.status !== 'expired')
      throw new Error('服务器未确认撤回，请重新读取状态或重试；原文清除尚未确认。')
    fields.value = blankTrialFields()
    feedback.value = ''
    pending.value = null
    confirmingWithdraw.value = false
    conflict.value = false
    withdrawKey = ''
    saved.value = snapshot()
    notice.value =
      data.status === 'expired'
        ? '任务已到期；回答与题质反馈原文不再提供。'
        : '已撤回；回答与题质反馈原文已清除。'
  } catch (caught) {
    if (current(scope)) fail(caught)
  } finally {
    if (current(scope)) busy.value = false
  }
}
function confirmLeave() {
  return (
    !(busy.value || pending.value || unsaved.value) ||
    window.confirm('仍有未保存输入或尚未确认的操作。离开后请重新读取服务器状态，确定离开？')
  )
}
function beforeUnload(event: BeforeUnloadEvent) {
  if (!busy.value && !pending.value && !unsaved.value) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
window.addEventListener('beforeunload', beforeUnload)
watch(
  () => [
    trialId.value,
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
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
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section class="trial-page shell">
    <header class="trial-heading">
      <div>
        <span class="trial-label">独立题质试答</span>
        <h1>{{ trialId ? '完成这道题，帮助改进题目' : '我的题质试答' }}</h1>
        <p>试答用于检查题意、选项与作答要求，不计入正式成绩、能力画像或成长趋势。</p>
      </div>
      <RouterLink :to="trialId ? '/content-trials' : '/assessment'" class="trial-link">{{
        trialId ? '返回试答列表' : '返回测评中心'
      }}</RouterLink>
    </header>
    <aside class="scope-note">
      <strong>这是题质试答，不是完整的正式测评。</strong
      ><span
        >客观题选择选项；对话题完成初答与两条固定追问；实操题只提交拆解、文本 / 代码、验证和反思。无
        AI 调用、自动评分、代码执行或文件上传。</span
      >
    </aside>
    <p v-if="!allowed" class="trial-state" role="status">
      {{ access.error || '正在确认登录与组织权限，请稍后或重新登录。' }}
    </p>
    <div v-if="error" class="trial-error" role="alert">
      {{ error }}
      <p v-if="conflict">
        服务器上的草稿版本或试答资格已变化，本次未覆盖任何新稿。请确认后读取最新状态。
      </p>
    </div>
    <p v-if="notice" class="trial-notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="trial-state" role="status">正在读取试答内容…</p>
    <div v-if="allowed && !loading && (error || pending)" class="actions">
      <button
        v-if="pending && !conflict"
        data-testid="trial-retry-write"
        class="primary-button"
        :disabled="busy"
        @click="runWrite"
      >
        重试同一次{{ pending.action === 'submit' ? '提交' : '保存' }}
      </button>
      <button
        data-testid="trial-reload"
        class="secondary-button"
        :disabled="busy"
        @click="load(offset, true)"
      >
        读取服务器最新状态
      </button>
      <small v-if="pending">重试使用相同内容；读取最新状态可确认服务器是否已保存。</small>
    </div>
    <section v-if="allowed && page && !trialId" class="trial-list" aria-label="我的试答任务">
      <p v-if="!page.items.length" class="trial-state">
        目前没有指定给你的题质试答。一位审核人通过后，管理员可向符合资格的学员指派。
      </p>
      <article v-for="row in page.items" :key="row.id" class="trial-row">
        <div>
          <code>{{ row.code }}</code>
          <h2>{{ TRIAL_TYPES[row.item_type] }}</h2>
          <p>
            {{ organizationName(row.organization_id) }} · 保留至 {{ trialDate(row.expires_at) }}
          </p>
        </div>
        <span class="status-pill">{{ TRIAL_STATUS[row.status] }}</span
        ><RouterLink :to="`/content-trials/${row.id}`" class="trial-link"
          >{{
            row.status === 'submitted'
              ? '查看提交'
              : row.status === 'withdrawn' || row.status === 'expired'
                ? '查看状态'
                : '打开试答'
          }}
          →</RouterLink
        >
      </article>
      <nav v-if="page.total > page.limit" class="pagination" aria-label="试答分页">
        <button
          class="secondary-button"
          :disabled="offset === 0 || loading"
          @click="load(Math.max(0, offset - 20))"
        >
          上一页</button
        ><span>共 {{ page.total }} 项</span
        ><button
          class="secondary-button"
          :disabled="offset + page.limit >= page.total || loading"
          @click="load(offset + 20)"
        >
          下一页
        </button>
      </nav>
    </section>
    <article v-if="allowed && detail" class="trial-card">
      <header class="card-heading">
        <div>
          <code>{{ detail.code }}</code>
          <h2>{{ TRIAL_TYPES[detail.item_type] }}</h2>
        </div>
        <span class="status-pill">{{ TRIAL_STATUS[detail.status] }}</span>
      </header>
      <p class="retention">
        {{ organizationName(detail.organization_id) }} · 保留至 {{ trialDate(detail.expires_at) }} ·
        可主动撤回并清除原文
      </p>
      <p v-if="detail.blocked_reason" class="trial-error" role="alert">
        {{ detail.blocked_reason }}；当前不可继续作答{{
          mayWithdraw ? '，已有任务仍可主动撤回。' : '。'
        }}
      </p>
      <section
        v-if="detail.status === 'withdrawn' || detail.status === 'expired'"
        class="trial-state"
      >
        <h3>{{ TRIAL_STATUS[detail.status] }}</h3>
        <p>本任务已关闭，回答与题质反馈不再显示，也不能再次提交。</p>
      </section>
      <section v-else-if="!detail.consented_at && !detail.blocked_reason" class="consent-panel">
        <h3>先了解，再决定是否参与</h3>
        <ul>
          <li>本次仅用于改进题目质量，不会生成正式成绩或能力报告。</li>
          <li>管理员只能读取已提交的回答与题质反馈，不能读取未提交的草稿。</li>
          <li>回答与反馈从指派之日起最多保留 90 天。你可以在提交前后撤回，撤回会清除原文。</li>
          <li>请勿填写真实个人信息、商业秘密或其他敏感内容。</li>
        </ul>
        <label class="check-label"
          ><input
            v-model="consented"
            data-testid="trial-consent-check"
            type="checkbox"
            :disabled="busy"
          />我已了解上述目的与数据使用方式，自愿参与题质试答。</label
        >
        <button
          data-testid="trial-consent"
          class="primary-button"
          :disabled="!consented || busy"
          @click="consent"
        >
          {{ busy ? '正在保存…' : '同意并打开题目' }}
        </button>
      </section>
      <section v-else-if="detail.status === 'submitted'" class="submitted-panel">
        <h3>已提交 · 不产生分数</h3>
        <p>提交稿已冻结，不能继续修改。你仍可撤回并清除回答与反馈原文。</p>
        <dl>
          <template v-for="[label, answer] in answerSections" :key="label"
            ><dt>{{ label }}</dt>
            <dd>{{ answer }}</dd></template
          >
          <dt>题质反馈</dt>
          <dd>{{ detail.feedback || '未填写' }}</dd>
        </dl>
      </section>
      <template v-else-if="detail.consented_at && !detail.blocked_reason && !conflict">
        <div v-if="!validTrialQuestion(detail)" class="trial-error" role="alert">
          题面或固定追问不完整，不能继续作答。请重新读取或联系管理员，本页不会自动提交。
          <button
            type="button"
            class="secondary-button"
            :disabled="busy"
            @click="load(offset, true)"
          >
            重新读取题面
          </button>
        </div>
        <form v-else-if="detail.question && editable" @submit.prevent="prepareSubmit">
          <ContentTrialAnswer
            v-model="fields"
            :type="detail.item_type"
            :question="detail.question"
            :disabled="locked"
          />
          <label class="feedback-label"
            >题质反馈（可选）<span>哪些措辞难理解、信息不够或要求不清楚？请只反馈题目本身。</span
            ><textarea
              v-model="feedback"
              data-testid="trial-feedback"
              rows="4"
              maxlength="2000"
              :disabled="locked"
            /><small>{{ feedback.length }} / 2000 字</small></label
          >
          <div class="actions">
            <button
              type="button"
              data-testid="trial-save"
              class="secondary-button"
              :disabled="locked"
              @click="prepareWrite('draft')"
            >
              保存草稿</button
            ><button
              type="button"
              data-testid="trial-prepare-submit"
              class="primary-button"
              :disabled="locked"
              @click="prepareSubmit"
            >
              核对并提交试答</button
            ><small
              >{{ unsaved ? '有未保存的输入' : `服务器草稿版本 ${detail.revision}` }} ·
              不会自动提交</small
            >
          </div>
        </form>
        <p v-else class="trial-state">当前试答不可继续编辑，请重新读取状态或联系管理员。</p>
      </template>
      <section v-if="confirmingSubmit" class="confirm-box" aria-label="确认提交题质试答">
        <h3>确认将当前回答提交给管理员？</h3>
        <p>提交后将冻结回答与反馈，不能修改。不计入正式成绩，仍可撤回并清除原文。</p>
        <div class="actions">
          <button class="secondary-button" :disabled="busy" @click="confirmingSubmit = false">
            返回修改</button
          ><button
            data-testid="trial-confirm-submit"
            class="primary-button"
            :disabled="busy"
            @click="prepareWrite('submit')"
          >
            确认提交试答
          </button>
        </div>
      </section>
      <footer v-if="mayWithdraw" class="withdraw-area">
        <button
          data-testid="trial-prepare-withdraw"
          class="trial-link"
          :disabled="busy"
          @click="confirmingWithdraw = true"
        >
          撤回本次试答并清除原文
        </button>
        <section v-if="confirmingWithdraw" class="confirm-box">
          <h3>确认撤回并清除原文？</h3>
          <p>
            将清除已保存或提交的回答与题质反馈，且此任务不能恢复作答。仅保留任务
            ID、状态等必要记录。
          </p>
          <div class="actions">
            <button class="secondary-button" :disabled="busy" @click="confirmingWithdraw = false">
              取消</button
            ><button
              data-testid="trial-confirm-withdraw"
              class="secondary-button"
              :disabled="busy"
              @click="withdraw"
            >
              确认撤回并清除原文
            </button>
          </div>
        </section>
      </footer>
    </article>
  </section>
</template>

<style scoped src="../assets/content-trial.css"></style>
