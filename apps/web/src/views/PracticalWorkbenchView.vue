<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useAssessmentDraft } from '../composables/useAssessmentDraft'
import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  FlaskConical,
  LoaderCircle,
  LockKeyhole,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  UploadCloud,
} from '@lucide/vue'

import {
  appendPracticalEvent,
  createPracticalWorkspace,
  getPracticalSnapshot,
  makeIdempotencyKey,
  runPracticalInteraction,
  submitPracticalWorkspace,
  uploadPracticalArtifact,
  type PracticalConnection,
  type PracticalEvent,
  type PracticalSnapshot,
  PracticalApiError,
} from '../services/practicalApi'
import { useAuthStore } from '../stores/auth'
import AssessmentQuestionMedia from '../components/AssessmentQuestionMedia.vue'

const props = withDefaults(
  defineProps<{
    formalSessionId?: string
    formalItemId?: string
    embedded?: boolean
    sessionDisabled?: boolean
    readOnlyMode?: boolean
  }>(),
  {
    formalSessionId: '',
    formalItemId: '',
    embedded: false,
    sessionDisabled: false,
    readOnlyMode: false,
  },
)
const emit = defineEmits<{ complete: [] }>()
let alive = true
const formalMode = Boolean(props.formalSessionId && props.formalItemId)
const auth = formalMode ? useAuthStore() : null

const query = new URLSearchParams(window.location.search)
const saved = sessionStorage.getItem('zhijian-practical-connection')
let restored: Partial<PracticalConnection> = {}
try {
  restored = saved ? (JSON.parse(saved) as Partial<PracticalConnection>) : {}
} catch {
  sessionStorage.removeItem('zhijian-practical-connection')
}
const configuredApiBase = import.meta.env.VITE_API_BASE_URL as string | undefined
const apiBaseLocked = import.meta.env.PROD
const apiBase = ref(
  configuredApiBase ??
    (apiBaseLocked ? `${window.location.origin}/api/v1` : 'http://localhost:18000/api/v1'),
)
const token = ref(formalMode ? '' : (restored.token ?? ''))
const sessionId = ref(props.formalSessionId || query.get('session_id') || restored.sessionId || '')
const itemId = ref(props.formalItemId || query.get('item_id') || restored.itemId || '')
const snapshot = ref<PracticalSnapshot | null>(null)
const busy = ref('')
const error = ref('')
const notice = ref('')
const decomposition = ref('明确任务目标\n形成AI协作草稿\n核验关键信息')
const prompt = ref('')
const verificationMethod = ref('')
const verificationFinding = ref('')
const finalOutput = ref('')
const reflection = ref('')
const selectedArtifactId = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const dialogueEnd = ref<HTMLElement | null>(null)
const workspaceKey = ref(makeIdempotencyKey('workspace'))
const decompositionKey = ref(makeIdempotencyKey('decomposition'))
const promptEventKey = ref(makeIdempotencyKey('prompt'))
const interactionKey = ref(makeIdempotencyKey('interaction'))
const verificationKey = ref(makeIdempotencyKey('verification'))
const uploadKey = ref(makeIdempotencyKey('artifact'))
const uploadFingerprint = ref('')
const submissionKey = ref(makeIdempotencyKey('submit'))

const connection = computed<PracticalConnection>(() => {
  const value: PracticalConnection = {
    apiBase: apiBase.value.trim(),
    token: token.value.trim(),
    sessionId: sessionId.value.trim(),
    itemId: itemId.value.trim(),
  }
  if (auth) value.request = (path, init) => auth.request(path, init)
  return value
})
const editable = computed(
  () => snapshot.value?.can_edit === true && !props.sessionDisabled && !props.readOnlyMode,
)
const interactionBudget = computed(() => {
  if (!snapshot.value) return '0 / 0'
  return `${snapshot.value.interaction_count} / ${snapshot.value.max_ai_interactions}`
})
const hasDecomposition = computed(() =>
  snapshot.value?.events.some((event) => event.event_type === 'task_decomposition'),
)
const hasVerification = computed(() =>
  snapshot.value?.events.some((event) => event.event_type === 'result_verification'),
)
const hasPendingWork = computed(
  () =>
    snapshot.value?.interactions.some((item) => item.state === 'pending') ||
    snapshot.value?.artifacts.some((item) => item.state === 'pending'),
)
const hasRequiredArtifact = computed(
  () => snapshot.value?.task_type !== 'image' || Boolean(selectedArtifactId.value),
)
const canAskAi = computed(
  () =>
    editable.value &&
    Boolean(prompt.value.trim()) &&
    !hasPendingWork.value &&
    (snapshot.value?.interaction_count ?? 0) < (snapshot.value?.max_ai_interactions ?? 0),
)
const canSubmit = computed(
  () =>
    editable.value &&
    Boolean(finalOutput.value.trim()) &&
    hasDecomposition.value &&
    hasVerification.value &&
    !hasPendingWork.value &&
    hasRequiredArtifact.value,
)
const serverDraft = useAssessmentDraft({
  sessionId: () => sessionId.value,
  itemId: () => itemId.value,
  contextRevision: () => 0,
  response: () => ({
    task_decomposition: decomposition.value,
    prompt: prompt.value,
    verification: { method: verificationMethod.value, finding: verificationFinding.value },
    final_output: finalOutput.value,
    reflection: reflection.value,
    artifact_id: selectedArtifactId.value,
  }),
  restore: (value) => {
    decomposition.value =
      typeof value.task_decomposition === 'string' ? value.task_decomposition : decomposition.value
    prompt.value = typeof value.prompt === 'string' ? value.prompt : ''
    finalOutput.value = typeof value.final_output === 'string' ? value.final_output : ''
    reflection.value = typeof value.reflection === 'string' ? value.reflection : ''
    const verification = value.verification as Record<string, unknown> | undefined
    verificationMethod.value = typeof verification?.method === 'string' ? verification.method : ''
    verificationFinding.value =
      typeof verification?.finding === 'string' ? verification.finding : ''
    selectedArtifactId.value =
      typeof value.artifact_id === 'string' ? value.artifact_id : selectedArtifactId.value
  },
})
const saveLabel = computed(() =>
  snapshot.value?.state === 'submitted' ? '回答已提交' : serverDraft.label.value,
)
const saveFailed = computed(() => ['error', 'conflict'].includes(serverDraft.state.value))
const saving = computed(() => Boolean(busy.value))
const dirty = computed(() => serverDraft.dirty.value)
const savedAt = computed(() => serverDraft.savedAt.value)
async function flushDraft() {
  return formalMode ? serverDraft.flush() : true
}
const evidence = computed(() => {
  if (!snapshot.value) return []
  return [
    ...snapshot.value.events.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kind: 'EVENT',
      label: eventLabel(entry),
      time: entry.occurred_at,
    })),
    ...snapshot.value.interactions.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kind: 'AI',
      label: entry.state === 'succeeded' ? 'AI协作回复已固化' : 'AI调用失败',
      time: entry.completed_at ?? entry.created_at,
    })),
    ...snapshot.value.artifacts.map((entry) => ({
      id: entry.id,
      sequence: entry.sequence,
      kind: 'FILE',
      label: entry.state === 'ready' ? `文件已验真 · ${entry.filename}` : '文件上传失败',
      time: entry.completed_at ?? entry.created_at,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time))
})

