<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ChevronDown,
  Download,
  LoaderCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  X,
} from '@lucide/vue'
import AssessmentQuestionMedia from './AssessmentQuestionMedia.vue'
import AssessmentMaterials from './AssessmentMaterials.vue'
import { useAssessmentDraft } from '../composables/useAssessmentDraft'
import { ApiError, operationKey, type AssessmentItem } from '../services/assessmentApi'
import {
  DialogueStreamError,
  getDialogueSnapshot,
  streamDialogueResponse,
  submitDialogueTurn,
  type DialogueSnapshot,
} from '../services/dialogueApi'
import {
  deleteDialogueAttachment,
  downloadDialogueAttachment,
  getDialogueAttachments,
  uploadDialogueAttachment,
  type DialogueAttachment,
} from '../services/assessmentWorkspaceApi'

const props = withDefaults(
  defineProps<{
    sessionId: string
    item: AssessmentItem
    persistDraft?: boolean
    externalFooter?: boolean
    disabled?: boolean
  }>(),
  { persistDraft: false, externalFooter: false, disabled: false },
)
const emit = defineEmits<{ complete: [] }>()
const snapshot = ref<DialogueSnapshot | null>(null),
  draft = ref(''),
  liveResponse = ref('')
const generating = ref(false),
  restoring = ref(true),
  uploadBusy = ref(false),
  restored = ref(false)
const error = ref(''),
  attachmentError = ref(''),
  retryTurnId = ref(''),
  retryAllowed = ref(true)
const attachments = ref<DialogueAttachment[]>([]),
  selectedAttachments = ref<string[]>([])
const input = ref<HTMLInputElement | null>(null)
const submitKey = ref(operationKey('dialogue-turn')),
  generationKey = ref(operationKey('dialogue-generation'))
let epoch = 0,
  controller = new AbortController(),
  emittedComplete = false
let uploadRetry: { file: File; key: string } | null = null
const contextRevision = computed(() => snapshot.value?.turn_count ?? 0)
const serverDraft = useAssessmentDraft({
  sessionId: () => props.sessionId,
  itemId: () => props.item.item_version_id,
  contextRevision: () => contextRevision.value,
  response: () => ({ content: draft.value, attachment_ids: selectedAttachments.value }),
  restore: (response) => {
    draft.value = typeof response.content === 'string' ? response.content : ''
    selectedAttachments.value = Array.isArray(response.attachment_ids)
      ? response.attachment_ids.filter((value): value is string => typeof value === 'string')
      : []
  },
})
const busy = computed(() => generating.value || restoring.value || uploadBusy.value)
const dirty = computed(() =>
  props.persistDraft
    ? serverDraft.dirty.value
    : Boolean(draft.value || selectedAttachments.value.length),
)
const savedAt = computed(() =>
  props.persistDraft ? serverDraft.savedAt.value : (lastTurn.value?.submitted_at ?? null),
)
const saveFailed = computed(
  () => props.persistDraft && ['error', 'conflict'].includes(serverDraft.state.value),
)
const saveLabel = computed(() =>
  retryTurnId.value
    ? '回答已提交'
    : props.persistDraft
      ? serverDraft.label.value
      : draft.value
        ? '尚未保存'
        : '等待作答',
)
const lastTurn = computed(() => snapshot.value?.turns[snapshot.value.turns.length - 1])
const lastAssistantTurn = computed(() =>
  [...(snapshot.value?.turns ?? [])].reverse().find((turn) => turn.assistant_content),
)
const currentQuestion = computed(
  () => lastAssistantTurn.value?.assistant_content || props.item.stem,
)
const interviewerName = computed(() =>
  lastAssistantTurn.value
    ? `AI面试官 · 第${lastAssistantTurn.value.sequence}次追问`
    : 'AI面试官 · 初始问题',
)
const turnLabel = computed(
  () =>
    `${contextRevision.value} / ${snapshot.value?.max_turns ?? Number(props.item.configuration.dialogue_max_turns ?? 3)} 轮`,
)
const policy = computed(() => {
  const value = props.item.configuration.attachment_policy
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    enabled: raw.enabled === true,
    maxFiles: Number(raw.max_files ?? 3),
    maxBytes: Number(raw.max_bytes ?? 5 * 1024 ** 2),
    allowCode: raw.allow_code === true,
  }
})
const acceptedTypes = computed(
  () =>
    '.txt,.md,.csv,.json,.png,.jpg,.jpeg,.webp' +
    (policy.value.allowCode ? ',.py,.js,.ts,.java,.css,.sql' : ''),
)
const unboundAttachments = computed(() =>
  attachments.value.filter((entry) => !entry.bound_turn_id && entry.state !== 'deleted'),
)
const canSubmit = computed(
  () =>
    Boolean(draft.value.trim()) &&
    restored.value &&
    !props.disabled &&
    !busy.value &&
    !retryTurnId.value &&
    (snapshot.value?.can_submit ?? true) &&
    (!props.persistDraft ||
      (serverDraft.ready.value && serverDraft.canEdit.value && !saveFailed.value)) &&
    selectedAttachments.value.every((id) =>
      unboundAttachments.value.some((entry) => entry.id === id && entry.state === 'ready'),
    ),
)
const textareaDisabled = computed(
  () =>
    props.disabled ||
    busy.value ||
    !restored.value ||
    (props.persistDraft && (!serverDraft.ready.value || !serverDraft.canEdit.value)),
)
watch([draft, () => selectedAttachments.value.join(',')], () => {
  submitKey.value = operationKey('dialogue-turn')
})

