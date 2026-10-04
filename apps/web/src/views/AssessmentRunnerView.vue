<script setup lang="ts">
import { completionExplanation, historicalPolicyNotice } from '../domain/assessmentCompletion'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { CheckCircle2, Clock3, LoaderCircle } from '@lucide/vue'
import AssessmentSessionFrame from '../components/AssessmentSessionFrame.vue'
import AssessmentQuestionMedia from '../components/AssessmentQuestionMedia.vue'
import AssessmentMaterials from '../components/AssessmentMaterials.vue'
import AssessmentReadOnlyAttachments from '../components/AssessmentReadOnlyAttachments.vue'
import DialogueAssessmentPanel from '../components/DialogueAssessmentPanel.vue'
import PracticalWorkbenchView from './PracticalWorkbenchView.vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
import { DIMENSIONS } from '../domain/capabilities'
import { registerAssessmentLeave } from '../domain/assessmentLeave'
import { useAssessmentDraft } from '../composables/useAssessmentDraft'
import {
  completeAssessment,
  getNextItem,
  operationKey,
  submitObjectiveAnswer,
} from '../services/assessmentApi'
import {
  abandonAssessment,
  getAssessmentReview,
  getAssessmentWorkspace,
  setAssessmentFlag,
  setAssessmentActivity,
  type AssessmentReview,
  type AssessmentWorkspace,
} from '../services/assessmentWorkspaceApi'

type AnswerPanel = {
  submit: () => Promise<void>
  flushDraft: () => Promise<boolean>
  busy: boolean
  canSubmit: boolean
  saveLabel: string
  saveFailed: boolean
  dirty: boolean
  savedAt: string | null
}
const route = useRoute(),
  router = useRouter(),
  access = useAccessStore(),
  auth = useAuthStore(),
  features = useFeatureStore()
const sessionId = String(route.params.sessionId)
const workspace = ref<AssessmentWorkspace | null>(null),
  review = ref<AssessmentReview | null>(null)
const busy = ref(false),
  error = ref(''),
  selectedOption = ref('')
const dialoguePanel = ref<AnswerPanel | null>(null),
  practicalPanel = ref<AnswerPanel | null>(null)
const finishDialog = ref<HTMLDialogElement | null>(null),
  leaveDialog = ref<HTMLDialogElement | null>(null)
const supportDialog = ref<HTMLDialogElement | null>(null)
const finishError = ref('')
const abandonDialog = ref<HTMLDialogElement | null>(null)
const abandonError = ref('')
const ending = ref(false)
const showPracticalReview = ref(false)
watch(review, () => {
  showPracticalReview.value = false
})
const answerKey = ref(operationKey('objective-answer')),
  completionKey = operationKey('assessment-complete')
const clockNow = ref(0),
  controller = new AbortController()
let clockBase = 0,
  monotonicBase = 0,
  clockTimer: ReturnType<typeof setInterval> | undefined
let readSequence = 0,
  alive = true,
  expiring = false,
  leaveResolver: ((value: boolean) => void) | null = null