function eventLabel(event: PracticalEvent) {
  const labels: Record<string, string> = {
    task_decomposition: '任务拆解已记录',
    prompt_draft: '提示词草稿已封存',
    prompt_revision: '提示词修订已封存',
    tool_use: '工具使用已记录',
    result_verification: '结果核验已记录',
    artifact_note: '产物说明已记录',
  }
  return labels[event.event_type] ?? event.event_type
}

function validateConnection() {
  if (!connection.value.apiBase || (!connection.value.token && !connection.value.request))
    throw new Error('请填写API地址和访问令牌。')
  if (!connection.value.sessionId || !connection.value.itemId)
    throw new Error('请填写会话ID和实操题ID。')
}

function resetKey(target: { value: string }, prefix: string) {
  target.value = makeIdempotencyKey(prefix)
}

watch(decomposition, () => resetKey(decompositionKey, 'decomposition'))
watch(prompt, () => {
  resetKey(promptEventKey, 'prompt')
  resetKey(interactionKey, 'interaction')
})
watch([verificationMethod, verificationFinding], () => resetKey(verificationKey, 'verification'))
watch([finalOutput, reflection, selectedArtifactId], () => resetKey(submissionKey, 'submit'))

watch([finalOutput, reflection, prompt, decomposition], () => {
  if (formalMode) return
  if (!sessionId.value.trim() || !itemId.value.trim()) return
  sessionStorage.setItem(
    `zhijian-practical-draft:${sessionId.value.trim()}:${itemId.value.trim()}`,
    JSON.stringify({
      finalOutput: finalOutput.value,
      reflection: reflection.value,
      prompt: prompt.value,
      decomposition: decomposition.value,
    }),
  )
})

function restoreDraft() {
  const raw = sessionStorage.getItem(
    `zhijian-practical-draft:${connection.value.sessionId}:${connection.value.itemId}`,
  )
  if (!raw) return
  try {
    const draft = JSON.parse(raw) as Record<string, unknown>
    finalOutput.value = typeof draft.finalOutput === 'string' ? draft.finalOutput : ''
    reflection.value = typeof draft.reflection === 'string' ? draft.reflection : ''
    prompt.value = typeof draft.prompt === 'string' ? draft.prompt : ''
    decomposition.value =
      typeof draft.decomposition === 'string' ? draft.decomposition : decomposition.value
  } catch {
    sessionStorage.removeItem(
      `zhijian-practical-draft:${connection.value.sessionId}:${connection.value.itemId}`,
    )
  }
}

async function refreshSnapshot() {
  const result = await getPracticalSnapshot(connection.value)
  if (!alive) return
  snapshot.value = result
  if (!selectedArtifactId.value) {
    selectedArtifactId.value =
      snapshot.value.artifacts.find((item) => item.state === 'ready')?.id ?? null
  }
}

