<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { FileUp, ImagePlus, SendHorizontal, Info, Trash2, Sparkles, X } from '@lucide/vue'
import BrandMark from './BrandMark.vue'
import {
  getGrowthGuide,
  uploadGuideMaterial,
  deleteGuideMaterial,
  GrowthGuideError,
  type GuideMaterial,
  type GrowthGuideResponse,
} from '../services/growthGuideApi'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'
import { useRoute } from 'vue-router'
const route = useRoute()
const props = defineProps<{ embedded?: boolean }>()

const access = useAccessStore()
const auth = useAuthStore()
const features = useFeatureStore()
const failedKey = ref('')
const failedMaterials = ref('')
const restrictedByServer = ref(false)
const question = ref('')
const materials = ref<GuideMaterial[]>([])
const uploading = ref(false)
const materialError = ref('')
const imageInput = ref<HTMLInputElement>()
const documentInput = ref<HTMLInputElement>()
const transcript = ref<HTMLElement>()
const questionInput = ref<HTMLTextAreaElement>()
const instructionsOpen = ref(false)

function selectMaterial(kind: 'image' | 'document') {
  if (
    !available.value ||
    loading.value ||
    uploading.value ||
    !features.attachmentsEnabled ||
    assessmentRestricted.value
  )
    return
  ;(kind === 'image' ? imageInput.value : documentInput.value)?.click()
}
function scrollToLatest() {
  void nextTick(() => {
    if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
  })
}
async function addMaterial(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (
    !files.length ||
    uploading.value ||
    loading.value ||
    !available.value ||
    !features.attachmentsEnabled ||
    assessmentRestricted.value
  )
    return
  if (
    files.length + materials.value.length > 3 ||
    files.some((file) => file.size > 5 * 1024 * 1024)
  ) {
    materialError.value = '最多 3 个材料，每个不超过 5 MiB。'
    return
  }
  const ticket = epoch,
    org = access.organizationId
  uploading.value = true
  materialError.value = ''
  try {
    for (const file of files) {
      const result = await uploadGuideMaterial(org, file)
      if (ticket !== epoch) {
        void deleteGuideMaterial(org, result.id).catch(() => {})
        break
      }
      materials.value.push(result)
    }
  } catch (cause) {
    if (ticket === epoch) {
      if (cause instanceof GrowthGuideError && cause.code === 'assessment_active')
        restrictedByServer.value = true
      materialError.value = cause instanceof Error ? cause.message : '解析失败'
    }
  } finally {
    if (ticket === epoch) uploading.value = false
  }
}
async function removeMaterial(id: string) {
  if (loading.value || uploading.value) return
  const ticket = epoch
  try {
    await deleteGuideMaterial(access.organizationId, id)
    if (ticket !== epoch) return
    materials.value = materials.value.filter((row) => row.id !== id)
  } catch (cause) {
    if (ticket === epoch)
      materialError.value = cause instanceof Error ? cause.message : '删除失败，请重试'
  }
}
const expanded = ref(Boolean(props.embedded))
const loading = ref(false)
const error = ref('')
const failedQuestion = ref('')
const history = ref<{ id: number; question: string; answer: GrowthGuideResponse }[]>([])
const quickQuestions = ['如何开始测评？', '怎么看我的报告？', '下一步怎么训练？']
const serviceReady = computed(() => features.ready && !features.loading && !features.error)
const assessmentRestricted = computed(
  () => features.assessmentInProgress || restrictedByServer.value,
)
const available = computed(() =>
  Boolean(
    access.ready &&
    !access.error &&
    access.organizationId &&
    auth.isAuthenticated &&
    auth.user?.id &&
    serviceReady.value &&
    features.growthGuideMode === 'deepseek' &&
    !assessmentRestricted.value,
  ),
)
const canSend = computed(
  () =>
    available.value &&
    !loading.value &&
    !uploading.value &&
    question.value.trim().length > 0 &&
    question.value.trim().length <= 200,
)
const availability = computed(() => {
  if (!auth.isAuthenticated) return '请先登录后使用 DeepSeek 成长助手。'
  if (access.error) return '访问权限暂不可用，请重新加载页面后重试。'
  if (!access.ready) return '正在确认访问权限…'
  if (!access.organizationId) return '请先选择一个可访问的组织。'
  if (features.error) return '服务连接失败，请点击“重新连接”后再发送或上传。'
  if (!serviceReady.value) return '正在确认 DeepSeek 与上传服务，请稍候…'
  if (assessmentRestricted.value)
    return '正在正式作答，请先在测评页暂存退出，再使用 DeepSeek 问答或分析材料。'
  if (features.growthGuideMode !== 'deepseek')
    return 'DeepSeek 服务尚未启用，请联系管理员；不会改用固定文字回答。'
  return '可询问测评使用、报告口径或训练下一步。'
})
const sendHint = computed(() => {
  if (!available.value) return availability.value
  if (loading.value) return '正在回答，请稍候…'
  return 'Enter 发送 · Shift+Enter 换行'
})
function onQuestionKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
  event.preventDefault()
  if (canSend.value) void submitQuestion()
}
let epoch = 0