const currentItem = computed(() => workspace.value?.current_item ?? null)
const item = computed(() => review.value?.item ?? currentItem.value)
const openSession = computed(() => workspace.value?.session.status === 'active')
const paused = computed(() => openSession.value && Boolean(workspace.value?.session.paused_at))
const active = computed(() => openSession.value && !paused.value)
const closed = computed(() => workspace.value !== null && !openSession.value)
const completed = computed(() => workspace.value?.session.status === 'completed')
const expired = computed(() => workspace.value?.session.ended_reason === 'timeout')
const endedEarly = computed(() => workspace.value?.session.ended_reason === 'user_ended')
const panel = computed(() =>
  currentItem.value?.item_type === 'dialogue' ? dialoguePanel.value : practicalPanel.value,
)
const objectiveDraft = useAssessmentDraft({
  sessionId: () => sessionId,
  itemId: () => currentItem.value?.item_version_id ?? '',
  contextRevision: () => 0,
  response: () => ({ selected_option: selectedOption.value }),
  restore: (value) => {
    selectedOption.value = typeof value.selected_option === 'string' ? value.selected_option : ''
  },
})
const allBusy = computed(() => busy.value || Boolean(!review.value && panel.value?.busy))
const saveLabel = computed(() =>
  !workspace.value && error.value && !busy.value
    ? '测评读取失败'
    : review.value
      ? '只读回看'
      : paused.value
        ? '已暂存 · 等待继续'
        : closed.value
          ? completed.value
            ? '测评已封存'
            : expired.value
              ? '已超时 · 未完成'
              : '测评已结束 · 未完成'
          : workspace.value?.can_complete && !currentItem.value
            ? '作答已保存 · 待确认完成'
            : currentItem.value?.item_type === 'objective'
              ? objectiveDraft.label.value
              : panel.value?.saveLabel || '正在恢复测评',
)
const saveFailed = computed(() =>
  currentItem.value?.item_type === 'objective'
    ? ['error', 'conflict'].includes(objectiveDraft.state.value)
    : Boolean(panel.value?.saveFailed),
)
const canSubmit = computed(
  () =>
    active.value &&
    secondsLeft.value !== 0 &&
    !review.value &&
    !allBusy.value &&
    (currentItem.value?.item_type === 'objective'
      ? Boolean(selectedOption.value) && objectiveDraft.ready.value && objectiveDraft.canEdit.value
      : Boolean(panel.value?.canSubmit)),
)
const options = computed(() => {
  const source = item.value?.configuration.options
  if (!Array.isArray(source)) return []
  return source.map((value) => {
    if (typeof value === 'string') return { value, label: value }
    const entry = value as Record<string, unknown>
    return {
      value: String(entry.value ?? entry.id ?? entry.label),
      label: String(entry.label ?? entry.value),
    }
  })
})
const secondsLeft = computed(() =>
  workspace.value?.session.expires_at
    ? Math.max(
        0,
        Math.ceil((Date.parse(workspace.value.session.expires_at) - clockNow.value) / 1000),
      )
    : null,
)
function duration(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(value / 60)).padStart(2, '0')}: ${String(value % 60).padStart(2, '0')}`
}
const clockLabel = computed(() => {
  if (closed.value)
    return expired.value ? '测评已超时' : completed.value ? '测评已完成' : '测评已结束'
  if (!clockNow.value) return '时间待同步'
  if (secondsLeft.value !== null) return `剩余时间 ${duration(secondsLeft.value)}`
  const created = Date.parse(workspace.value?.session.created_at ?? '')
  return Number.isFinite(created)
    ? `已用时间 ${duration((clockNow.value - created) / 1000)}`
    : '不限时测评'
})
const unmet = computed(() => {
  if (!workspace.value) return []
  const value = workspace.value,
    messages: string[] = []
  if (value.answered_count < value.min_items)
    messages.push(`至少完成 ${value.min_items} 题，当前完成 ${value.answered_count} 题`)
  if (value.current_item) messages.push('当前题尚未正式完成')
  if (value.unmet_dimensions.length)
    messages.push(
      `还需收集：${value.unmet_dimensions.map((code) => DIMENSIONS.find((d) => d.code === code)?.name ?? code).join('、')}`,
    )
  if (value.unmet_item_types.length)
    messages.push(
      `题型覆盖尚不足：${value.unmet_item_types.map((type) => ({ objective: '客观题', dialogue: '对话题', practical: '实操任务' })[type as 'objective'] ?? type).join('、')}`,
    )
  if (!messages.length && !value.can_complete)
    messages.push('尚未达到服务端测评完成条件，请继续当前测评。')
  return messages
})
watch(selectedOption, () => {
  answerKey.value = operationKey('objective-answer')
})
async function syncWorkspace() {
  const ticket = ++readSequence
  const result = await getAssessmentWorkspace(sessionId, controller.signal)
  if (!alive || ticket !== readSequence) return
  workspace.value = result
  clockBase = Date.parse(result.server_now)
  monotonicBase = performance.now()
  clockNow.value = clockBase
}
async function prepareObjective() {
  if (currentItem.value?.item_type !== 'objective' || !active.value) return
  selectedOption.value = ''
  answerKey.value = operationKey('objective-answer')
  await objectiveDraft.load()
}
async function advance() {
  if (!alive || ending.value) return
  busy.value = true
  error.value = ''
  try {
    await syncWorkspace()
    if (!alive) return
    if (active.value && !currentItem.value && !workspace.value?.can_complete) {
      await getNextItem(sessionId)
      if (!alive) return
      await syncWorkspace()
    }
    review.value = null
    await prepareObjective()
  } catch (cause) {
    if (alive) {
      error.value = cause instanceof Error ? cause.message : '题目未能恢复，请重试。'
      try {
        await syncWorkspace()
      } catch {
        /* Keep original error and last confirmed state. */
      }
    }
  } finally {
    if (alive) busy.value = false
  }
}
async function initialize() {
  busy.value = true
  error.value = ''
  try {
    await syncWorkspace()
    if (!alive || !workspace.value) return
    if (
      !access.singlePlatform &&
      access.ready &&
      access.organizationId !== workspace.value.session.organization_id
    ) {
      await access.selectOrganization(workspace.value.session.organization_id)
      if (!alive) return
      if (access.error || access.organizationId !== workspace.value.session.organization_id)
        throw new Error(access.error || '无法同步此测评所属组织。')
    }
    await advance()
  } catch (cause) {
    if (alive) error.value = cause instanceof Error ? cause.message : '测评恢复失败。'
  } finally {
    if (alive) busy.value = false
  }
}
async function flushCurrent() {
  if (review.value || !active.value || !currentItem.value) return true
  return currentItem.value.item_type === 'objective'
    ? objectiveDraft.flush()
    : ((await panel.value?.flushDraft()) ?? false)
}
async function inspect(id: string) {
  if (allBusy.value) return
  if (id === currentItem.value?.item_version_id && active.value) {
    await returnCurrent()
    return
  }
  if (!(await flushCurrent())) {
    error.value = '当前草稿尚未保存，请先重试保存后再回看。'
    return
  }
  busy.value = true
  error.value = ''
  try {
    const value = await getAssessmentReview(sessionId, id, controller.signal)
    if (alive) review.value = value
  } catch (cause) {
    if (alive) error.value = cause instanceof Error ? cause.message : '无法读取历史题目。'
  } finally {
    if (alive) busy.value = false
  }
}
async function flag() {
  if (!item.value || !active.value || allBusy.value) return
  busy.value = true
  try {
    const current = workspace.value?.items.find(
      (entry) => entry.item_version_id === item.value?.item_version_id,
    )
    await setAssessmentFlag(
      sessionId,
      item.value.item_version_id,
      !current?.flagged,
      operationKey('question-flag'),
    )
    await syncWorkspace()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '标记未能保存。'
  } finally {
    busy.value = false
  }
}
async function returnCurrent() {
  if (!review.value) return
  review.value = null
  await prepareObjective()
}
async function reload() {
  if (await beforeLeave()) await initialize()
}
async function submit() {
  if (!canSubmit.value || !currentItem.value) return
  if (currentItem.value.item_type !== 'objective') {
    await panel.value?.submit()
    return
  }
  busy.value = true
  error.value = ''
  try {
    if (!(await objectiveDraft.flush()))
      throw new Error(objectiveDraft.error.value || '草稿未保存，请重试。')
    await submitObjectiveAnswer(
      sessionId,
      currentItem.value.item_version_id,
      selectedOption.value,
      answerKey.value,
    )
    if (!alive) return
    objectiveDraft.markSubmitted()
    await advance()
  } catch (cause) {
    if (alive) {
      error.value = cause instanceof Error ? cause.message : '回答保存失败。'
      try {
        await syncWorkspace()
      } catch {
        /* Keep actionable original error. */
      }
    }
  } finally {
    if (alive) busy.value = false
  }
}
async function openFinish() {
  if (allBusy.value || !active.value) return
  finishError.value = ''
  try {
    await syncWorkspace()
    if (alive) finishDialog.value?.showModal()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法确认完成条件。'
  }
}
async function finish() {
  if (!workspace.value?.can_complete || allBusy.value || !active.value) return
  busy.value = true
  error.value = ''
  finishError.value = ''
  try {
    await completeAssessment(sessionId, completionKey)
    if (!alive) return
    // A successful seal must not be presented as a failed submission if refresh fails.
    workspace.value = {
      ...workspace.value!,
      session: { ...workspace.value!.session, status: 'completed' },
      can_complete: false,
      current_item: null,
    }
    review.value = null
    finishDialog.value?.close()
    try {
      await syncWorkspace()
    } catch {
      if (alive) error.value = '测评已成功封存，但最新状态读取失败。可以重新加载或进入报告查看。'
    }
  } catch (cause) {
    if (alive)
      finishError.value =
        cause instanceof TypeError || !(cause instanceof Error)
          ? '未能确认封存结果，请检查网络及后端服务后重试。已提交回答会保留，重试不会重复封存。'
          : cause.message
  } finally {
    busy.value = false
  }
}
function openAbandon() {
  if (busy.value || !openSession.value) return
  abandonError.value = ''
  finishDialog.value?.close()
  abandonDialog.value?.showModal()
}
async function abandon() {
  if (busy.value || !openSession.value || !workspace.value) return
  ending.value = true
  busy.value = true
  ++readSequence
  abandonError.value = ''
  try {
    // Confirmation explicitly warns about unsynced text. A failed draft save
    // must not trap the learner in an assessment they want to end permanently.
    const session = await abandonAssessment(sessionId)
    if (!alive) return
    ++readSequence
    workspace.value = { ...workspace.value, session, current_item: null, can_complete: false }
    review.value = null
    error.value = ''
    abandonDialog.value?.close()
    void features.load(true)
  } catch (cause) {
    if (!alive) return
    abandonError.value =
      cause instanceof TypeError || !(cause instanceof Error)
        ? '未能确认结束结果，请检查网络后重试。已保存记录会保留，重复操作不会重复结束。'
        : cause.message
  } finally {
    ending.value = false
    busy.value = false
  }
}
function answerLeave(value: boolean) {
  if (leaveDialog.value?.open) leaveDialog.value.close()
  leaveResolver?.(value)
  leaveResolver = null
}
async function beforeLeave() {
  if (!auth.isAuthenticated || closed.value) return true
  if (!allBusy.value && (await flushCurrent())) return true
  if (leaveResolver) return false
  return new Promise<boolean>((resolve) => {
    leaveResolver = resolve
    leaveDialog.value?.showModal()
  })
}
async function pauseBeforeLeave() {
  if (!auth.isAuthenticated || closed.value || paused.value || !workspace.value) return true
  if (!(await beforeLeave())) return false
  busy.value = true
  error.value = ''
  try {
    const session = await setAssessmentActivity(
      sessionId,
      true,
      workspace.value.session.activity_revision ?? 0,
    )
    if (!alive) return false
    workspace.value = { ...workspace.value, session, can_complete: false }
    void features.load(true)
    return true
  } catch (cause) {
    if (alive) {
      error.value = cause instanceof Error ? cause.message : '暂存状态未能确认，请重试。'
      try {
        await syncWorkspace()
      } catch {
        /* Keep the original actionable failure. */
      }
    }
    return false
  } finally {
    if (alive) busy.value = false
  }
}
async function resume() {
  if (!paused.value || allBusy.value || !workspace.value) return
  busy.value = true
  error.value = ''
  try {
    const session = await setAssessmentActivity(
      sessionId,
      false,
      workspace.value.session.activity_revision ?? 0,
    )
    if (!alive) return
    workspace.value = { ...workspace.value, session }
    void features.load(true)
    await advance()
  } catch (cause) {
    if (alive) {
      error.value = cause instanceof Error ? cause.message : '继续状态未能确认，请重试。'
      try {
        await syncWorkspace()
      } catch {
        /* Keep original failure. */
      }
    }
  } finally {
    if (alive) busy.value = false
  }
}
const unregisterLeave = registerAssessmentLeave(pauseBeforeLeave)
onBeforeRouteLeave(pauseBeforeLeave)
async function exit() {
  if (await pauseBeforeLeave()) await router.push('/workspace')
}
function shortcut(event: KeyboardEvent) {
  if (
    event.ctrlKey &&
    event.key === 'Enter' &&
    !event.isComposing &&
    !(event.target instanceof HTMLTextAreaElement)
  ) {
    event.preventDefault()
    void submit()
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  const dirty =
    currentItem.value?.item_type === 'objective' ? objectiveDraft.dirty.value : panel.value?.dirty
  if (active.value && (dirty || allBusy.value)) {
    event.preventDefault()
    event.returnValue = ''
  }
}
async function checkExpiry() {
  if (expiring || !openSession.value || secondsLeft.value !== 0) return
  expiring = true
  try {
    await syncWorkspace()
  } catch {
    error.value = '测评时间已到，正在确认服务端结束状态。当前回答不能继续提交。'
  } finally {
    expiring = false
  }
}
onMounted(() => {
  void initialize()
  window.addEventListener('keydown', shortcut)
  window.addEventListener('beforeunload', beforeUnload)
  clockTimer = setInterval(() => {
    if (clockBase) clockNow.value = clockBase + performance.now() - monotonicBase
    void checkExpiry()
  }, 1000)
})
onBeforeUnmount(() => {
  alive = false
  ++readSequence
  controller.abort()
  clearInterval(clockTimer)
  unregisterLeave()
  answerLeave(false)
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <AssessmentSessionFrame
    :workspace="workspace"
    :item="paused && !review ? null : item"
    :read-only="Boolean(review) || closed || paused"
    :busy="allBusy"
    :end-busy="busy"
    :save-label="saveLabel"
    :save-failed="saveFailed"
    :clock-label="clockLabel"
    :urgent="secondsLeft !== null && secondsLeft <= 60"
    :can-submit="canSubmit && secondsLeft !== 0"
    :error="error"
    :submit-label="item?.item_type === 'practical' ? '封存产物并继续' : '提交回答并继续'"
    @exit="exit"
    @finish="openFinish"
    @abandon="openAbandon"
    @flag="flag"
    @review="inspect"
    @current="returnCurrent"
    @submit="submit"
    @support="supportDialog?.showModal()"
  >
    <template #error-action
      ><button class="runner-retry" type="button" :disabled="allBusy" @click="reload">
        重新加载
      </button></template
    >
    <p v-if="historicalPolicyNotice(workspace)" class="runner-policy-note" role="note">
      {{ historicalPolicyNotice(workspace) }}
    </p>
    <section
      v-if="!workspace && error && !busy"
      class="runner-terminal"
      data-testid="assessment-load-failed"
      aria-label="测评读取失败"
    >
      <Clock3 :size="40" />
      <h1>暂时无法读取本次测评</h1>
      <p>请检查网络连接后重新加载。已保存的回答不会因本次读取失败而丢失。</p>
      <button type="button" :disabled="allBusy" @click="reload">重新加载测评</button>
      <RouterLink to="/assessment">返回测评中心</RouterLink>
    </section>
    <div v-else-if="!workspace" class="runner-loading" role="status">
      <LoaderCircle :size="20" />正在恢复测评…
    </div>
    <section v-else-if="review" class="exam-readonly-answer">
      <h1>{{ review.item.stem }}</h1>
      <AssessmentQuestionMedia :media="review.item.configuration.media" />
      <template v-if="review.dialogue_turns.length"
        ><article v-for="turn in review.dialogue_turns" :key="turn.sequence">
          <h2>你的回答 · 第{{ turn.sequence }}轮</h2>
          <p>{{ turn.user_content }}</p>
          <template v-if="turn.assistant_content"
            ><h2>面试官</h2>
            <p>{{ turn.assistant_content }}</p></template
          >
        </article></template
      >
      <template v-else-if="review.item.item_type === 'objective'"
        ><h2>你的回答</h2>
        <p>
          {{
            review.response?.selected_option ??
            review.draft?.response.selected_option ??
            '未提交回答'
          }}
        </p></template
      >
      <template v-else-if="review.item.item_type !== 'dialogue'"
        ><h2>你的结果与反思</h2>
        <p>
          {{
            review.response?.final_output ?? review.draft?.response.final_output ?? '未提交最终产物'
          }}
        </p>
        <p>{{ review.response?.reflection ?? review.draft?.response.reflection }}</p></template
      >
      <template v-if="review.item.item_type === 'dialogue'"
        ><h2 v-if="review.draft?.response.content">未提交草稿</h2>
        <p v-if="review.draft?.response.content">{{ review.draft.response.content }}</p>
        <AssessmentReadOnlyAttachments
          :key="review.item.item_version_id"
          :session-id="sessionId"
          :item-id="review.item.item_version_id"
      /></template>
      <p v-if="!review.answered_at" class="read-only-warning">
        本题未正式完成；已保存草稿不计为最终答案。
      </p>
      <template v-if="review.item.item_type === 'practical'"
        ><button
          class="runner-retry"
          type="button"
          @click="showPracticalReview = !showPracticalReview"
        >
          {{ showPracticalReview ? '收起实操过程' : '查看实操过程、AI交互与文件记录' }}</button
        ><PracticalWorkbenchView
          v-if="showPracticalReview"
          :key="review.item.item_version_id"
          :formal-session-id="sessionId"
          :formal-item-id="review.item.item_version_id"
          embedded
          session-disabled
          read-only-mode
      /></template>
    </section>
    <section v-else-if="closed" class="runner-terminal">
      <CheckCircle2 v-if="completed" :size="40" /><Clock3 v-else :size="40" />
      <h1>
        {{
          completed
            ? '本次测评已封存'
            : expired
              ? '已超时 · 测评未完成'
              : endedEarly
                ? '已提前结束 · 测评未完成'
                : '测评已结束 · 未完成'
        }}
      </h1>
      <p>
        {{
          completed
            ? '报告会明确标记评分中、待人工复核或最终完成。'
            : '成功保存的回答与草稿已保留。未完成测评不生成正式能力报告。'
        }}
      </p>
      <RouterLink v-if="completed" :to="`/reports/${sessionId}`">查看能力报告</RouterLink
      ><button
        v-if="workspace.items.length"
        type="button"
        @click="inspect(workspace.items[workspace.items.length - 1]!.item_version_id)"
      >
        只读回看已保存记录</button
      ><RouterLink to="/assessment">返回测评中心</RouterLink>
    </section>
    <section v-else-if="paused" class="runner-terminal" data-testid="assessment-paused">
      <Clock3 :size="40" />
      <h1>本次测评已暂存</h1>
      <p>已提交回答与成功保存的草稿均已保留。点击继续后恢复作答，成长助手会暂时停用。</p>
      <p v-if="workspace.session.expires_at">限时测评暂存后仍继续计时，请留意剩余时间。</p>
      <button
        type="button"
        data-testid="resume-assessment"
        :disabled="allBusy || secondsLeft === 0"
        @click="resume"
      >
        继续本次测评
      </button>
      <RouterLink to="/workspace">返回工作台</RouterLink>
    </section>
    <template v-else-if="currentItem">
      <form
        v-if="currentItem.item_type === 'objective'"
        class="exam-objective"
        @submit.prevent="submit"
      >
        <h1>{{ currentItem.stem }}</h1>
        <AssessmentQuestionMedia :media="currentItem.configuration.media" />
        <fieldset :disabled="allBusy || secondsLeft === 0">
          <legend class="visually-hidden">选择你的回答</legend>
          <label
            v-for="(option, index) in options"
            :key="option.value"
            :class="{ chosen: selectedOption === option.value }"
            ><input
              v-model="selectedOption"
              type="radio"
              name="answer"
              :value="option.value"
            /><span>{{ String.fromCharCode(65 + index) }}</span
            ><strong>{{ option.label }}</strong></label
          >
        </fieldset>
        <div class="objective-tools">
          <span>{{ saveLabel }}</span
          ><AssessmentMaterials :item="currentItem" hide-hint />
        </div>
        <p v-if="objectiveDraft.error.value" class="runner-draft-error" role="alert">
          {{ objectiveDraft.error.value
          }}<button type="button" @click="objectiveDraft.flush()">重试保存</button>
        </p>
        <AssessmentMaterials :item="currentItem" />
      </form>
      <DialogueAssessmentPanel
        v-else-if="currentItem.item_type === 'dialogue'"
        :key="currentItem.item_version_id"
        ref="dialoguePanel"
        :session-id="sessionId"
        :item="currentItem"
        persist-draft
        external-footer
        :disabled="!active || secondsLeft === 0"
        @complete="advance"
      />
      <PracticalWorkbenchView
        v-else
        :key="currentItem.item_version_id"
        ref="practicalPanel"
        :formal-session-id="sessionId"
        :formal-item-id="currentItem.item_version_id"
        embedded
        :session-disabled="!active || secondsLeft === 0"
        @complete="advance"
      />
    </template>
    <section v-else-if="workspace.can_complete" class="runner-terminal">
      <CheckCircle2 :size="38" />
      <h1>本次作答已达到完成条件</h1>
      <p data-testid="completion-explanation">{{ completionExplanation(workspace) }}</p>
      <p>确认完成后封存本次测评，并进入评分与报告流程。</p>
      <button type="button" :disabled="allBusy" @click="openFinish">确认完成测试</button>
    </section>
    <dialog
      ref="finishDialog"
      class="runner-dialog"
      aria-label="确认完成测试"
      @cancel="allBusy && $event.preventDefault()"
    >
      <h2>完成本次测评</h2>
      <p>正式完成后，已提交回答将保持封存，不可修改。</p>
      <ul v-if="!workspace?.can_complete">
        <li v-for="message in unmet" :key="message">{{ message }}</li>
      </ul>
      <p v-else>{{ completionExplanation(workspace) }}</p>
      <p v-if="finishError" class="runner-finish-error" role="alert">{{ finishError }}</p>
      <div>
        <button type="button" :disabled="allBusy" @click="finishDialog?.close()">继续测评</button
        ><button type="button" :disabled="!workspace?.can_complete || allBusy" @click="finish">
          {{ allBusy ? '正在封存…' : finishError ? '重试完成' : '确认完成' }}
        </button>
        <button v-if="openSession" type="button" :disabled="busy" @click="openAbandon">
          不继续做了，提前结束
        </button>
      </div>
    </dialog>
    <dialog
      ref="abandonDialog"
      class="runner-dialog"
      aria-label="确认提前结束"
      @cancel="ending && $event.preventDefault()"
    >
      <h2>提前结束本次测评？</h2>
      <p>不必答满题目。确认后不能继续本次测评，你可以重新开始一场。</p>
      <p>
        已提交回答与成功保存的草稿会保留，尚未同步的内容可能丢失。本次标记为“提前结束 ·
        未完成”，不生成正式能力报告。
      </p>
      <p>
        如果只想休息一下，请取消并选择“暂存退出”。已发出的 AI
        请求可能仍会产生费用，返回内容不会继续计入本次作答。
      </p>
      <p v-if="abandonError" class="runner-finish-error" role="alert">{{ abandonError }}</p>
      <div>
        <button type="button" :disabled="ending" @click="abandonDialog?.close()">
          取消，保留本次测评
        </button>
        <button
          type="button"
          data-testid="confirm-early-end"
          :disabled="ending || !openSession"
          @click="abandon"
        >
          {{ ending ? '正在结束…' : '确认提前结束' }}
        </button>
      </div>
    </dialog>
    <dialog
      ref="leaveDialog"
      class="runner-dialog"
      aria-label="草稿尚未同步"
      @cancel.prevent="answerLeave(false)"
    >
      <h2>当前内容尚未全部同步</h2>
      <p>
        可能有未保存修改或在途操作。留在此页可继续重试；退出可能丢失未同步文字。限时测评退出后不会暂停计时。
      </p>
      <div>
        <button type="button" @click="answerLeave(false)">留在此页</button
        ><button type="button" @click="answerLeave(true)">仍然退出</button>
      </div>
    </dialog>
    <dialog ref="supportDialog" class="runner-dialog" aria-label="测评技术支持">
      <h2>测评技术支持</h2>
      <p>断网时保留当前页面，恢复连接后重试保存。追问失败请使用“重新生成已保存回答的追问”。</p>
      <p>若仍无法操作，请联系管理员。不要在反馈中公开正式题目、个人文件或访问令牌。</p>
      <div>
        <button type="button" @click="supportDialog?.close()">返回作答</button
        ><RouterLink to="/help">查看平台帮助</RouterLink>
      </div>
    </dialog>
  </AssessmentSessionFrame>
</template>

<style scoped>
.runner-policy-note {
  padding: 12px 16px;
  border-left: 3px solid var(--signal-dark);
  background: var(--surface-soft, #eff8fa);
  line-height: 1.7;
  font-size: 14px;
}
.runner-finish-error {
  padding: 12px 16px;
  border-left: 3px solid #bd4c37;
  border-radius: 8px;
  background: #fff3ee;
  color: #9b3526;
  overflow-wrap: anywhere;
}
.runner-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #627b85;
  padding: 40px 0;
}
.runner-retry {
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  padding: 4px 12px;
  cursor: pointer;
}
.exam-objective > h1,
.exam-readonly-answer > h1 {
  font-size: calc(18 * var(--exam-u, 1px)) !important;
  line-height: 1.65 !important;
  letter-spacing: 0 !important;
  color: #464b4e;
  font-weight: 650;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.exam-objective fieldset {
  display: grid;
  gap: 14px;
  margin: 28px 0 0;
  padding: 0;
  border: 0;
}
.exam-objective label {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px;
  border: 1px solid #d0dce3;
  border-radius: 12px;
  background: #f8fafb;
  cursor: pointer;
  line-height: 1.7;
  font-size: 16px;
}
.exam-objective label.chosen {
  border-color: #68b8c6;
  background: #ebf6f9;
}
.exam-objective input {
  margin-top: 5px;
  width: 17px;
  height: 17px;
  accent-color: #219bac;
  flex: none;
}
.exam-objective label > span {
  color: #208c9c;
  font-weight: 650;
}
.exam-objective label strong {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.objective-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  margin-top: 20px;
  font-size: 13px;
  color: #72858e;
}
.runner-draft-error {
  padding: 14px;
  background: #fff0eb;
  color: #9c3c2d;
  font-size: 14px;
  line-height: 1.7;
  margin-top: 15px;
}
.runner-draft-error button {
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.runner-terminal {
  padding: 60px 0;
  max-width: 650px;
  display: grid;
  justify-items: start;
  gap: 18px;
  color: #208c9c;
}
.runner-terminal h1 {
  font-size: 26px !important;
  color: #385661;
}
.runner-terminal p {
  color: #6a7e86;
  font-size: 15px;
  line-height: 1.9;
}
.runner-terminal a,
.runner-terminal button {
  border: 1px solid #9dcbd5;
  background: #ebf6f9;
  border-radius: 7px;
  padding: 12px 18px;
  color: #137f91;
  font-size: 14px;
  cursor: pointer;
}
.exam-readonly-answer article,
.exam-readonly-answer > h2 {
  margin-top: 24px;
}
.exam-readonly-answer h2 {
  font-size: 15px;
  color: #738893;
  margin-bottom: 10px;
}
.exam-readonly-answer p {
  font-size: 16px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.read-only-warning {
  margin-top: 22px;
  color: #946422;
  background: #fff6e8;
  padding: 14px;
}
.runner-dialog {
  position: fixed;
  inset: 50% auto auto 50%;
  transform: translate(-50%, -50%);
  width: min(520px, calc(100vw - 32px));
  max-height: 85dvh;
  overflow: auto;
  margin: 0;
  border: 1px solid #ccdce2;
  border-radius: 16px;
  padding: 28px;
  color: #425c67;
}
.runner-dialog::backdrop {
  background: #183b4655;
}
.runner-dialog h2 {
  font-size: 21px;
}
.runner-dialog p,
.runner-dialog li {
  font-size: 14px;
  line-height: 1.8;
  margin-top: 12px;
}
.runner-dialog ul {
  padding-left: 20px;
}
.runner-dialog > div {
  display: flex;
  justify-content: flex-end;
  gap: 14px;
  align-items: center;
  margin-top: 24px;
}
.runner-dialog button,
.runner-dialog a {
  font: inherit;
  font-size: 14px;
  border: 1px solid #abcbd3;
  border-radius: 7px;
  background: #f3f9fa;
  color: #137f91;
  padding: 10px 14px;
  cursor: pointer;
}
.runner-dialog button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
@media (max-width: 600px) {
  .exam-objective label {
    padding: 14px;
    font-size: 15px;
  }
  .runner-terminal {
    padding: 35px 0;
  }
  .runner-dialog {
    padding: 22px;
  }
}
</style>