function current(ticket: number) {
  return ticket === epoch && !controller.signal.aborted
}
function describeError(caught: unknown) {
  if (caught instanceof DialogueStreamError)
    return caught.retryable
      ? '追问生成中断，你的回答已经保存，可以安全重试。'
      : '追问未通过完整性校验，请联系评估员处理。'
  return caught instanceof Error ? caught.message : '本轮对话未能完成，请重试。'
}
async function restore(ticket = epoch) {
  restoring.value = true
  error.value = ''
  restored.value = false
  try {
    let result: DialogueSnapshot | null
    try {
      result = await getDialogueSnapshot(
        props.sessionId,
        props.item.item_version_id,
        controller.signal,
      )
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) result = null
      else throw caught
    }
    if (!current(ticket)) return
    snapshot.value = result
    const last = result?.turns[result.turns.length - 1]
    retryTurnId.value =
      result && (result.can_retry_generation || result.state === 'generating') && last
        ? last.id
        : ''
    retryAllowed.value = result?.can_retry_generation ?? true
    if (result?.state === 'completed') {
      serverDraft.markSubmitted()
      if (!emittedComplete) {
        emittedComplete = true
        emit('complete')
      }
      return
    }
    if (policy.value.enabled) {
      const listed = await getDialogueAttachments(props.sessionId, props.item.item_version_id)
      if (!current(ticket)) return
      attachments.value = listed.attachments
    }
    if (props.persistDraft) {
      await serverDraft.load()
      if (!current(ticket)) return
      // The server owns attachment records. Stale draft IDs are shown as an error, never bound silently.
      if (
        selectedAttachments.value.some(
          (id) => !unboundAttachments.value.some((entry) => entry.id === id),
        )
      )
        attachmentError.value = '草稿中的附件已经提交或移除，请重新确认附件。'
    }
    restored.value = true
  } catch (caught) {
    if (current(ticket)) error.value = describeError(caught)
  } finally {
    if (current(ticket)) restoring.value = false
  }
}
async function flushDraft(): Promise<boolean> {
  if (uploadBusy.value) {
    attachmentError.value = '请等待附件上传完成后再离开。'
    return false
  }
  return !props.persistDraft || (await serverDraft.flush())
}
async function recoverDraft() {
  if (!serverDraft.ready.value || serverDraft.state.value === 'conflict') {
    if (
      serverDraft.dirty.value &&
      !window.confirm('重新加载会替换此页尚未同步的文字。请先复制保存，确认后读取服务端草稿。')
    )
      return
    // Refresh the exchange first: another tab may have advanced to a new round.
    // Old-round text must never seed a new, empty server draft.
    serverDraft.markSubmitted()
    draft.value = ''
    selectedAttachments.value = []
    await restore()
    return
  }
  await flushDraft()
}
const hasUnavailableAttachments = computed(() =>
  selectedAttachments.value.some(
    (id) => !unboundAttachments.value.some((entry) => entry.id === id && entry.state === 'ready'),
  ),
)
function clearUnavailableAttachments() {
  selectedAttachments.value = selectedAttachments.value.filter((id) =>
    unboundAttachments.value.some((entry) => entry.id === id && entry.state === 'ready'),
  )
  attachmentError.value = ''
}
async function generate(turnId: string, ticket: number) {
  liveResponse.value = ''
  try {
    await streamDialogueResponse(
      props.sessionId,
      turnId,
      generationKey.value,
      (content) => {
        if (current(ticket)) liveResponse.value += content
      },
      controller.signal,
    )
    if (current(ticket)) await restore(ticket)
  } finally {
    if (current(ticket)) liveResponse.value = ''
  }
}
async function submit() {
  if (!canSubmit.value) return
  const ticket = epoch
  generating.value = true
  error.value = ''
  try {
    if (!(await flushDraft()) || !current(ticket)) return
    const turn = await submitDialogueTurn(
      props.sessionId,
      props.item.item_version_id,
      draft.value.trim(),
      submitKey.value,
      [...selectedAttachments.value],
      controller.signal,
    )
    if (!current(ticket)) return
    serverDraft.markSubmitted()
    draft.value = ''
    selectedAttachments.value = []
    retryTurnId.value = turn.turn_id
    retryAllowed.value = true
    generationKey.value = operationKey(`dialogue-generation:${turn.turn_id}`)
    await generate(turn.turn_id, ticket)
  } catch (caught) {
    if (current(ticket)) {
      error.value = describeError(caught)
      if (caught instanceof DialogueStreamError && !caught.retryable) retryAllowed.value = false
    }
  } finally {
    if (current(ticket)) generating.value = false
  }
}
async function retryGeneration() {
  if (!retryTurnId.value || busy.value || props.disabled || !retryAllowed.value) return
  const ticket = epoch
  generating.value = true
  error.value = ''
  try {
    await generate(retryTurnId.value, ticket)
  } catch (caught) {
    if (current(ticket)) error.value = describeError(caught)
  } finally {
    if (current(ticket)) generating.value = false
  }
}
async function uploadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file || !policy.value.enabled || textareaDisabled.value) return
  attachmentError.value = ''
  if (
    file.size > policy.value.maxBytes ||
    attachments.value.filter((entry) => entry.state !== 'deleted').length >= policy.value.maxFiles
  ) {
    attachmentError.value = `每题最多${policy.value.maxFiles}个附件，单文件不超过${(policy.value.maxBytes / 1024 ** 2).toFixed(1)} MiB。`
    return
  }
  const extension = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
  if (!acceptedTypes.value.split(',').includes(extension)) {
    attachmentError.value = '本题不支持此文件类型；首版不支持 PDF、DOCX。'
    return
  }
  const ticket = epoch
  uploadBusy.value = true
  if (
    !uploadRetry ||
    uploadRetry.file.name !== file.name ||
    uploadRetry.file.size !== file.size ||
    uploadRetry.file.lastModified !== file.lastModified ||
    uploadRetry.file.type !== file.type
  )
    uploadRetry = { file, key: operationKey('dialogue-attachment') }
  try {
    const record = await uploadDialogueAttachment(
      props.sessionId,
      props.item.item_version_id,
      file,
      uploadRetry.key,
    )
    if (!current(ticket)) return
    attachments.value = [...attachments.value.filter((entry) => entry.id !== record.id), record]
    if (record.state === 'ready')
      selectedAttachments.value = [...new Set([...selectedAttachments.value, record.id])]
    else attachmentError.value = '附件尚未可用，请刷新附件状态后重试。'
    uploadRetry = null
  } catch (caught) {
    if (current(ticket)) attachmentError.value = describeError(caught)
  } finally {
    if (current(ticket)) {
      uploadBusy.value = false
      if (input.value) input.value.value = ''
    }
  }
}
async function removeAttachment(record: DialogueAttachment) {
  if (textareaDisabled.value || record.bound_turn_id) return
  const ticket = epoch
  uploadBusy.value = true
  attachmentError.value = ''
  try {
    await deleteDialogueAttachment(
      props.sessionId,
      props.item.item_version_id,
      record.id,
      operationKey('delete-dialogue-attachment'),
    )
    if (!current(ticket)) return
    attachments.value = attachments.value.filter((entry) => entry.id !== record.id)
    selectedAttachments.value = selectedAttachments.value.filter((id) => id !== record.id)
  } catch (caught) {
    if (current(ticket)) attachmentError.value = describeError(caught)
  } finally {
    if (current(ticket)) uploadBusy.value = false
  }
}
async function download(record: DialogueAttachment) {
  const ticket = epoch
  try {
    await downloadDialogueAttachment(
      props.sessionId,
      props.item.item_version_id,
      record,
      controller.signal,
    )
  } catch (caught) {
    if (current(ticket)) attachmentError.value = describeError(caught)
  }
}
function shortcut(event: KeyboardEvent) {
  if (event.ctrlKey && event.key === 'Enter' && !event.isComposing && !props.externalFooter) {
    event.preventDefault()
    void submit()
  }
}
watch(
  () => [props.sessionId, props.item.item_version_id],
  () => {
    ++epoch
    controller.abort()
    controller = new AbortController()
    emittedComplete = false
    serverDraft.markSubmitted()
    snapshot.value = null
    draft.value = ''
    attachments.value = []
    selectedAttachments.value = []
    retryTurnId.value = ''
    liveResponse.value = ''
    generating.value = false
    uploadBusy.value = false
    attachmentError.value = ''
    uploadRetry = null
    void restore(epoch)
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  ++epoch
  controller.abort()
})
defineExpose({ submit, flushDraft, busy, canSubmit, saveLabel, saveFailed, dirty, savedAt })
</script>