async function connectWorkbench() {
  error.value = ''
  notice.value = ''
  try {
    validateConnection()
    busy.value = 'connect'
    if (!formalMode) {
      const {
        apiBase: base,
        token: accessToken,
        sessionId: sessionValue,
        itemId: itemValue,
      } = connection.value
      sessionStorage.setItem(
        'zhijian-practical-connection',
        JSON.stringify({
          apiBase: base,
          token: accessToken,
          sessionId: sessionValue,
          itemId: itemValue,
        }),
      )
    }
    try {
      await refreshSnapshot()
      notice.value = '已恢复上次证据快照。'
    } catch (caught) {
      if (
        !(caught instanceof PracticalApiError) ||
        caught.status !== 404 ||
        props.readOnlyMode ||
        props.sessionDisabled
      )
        throw caught
      snapshot.value = await createPracticalWorkspace(connection.value, workspaceKey.value)
      notice.value = '已创建受控实操工作台。'
    }
    if (formalMode && snapshot.value?.can_edit && !props.readOnlyMode && !props.sessionDisabled) {
      await serverDraft.load()
      if (!alive) return
      // Migrate a former tab-local draft only after the server confirms no saved draft.
      if (serverDraft.ready.value && serverDraft.canEdit.value && !serverDraft.savedAt.value) {
        restoreDraft()
        if (await serverDraft.flush())
          sessionStorage.removeItem(
            `zhijian-practical-draft:${connection.value.sessionId}:${connection.value.itemId}`,
          )
      }
    } else if (!formalMode) restoreDraft()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '连接工作台失败。'
  } finally {
    busy.value = ''
  }
}

async function recordDecomposition() {
  const steps = decomposition.value
    .split('\n')
    .map((step) => step.trim())
    .filter(Boolean)
  await perform('decomposition', async () => {
    await appendPracticalEvent(
      connection.value,
      'task_decomposition',
      { steps },
      decompositionKey.value,
    )
    await refreshSnapshot()
    notice.value = '任务拆解已盖入证据轨。'
  })
}

async function askAi() {
  const value = prompt.value.trim()
  if (!value) return
  await perform('ai', async () => {
    const hasPrompt = snapshot.value?.events.some((event) => event.event_type.startsWith('prompt_'))
    await appendPracticalEvent(
      connection.value,
      hasPrompt ? 'prompt_revision' : 'prompt_draft',
      { content: value },
      promptEventKey.value,
    )
    await runPracticalInteraction(connection.value, value, interactionKey.value)
    prompt.value = ''
    await refreshSnapshot()
    await nextTick()
    dialogueEnd.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  })
  if (snapshot.value) {
    try {
      await refreshSnapshot()
    } catch {
      // Keep the original actionable error; the user can retry the visible refresh control.
    }
  }
}

async function recordVerification() {
  if (!verificationMethod.value.trim() || !verificationFinding.value.trim()) return
  await perform('verification', async () => {
    await appendPracticalEvent(
      connection.value,
      'result_verification',
      {
        method: verificationMethod.value.trim(),
        finding: verificationFinding.value.trim(),
      },
      verificationKey.value,
    )
    verificationMethod.value = ''
    verificationFinding.value = ''
    await refreshSnapshot()
    notice.value = '核验结论已成为评分证据。'
  })
}

async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const fingerprint = `${file.name}:${file.size}:${file.lastModified}:${file.type}`
  if (uploadFingerprint.value !== fingerprint) {
    uploadFingerprint.value = fingerprint
    resetKey(uploadKey, 'artifact')
  }
  await perform('upload', async () => {
    const artifact = await uploadPracticalArtifact(connection.value, file, uploadKey.value)
    selectedArtifactId.value = artifact.id
    await refreshSnapshot()
    notice.value = `已验真 ${artifact.filename}，SHA-256 已固化。`
  })
  input.value = ''
}

async function submitFinal() {
  if (!canSubmit.value || busy.value || props.sessionDisabled) return
  await perform('submit', async () => {
    if (formalMode && !(await flushDraft()))
      throw new Error(serverDraft.error.value || '草稿未同步，请重试保存。')
    await submitPracticalWorkspace(
      connection.value,
      {
        final_output: finalOutput.value.trim(),
        artifact_id: selectedArtifactId.value,
        reflection: reflection.value.trim() || null,
      },
      submissionKey.value,
    )
    if (!alive) return
    serverDraft.markSubmitted()
    await refreshSnapshot()
    notice.value = '最终产物已封存，正在等待量规评分。'
    if (props.embedded) emit('complete')
  })
}

async function perform(state: string, action: () => Promise<void>) {
  if (busy.value || (props.sessionDisabled && state !== 'refresh')) return
  error.value = ''
  notice.value = ''
  try {
    busy.value = state
    await action()
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '操作未能完成。'
  } finally {
    busy.value = ''
  }
}

onMounted(() => {
  if (formalMode) void connectWorkbench()
})
onBeforeUnmount(() => {
  alive = false
})
defineExpose({
  submit: submitFinal,
  flushDraft,
  busy: saving,
  canSubmit,
  saveLabel,
  saveFailed,
  dirty,
  savedAt,
})

function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}
</script>