function clearGuide() {
  epoch += 1
  question.value = ''
  history.value = []
  error.value = ''
  failedQuestion.value = ''
  failedKey.value = ''
  failedMaterials.value = ''
  restrictedByServer.value = false
  loading.value = false
  materials.value = []
  uploading.value = false
  materialError.value = ''
  instructionsOpen.value = false
}
watch(
  () => [access.organizationId, access.ready, access.error, auth.user?.id, auth.isAuthenticated],
  () => {
    clearGuide()
    expanded.value = false
  },
  { flush: 'sync' },
)
onBeforeUnmount(clearGuide)
watch(() => route?.fullPath, clearGuide)
watch(
  () => features.ready,
  (ready) => {
    if (ready) restrictedByServer.value = false
  },
)

async function submitQuestion(value = question.value) {
  const trimmed = value.trim()
  if (!available.value || loading.value || uploading.value || !trimmed || trimmed.length > 200)
    return
  const ticket = ++epoch
  const organizationId = access.organizationId
  const attachmentIds = materials.value.map((row) => row.id)
  const materialSignature = JSON.stringify(attachmentIds)
  const key =
    (failedQuestion.value === trimmed &&
      failedMaterials.value === materialSignature &&
      failedKey.value) ||
    crypto.randomUUID()
  question.value = trimmed
  expanded.value = true
  error.value = ''
  failedQuestion.value = ''
  loading.value = true
  scrollToLatest()
  try {
    const answer = await getGrowthGuide(organizationId, trimmed, {
      provider: 'deepseek',
      idempotencyKey: key,
      attachmentIds,
    })
    if (ticket !== epoch) return
    history.value = [...history.value, { id: ticket, question: trimmed, answer }].slice(-10)
    question.value = ''
    failedKey.value = ''
  } catch (cause) {
    if (ticket !== epoch) return
    failedQuestion.value = trimmed
    failedKey.value = key
    failedMaterials.value = materialSignature
    if (cause instanceof GrowthGuideError && cause.code === 'assessment_active')
      restrictedByServer.value = true
    error.value = cause instanceof Error ? cause.message : '暂时无法读取成长建议，请重试。'
  } finally {
    if (ticket === epoch) {
      loading.value = false
      scrollToLatest()
      void nextTick(() => questionInput.value?.focus())
    }
  }
}
function generationNotice(answer: GrowthGuideResponse) {
  return `DeepSeek 生成 · ${answer.generation?.model ?? ''}`
}
// The API includes this fixed footer in paragraphs, including replayed responses.
// Keep the disclosure in 使用说明, rather than repeating it below every answer.
const repeatedAnswerFooter =
  '以上为 DeepSeek 生成的学习建议，不是专家评分，不修改正式测评结果。' +
  '材料分析仅基于提取文字，图片OCR可能有误，不代表完整视觉理解。'
function answerParagraphs(answer: GrowthGuideResponse) {
  return answer.paragraphs.filter(
    (paragraph) => paragraph.replace(/\s/g, '') !== repeatedAnswerFooter.replace(/\s/g, ''),
  )
}
function sourceStatus(status: string) {
  const labels: Record<string, string> = {
    complete: '已定稿',
    pending_scoring: '待评分',
    needs_review: '待复核',
    partial: '证据未完整',
  }
  return labels[status] ?? '以报告页面状态为准'
}
</script>