<template>
  <section class="dialogue-panel" :aria-busy="busy">
    <header class="interviewer-heading">
      <span class="interviewer-badge" aria-hidden="true">鉴</span>
      <span class="interviewer-name">{{ interviewerName }}</span>
      <span v-if="!snapshot?.turns.length" class="turn-counter">{{ turnLabel }}</span>
    </header>
    <p class="dialogue-current-question">{{ currentQuestion }}</p>
    <AssessmentQuestionMedia :media="item.configuration.media" />
    <details v-if="snapshot?.turns.length" class="dialogue-history">
      <summary><ChevronDown :size="14" />查看前序对话（{{ snapshot.turn_count }}轮）</summary>
      <p class="initial-question">初始题目：{{ item.stem }}</p>
      <article v-for="turn in snapshot.turns" :key="turn.id">
        <strong>第{{ turn.sequence }}轮 · 我的回答</strong>
        <p>{{ turn.user_content }}</p>
        <ul v-if="turn.attachments?.length" class="history-files">
          <li v-for="file in turn.attachments" :key="file.id">
            <button type="button" @click="download(file)">
              <Paperclip :size="14" />{{ file.filename }}<Download :size="14" />
            </button>
          </li>
        </ul>
        <template v-if="turn.assistant_content"
          ><strong>AI面试官<span v-if="turn.degraded"> · 降级模型</span></strong>
          <p>{{ turn.assistant_content }}</p></template
        >
      </article>
    </details>
    <p v-if="restoring" class="dialogue-notice" role="status">正在恢复对话记录……</p>
    <p v-if="liveResponse" class="dialogue-live" aria-live="polite">
      {{ liveResponse }}<i aria-hidden="true"></i>
    </p>
    <p v-if="error" class="dialogue-error" role="alert">{{ error }}</p>
    <button
      v-if="!restored && !busy && !retryTurnId && snapshot?.state !== 'completed'"
      class="retry-button"
      type="button"
      @click="restore()"
    >
      重新加载对话
    </button>
    <template v-if="retryTurnId">
      <p class="dialogue-notice">
        本轮回答已保存。{{
          retryAllowed
            ? '请完成面试官追问后再继续。'
            : '请刷新状态或联系评估员，不要重复提交本轮回答。'
        }}
      </p>
      <button
        class="retry-button"
        type="button"
        :disabled="busy || disabled || !retryAllowed"
        @click="retryGeneration"
      >
        <RefreshCw :size="15" />重新生成已保存回答的追问
      </button>
      <button v-if="!retryAllowed && !busy" class="text-button" type="button" @click="restore()">
        刷新对话状态
      </button>
    </template>
    <form
      v-if="snapshot?.state !== 'completed' && !retryTurnId"
      class="dialogue-answer-form"
      @submit.prevent="submit"
    >
      <label :for="`dialogue-answer-${item.item_version_id}`">你的回答</label>
      <div class="dialogue-composer" :class="{ 'is-disabled': textareaDisabled }">
        <textarea
          :id="`dialogue-answer-${item.item_version_id}`"
          v-model="draft"
          maxlength="4000"
          rows="4"
          :disabled="textareaDisabled"
          placeholder="说明你的判断过程、核验依据和下一步行动……"
          @blur="flushDraft"
          @keydown="shortcut"
        ></textarea>
        <div class="composer-tools">
          <span>已输入{{ draft.length }}字</span>
          <div>
            <AssessmentMaterials :item="item" hide-hint />
            <button
              type="button"
              class="attachment-trigger"
              :disabled="!policy.enabled || textareaDisabled"
              :title="
                policy.enabled
                  ? `最多${policy.maxFiles}个附件，单个不超过${policy.maxBytes / 1024 ** 2} MiB`
                  : '本题未开放附件提交'
              "
              @click="input?.click()"
            >
              <Plus :size="19" />{{ uploadBusy ? '上传中' : '添加附件' }}
            </button>
            <input
              ref="input"
              class="file-input"
              type="file"
              :accept="acceptedTypes"
              aria-label="上传对话题附件"
              @change="uploadFile"
            />
          </div>
        </div>
      </div>
      <ul v-if="unboundAttachments.length" class="attachment-list">
        <li v-for="file in unboundAttachments" :key="file.id">
          <label
            ><input
              v-model="selectedAttachments"
              type="checkbox"
              :value="file.id"
              :disabled="textareaDisabled || file.state !== 'ready'"
            /><span>{{ file.filename }}</span></label
          >
          <small>{{
            file.state !== 'ready'
              ? '未完成上传'
              : file.parse_status === 'text_ready'
                ? '文本可读取'
                : '需人工查看，不作为自动识图结果'
          }}</small>
          <button
            type="button"
            :aria-label="`移除${file.filename}`"
            :disabled="textareaDisabled"
            @click="removeAttachment(file)"
          >
            <X :size="16" />
          </button>
        </li>
      </ul>
      <p v-if="attachmentError" class="dialogue-error" role="alert">
        {{ attachmentError }}
        <button
          v-if="hasUnavailableAttachments"
          type="button"
          class="text-button"
          @click="clearUnavailableAttachments"
        >
          清除不可用附件引用
        </button>
      </p>
      <AssessmentMaterials :item="item" />
      <p v-if="policy.enabled" class="attachment-policy">
        本题最多{{ policy.maxFiles }}个附件，单文件≤{{ policy.maxBytes / 1024 ** 2 }}
        MiB；支持文本和图片。可读取文本会作为本轮证据交给面试官及评分模型，图片由评估员查看。提交后附件不可替换。
      </p>
      <p v-if="persistDraft && serverDraft.error.value" class="dialogue-error" role="alert">
        {{ serverDraft.error.value
        }}<button type="button" class="text-button" @click="recoverDraft">
          {{
            !serverDraft.ready.value || serverDraft.state.value === 'conflict'
              ? '重新加载草稿'
              : '重试保存'
          }}
        </button>
      </p>
      <footer v-if="!externalFooter" class="standalone-footer">
        <span>{{ saveLabel }} · {{ draft.length }} / 4000</span
        ><button type="submit" :disabled="!canSubmit">
          <LoaderCircle v-if="generating" class="spin" :size="17" /><Send v-else :size="17" />{{
            generating ? '正在固化并生成追问' : '提交本轮回答'
          }}
        </button>
      </footer>
    </form>
  </section>