<template>
  <section class="workbench shell" :class="{ 'embedded-workbench': embedded }">
    <header v-if="!embedded" class="workbench-heading">
      <div>
        <span class="eyebrow">Practical evidence studio / v1</span>
        <h1 data-testid="workbench-title">完成任务，也留下<br /><em>可信的协作证据</em></h1>
      </div>
      <div class="heading-seal">
        <ShieldCheck :size="20" />
        <span>PRIVATE · HASHED · TRACEABLE</span>
      </div>
    </header>

    <div v-if="!snapshot && formalMode" class="formal-loading surface" role="status">
      <LoaderCircle class="spin" :size="19" /> 正在恢复受控实操证据……
    </div>
    <form v-else-if="!snapshot" class="connection surface" @submit.prevent="connectWorkbench">
      <div class="connection-intro">
        <LockKeyhole :size="22" />
        <div><strong>连接你的测评会话</strong><span>令牌只保存在当前浏览器标签页</span></div>
      </div>
      <label
        ><span>API 地址</span><input v-model="apiBase" autocomplete="url" :disabled="apiBaseLocked"
      /></label>
      <label
        ><span>访问令牌</span><input v-model="token" type="password" autocomplete="off"
      /></label>
      <label><span>会话 ID</span><input v-model="sessionId" autocomplete="off" /></label>
      <label><span>实操题 ID</span><input v-model="itemId" autocomplete="off" /></label>
      <button class="primary-button" type="submit" :disabled="Boolean(busy)">
        <LoaderCircle v-if="busy" class="spin" :size="18" />
        <FlaskConical v-else :size="18" />
        {{ busy ? '正在校准工作台' : '进入证据工作台' }}
      </button>
    </form>

    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <div v-if="formalMode && serverDraft.error.value" class="alert error" role="alert">
      {{ serverDraft.error.value
      }}<button type="button" :disabled="Boolean(busy)" @click="flushDraft">重试草稿保存</button>
    </div>
    <div v-if="notice" class="alert notice" role="status">{{ notice }}</div>
    <div
      v-if="formalMode && !embedded && snapshot?.state === 'submitted'"
      class="formal-complete surface"
    >
      <CheckCircle2 :size="20" />
      <div>
        <strong>实操证据已封存</strong><span>返回运行器后，服务端会自适应派发下一题。</span>
      </div>
      <a :href="`/assessment/${sessionId}`">返回测评并继续 <ArrowUpRight :size="16" /></a>
    </div>

    <div v-if="snapshot" class="studio" :class="{ sealed: !editable }">
      <aside class="dossier surface">
        <div class="panel-kicker">
          <span>01</span> {{ embedded ? '任务说明与核验' : 'TASK DOSSIER' }}
        </div>
        <div class="task-state">
          <i></i
          >{{
            editable
              ? '测评进行中'
              : snapshot.state === 'submitted'
                ? '证据已封存'
                : '只读记录 · 未完成'
          }}
        </div>
        <h2>{{ snapshot.stem }}</h2>
        <AssessmentQuestionMedia :media="snapshot.media" />
        <dl>
          <div>
            <dt>任务类型</dt>
            <dd>{{ snapshot.task_type.toUpperCase() }}</dd>
          </div>
          <div>
            <dt>AI额度</dt>
            <dd>{{ interactionBudget }}</dd>
          </div>
          <div>
            <dt>文件证据</dt>
            <dd>{{ snapshot.artifact_count }}</dd>
          </div>
        </dl>

        <div class="dossier-block">
          <label for="decomposition">任务拆解 · 每行一步</label>
          <textarea
            id="decomposition"
            v-model="decomposition"
            rows="5"
            :disabled="!editable"
          ></textarea>
          <button type="button" :disabled="!editable || Boolean(busy)" @click="recordDecomposition">
            <Plus :size="15" /> 盖入证据轨
          </button>
        </div>

        <div class="dossier-block verification">
          <label for="verify-method">结果核验</label>
          <input
            id="verify-method"
            v-model="verificationMethod"
            placeholder="方法：官方来源 / 代码测试"
            :disabled="!editable"
          />
          <textarea
            v-model="verificationFinding"
            rows="3"
            aria-label="核验结论"
            placeholder="结论：哪些信息已确认，哪些仍不确定"
            :disabled="!editable"
          ></textarea>
          <button type="button" :disabled="!editable || Boolean(busy)" @click="recordVerification">
            <ClipboardCheck :size="15" /> 固化核验结论
          </button>
        </div>
      </aside>

      <section class="ai-lab surface">
        <div class="panel-kicker">
          <span>02</span> {{ embedded ? '受控 AI 协作' : 'AI COLLABORATION LAB' }}
        </div>
        <div class="dialogue" aria-live="polite">
          <div v-if="!snapshot.interactions.length" class="empty-dialogue">
            <Bot :size="34" />
            <strong>这里记录真实的人机协作</strong>
            <p>每次提示词与AI回复都会固化进证据链。先拆解任务，再发出第一条精确指令。</p>
          </div>
          <article v-for="item in snapshot.interactions" :key="item.id" class="exchange">
            <div class="learner-message">
              <small>PROMPT · {{ item.sequence }}</small>
              <p>{{ item.prompt }}</p>
            </div>
            <div class="ai-message" :class="{ failed: item.state === 'failed' }">
              <small>AI RESPONSE · {{ item.degraded ? 'MOCK FALLBACK' : 'AUDITED' }}</small>
              <p>{{ item.response ?? `调用未完成：${item.error_code}` }}</p>
            </div>
          </article>
          <span ref="dialogueEnd"></span>
        </div>
        <div class="composer">
          <textarea
            v-model="prompt"
            rows="4"
            aria-label="AI提示词"
            placeholder="写下目标、约束、输出格式，以及需要AI明确标注的不确定信息……"
            :disabled="!editable"
          ></textarea>
          <div>
            <span>{{ prompt.length }} / 8000</span>
            <button type="button" :disabled="!canAskAi || Boolean(busy)" @click="askAi">
              <LoaderCircle v-if="busy === 'ai'" class="spin" :size="17" />
              <Send v-else :size="17" />
              发送并留痕
            </button>
          </div>
        </div>

        <section class="artifact-dock">
          <div class="dock-title">
            <FileCheck2 :size="19" /><strong>最终产物舱</strong><span>私有存储 · 5 MiB</span>
          </div>
          <div class="artifact-list">
            <label
              v-for="artifact in snapshot.artifacts"
              :key="artifact.id"
              :class="{ selected: selectedArtifactId === artifact.id }"
            >
              <input
                v-model="selectedArtifactId"
                type="radio"
                :value="artifact.id"
                :disabled="artifact.state !== 'ready' || !editable"
              />
              <span
                ><strong>{{ artifact.filename }}</strong
                ><small
                  >{{ shortHash(artifact.sha256) }} ·
                  {{ (artifact.byte_size / 1024).toFixed(1) }} KB</small
                ></span
              >
              <CheckCircle2 v-if="artifact.state === 'ready'" :size="17" />
            </label>
            <button
              v-if="editable"
              class="upload-tile"
              type="button"
              :disabled="Boolean(busy)"
              @click="fileInput?.click()"
            >
              <UploadCloud :size="19" /> {{ busy === 'upload' ? '正在验真并封存' : '上传文件产物' }}
            </button>
            <input ref="fileInput" class="visually-hidden" type="file" @change="uploadFile" />
          </div>
          <textarea
            v-model="finalOutput"
            rows="5"
            aria-label="最终结果"
            placeholder="填写最终结果、关键结论或代码说明……"
            :disabled="!editable"
          ></textarea>
          <textarea
            v-model="reflection"
            rows="3"
            aria-label="协作反思"
            placeholder="反思：AI在哪一步有帮助？你如何发现并修正问题？"
            :disabled="!editable"
          ></textarea>
          <div v-if="editable && !canSubmit" class="submission-gates" aria-live="polite">
            <span :class="{ done: hasDecomposition }">任务拆解</span>
            <span :class="{ done: hasVerification }">结果核验</span>
            <span :class="{ done: !hasPendingWork }">无在途任务</span>
            <span v-if="snapshot.task_type === 'image'" :class="{ done: hasRequiredArtifact }"
              >已选图像产物</span
            >
          </div>
          <button
            v-if="!embedded"
            class="seal-button"
            type="button"
            :disabled="!canSubmit || Boolean(busy)"
            @click="submitFinal"
          >
            <LockKeyhole :size="17" /> {{ busy === 'submit' ? '正在封存' : '封存最终产物' }}
          </button>
        </section>
      </section>

      <aside class="proof-rail">
        <div class="rail-head">
          <div>
            <span>03</span><strong>{{ embedded ? '过程证据记录' : 'EVIDENCE RAIL' }}</strong>
          </div>
          <button
            type="button"
            aria-label="刷新证据快照"
            :disabled="Boolean(busy)"
            @click="perform('refresh', refreshSnapshot)"
          >
            <RefreshCw :size="16" />
          </button>
        </div>
        <p>系统观测证据 · 仅追加</p>
        <ol>
          <li v-for="(item, index) in evidence" :key="item.id">
            <span class="rail-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <div>
              <small
                >{{ item.kind }} ·
                {{
                  new Date(item.time).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                }}</small
              ><strong>{{ item.label }}</strong
              ><code>{{ item.id.slice(0, 8) }}</code>
            </div>
          </li>
        </ol>
        <div v-if="!evidence.length" class="rail-empty">第一条证据将在任务拆解后出现。</div>
        <div class="rail-footer">
          <ShieldCheck :size="18" /><span
            ><strong>{{ evidence.length }}</strong> 条证据已进入评分上下文</span
          >
        </div>
      </aside>
    </div>

    <div v-if="snapshot?.state === 'submitted' && !embedded" class="sealed-banner">
      <CheckCircle2 :size="22" />
      <div>
        <strong>本次实操已封存</strong><span>过程证据与文件哈希不可静默改写，等待量规评分。</span>
      </div>
      <ArrowUpRight :size="20" />
    </div>
  </section>