<template>
  <section
    class="growth-composer"
    :class="{ 'is-embedded': embedded }"
    aria-label="成长助手"
    aria-describedby="growth-availability"
  >
    <div
      v-if="embedded || expanded"
      id="growth-conversation"
      class="guide-conversation"
      data-testid="guide-conversation"
    >
      <header class="conversation-heading">
        <span class="conversation-caption"><span class="status-dot"></span>你的能力成长空间</span>
        <div class="conversation-tools">
          <button
            type="button"
            :aria-expanded="instructionsOpen"
            aria-controls="guide-instructions"
            @click="instructionsOpen = !instructionsOpen"
          >
            <Info :size="18" />使用说明
          </button>
          <button type="button" data-testid="clear-guide" @click="clearGuide">
            <Trash2 :size="17" />清空问答
          </button>
        </div>
      </header>
      <div v-if="!serviceReady" class="service-notice" :role="features.error ? 'alert' : 'status'">
        <Info :size="18" />
        <span>{{
          features.error ? '服务配置加载失败，未调用模型，请重新连接。' : '正在连接助手与上传服务…'
        }}</span>
        <button
          v-if="features.error || (!features.ready && !features.loading)"
          type="button"
          :disabled="features.loading"
          data-testid="retry-guide-features"
          @click="features.load(true)"
        >
          重新连接
        </button>
      </div>
      <div v-else-if="assessmentRestricted" class="service-notice assessment-notice" role="status">
        <Info :size="18" /><span
          >正在正式作答：请先在测评页暂存退出，再使用 DeepSeek 问答或分析材料。</span
        >
        <RouterLink to="/assessment">前往测评 →</RouterLink>
        <button type="button" @click="features.load(true)">刷新状态</button>
      </div>
      <div v-else-if="features.growthGuideMode !== 'deepseek'" class="service-notice" role="status">
        <Info :size="18" /><span>DeepSeek 服务尚未启用，请联系管理员；不会改用固定文字回答。</span>
        <button type="button" data-testid="retry-guide-features" @click="features.load(true)">
          重新连接
        </button>
      </div>
      <aside
        v-if="instructionsOpen"
        id="guide-instructions"
        class="guide-instructions"
        aria-label="使用说明"
      >
        <div class="instructions-heading">
          <strong>使用与数据说明</strong
          ><button type="button" aria-label="关闭使用说明" @click="instructionsOpen = false">
            <X :size="18" />
          </button>
        </div>
        <p>
          仅保留本页最近 10
          次问答，刷新、进入其他页面或切换账号后清空。历史问答不会作为多轮上下文发送给模型。
        </p>
        <p>
          每条问答均由 DeepSeek 生成，并标明实际模型。服务失败只显示错误提示，不用固定文字替代回答。
          正式作答时请先暂存退出再提问；待定稿报告不作为能力结论发送，仍可询问一般学习问题。建议不改变正式成绩。
        </p>
        <p>
          {{
            features.attachmentsEnabled
              ? '支持文档文字提取和图片 OCR；识别可能有误，请先检查提取文字。正式测评期间不分析材料。最多 3 个文件，每个 5 MiB；PDF 最多 30 页。原文件不留存，提取文字加密临存 1 小时。'
              : '附件服务尚未启用，当前仅支持文字问题。'
          }}
        </p>
        <p>
          点击发送、按 Enter
          或选择快捷问题后，本次问题、所选材料的提取文字及必要的本人报告摘要会发送给
          DeepSeek，不自动读取正式测评作答原文。选择文件后即上传服务器提取文字。请勿输入密码、密钥或敏感信息；模型请求可能计费，失败或中断也可能产生费用。
        </p>
        <RouterLink class="guide-help" to="/help">查看完整使用指南 →</RouterLink>
      </aside>
      <div ref="transcript" class="conversation-scroll" aria-label="本页问答记录" tabindex="0">
        <div v-if="!history.length && !loading && !error" class="conversation-welcome">
          <span class="welcome-symbol"><BrandMark /></span>
          <h3>今天，想了解什么？</h3>
          <p>从读懂报告，到找到下一步训练方向。<br />把你的问题告诉我，我们一起理清思路。</p>
          <div class="guide-quick-questions" aria-label="快捷问题">
            <button
              v-for="quick in quickQuestions"
              :key="quick"
              type="button"
              data-testid="guide-quick-question"
              :disabled="!available || loading || uploading"
              @click="submitQuestion(quick)"
            >
              {{ quick }}<span aria-hidden="true">↗</span>
            </button>
          </div>
          <span class="welcome-note">{{
            !serviceReady
              ? '连接确认后即可开始提问'
              : features.growthGuideMode === 'deepseek'
                ? 'DeepSeek · 每条回答均由大模型生成'
                : 'DeepSeek 尚未启用 · 暂不可提问'
          }}</span>
        </div>
        <div v-if="history.length" class="guide-turns" role="log" aria-live="polite">
          <article
            v-for="turn in history"
            :key="turn.id"
            class="guide-turn"
            data-testid="guide-turn"
          >
            <h3 class="user-message"><span class="sr-only">你：</span>{{ turn.question }}</h3>
            <div class="assistant-message">
              <p class="guide-generation">
                <Sparkles :size="17" />{{ generationNotice(turn.answer) }}
              </p>
              <p
                v-for="(paragraph, index) in answerParagraphs(turn.answer)"
                :key="index"
                class="guide-paragraph"
              >
                {{ paragraph }}
              </p>
              <RouterLink
                v-if="turn.answer.source"
                data-testid="guide-source"
                class="guide-source"
                :to="`/reports/${turn.answer.source.session_id}`"
                >来源报告 · 修订 {{ turn.answer.source.revision }} ·
                {{ sourceStatus(turn.answer.source.status) }}</RouterLink
              >
              <nav v-if="turn.answer.actions.length" class="guide-actions" aria-label="建议下一步">
                <RouterLink
                  v-for="(action, index) in turn.answer.actions"
                  :key="index"
                  :to="action.path"
                  >{{ action.label }} →</RouterLink
                >
              </nav>
            </div>
          </article>
        </div>
        <div v-if="loading" class="pending-turn">
          <p class="user-message">{{ question }}</p>
          <p class="guide-state" role="status">
            <span class="thinking-dots" aria-hidden="true">•••</span>DeepSeek 正在生成回答…
          </p>
        </div>
        <div v-if="error" class="guide-error" role="alert">
          <p>{{ error }}</p>
          <p v-if="failedKey" class="guide-boundary">
            重试沿用同一请求标识，不会自动再次调用模型。需要重新提问时请先清空问答，再发送新请求。
          </p>
          <button
            type="button"
            data-testid="retry-guide"
            :disabled="!available || loading"
            @click="submitQuestion(failedQuestion)"
          >
            重试这个问题 →
          </button>
        </div>
      </div>
    </div>
    <form class="composer-input" @submit.prevent="submitQuestion()">
      <div v-if="!embedded" class="composer-heading">
        <label for="growth-question">Hi，有问题随时问哦</label>
        <button
          type="button"
          data-testid="toggle-guide"
          :aria-expanded="expanded"
          aria-controls="growth-conversation"
          @click="expanded = !expanded"
        >
          {{ expanded ? '收起' : '展开引导' }}
        </button>
      </div>
      <div v-if="materials.length" class="materials-tray">
        <details v-for="material in materials" :key="material.id" class="material-item">
          <summary>
            <FileUp :size="16" /><span>{{ material.name }}</span
            ><span class="material-status">{{
              material.method === 'ocr' ? 'OCR · 检查文字' : '检查提取文字'
            }}</span>
          </summary>
          <pre>{{ material.text }}</pre>
          <span v-if="material.truncated">已截取前 12000 字</span>
          <button
            type="button"
            :disabled="loading || uploading"
            @click="removeMaterial(material.id)"
          >
            删除材料
          </button>
        </details>
      </div>
      <p v-if="uploading" class="inline-status" role="status">正在上传并解析材料…</p>
      <p v-if="materialError" class="inline-error" role="alert">{{ materialError }}</p>
      <textarea
        id="growth-question"
        ref="questionInput"
        v-model="question"
        aria-label="向成长助手提问"
        aria-describedby="growth-availability"
        :disabled="!available || loading"
        maxlength="200"
        rows="2"
        :placeholder="available ? '输入你的问题，让成长更有方向…' : availability"
        @focus="expanded = true"
        @keydown="onQuestionKeydown"
      ></textarea>
      <footer class="composer-toolbar">
        <input
          ref="imageInput"
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          multiple
          hidden
          @change="addMaterial"
        />
        <input
          ref="documentInput"
          type="file"
          accept=".txt,.md,.csv,.json,.pdf,.docx"
          multiple
          hidden
          @change="addMaterial"
        />
        <div class="attachment-actions">
          <button
            type="button"
            :disabled="
              !features.attachmentsEnabled ||
              !available ||
              loading ||
              uploading ||
              assessmentRestricted
            "
            :title="
              assessmentRestricted
                ? '请先暂存退出当前测评，再分析材料'
                : !available
                  ? availability
                  : features.attachmentsEnabled
                    ? '上传图片提取文字（不分析复杂图表）'
                    : '附件服务尚未启用'
            "
            aria-label="上传图片"
            @click="selectMaterial('image')"
          >
            <ImagePlus :size="21" /><span>图片</span>
          </button>
          <button
            type="button"
            :disabled="
              !features.attachmentsEnabled ||
              !available ||
              loading ||
              uploading ||
              assessmentRestricted
            "
            :title="
              assessmentRestricted
                ? '请先暂存退出当前测评，再分析材料'
                : !available
                  ? availability
                  : features.attachmentsEnabled
                    ? '上传文档提取文字'
                    : '附件服务尚未启用'
            "
            aria-label="上传文档"
            @click="selectMaterial('document')"
          >
            <FileUp :size="21" /><span>文档</span>
          </button>
        </div>
        <span class="model-provider" data-testid="guide-provider">{{
          !serviceReady
            ? features.error
              ? '服务连接异常'
              : '正在连接服务…'
            : features.growthGuideMode === 'deepseek'
              ? 'DeepSeek · 大模型回答'
              : 'DeepSeek 尚未启用'
        }}</span>
        <span class="character-count" :aria-label="`已输入${question.length}字，最多200字`"
          >{{ question.length }}/200</span
        >
        <button
          class="send-question"
          type="submit"
          :disabled="!canSend"
          :aria-busy="loading"
          aria-label="发送问题"
          :title="canSend ? '发送问题' : sendHint"
        >
          <SendHorizontal :size="23" /><span>发送</span>
        </button>
      </footer>
      <p id="growth-availability" class="send-hint" role="status">
        {{ sendHint }}<span class="source-reminder">以每条回复标注的来源为准</span>
      </p>
    </form>
  </section>