</template>

<style scoped>
.dialogue-panel {
  --dialogue-text: #4a4d50;
  --dialogue-muted: #7a8185;
  --dialogue-border: #91a6e3;
  position: relative;
  color: var(--dialogue-text);
}
.interviewer-heading {
  display: flex;
  align-items: center;
  min-height: calc(20 * var(--exam-u, 1px));
  gap: 12px;
  position: relative;
  font-size: calc(15 * var(--exam-u, 1px));
  font-weight: 650;
  color: var(--dialogue-muted);
}
.interviewer-badge {
  position: absolute;
  left: calc(-56 * var(--exam-u, 1px));
  top: 0;
  display: grid;
  place-items: center;
  width: calc(37 * var(--exam-u, 1px));
  height: calc(36 * var(--exam-u, 1px));
  border-radius: 6px;
  background: #7696dd;
  color: white;
  font-size: 16px;
  font-weight: 750;
}
.turn-counter {
  margin-left: auto;
  font-size: 12px;
  color: #81878b;
  font-weight: 400;
}
.dialogue-current-question {
  font-size: calc(18 * var(--exam-u, 1px));
  font-weight: 650;
  line-height: 1.45;
  margin: calc(9 * var(--exam-u, 1px)) 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.dialogue-answer-form {
  margin-top: calc(26 * var(--exam-u, 1px));
}
.dialogue-answer-form > label {
  display: block;
  margin-bottom: calc(10 * var(--exam-u, 1px));
  font-size: calc(16 * var(--exam-u, 1px));
  font-weight: 650;
  line-height: 1.45;
}
.dialogue-composer {
  min-height: calc(178 * var(--exam-u, 1px));
  display: flex;
  flex-direction: column;
  border: 1px solid var(--dialogue-border);
  border-radius: 20px;
  background: #f3f5f9;
  overflow: hidden;
}
.dialogue-composer:focus-within {
  outline: 2px solid #219bac55;
  outline-offset: 2px;
}
.dialogue-composer textarea {
  display: block;
  width: 100%;
  min-height: calc(125 * var(--exam-u, 1px));
  height: calc(125 * var(--exam-u, 1px));
  box-sizing: border-box;
  padding: calc(21 * var(--exam-u, 1px));
  padding-bottom: 12px;
  border: 0;
  background: transparent;
  color: #5e6266;
  font-family: inherit;
  font-size: calc(18 * var(--exam-u, 1px));
  font-weight: 600;
  line-height: 1.45;
  resize: vertical;
  outline: none;
  box-shadow: none;
}
.dialogue-composer textarea::placeholder {
  color: #969da3;
  font-weight: 400;
}
.dialogue-composer.is-disabled {
  opacity: 0.8;
}
.composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding: 8px calc(20 * var(--exam-u, 1px)) calc(16 * var(--exam-u, 1px));
  color: var(--dialogue-muted);
  font-size: calc(14 * var(--exam-u, 1px));
  font-weight: 600;
}
.composer-tools > div {
  display: flex;
  align-items: center;
  gap: 20px;
}
.attachment-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: none;
  padding: 0;
  border: 0;
  color: var(--dialogue-muted);
  font: inherit;
  cursor: pointer;
}
.file-input {
  display: none;
}
.attachment-trigger:disabled {
  cursor: not-allowed;
  color: #91999f;
}
.dialogue-history {
  margin-top: 0;
  font-size: 13px;
}
.dialogue-history > summary {
  position: absolute;
  top: 2px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  color: #77838b;
  list-style: none;
}
.dialogue-history[open] {
  margin-top: 14px;
  padding-bottom: 16px;
  border-bottom: 1px solid #d5e0e4;
}
.dialogue-history article {
  padding: 14px 0 0;
}
.dialogue-history article strong {
  display: block;
  margin: 10px 0 4px;
  font-size: 13px;
  color: #5f7380;
}
.dialogue-history p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.7;
}
.initial-question {
  padding: 14px;
  background: #f5f8fa;
  margin-top: 12px;
  border-radius: 8px;
}
.history-files {
  list-style: none;
  padding: 0;
}
.history-files button {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  color: #137f91;
  cursor: pointer;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.dialogue-notice {
  margin-top: 16px;
  color: #6a7b84;
  font-size: 14px;
  line-height: 1.6;
}
.dialogue-live {
  padding: 14px;
  margin-top: 16px;
  background: #ebf6f9;
  border-radius: 10px;
  white-space: pre-wrap;
  line-height: 1.7;
}
.dialogue-live i {
  display: inline-block;
  width: 5px;
  height: 14px;
  background: #219bac;
  margin-left: 4px;
}
.dialogue-error {
  margin-top: 12px;
  padding: 10px 12px;
  color: #923d30;
  background: #fff1eb;
  border-left: 3px solid #b76849;
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.retry-button,
.standalone-footer > button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  margin-top: 12px;
  border: 0;
  border-radius: 5px;
  background: #219bac;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.text-button {
  padding: 5px 8px;
  border: 0;
  background: none;
  color: #137f91;
  text-decoration: underline;
  cursor: pointer;
}
.dialogue-panel button:focus-visible,
.dialogue-history summary:focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
.dialogue-panel button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.standalone-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  font-size: 13px;
  color: #73838a;
}
.attachment-list {
  list-style: none;
  padding: 0;
  margin: 12px 0 0;
  display: grid;
  gap: 6px;
}
.attachment-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f4f8fa;
  border: 1px solid #d6e5ea;
  border-radius: 6px;
}
.attachment-list label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.attachment-list small {
  margin-left: auto;
  color: #687b84;
  font-size: 12px;
}
.attachment-list button {
  border: 0;
  background: none;
  padding: 5px;
  cursor: pointer;
  color: #687b84;
}
.attachment-policy {
  font-size: 12px;
  color: #768790;
  margin-top: 8px;
  line-height: 1.6;
}
.spin {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
@media (max-width: 700px) {
  .interviewer-badge {
    position: static;
    width: 30px;
    height: 30px;
  }
  .interviewer-heading {
    font-size: 14px;
    gap: 8px;
  }
  .turn-counter {
    font-size: 12px;
  }
  .dialogue-current-question {
    font-size: 17px;
    margin-top: 14px;
  }
  .dialogue-answer-form {
    margin-top: 22px;
  }
  .dialogue-composer {
    border-radius: 16px;
    min-height: 200px;
  }
  .dialogue-composer textarea {
    font-size: 16px;
    min-height: 140px;
    padding: 16px;
  }
  .composer-tools {
    padding: 8px 12px 10px;
    font-size: 12px;
    gap: 8px;
    flex-wrap: wrap;
  }
  .composer-tools > div {
    gap: 12px;
  }
  .attachment-trigger {
    min-height: 40px;
  }
  .dialogue-history > summary {
    position: static;
    min-height: 40px;
  }
  .attachment-list li {
    flex-wrap: wrap;
  }
  .attachment-list small {
    margin-left: 0;
  }
  .attachment-list button {
    margin-left: auto;
    min-width: 40px;
    min-height: 40px;
  }
  .standalone-footer {
    align-items: flex-end;
    gap: 8px;
  }
}
</style>
