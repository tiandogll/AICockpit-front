<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { MODE_NAMES, SCENARIO_NAMES } from '../domain/capabilities'
import { ApiError } from '../services/apiClient'
import {
  getPublicationPreview,
  publishContentReview,
  type PublicationPreview,
  type PublicationReceipt,
  type PublicationTarget,
  type ReviewStatus,
  type SubmitPublication,
  type PublicationStatus,
} from '../services/contentReviewApi'

const props = defineProps<{
  packetId: string
  digest: string
  status: ReviewStatus
  code: string
  revision: number
  approvalCount: number
  requiredApprovals: number
  disabled?: boolean
  publicationStatus?: PublicationStatus
}>()
const emit = defineEmits<{
  busy: [value: boolean]
  publication: [value: PublicationReceipt | null]
  published: [value: PublicationReceipt]
  'access-revoked': []
}>()
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
const preview = ref<PublicationPreview | null>(null)
const receipt = ref<PublicationReceipt | null>(null)
const selectedIds = ref<string[]>([])
const excludedExpanded = ref(false),
  excludedPage = ref(0)
const excludedPageSize = 20
const compatibleTargets = computed(
  () => preview.value?.targets.filter((target) => target.eligible) ?? [],
)
const excludedTargets = computed(
  () => preview.value?.targets.filter((target) => !target.eligible) ?? [],
)
const excludedPageCount = computed(() =>
  Math.max(1, Math.ceil(excludedTargets.value.length / excludedPageSize)),
)
const visibleExcludedTargets = computed(() =>
  excludedTargets.value.slice(
    excludedPage.value * excludedPageSize,
    (excludedPage.value + 1) * excludedPageSize,
  ),
)
const loading = ref(false),
  busy = ref(false),
  error = ref('')
const intent = ref<{
  packetId: string
  body: SubmitPublication
  key: string
  targets: PublicationTarget[]
  attempted: boolean
} | null>(null)
const locked = computed(() => busy.value || !!props.disabled)
const selectedTargets = computed(
  () =>
    preview.value?.targets.filter(
      (target) => target.eligible && selectedIds.value.includes(target.blueprint_id),
    ) ?? [],
)
const canPrepare = computed(
  () =>
    props.status === 'reviewed' &&
    props.publicationStatus !== 'published' &&
    preview.value?.eligible &&
    !receipt.value &&
    selectedTargets.value.length > 0,
)
let epoch = 0,
  ticket = 0