</template>

<style scoped>
.workbench {
  padding: 56px 0 90px;
}
.workbench-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 32px;
  margin-bottom: 34px;
}
.workbench-heading h1 {
  margin-top: 12px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.045em;
}
.workbench-heading em {
  color: var(--signal-dark);
  font-style: normal;
}
.heading-seal {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--signal-dark);
  font:
    700 12px/1 'Cascadia Mono',
    monospace;
  letter-spacing: 0.08em;
}
.connection {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1fr;
  gap: 14px;
  padding: 24px;
}
.formal-loading {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 20px;
  color: var(--signal-dark);
  font-weight: 700;
}
.formal-complete {
  display: grid;
  align-items: center;
  margin-bottom: 16px;
  padding: 16px 18px;
  border-color: rgba(7, 128, 95, 0.35);
  grid-template-columns: 24px 1fr auto;
  gap: 10px;
  color: var(--signal-dark);
}
.formal-complete strong,
.formal-complete span {
  display: block;
}
.formal-complete strong {
  color: var(--ink-950);
  font-size: 13px;
}
.formal-complete span {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}
.formal-complete a {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--signal-dark);
  font-size: 12px;
  font-weight: 800;
}
.connection-intro {
  display: flex;
  align-items: center;
  gap: 12px;
}
.connection-intro strong,
.connection-intro span {
  display: block;
}
.connection-intro span {
  color: var(--muted);
  font-size: 12px;
}
label span,
.dossier-block > label {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 750;
  letter-spacing: 0.08em;
}
input,
textarea {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: var(--ink-950);
  background: #fff;
  outline: none;
}
input {
  height: 43px;
  padding: 0 12px;
}
textarea {
  padding: 11px 12px;
  resize: vertical;
  line-height: 1.55;
}
input:focus,
textarea:focus {
  border-color: var(--signal-dark);
  box-shadow: 0 0 0 3px rgba(49, 212, 156, 0.14);
}
.connection .primary-button {
  grid-column: 4;
}
.alert {
  margin: 0 0 16px;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 13px;
}
.error {
  color: #8a2f23;
  background: #fff0ed;
}
.notice {
  color: var(--signal-dark);
  background: var(--mist);
}
.studio {
  display: grid;
  grid-template-columns: minmax(235px, 0.82fr) minmax(390px, 1.45fr) minmax(230px, 0.82fr);
  align-items: start;
  gap: 14px;
}
.dossier,
.ai-lab {
  overflow: hidden;
}
.dossier {
  padding: 21px;
}
.ai-lab {
  padding: 21px;
}
.panel-kicker {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--muted);
  font:
    700 12px/1 'Cascadia Mono',
    monospace;
  letter-spacing: 0.12em;
}
.panel-kicker span {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-950);
  background: var(--signal);
}
.task-state {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 26px;
  color: var(--signal-dark);
  font-size: 12px;
  font-weight: 750;
}
.task-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--signal);
}
.dossier h2 {
  margin: 12px 0 22px;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.85;
}
dl {
  display: grid;
  gap: 7px;
  margin-bottom: 22px;
}
dl div {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px solid var(--mist);
}
dt {
  color: var(--muted);
  font-size: 12px;
}
dd {
  font:
    700 12px 'Cascadia Mono',
    monospace;
}
.dossier-block {
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.dossier-block + .dossier-block {
  margin-top: 20px;
}
.dossier-block button {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 9px;
  padding: 7px 0;
  border: 0;
  color: var(--signal-dark);
  background: none;
  cursor: pointer;
  font-weight: 750;
}
.verification {
  display: grid;
  gap: 8px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.dialogue {
  min-height: 330px;
  max-height: 520px;
  overflow: auto;
  padding: 20px 4px 14px;
  scroll-behavior: smooth;
}
.empty-dialogue {
  display: grid;
  min-height: 280px;
  place-items: center;
  align-content: center;
  gap: 8px;
  color: var(--muted);
  text-align: center;
}
.empty-dialogue strong {
  color: var(--ink-950);
}
.empty-dialogue p {
  max-width: 340px;
  font-size: 13px;
}
.exchange {
  display: grid;
  gap: 10px;
  margin-bottom: 23px;
}
.exchange small {
  display: block;
  margin-bottom: 5px;
  font:
    700 12px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.09em;
}
.exchange p {
  white-space: pre-wrap;
}
.learner-message {
  width: 84%;
  margin-left: auto;
  padding: 12px 14px;
  border-radius: 14px 14px 3px 14px;
  background: var(--mist);
}
.learner-message small {
  color: var(--signal-dark);
}
.ai-message {
  width: 92%;
  padding: 15px;
  border-left: 3px solid var(--signal);
  border-radius: 3px 14px 14px;
  color: var(--text);
  background: var(--ink-900);
}
.ai-message small {
  color: var(--signal);
}
.ai-message.failed {
  border-color: #e37458;
}
.composer {
  padding: 13px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fff;
}
.composer textarea {
  border: 0;
  padding: 4px;
  box-shadow: none;
}
.composer > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.composer span {
  color: var(--muted);
  font:
    12px 'Cascadia Mono',
    monospace;
}
.composer button,
.seal-button {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 15px;
  border: 0;
  border-radius: 999px;
  color: white;
  background: var(--ink-950);
  cursor: pointer;
  font-weight: 750;
}
.artifact-dock {
  margin: 18px -21px -21px;
  padding: 20px 21px 22px;
  border-top: 1px solid var(--line);
  background: var(--paper);
}
.dock-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.dock-title span {
  margin-left: auto;
  color: var(--muted);
  font-size: 12px;
}
.artifact-list {
  display: grid;
  gap: 8px;
  margin-bottom: 12px;
}
.artifact-list label {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: white;
}
.artifact-list label.selected {
  border-color: var(--signal-dark);
  box-shadow: inset 3px 0 var(--signal);
}
.artifact-list label input {
  width: auto;
  height: auto;
}
.artifact-list label span {
  flex: 1;
  margin: 0;
}
.artifact-list label strong,
.artifact-list label small {
  display: block;
}
.artifact-list label small {
  color: var(--muted);
  font:
    12px 'Cascadia Mono',
    monospace;
}
.upload-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  border: 1px dashed var(--signal-dark);
  border-radius: 10px;
  color: var(--signal-dark);
  background: var(--mist);
  cursor: pointer;
  font-weight: 750;
}
.artifact-dock textarea + textarea {
  margin-top: 8px;
}
.seal-button {
  margin-top: 11px;
  margin-left: auto;
}
.submission-gates {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.submission-gates span {
  padding: 4px 8px;
  border-radius: 999px;
  color: #8a5b2a;
  background: #fff0d9;
  font-size: 12px;
  font-weight: 700;
}
.submission-gates span::before {
  margin-right: 4px;
  content: '○';
}
.submission-gates span.done {
  color: var(--signal-dark);
  background: var(--mist);
}
.submission-gates span.done::before {
  content: '✓';
}
.proof-rail {
  position: sticky;
  top: 14px;
  overflow: hidden;
  min-height: 610px;
  padding: 21px;
  border-radius: 18px;
  color: var(--text);
  background: var(--ink-950);
  box-shadow: 0 20px 48px rgba(7, 26, 36, 0.2);
}
.proof-rail::before {
  position: absolute;
  inset: 0;
  background: linear-gradient(120deg, transparent 38%, rgba(49, 212, 156, 0.06));
  content: '';
  pointer-events: none;
}
.rail-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rail-head div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rail-head span {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border-radius: 50%;
  color: var(--ink-950);
  background: var(--signal);
  font: 700 12px monospace;
}
.rail-head strong {
  font:
    700 12px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.12em;
}
.rail-head > button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--signal);
  background: transparent;
  cursor: pointer;
}
.proof-rail > p {
  position: relative;
  margin: 13px 0 23px;
  color: var(--muted);
  font-size: 12px;
}
.proof-rail ol {
  position: relative;
  display: grid;
  gap: 0;
  padding: 0;
  list-style: none;
}
.proof-rail li {
  display: grid;
  grid-template-columns: 27px 1fr;
  gap: 10px;
  min-height: 78px;
}
.rail-index {
  display: grid;
  z-index: 1;
  width: 26px;
  height: 26px;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: 50%;
  color: var(--signal);
  background: var(--ink-950);
  font: 700 12px monospace;
}
.proof-rail li:not(:last-child) .rail-index::after {
  position: absolute;
  width: 1px;
  height: 53px;
  margin-top: 79px;
  background: var(--line);
  content: '';
}
.proof-rail li div small,
.proof-rail li div strong,
.proof-rail li div code {
  display: block;
}
.proof-rail li div small {
  color: var(--muted);
  font: 700 12px monospace;
  letter-spacing: 0.08em;
}
.proof-rail li div strong {
  margin: 3px 0;
  color: var(--text);
  font-size: 12px;
}
.proof-rail li div code {
  color: var(--muted);
  font-size: 12px;
}
.rail-empty {
  position: relative;
  padding: 20px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  color: var(--muted);
  font-size: 12px;
}
.rail-footer {
  position: absolute;
  right: 20px;
  bottom: 20px;
  left: 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.rail-footer strong {
  color: var(--signal);
  font-size: 19px;
}
.sealed-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding: 16px 20px;
  border: 1px solid var(--line);
  border-radius: 14px;
  color: var(--signal-dark);
  background: var(--mist);
}
.sealed-banner div {
  flex: 1;
}
.sealed-banner strong,
.sealed-banner span {
  display: block;
}
.sealed-banner span {
  font-size: 12px;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1000px) {
  .studio {
    grid-template-columns: minmax(230px, 0.8fr) minmax(420px, 1.4fr);
  }
  .proof-rail {
    position: relative;
    top: 0;
    grid-column: 1/-1;
    min-height: auto;
  }
  .rail-footer {
    position: relative;
    right: auto;
    bottom: auto;
    left: auto;
    margin-top: 20px;
  }
  .connection {
    grid-template-columns: 1fr 1fr;
  }
  .connection .primary-button {
    grid-column: 2;
  }
}
@media (max-width: 720px) {
  .workbench {
    padding-top: 32px;
  }
  .workbench-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .heading-seal {
    display: none;
  }
  .studio {
    grid-template-columns: 1fr;
  }
  .proof-rail {
    grid-column: auto;
  }
  .connection {
    grid-template-columns: 1fr;
  }
  .connection .primary-button {
    grid-column: auto;
  }
  .dossier,
  .ai-lab {
    padding: 17px;
  }
  .artifact-dock {
    margin: 18px -17px -17px;
    padding: 17px;
  }
  .learner-message,
  .ai-message {
    width: 96%;
  }
}