</template>

<style scoped>
.growth-composer {
  --reference-unit: 1px;
  width: 100%;
  min-width: 0;
  color: #183b46;
  font-size: 16px;
}
.growth-composer,
.growth-composer * {
  box-sizing: border-box;
}
button,
select,
textarea {
  font: inherit;
}
button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 44px;
  border: 0;
  padding: 8px 12px;
  color: #247b89;
  background: transparent;
  cursor: pointer;
  border-radius: 10px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
button:not(:disabled):hover {
  background: #e7f3f5;
}
button:focus-visible,
a:focus-visible,
summary:focus-visible,
select:focus-visible,
.conversation-scroll:focus-visible {
  outline: 3px solid #289aac;
  outline-offset: 2px;
}
button svg,
summary svg {
  flex-shrink: 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
.is-embedded {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 14px;
}
.guide-conversation {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #f5fafb;
  border-radius: 16px;
  margin-bottom: 14px;
  color: #183b46;
}
.is-embedded .guide-conversation {
  flex: 1;
  margin: 0;
  border-radius: 0;
  background: transparent;
}
.conversation-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 10px;
  border-bottom: 1px solid #e0ecef;
  flex-shrink: 0;
}
.conversation-caption {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: #65838c;
}
.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #40acb9;
}
.service-notice {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  margin-top: 10px;
  border-radius: 10px;
  color: #496c77;
  background: #e9f4f7;
  font-size: 14px;
  line-height: 1.7;
}
.service-notice svg {
  flex-shrink: 0;
}
.service-notice span {
  flex: 1;
  min-width: 180px;
}
.service-notice button,
.service-notice a {
  font-size: 14px;
  color: #137f91;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
}
.assessment-notice {
  background: #fff7ea;
  color: #85602f;
}
.conversation-tools {
  display: flex;
  gap: 6px;
}
.conversation-tools button {
  font-size: 14px;
}
.conversation-scroll {
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  min-height: 0;
  max-height: 520px;
  padding: 24px 16px;
  overflow-wrap: anywhere;
}
.is-embedded .conversation-scroll {
  flex: 1;
  max-height: none;
}
.conversation-welcome {
  min-height: 310px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px 12px;
  height: 100%;
}
.welcome-symbol {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  flex-shrink: 0;
  background: #e1f4f7;
  color: #14889b;
  border-radius: 22px;
  margin-bottom: 20px;
}
.welcome-symbol :deep(.brand-mark) {
  width: 50px;
  height: 42px;
}
.conversation-welcome h3 {
  margin: 0 0 12px;
  font-size: 28px;
  letter-spacing: -0.5px;
}
.conversation-welcome p {
  margin: 0;
  color: #66808a;
  font-size: 17px;
  line-height: 1.9;
}
.guide-quick-questions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin: 28px 0 18px;
}
.guide-quick-questions button {
  font-size: 15px;
  background: #fff;
  border: 1px solid #d7e8ec;
  padding: 10px 14px;
}
.guide-quick-questions span {
  color: #71a8b1;
  margin-left: 6px;
}
.welcome-note {
  font-size: 13px;
  color: #728a93;
}
.guide-turn {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-bottom: 30px;
}
.user-message {
  align-self: flex-end;
  width: fit-content;
  max-width: 82%;
  margin: 0 0 0 auto;
  padding: 13px 20px;
  border-radius: 20px 20px 5px 20px;
  background: #def0f3;
  font-size: 17px;
  font-weight: 500;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistant-message {
  width: fit-content;
  max-width: 94%;
  padding: 20px 24px;
  border: 1px solid #e3ecef;
  border-radius: 5px 20px 20px;
  background: white;
  box-shadow: 0 3px 14px #1f576405;
}
.guide-generation {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  color: #137f91;
  font-size: 14px;
  line-height: 1.6;
}
.guide-generation.fallback {
  color: #8a6028;
}
.guide-paragraph {
  margin: 12px 0 0;
  white-space: pre-wrap;
  font-size: 17px;
  line-height: 1.9;
}
.guide-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}
.guide-actions a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 7px 12px;
  border-radius: 9px;
  color: #178296;
  background: #f0f8fa;
  text-decoration: none;
  font-size: 14px;
}
.guide-source,
.guide-help {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: 10px;
  color: #178296;
  font-size: 14px;
  text-underline-offset: 4px;
}
.guide-state {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
  font-size: 16px;
  color: #648089;
}
.thinking-dots {
  font-size: 26px;
  letter-spacing: 3px;
  color: #219bad;
}
.guide-error {
  padding: 18px;
  border: 1px solid #f0dbc3;
  background: #fff8f0;
  border-radius: 14px;
  color: #875230;
  margin-top: 14px;
  line-height: 1.8;
}
.guide-error p {
  margin: 0 0 8px;
}
.guide-boundary {
  font-size: 14px;
  color: #7c6e60;
}
.guide-instructions {
  position: absolute;
  z-index: 2;
  right: 0;
  top: 54px;
  width: min(540px, 100%);
  max-height: min(440px, 60dvh);
  overflow: auto;
  padding: 20px;
  border: 1px solid #d1e4e9;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 14px 40px #16495720;
  font-size: 14px;
  color: #56727e;
  line-height: 1.85;
}
.instructions-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #183b46;
  font-size: 17px;
}
.guide-instructions p {
  margin: 8px 0 14px;
}
.composer-input {
  flex-shrink: 0;
  padding: 14px 18px 10px;
  border: 1px solid #d2e4e9;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 6px 28px #1d60700a;
}
.is-embedded .composer-input {
  max-height: 55%;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.composer-input:focus-within {
  border-color: #77bdca;
  box-shadow: 0 0 0 3px #198b9e08;
}
.composer-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.composer-heading label {
  color: #219bac;
  font-size: 18px;
}
.composer-heading button {
  font-size: 14px;
}
textarea {
  display: block;
  width: 100%;
  height: 84px;
  min-height: 68px;
  max-height: 150px;
  resize: vertical;
  border: 0;
  border-radius: 10px;
  background: transparent;
  padding: 12px 6px;
  color: #183b46;
  font-size: 17px;
  line-height: 1.7;
}
textarea::placeholder {
  color: #889da5;
}
textarea:focus-visible {
  outline: none;
  background: #f8fcfd;
}
.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding-top: 7px;
}
.attachment-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}
.attachment-actions button {
  font-size: 14px;
  padding: 8px;
  color: #4b8290;
}
.guide-provider {
  min-width: 0;
}
.guide-provider select {
  display: block;
  width: 190px;
  max-width: 100%;
  min-height: 40px;
  border: 1px solid #dfedf0;
  border-radius: 10px;
  padding: 7px 10px;
  color: #347c8b;
  background: #f4fafb;
  font-size: 14px;
}
.model-provider {
  font-size: 13px;
  color: #64828b;
}
.character-count {
  margin-left: auto;
  color: #82949b;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.send-question {
  flex-shrink: 0;
  min-width: 90px;
  min-height: 46px;
  border-radius: 13px;
  background: #14899d;
  color: #fff;
  font-weight: 600;
}
.send-question:not(:disabled):hover {
  background: #086e80;
}
.send-hint {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin: 8px 4px 0;
  color: #78909a;
  font-size: 12px;
  line-height: 1.6;
}
.inline-status,
.inline-error {
  font-size: 14px;
  margin: 6px 0;
  line-height: 1.7;
}
.inline-error {
  color: #9a4d37;
}
.materials-tray {
  max-height: 180px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.material-item {
  border-radius: 10px;
  border: 1px solid #dfecef;
  background: #f7fbfc;
  padding: 0 10px;
  color: #4d707a;
  font-size: 13px;
}
.material-item summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  cursor: pointer;
}
.material-item summary span {
  overflow-wrap: anywhere;
}
.material-status {
  margin-left: auto;
  font-size: 12px;
}
.material-item pre {
  font: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 100px;
  overflow-y: auto;
}
.material-item button {
  min-height: 36px;
  font-size: 13px;
  padding: 6px;
  text-decoration: underline;
}
@media (max-width: 700px) {
  .conversation-caption {
    display: none;
  }
  .conversation-heading {
    justify-content: flex-end;
  }
  .conversation-scroll {
    padding: 18px 4px;
  }
  .conversation-welcome {
    min-height: 280px;
    padding: 16px 0;
  }
  .conversation-welcome h3 {
    font-size: 24px;
  }
  .conversation-welcome p {
    font-size: 16px;
  }
  .guide-quick-questions {
    gap: 8px;
    margin-top: 20px;
  }
  .guide-quick-questions button {
    font-size: 14px;
  }
  .assistant-message {
    max-width: 100%;
    padding: 16px;
  }
  .guide-paragraph,
  .user-message {
    font-size: 16px;
  }
  .composer-input {
    padding: 10px 12px 8px;
    border-radius: 16px;
  }
  .composer-toolbar {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto auto;
    gap: 4px;
  }
  .guide-provider select {
    width: 100%;
    min-width: 0;
    font-size: 13px;
  }
  .attachment-actions button {
    padding: 8px;
  }
  .attachment-actions button span,
  .send-question span,
  .source-reminder {
    display: none;
  }
  .send-question {
    min-width: 44px;
    min-height: 44px;
  }
  .character-count {
    font-size: 12px;
  }
  .model-provider {
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .send-hint {
    font-size: 11px;
  }
  .is-embedded {
    gap: 8px;
  }
  .guide-generation {
    font-size: 13px;
  }
}
@media (max-width: 360px) {
  .guide-provider {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .guide-provider select {
    width: 100%;
  }
}
</style>