function current(scope: number) {
  return scope === epoch && allowed.value
}
function collapseExcluded() {
  excludedExpanded.value = false
  excludedPage.value = 0
}
function toggleExcluded() {
  excludedPage.value = 0
  excludedExpanded.value = !excludedExpanded.value
}
function reset() {
  epoch += 1
  ticket += 1
  preview.value = null
  receipt.value = null
  selectedIds.value = []
  collapseExcluded()
  intent.value = null
  loading.value = false
  busy.value = false
  error.value = ''
  emit('busy', false)
  emit('publication', null)
}
function revoked(caught: unknown) {
  if (!(caught instanceof ApiError && [401, 403, 404].includes(caught.status))) return false
  reset()
  error.value = '发布权限或题目范围发生变化，发布预览与待提交信息已清除。'
  emit('access-revoked')
  return true
}
function validReceipt(value: PublicationReceipt) {
  return (
    !!value?.item_version_id &&
    Number.isFinite(Date.parse(value.published_at)) &&
    Array.isArray(value.targets) &&
    value.targets.length > 0 &&
    value.targets.every(
      (target) => !!target.previous_blueprint_id && !!target.blueprint_id && !!target.name,
    )
  )
}
async function load() {
  if (!allowed.value || locked.value || intent.value) return
  const scope = epoch,
    request = ++ticket
  preview.value = null
  selectedIds.value = []
  collapseExcluded()
  error.value = ''
  loading.value = true
  try {
    const value = await getPublicationPreview(props.packetId)
    if (!current(scope) || request !== ticket) return
    if (
      value.packet_id !== props.packetId ||
      value.digest !== props.digest ||
      !value.preview_token ||
      !Array.isArray(value.targets) ||
      !Array.isArray(value.issues) ||
      typeof value.eligible !== 'boolean' ||
      (value.publication !== null && !validReceipt(value.publication)) ||
      !value.targets.every(
        (target) =>
          target &&
          typeof target.blueprint_id === 'string' &&
          typeof target.name === 'string' &&
          typeof target.mode === 'string' &&
          typeof target.scenario === 'string' &&
          Number.isInteger(target.version) &&
          Number.isInteger(target.pool_size) &&
          Array.isArray(target.organization_names) &&
          target.organization_names.every((name) => typeof name === 'string') &&
          typeof target.eligible === 'boolean',
      )
    )
      throw new Error('发布预览与当前题稿不一致或响应不完整，请重新读取题目后再核对。')
    preview.value = value
    receipt.value = value.publication
    emit('publication', value.publication)
  } catch (caught) {
    if (current(scope) && request === ticket && !revoked(caught))
      error.value = caught instanceof Error ? caught.message : '发布预览读取失败，请重试。'
  } finally {
    if (current(scope) && request === ticket) loading.value = false
  }
}
function prepare() {
  if (
    !allowed.value ||
    locked.value ||
    loading.value ||
    intent.value ||
    !canPrepare.value ||
    !preview.value
  )
    return
  intent.value = {
    packetId: props.packetId,
    body: {
      expected_digest: props.digest,
      preview_token: preview.value.preview_token,
      blueprint_ids: selectedTargets.value.map((target) => target.blueprint_id),
    },
    key: `content-publication-${crypto.randomUUID()}`,
    targets: selectedTargets.value.map((target) => ({
      ...target,
      organization_names: [...target.organization_names],
    })),
    attempted: false,
  }
  error.value = ''
}
async function publish() {
  if (
    !allowed.value ||
    locked.value ||
    !intent.value ||
    props.status !== 'reviewed' ||
    receipt.value
  )
    return
  const scope = epoch,
    pending = intent.value
  if (pending.packetId !== props.packetId || pending.body.expected_digest !== props.digest) return
  pending.attempted = true
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const value = await publishContentReview(pending.packetId, pending.body, pending.key)
    if (!current(scope)) return
    if (
      !validReceipt(value) ||
      value.targets.length !== pending.body.blueprint_ids.length ||
      !value.targets.every((target) =>
        pending.body.blueprint_ids.includes(target.previous_blueprint_id),
      )
    )
      throw new Error('发布回执不完整，结果尚未确认。请重试同一次发布。')
    receipt.value = value
    intent.value = null
    selectedIds.value = []
    emit('publication', value)
    emit('published', value)
  } catch (caught) {
    if (!current(scope) || revoked(caught)) return
    if (caught instanceof ApiError && [409, 422].includes(caught.status)) {
      preview.value = null
      selectedIds.value = []
      intent.value = null
      error.value = `${caught.message}。当前预览已失效，请重新读取发布预览并核对，不会自动重发。`
    } else {
      error.value = `${caught instanceof Error ? caught.message : '发布请求未确认成功'}。请重试同一次发布，已保留原计划选择与请求标识。`
    }
  } finally {
    if (current(scope)) {
      busy.value = false
      emit('busy', false)
    }
  }
}
function mayLeave() {
  if (busy.value) return false
  return (
    !intent.value ||
    window.confirm(
      intent.value.attempted
        ? '发布结果尚未确认。离开会丢失本次重试信息；建议先重试同一次发布。确定离开吗？'
        : '尚未确认发布，离开将放弃本次计划选择。确定继续吗？',
    )
  )
}
defineExpose({ mayLeave, hasPending: () => !!intent.value })
watch(
  () => [
    props.packetId,
    props.digest,
    props.status,
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
watch(
  () => props.disabled,
  (disabled) => {
    if (
      !disabled &&
      !preview.value &&
      !receipt.value &&
      !loading.value &&
      !error.value &&
      !intent.value
    )
      void load()
  },
)
onBeforeUnmount(reset)
</script>

<template>
  <section
    v-if="allowed"
    class="publication-panel"
    aria-label="发布到正式题库"
    data-testid="review-publication-panel"
  >
    <header>
      <h3>发布到正式题库</h3>
      <span class="publication-tag">管理员确认 · 与试答分离</span>
    </header>
    <p>
      审核通过不等于发布，也不是专家准确度或信效度认证。正式发布将把本次题稿加入所选自助测评计划的题池。
    </p>
    <div class="publication-scope">
      <strong>同一平台中所有符合计划范围的学员，均可在下一次新建测评时随机抽到本题。</strong>
      <p>
        不只限于获指派试答的学员，也不保证每次都抽到。已开始的测评、固定试卷和独立题质试答保持不变。
      </p>
    </div>
    <p v-if="status !== 'reviewed'" class="blocked-note">
      当前题稿未满足审核通过、无退回且未换版的条件，不能正式发布新版本；若已有正式发布，下方仍保留历史回执。
    </p>
    <div class="publication-body">
      <div class="actions">
        <button
          type="button"
          class="secondary-button"
          data-testid="publication-refresh"
          :disabled="locked || loading || !!intent"
          @click="load"
        >
          {{ loading ? '正在读取发布预览…' : '重新读取发布预览' }}
        </button>
      </div>
      <p v-if="loading" role="status">正在核对发布状态、兼容计划与适用组织…</p>
      <p v-if="error" class="publication-error" role="alert">{{ error }}</p>
      <section v-if="receipt" class="publication-receipt" role="status" aria-label="正式发布回执">
        <h4>正式已发布</h4>
        <p>
          发布时间：{{ new Date(receipt.published_at).toLocaleString('zh-CN', { hour12: false }) }}
        </p>
        <p>
          正式题目版本：<code>{{ receipt.item_version_id }}</code>
        </p>
        <p v-if="receipt.rubric_version_id">
          评分量规版本：<code>{{ receipt.rubric_version_id }}</code>
        </p>
        <ul>
          <li v-for="target in receipt.targets" :key="target.blueprint_id">
            {{ target.name }} · 新计划版本 <code>{{ target.blueprint_id }}</code>
          </li>
        </ul>
        <p>以上为本次发布回执；学员新建测评时按当前启用计划抽题，现有作答与报告不变。</p>
      </section>
      <p v-else-if="publicationStatus === 'published'" class="publication-notice" role="status">
        正式已发布。暂未读取到完整发布回执，请重新读取发布预览；不会重复发布。
      </p>
      <template v-else-if="preview && status === 'reviewed'">
        <p class="publication-notice" role="status">
          {{ preview.eligible ? '审核通过 · 尚未正式发布' : '尚未正式发布 · 暂不满足发布条件' }}
        </p>
        <ul v-if="preview.issues.length" class="blocked-note">
          <li v-for="issue in preview.issues" :key="issue">{{ issue }}</li>
        </ul>
        <fieldset :disabled="locked || !!intent || !preview.eligible">
          <legend>选择接收题目的自助测评计划 · {{ compatibleTargets.length }} 个兼容计划</legend>
          <p v-if="!compatibleTargets.length">
            没有可接收此题的兼容计划，请先核对计划配置与题型要求。
          </p>
          <label v-for="target in compatibleTargets" :key="target.blueprint_id" class="target-row">
            <input
              v-model="selectedIds"
              type="checkbox"
              :value="target.blueprint_id"
              :data-testid="`publication-target-${target.blueprint_id}`"
              :disabled="locked || !!intent || !preview.eligible"
            />
            <span
              ><strong>{{ target.name }}</strong
              ><span class="target-meta"
                >{{ MODE_NAMES[target.mode] ?? target.mode }} ·
                {{ SCENARIO_NAMES[target.scenario] ?? target.scenario }} · v{{ target.version }} ·
                当前题池 {{ target.pool_size }} 道</span
              ><span class="target-meta"
                >适用组织：{{ target.organization_names.join('、') || '无可用组织' }}</span
              ></span
            >
          </label>
        </fieldset>
        <section v-if="excludedTargets.length" class="excluded-plans" aria-label="不兼容计划说明">
          <button
            type="button"
            class="text-button"
            data-testid="publication-excluded-toggle"
            :aria-expanded="excludedExpanded"
            :aria-controls="`publication-excluded-${packetId}`"
            @click="toggleExcluded"
          >
            {{ excludedExpanded ? '收起' : '查看' }}不可选计划（{{ excludedTargets.length }}）
          </button>
          <p>
            这些计划不满足题型、题池或发布范围等条件，不能选择；展开后可逐项核对具体原因，每页最多
            20 个。
          </p>
          <div v-if="excludedExpanded" :id="`publication-excluded-${packetId}`">
            <div class="excluded-list" role="region" aria-label="不可选计划列表" tabindex="0">
              <label
                v-for="target in visibleExcludedTargets"
                :key="target.blueprint_id"
                class="target-row"
              >
                <input
                  type="checkbox"
                  :data-testid="`publication-target-${target.blueprint_id}`"
                  disabled
                />
                <span
                  ><strong>{{ target.name }}</strong
                  ><span class="target-meta">
                    {{ MODE_NAMES[target.mode] ?? target.mode }} ·
                    {{ SCENARIO_NAMES[target.scenario] ?? target.scenario }} · v{{
                      target.version
                    }}
                    · 当前题池 {{ target.pool_size }} 道 </span
                  ><span class="target-meta"
                    >适用组织：{{ target.organization_names.join('、') || '无可用组织' }}</span
                  >
                  <span class="target-reason"
                    >不可选：{{ target.reason || '不满足兼容条件' }}</span
                  ></span
                >
              </label>
            </div>
            <nav v-if="excludedPageCount > 1" class="actions" aria-label="不可选计划分页">
              <button
                type="button"
                class="secondary-button"
                :disabled="excludedPage === 0"
                aria-label="不可选计划上一页"
                @click="excludedPage -= 1"
              >
                上一页
              </button>
              <span
                >第 {{ excludedPage + 1 }} / {{ excludedPageCount }} 页 · 共
                {{ excludedTargets.length }} 个</span
              >
              <button
                type="button"
                class="secondary-button"
                data-testid="publication-excluded-next"
                :disabled="excludedPage + 1 >= excludedPageCount"
                aria-label="不可选计划下一页"
                @click="excludedPage += 1"
              >
                下一页
              </button>
            </nav>
          </div>
        </section>
        <button
          type="button"
          class="secondary-button"
          data-testid="publication-prepare"
          :disabled="locked || loading || !!intent || !canPrepare"
          @click="prepare"
        >
          核对正式发布范围
        </button>
      </template>
      <section
        v-if="intent"
        class="publication-confirm"
        data-testid="publication-confirmation"
        aria-label="确认正式发布"
      >
        <h4>确认发布 {{ code }} · 修订 {{ revision }}</h4>
        <p>
          内容审核通过 {{ approvalCount }} /
          {{ requiredApprovals }}。将发布绑定摘要的本次审核题稿，形成正式题目与所选计划的新版本。
        </p>
        <p class="digest">
          题稿摘要：<code>{{ intent.body.expected_digest }}</code>
        </p>
        <ul>
          <li v-for="target in intent.targets" :key="target.blueprint_id">
            {{ target.name }} · 当前 v{{ target.version }} ·
            {{ target.organization_names.join('、') }}
          </li>
        </ul>
        <p>
          发布后，范围内学员无需试答指派，可在新的正式测评中随机抽取；本操作不代表专家准确度认证。
        </p>
        <p v-if="intent.attempted && !busy">
          发布结果尚未确认，计划与请求已锁定。请重试同一次发布，不会自动重发。
        </p>
        <div class="actions">
          <button
            v-if="!intent.attempted"
            type="button"
            class="secondary-button"
            data-testid="publication-cancel"
            :disabled="locked"
            @click="intent = null"
          >
            返回核对
          </button>
          <button
            type="button"
            class="primary-button"
            data-testid="publication-confirm"
            :disabled="locked"
            @click="publish"
          >
            {{ busy ? '正在发布…' : intent.attempted ? '重试同一次发布' : '确认发布' }}
          </button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.publication-panel {
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
.publication-tag {
  color: #137f91;
  background: #eaf5f7;
  border-radius: 7px;
  padding: 3px 8px;
  font-size: 12px;
}
.publication-scope {
  border-left: 3px solid #137f91;
  border-radius: 0 8px 8px 0;
  background: #eaf5f7;
  padding: 14px 16px;
  margin: 16px 0;
}
.publication-scope p {
  margin-bottom: 0;
}
.blocked-note,
.publication-receipt {
  border: 1px solid #d8e6ea;
  border-radius: 8px;
  padding: 14px 20px;
}
fieldset {
  border: 0;
  padding: 0;
  margin: 18px 0;
}
legend {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}
.target-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid #d8e6ea;
  border-radius: 9px;
  padding: 14px;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
input {
  accent-color: #137f91;
  min-width: 17px;
  height: 17px;
  margin: 4px 0 0;
}
.target-meta,
.target-reason {
  display: block;
  color: #5d727a;
  font-size: 13px;
}
.target-reason {
  color: #88501a;
}
.excluded-plans {
  margin: 16px 0;
}
.excluded-list {
  max-height: 360px;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.excluded-plans .actions {
  font-size: 13px;
}
.text-button {
  background: none;
  border: 0;
  padding: 4px 0;
  color: #137f91;
  font: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.excluded-list:focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
.publication-error,
.publication-notice {
  border-radius: 9px;
  padding: 13px 16px;
}
.publication-error {
  color: #923628;
  background: #fff0ed;
}
.publication-notice {
  color: #137f91;
  background: #eaf5f7;
}
.publication-confirm {
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
code {
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  overflow-wrap: anywhere;
}
ul {
  padding-left: 22px;
}
li + li {
  margin-top: 6px;
}
button {
  min-height: 40px;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
:is(button, input):focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
</style>