.workbench {
  width: 100%;
  padding: 0 0 36px;
  color: var(--text);
}
.workbench-heading {
  align-items: center;
  margin-bottom: 24px;
  gap: 20px;
}
.workbench-heading h1 {
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.025em;
}
.workbench-heading h1 br {
  display: none;
}
.workbench-heading h1 em {
  margin-left: 4px;
}
.heading-seal {
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0;
  padding: 10px 12px;
  border-radius: 9px;
  background: var(--mist);
}
.connection {
  background: var(--paper-strong);
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.connection-intro {
  grid-column: 1/-1;
}
.connection .primary-button {
  grid-column: 2;
  justify-self: end;
}
.studio {
  grid-template-columns: minmax(225px, 0.85fr) minmax(0, 1.5fr) minmax(210px, 0.8fr);
  gap: 18px;
}
.dossier,
.ai-lab {
  min-width: 0;
  background: var(--paper-strong);
}
.panel-kicker {
  font-family: inherit;
  font-size: 12px;
  letter-spacing: 0;
  line-height: 1.5;
}
.panel-kicker span,
.rail-head span {
  background: var(--mist);
  color: var(--signal-dark);
}
.dossier h2 {
  font-family: inherit;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.task-state {
  margin-top: 20px;
}
.task-state i {
  background: var(--signal-dark);
}
input,
textarea {
  font-size: 14px;
  line-height: 1.8;
}
input:focus,
textarea:focus {
  box-shadow: none;
  outline: 2px solid var(--nav-bg);
  outline-offset: 2px;
}
.dossier-block button {
  min-height: 40px;
  font-size: 13px;
}
.exchange p {
  font-size: 14px;
  line-height: 1.9;
  overflow-wrap: anywhere;
}
.ai-message {
  color: var(--text);
  background: var(--paper);
  border-color: var(--signal-dark);
}
.ai-message small {
  color: var(--signal-dark);
}
.composer:focus-within {
  border-color: var(--signal-dark);
}
.composer textarea:focus {
  outline: 0;
}
.composer button,
.seal-button {
  min-height: 42px;
  border-radius: 8px;
  background: var(--signal-dark);
  font-size: 13px;
  font-weight: 600;
}
.dock-title {
  flex-wrap: wrap;
}
.dock-title strong {
  font-size: 15px;
}
.dock-title span {
  font-size: 12px;
}
.artifact-list label strong {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.artifact-list label small {
  font-size: 12px;
  overflow-wrap: anywhere;
}
.proof-rail {
  position: relative;
  top: auto;
  min-height: 0;
  color: var(--text);
  background: var(--paper-strong);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: none;
}
.proof-rail::before {
  display: none;
}
.rail-head > button {
  width: 36px;
  height: 36px;
  color: var(--signal-dark);
  background: var(--paper-strong);
}
.rail-head strong {
  font-family: inherit;
  letter-spacing: 0;
  font-size: 12px;
}
.rail-index {
  color: var(--signal-dark);
  background: var(--paper-strong);
}
.rail-footer {
  position: relative;
  inset: auto;
  margin-top: 18px;
  padding-top: 16px;
  font-size: 12px;
}
.rail-footer strong {
  color: var(--signal-dark);
}
.proof-rail li {
  min-height: 86px;
}
.proof-rail li div {
  min-width: 0;
}
.proof-rail li div strong {
  overflow-wrap: anywhere;
  line-height: 1.8;
}
.proof-rail li div small {
  line-height: 1.8;
  letter-spacing: 0;
}
.formal-complete {
  background: var(--paper-strong);
  border-color: var(--line);
}
.formal-complete span {
  font-size: 12px;
}
.formal-complete a {
  min-height: 40px;
  font-size: 13px;
}
.sealed-banner span {
  font-size: 13px;
}
@media (max-width: 1150px) {
  .studio {
    grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.4fr);
  }
  .proof-rail {
    grid-column: 1/-1;
  }
  .proof-rail ol {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  .proof-rail li:not(:last-child) .rail-index::after {
    display: none;
  }
  .heading-seal {
    max-width: 230px;
    line-height: 1.5;
  }
}
@media (max-width: 720px) {
  .workbench {
    padding-top: 0;
  }
  .workbench-heading {
    gap: 16px;
  }
  .workbench-heading h1 {
    font-size: 25px;
  }
  .workbench-heading h1 br {
    display: block;
  }
  .workbench-heading h1 em {
    margin-left: 0;
  }
  .studio {
    grid-template-columns: 1fr;
  }
  .proof-rail {
    grid-column: auto;
  }
  .proof-rail ol {
    grid-template-columns: 1fr;
  }
  .connection {
    grid-template-columns: 1fr;
    padding: 20px 16px;
  }
  .connection .primary-button {
    grid-column: auto;
    width: 100%;
    justify-self: stretch;
  }
  .formal-complete {
    grid-template-columns: 24px minmax(0, 1fr);
  }
  .formal-complete a {
    grid-column: 2;
  }
  .dock-title span {
    margin-left: 0;
    flex-basis: 100%;
  }
  .composer > div {
    gap: 10px;
  }
  .composer button {
    padding: 10px 12px;
  }
  .seal-button {
    width: 100%;
    justify-content: center;
  }
}
.workbench.embedded-workbench {
  padding: 0;
  min-width: 0;
  max-width: none;
}
.embedded-workbench .studio {
  grid-template-columns: minmax(200px, 0.65fr) minmax(0, 1fr);
  gap: 16px;
  margin: 0;
}
.embedded-workbench .proof-rail {
  grid-column: 1/-1;
  min-width: 0;
}
.embedded-workbench .proof-rail ol {
  max-height: 280px;
  overflow: auto;
}
.embedded-workbench .dossier,
.embedded-workbench .ai-lab {
  min-width: 0;
  padding: 18px;
  border: 1px solid #d3dfe5;
  box-shadow: none;
  border-radius: 12px;
}
.embedded-workbench .dossier h2 {
  font-size: 18px;
  line-height: 1.6;
}
.embedded-workbench .panel-kicker {
  font-size: 12px;
  letter-spacing: 0;
}
.embedded-workbench .dialogue {
  min-height: 210px;
  max-height: 360px;
}
.embedded-workbench .composer textarea,
.embedded-workbench .artifact-dock textarea {
  font-size: 15px;
}
.embedded-workbench .dossier-block textarea {
  font-size: 14px;
}
.embedded-workbench .empty-dialogue {
  padding: 20px 10px;
  min-height: 200px;
}
.embedded-workbench .dock-title {
  flex-wrap: wrap;
}
.embedded-workbench .dock-title span {
  margin-left: 0;
}
@media (max-width: 1400px) {
  .embedded-workbench .studio {
    grid-template-columns: 1fr;
  }
  .embedded-workbench .dossier {
    display: block;
  }
}
</style>
