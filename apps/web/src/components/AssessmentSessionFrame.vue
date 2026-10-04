<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ChevronLeft, Circle, ListChecks, Star, X } from '@lucide/vue'
import { DIMENSIONS, ASSESSMENT_REFERENCE_UI_ENABLED } from '../domain/capabilities'
import type { AssessmentItem } from '../services/assessmentApi'
import type { AssessmentWorkspace } from '../services/assessmentWorkspaceApi'
import AssessmentOriginNotice from './AssessmentOriginNotice.vue'

const props = withDefaults(
  defineProps<{
    workspace: AssessmentWorkspace | null
    item?: AssessmentItem | null
    readOnly?: boolean
    busy?: boolean
    endBusy?: boolean
    saveLabel?: string
    saveFailed?: boolean
    clockLabel?: string
    urgent?: boolean
    canSubmit?: boolean
    submitLabel?: string
    error?: string
  }>(),
  {
    item: null,
    readOnly: false,
    busy: false,
    endBusy: false,
    saveLabel: '',
    saveFailed: false,
    clockLabel: '',
    urgent: false,
    canSubmit: false,
    submitLabel: '提交回答并继续',
    error: '',
  },
)
const emit = defineEmits<{
  exit: []
  finish: []
  abandon: []
  flag: []
  review: [id: string]
  current: []
  submit: []
  support: []
}>()
const railDialog = ref<HTMLDialogElement | null>(null)
const labels = { objective: '客观题', dialogue: '对话测评', practical: '实操任务' }
const types = ['objective', 'dialogue', 'practical'] as const
// Keep any issued historical evidence visible, even if a legacy minimum is zero.
const visibleTypes = computed(() =>
  types.filter(
    (type) =>
      (coverage(type)?.minimum ?? 0) > 0 ||
      (coverage(type)?.answered_count ?? 0) > 0 ||
      props.workspace?.items.some((entry) => entry.item_type === type) ||
      props.item?.item_type === type ||
      props.workspace?.current_item?.item_type === type,
  ),
)
const singleType = computed(() => visibleTypes.value.length === 1)
const maximum = computed(() => props.workspace?.max_items ?? 0)
const answered = computed(() => props.workspace?.answered_count ?? 0)
const percentage = computed(() =>
  maximum.value ? Math.min(100, Math.round((answered.value / maximum.value) * 100)) : 0,
)
const fixed = computed(() => props.workspace?.session.mode === 'fixed')
const exactTypeTotals = computed(
  () =>
    fixed.value &&
    maximum.value > 0 &&
    props.workspace?.type_coverage.reduce((total, entry) => total + entry.minimum, 0) ===
      maximum.value,
)
const paused = computed(() => Boolean(props.workspace?.session.paused_at))
const canWork = computed(() => props.workspace?.session.status === 'active' && !paused.value)
const pendingIssued = computed(() =>
  Math.max(0, (props.workspace?.dispatched_count ?? 0) - answered.value),
)
const progressText = computed(() =>
  fixed.value
    ? `已回答 ${answered.value}/${maximum.value} 题`
    : `已完成 ${answered.value} 题，最多 ${maximum.value} 题`,
)
const flagged = computed(
  () =>
    props.workspace?.items.find((entry) => entry.item_version_id === props.item?.item_version_id)
      ?.flagged ?? false,
)
const previous = computed(
  () =>
    props.workspace?.items
      .filter((entry) => entry.sequence < (props.item?.sequence ?? 0))
      .slice(-1)[0],
)
const dimension = computed(
  () => DIMENSIONS.find((entry) => entry.code === props.item?.dimension_code)?.name ?? '',
)
const targetLevel = computed(() =>
  /^L[1-4]$/.test(String(props.item?.configuration.target_level ?? ''))
    ? props.item?.configuration.target_level
    : '',
)
const focus = computed(() => {
  const value = props.item?.configuration.evidence_focus
  return Array.isArray(value)
    ? value.filter((line): line is string => typeof line === 'string')
    : []
})
const groups = computed(() => [
  ...visibleTypes.value.map((type) => ({
    label: labels[type],
    entries: (props.workspace?.items ?? [])
      .filter((entry) => entry.item_type === type)
      .map((entry) => ({ ...entry, issued: true })),
  })),
  {
    label: '待派发',
    entries: Array.from(
      {
        length:
          props.workspace?.session.status === 'active' && !props.workspace.can_complete
            ? Math.max(0, maximum.value - (props.workspace?.dispatched_count ?? 0))
            : 0,
      },
      (_, i) => ({
        sequence: (props.workspace?.dispatched_count ?? 0) + i + 1,
        item_version_id: '',
        answered_at: null,
        flagged: false,
        issued: false,
      }),
    ),
  },
])
function coverage(type: AssessmentItem['item_type']) {
  return props.workspace?.type_coverage.find((entry) => entry.item_type === type)
}
function coverageReached(type: AssessmentItem['item_type']) {
  const value = coverage(type)
  return Boolean(value && value.minimum > 0 && value.answered_count >= value.minimum)
}
function coverageText(type: AssessmentItem['item_type']) {
  const value = coverage(type)
  const count = value?.answered_count ?? 0
  if (!value?.minimum) return `已完成 ${count} 题`
  return exactTypeTotals.value && count <= value.minimum
    ? `${count}/${value.minimum} 题`
    : `已完成 ${count} 题 · 至少 ${value.minimum} 题`
}
function inspect(id: string) {
  if (railDialog.value?.open) railDialog.value.close()
  emit('review', id)
}
function support() {
  if (railDialog.value?.open) railDialog.value.close()
  emit('support')
}
</script>

<template>
  <section
    class="assessment-frame"
    :class="{ 'is-review': readOnly, 'plain-layout': !ASSESSMENT_REFERENCE_UI_ENABLED }"
  >
    <header class="exam-session-toolbar" data-testid="assessment-session-toolbar">
      <div class="exam-session-identity">
        <button class="exam-back" type="button" @click="emit('exit')">
          <ChevronLeft :size="24" /><span>返回工作台</span>
        </button>
        <span class="exam-toolbar-divider"></span>
        <strong>{{ workspace?.blueprint_name || '能力测评' }}</strong>
        <span
          class="exam-save-state"
          :class="{
            failed: saveFailed,
            confirmed: saveLabel === '草稿已保存' || saveLabel === '回答已提交',
          }"
          role="status"
          ><i></i>{{ saveLabel || '正在恢复测评' }}</span
        >
      </div>
      <div class="exam-session-actions">
        <span class="exam-clock" :class="{ urgent }">{{ clockLabel || '时间待同步' }}</span>
        <span class="exam-toolbar-divider"></span>
        <button class="exam-outline" type="button" :disabled="busy" @click="emit('exit')">
          {{ paused || workspace?.session.status !== 'active' ? '返回工作台' : '暂存退出' }}
        </button>
        <button
          v-if="workspace?.session.status === 'active'"
          class="exam-outline"
          type="button"
          data-testid="early-end-assessment"
          :disabled="endBusy"
          @click="emit('abandon')"
        >
          提前结束
        </button>
        <button
          v-if="workspace?.session.status === 'active'"
          class="exam-outline exam-finish"
          type="button"
          :disabled="busy || !canWork"
          @click="emit('finish')"
        >
          完成测试
        </button>
      </div>
    </header>
    <AssessmentOriginNotice
      class="exam-origin-note"
      :origin="workspace?.data_origin ?? workspace?.session.data_origin"
    />
    <div
      v-if="visibleTypes.length"
      class="exam-coverage"
      :class="{ 'single-type': singleType }"
      data-testid="assessment-coverage"
      aria-label="本次测评题型覆盖情况"
    >
      <span v-if="singleType" class="exam-coverage-caption">本次仅含</span>
      <template v-for="(type, index) in visibleTypes" :key="type">
        <i v-if="index" class="exam-coverage-line" aria-hidden="true"></i>
        <div
          class="exam-coverage-step"
          :class="{
            covered: coverageReached(type),
            active: item?.item_type === type,
          }"
        >
          <span v-if="!singleType" class="exam-step-square" aria-hidden="true"
            ><Check v-if="coverageReached(type)" :size="21" /><Circle v-else :size="12"
          /></span>
          <span
            >{{ labels[type] }}<strong>{{ coverageText(type) }}</strong></span
          >
        </div>
      </template>
    </div>
    <div v-if="error" class="exam-error" role="alert">{{ error }}<slot name="error-action" /></div>
    <div class="exam-columns">
      <div class="exam-main">
        <div v-if="!item && workspace?.items.length" class="exam-review-navigation">
          <button class="exam-mobile-rail" type="button" @click="railDialog?.showModal()">
            <ListChecks :size="18" />题目导航
          </button>
        </div>
        <div v-if="item" class="exam-question-meta">
          <span class="exam-type-tag">{{
            item.item_type === 'dialogue' ? '对话题' : labels[item.item_type]
          }}</span>
          <span>第{{ item.sequence }}题/{{ fixed ? '共' : '最多' }}{{ maximum }}题</span>
          <span :title="targetLevel ? '题目目标等级，并非学员能力等级' : undefined"
            >{{ dimension }}<template v-if="targetLevel"> · {{ targetLevel }}</template></span
          >
          <button
            type="button"
            class="exam-flag"
            data-testid="flag-question"
            :class="{ flagged }"
            :aria-pressed="flagged"
            :disabled="busy || !canWork"
            @click="emit('flag')"
          >
            <Star :size="20" :fill="flagged ? 'currentColor' : 'none'" />{{
              flagged ? '已标记检查' : '标记稍后检查'
            }}
          </button>
          <button class="exam-mobile-rail" type="button" @click="railDialog?.showModal()">
            <ListChecks :size="18" />题目导航
          </button>
        </div>
        <div v-if="readOnly && item" class="exam-review-note">
          只读回看 · 已提交答案不可修改<button
            v-if="workspace?.session.status === 'active'"
            type="button"
            @click="emit('current')"
          >
            {{ paused ? '返回暂存页面' : '返回当前题' }}
          </button>
        </div>
        <div class="exam-answer-body"><slot /></div>
        <footer v-if="item" class="exam-answer-footer">
          <button
            type="button"
            class="exam-previous"
            :disabled="!previous || busy"
            @click="previous && emit('review', previous.item_version_id)"
          >
            上一题
          </button>
          <span>{{ readOnly ? '历史记录只读' : 'Ctrl+Enter快捷提交' }}</span>
          <button
            v-if="readOnly && workspace?.session.status === 'active'"
            class="exam-submit"
            type="button"
            @click="emit('current')"
          >
            {{ paused ? '返回暂存页面' : '返回当前题' }}
          </button>
          <button
            v-else-if="!readOnly"
            class="exam-submit"
            data-testid="submit-current-answer"
            type="button"
            :disabled="!canSubmit || busy || !canWork"
            @click="emit('submit')"
          >
            {{ busy ? '正在处理…' : submitLabel }}
          </button>
        </footer>
      </div>
      <aside class="exam-side-rail" aria-label="答题进度与证据">
        <div class="exam-rail-progress">
          <h2 :title="`${progressText}；题型条为最低覆盖要求，不是顺序阶段`">
            答题进度 <strong>{{ fixed ? `${percentage}%` : `${answered}/${maximum}` }}</strong>
          </h2>
          <progress
            :value="answered"
            :max="maximum || 1"
            :aria-label="fixed ? '固定卷完成比例' : '已完成题数占题量上限'"
            :title="progressText"
          ></progress>
          <div class="exam-legend" title="标记可以与已回答重叠，不改变作答进度">
            <span><i></i>已回答{{ answered }}</span
            ><span><i></i>标记{{ workspace?.flagged_count ?? 0 }}</span
            ><span><i></i>当前待答{{ pendingIssued }}</span>
          </div>
          <p class="exam-progress-caption">
            {{ progressText }}<br />{{
              fixed ? '标记可与已回答重叠' : '题量上限不等于必答题数，满足完成条件后可结束'
            }}
          </p>
        </div>
        <nav
          class="exam-item-navigation"
          data-testid="assessment-navigation"
          aria-label="已派发题目只读导航"
        >
          <h2>题目导航</h2>
          <div v-for="group in groups" :key="group.label" class="exam-question-group">
            <template v-if="group.entries.length"
              ><h3>{{ group.label }}</h3>
              <div class="exam-question-numbers">
                <button
                  v-for="entry in group.entries"
                  :key="entry.sequence"
                  type="button"
                  :data-testid="`question-${entry.sequence}`"
                  :disabled="!entry.issued || busy"
                  :class="{
                    answered: entry.answered_at,
                    current: entry.item_version_id === item?.item_version_id,
                    flagged: entry.flagged,
                  }"
                  :aria-current="
                    entry.item_version_id === item?.item_version_id ? 'step' : undefined
                  "
                  :aria-label="`第${entry.sequence}题，${entry.issued ? (entry.answered_at ? '已回答，只读查看' : '当前未完成题') : '尚未派发'}${entry.flagged ? '，已标记' : ''}`"
                  @click="inspect(entry.item_version_id)"
                >
                  {{ entry.sequence }}
                </button>
              </div></template
            >
          </div>
        </nav>
        <section v-if="focus.length" class="exam-evidence-focus">
          <h2>本题采集的能力证据</h2>
          <ul>
            <li v-for="line in focus" :key="line"><Circle :size="11" />{{ line }}</li>
          </ul>
          <p class="exam-scoring-note">评分将在测评完成后进行</p>
        </section>
        <p class="exam-support">
          遇到技术问题？<button type="button" @click="emit('support')">联系支持</button>
        </p>
      </aside>
    </div>
    <dialog ref="railDialog" class="exam-mobile-dialog" aria-label="题目导航与能力证据">
      <header>
        <h2>题目导航</h2>
        <button type="button" aria-label="关闭题目导航" @click="railDialog?.close()">
          <X :size="22" />
        </button>
      </header>
      <p>{{ progressText }}</p>
      <div v-for="group in groups" :key="group.label" class="exam-question-group">
        <template v-if="group.entries.length"
          ><h3>{{ group.label }}</h3>
          <div class="exam-question-numbers">
            <button
              v-for="entry in group.entries"
              :key="entry.sequence"
              type="button"
              :disabled="!entry.issued || busy"
              :class="{
                answered: entry.answered_at,
                current: entry.item_version_id === item?.item_version_id,
              }"
              :aria-label="`第${entry.sequence}题，${entry.issued ? (entry.answered_at ? '已回答，只读查看' : '当前未完成题') : '尚未派发'}${entry.flagged ? '，已标记' : ''}`"
              @click="inspect(entry.item_version_id)"
            >
              {{ entry.sequence }}
            </button>
          </div></template
        >
      </div>
      <h2 v-if="focus.length">本题能力证据</h2>
      <p v-for="line in focus" :key="line">{{ line }}</p>
      <button type="button" @click="support">联系支持</button>
    </dialog>
  </section>
</template>

<style scoped>
.assessment-frame {
  --exam-u: clamp(0.88px, 0.06527415vw, 1.12px);
  --exam-teal: #219bac;
  --exam-muted: #777e82;
  --exam-line: #c5c7c9;
  min-height: calc(100dvh - var(--reference-toolbar, 73px));
  background: #fff;
  color: #505456;
  font-size: calc(16 * var(--exam-u));
}
.assessment-frame button {
  font: inherit;
  cursor: pointer;
}
.exam-origin-note {
  margin: 10px calc(32 * var(--exam-u));
}
.assessment-frame button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}
.visually-hidden {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  white-space: nowrap !important;
  border: 0 !important;
}
.plain-layout .exam-columns {
  grid-template-columns: minmax(0, 1fr);
}
.plain-layout .exam-main {
  padding: 20px;
}
.plain-layout .exam-side-rail {
  border-top: 1px solid #bfc6ca;
  border-left: 0;
}
.plain-layout .exam-answer-body,
.plain-layout .exam-answer-footer {
  margin-left: 56px;
}
.plain-layout .exam-answer-footer {
  margin-top: 32px;
  padding-bottom: 24px;
}
.assessment-frame button:focus-visible {
  outline: 3px solid #137f91;
  outline-offset: 3px;
}
.exam-session-toolbar {
  min-height: calc(73 * var(--exam-u));
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: calc(12 * var(--exam-u)) calc(33 * var(--exam-u));
  border-bottom: 1px solid var(--exam-line);
}
.exam-session-identity,
.exam-session-actions {
  display: flex;
  align-items: center;
  gap: calc(19 * var(--exam-u));
  min-width: 0;
}
.exam-session-identity > strong {
  font-size: calc(18 * var(--exam-u));
  font-weight: 650;
  max-width: 26ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.exam-back {
  display: flex;
  align-items: center;
  gap: calc(14 * var(--exam-u));
  white-space: nowrap;
  border: 0;
  padding: 0;
  background: none;
  color: #818587;
  font-weight: 650 !important;
}
.exam-toolbar-divider {
  width: 1px;
  align-self: stretch;
  min-height: 32px;
  background: var(--exam-line);
}
.exam-save-state {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  font-size: calc(14 * var(--exam-u));
  font-weight: 600;
  color: var(--exam-muted);
}
.exam-save-state i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #87989d;
}
.exam-save-state.confirmed i {
  background: #21c646;
}
.exam-save-state.failed {
  color: #a33b30;
}
.exam-save-state.failed i {
  background: currentColor;
}
.exam-clock {
  font-size: calc(16 * var(--exam-u));
  font-weight: 600;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.exam-clock.urgent {
  color: #bf332c;
}
.exam-outline {
  height: calc(35 * var(--exam-u));
  padding: 0 calc(17 * var(--exam-u));
  border: 1px solid #929696;
  border-radius: 9px;
  background: white;
  font-size: calc(13 * var(--exam-u)) !important;
  white-space: nowrap;
}
.exam-finish {
  border-color: #ff3838;
  color: #ed3333;
}
.exam-coverage {
  min-height: calc(82 * var(--exam-u));
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(30 * var(--exam-u));
  border-bottom: 1px solid var(--exam-line);
  padding: 12px calc(33 * var(--exam-u));
  flex-wrap: wrap;
}
.exam-coverage.single-type {
  min-height: calc(60 * var(--exam-u));
  justify-content: flex-start;
  gap: 12px;
}
.exam-coverage-caption {
  color: var(--exam-muted);
  font-size: 13px;
}
.single-type .exam-coverage-step > span:last-child {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  column-gap: 18px;
  row-gap: 4px;
  color: var(--exam-teal);
}
.exam-coverage-step {
  display: flex;
  align-items: center;
  gap: calc(15 * var(--exam-u));
  color: #85898b;
  font-size: calc(14 * var(--exam-u));
  font-weight: 650;
}
.exam-coverage-step > span:last-child {
  display: grid;
  gap: 2px;
}
.exam-coverage-step strong {
  font-size: calc(14 * var(--exam-u));
  line-height: 1.5;
  font-variant-numeric: tabular-nums;
}
.exam-coverage-step small {
  margin-left: 5px;
  font-size: 11px;
  font-weight: 400;
}
.exam-step-square {
  width: calc(30 * var(--exam-u));
  height: calc(30 * var(--exam-u));
  display: grid;
  place-items: center;
  border: 1px solid #bbb;
  font-size: calc(18 * var(--exam-u));
}
.exam-coverage-step.covered .exam-step-square,
.exam-coverage-step.active .exam-step-square {
  border-color: #acd3d9;
  background: #58b1c0;
  color: white;
}
.exam-coverage-line {
  width: calc(89 * var(--exam-u));
  height: 4px;
  background: #b0dce3;
}
.exam-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) calc(297 * var(--exam-u));
  min-height: calc(100dvh - var(--reference-toolbar, 73px) - 155 * var(--exam-u));
}
.exam-main {
  min-width: 0;
  padding: 0 calc(93 * var(--exam-u)) 0 calc(33 * var(--exam-u));
  display: flex;
  flex-direction: column;
}
.exam-question-meta {
  min-height: calc(76 * var(--exam-u));
  display: flex;
  align-items: flex-start;
  padding-top: calc(14 * var(--exam-u));
  gap: calc(16 * var(--exam-u));
  font-weight: 600;
  color: var(--exam-muted);
  font-size: calc(15 * var(--exam-u));
}
.exam-question-meta > span:not(.exam-type-tag) {
  padding-top: 7px;
}
.exam-type-tag {
  display: grid;
  place-items: center;
  min-width: calc(86 * var(--exam-u));
  height: calc(34 * var(--exam-u));
  background: #68bbc8;
  border-radius: 4px;
  font-size: calc(13 * var(--exam-u));
  color: white;
}
.exam-question-meta > span:nth-child(3) {
  margin-left: calc(20 * var(--exam-u));
  white-space: nowrap;
}
.exam-flag {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 0;
  border: 0;
  background: none;
  white-space: nowrap;
  color: #85898b;
}
.exam-flag.flagged {
  color: #a16b14;
}
.exam-mobile-rail {
  display: none;
}
.exam-review-navigation {
  display: none;
}
.exam-answer-body {
  margin-left: calc(56 * var(--exam-u));
  flex: 1;
  min-width: 0;
}
.exam-answer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--exam-line);
  margin-top: calc(90 * var(--exam-u));
  margin-left: calc(56 * var(--exam-u));
  padding: calc(49 * var(--exam-u)) 0 calc(74 * var(--exam-u));
  font-size: calc(15 * var(--exam-u));
  font-weight: 600;
  color: #85898b;
}
.exam-previous,
.exam-submit {
  min-height: calc(38 * var(--exam-u));
  padding: 8px 12px;
  border: 0;
  border-radius: 4px;
  color: white;
}
.exam-previous {
  min-width: calc(89 * var(--exam-u));
  background: #8da2d1;
}
.exam-submit {
  background: var(--exam-teal);
  font-size: calc(14 * var(--exam-u)) !important;
}
.exam-review-note {
  padding: 12px;
  background: #ebf6f9;
  margin-bottom: 20px;
}
.exam-review-note button {
  border: 0;
  background: transparent;
  text-decoration: underline;
  color: #137f91;
  margin-left: 12px;
}
.exam-error {
  padding: 14px 33px;
  background: #fff1ed;
  color: #a63f32;
  line-height: 1.7;
}
.exam-side-rail {
  border-left: 1px solid var(--exam-line);
  padding: calc(20 * var(--exam-u));
  font-size: calc(13 * var(--exam-u));
  min-width: 0;
}
.exam-side-rail h2 {
  font-size: calc(15 * var(--exam-u));
  letter-spacing: 0;
  line-height: 1.5;
  font-weight: 650;
}
.exam-rail-progress h2 {
  display: flex;
  justify-content: space-between;
  margin-bottom: 12px;
}
.exam-rail-progress h2 strong {
  color: #507ff0;
  font-variant-numeric: tabular-nums;
}
.exam-rail-progress progress {
  display: block;
  width: 100%;
  height: 5px;
  border: 0;
  border-radius: 9px;
  background: #e9e9eb;
  overflow: hidden;
}
.exam-rail-progress progress::-webkit-progress-bar {
  background: #e9e9eb;
}
.exam-rail-progress progress::-webkit-progress-value {
  background: #2a89ff;
  border-radius: 9px;
}
.exam-rail-progress progress::-moz-progress-bar {
  background: #2a89ff;
}
.exam-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
  color: var(--exam-muted);
  font-size: calc(12 * var(--exam-u));
  font-weight: 600;
}
.exam-legend span {
  display: flex;
  align-items: center;
  gap: 5px;
}
.exam-legend i {
  width: 8px;
  height: 8px;
  background: #2aa5b2;
}
.exam-legend span:nth-child(2) i {
  background: #ffbb48;
}
.exam-legend span:nth-child(3) i {
  background: #929696;
}
.exam-progress-caption {
  font-size: 11px;
  color: #7b8285;
  line-height: 1.5;
  margin-top: 8px;
}
.exam-item-navigation {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--exam-line);
}
.exam-question-group h3 {
  font-size: calc(13 * var(--exam-u));
  font-weight: 600;
  color: var(--exam-muted);
  margin: 8px 0 7px;
}
.exam-question-numbers {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: calc(12 * var(--exam-u));
}
.exam-question-numbers button {
  position: relative;
  min-height: calc(22 * var(--exam-u));
  line-height: calc(18 * var(--exam-u));
  padding: 1px 0;
  background: white;
  border: 1px solid #bbb;
  border-radius: 5px;
  color: #7d868b;
  font-size: calc(13 * var(--exam-u));
}
.exam-question-numbers button:disabled {
  opacity: 1;
}
.exam-question-numbers button.answered {
  background: #b4dce2;
  color: #208c9c;
}
.exam-question-numbers button.current {
  background: #5582df;
  color: #fff;
  font-weight: 700;
}
.exam-question-numbers button.flagged:after {
  content: '';
  position: absolute;
  right: -2px;
  top: -2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffbd44;
}
.exam-evidence-focus {
  border-top: 1px solid var(--exam-line);
  margin-top: calc(25 * var(--exam-u));
  padding-top: calc(19 * var(--exam-u));
}
.exam-evidence-focus ul {
  list-style: none;
  padding: 0;
  margin: 7px 0;
}
.exam-evidence-focus li {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  line-height: 1.8;
  font-size: calc(12 * var(--exam-u));
}
.exam-evidence-focus li svg {
  flex: none;
  margin-top: 5px;
}
.exam-evidence-focus > p {
  font-size: 12px;
  color: var(--exam-muted);
  line-height: 1.7;
  margin-top: 8px;
}
.exam-evidence-focus .exam-scoring-note {
  margin-top: calc(25 * var(--exam-u));
  padding-bottom: 14px;
  border-bottom: 1px solid var(--exam-line);
}
.exam-support {
  text-align: center;
  margin-top: calc(29 * var(--exam-u));
  font-size: 11px;
  color: #7b8285;
}
.exam-support button {
  padding: 5px 0;
  border: 0;
  background: none;
  color: #477feb;
  font-size: 11px;
}
.exam-mobile-dialog {
  position: fixed;
  inset: 0 0 0 auto;
  max-height: none;
  height: 100dvh;
  width: min(350px, 94vw);
  margin: 0;
  border: 0;
  border-left: 1px solid var(--exam-line);
  padding: 24px;
}
.exam-mobile-dialog::backdrop {
  background: #183b4655;
}
.exam-mobile-dialog > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.exam-mobile-dialog > header button {
  border: 0;
  background: none;
}
.exam-mobile-dialog > h2 {
  font-size: 17px;
  margin-top: 25px;
}
.exam-mobile-dialog > p {
  font-size: 13px;
  margin: 12px 0;
}
.exam-mobile-dialog .exam-question-numbers {
  gap: 9px;
}
.exam-mobile-dialog .exam-question-numbers button {
  min-height: 40px;
}
@media (max-width: 1399px) {
  .exam-session-identity {
    gap: 12px;
  }
  .exam-save-state {
    max-width: 12ch;
    white-space: normal;
  }
  .exam-session-actions {
    gap: 12px;
  }
  .exam-main {
    padding-right: 36px;
  }
  .exam-coverage {
    gap: 20px;
  }
  .exam-coverage-line {
    width: 65px;
  }
  .exam-question-meta > span:nth-child(3) {
    margin-left: 0;
  }
  .exam-answer-body,
  .exam-answer-footer {
    margin-left: 44px;
  }
  .exam-flag {
    font-size: 13px !important;
  }
  .exam-side-rail {
    padding: 18px;
  }
  .exam-columns {
    grid-template-columns: minmax(0, 1fr) 270px;
  }
}
@media (max-width: 1100px) {
  .exam-columns {
    grid-template-columns: minmax(0, 1fr);
  }
  .exam-side-rail {
    display: none;
  }
  .exam-mobile-rail {
    display: flex;
    gap: 5px;
    align-items: center;
    background: none;
    border: 0;
    color: #208c9c;
    white-space: nowrap;
    padding: 7px 0;
  }
  .exam-review-navigation {
    display: flex;
    justify-content: flex-end;
    padding: 16px 0;
  }
  .exam-session-toolbar {
    flex-wrap: wrap;
    gap: 12px;
  }
  .exam-session-identity {
    flex: 1;
  }
  .exam-session-actions {
    margin-left: auto;
  }
  .exam-main {
    padding: 0 28px;
  }
  .exam-answer-footer {
    padding-bottom: 40px;
    margin-top: 60px;
  }
  .exam-question-meta {
    flex-wrap: wrap;
    gap: 12px;
    padding-bottom: 16px;
  }
  .exam-flag {
    margin-left: auto;
  }
}
@media (max-width: 600px) {
  .assessment-frame {
    font-size: 14px;
  }
  .exam-session-toolbar {
    padding: 12px 16px;
  }
  .exam-session-identity {
    flex-wrap: wrap;
    gap: 8px;
  }
  .exam-session-identity > strong {
    font-size: 15px;
    max-width: 20ch;
  }
  .exam-back {
    font-size: 13px !important;
    gap: 3px;
  }
  .exam-save-state {
    font-size: 12px;
    max-width: none;
    flex-basis: 100%;
    white-space: normal;
  }
  .exam-session-actions {
    margin: 0;
    width: 100%;
    justify-content: space-between;
    gap: 8px;
  }
  .exam-outline {
    min-height: 40px;
    padding: 0 12px;
  }
  .exam-clock {
    font-size: 13px;
  }
  .exam-session-actions .exam-toolbar-divider {
    display: none;
  }
  .exam-coverage {
    gap: 10px;
    padding: 15px 10px;
    min-height: 80px;
  }
  .exam-coverage:not(.single-type) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    padding: 15px 16px;
  }
  .exam-coverage-line {
    display: none;
  }
  .exam-coverage-step {
    gap: 7px;
    font-size: 12px;
  }
  .exam-coverage:not(.single-type) .exam-coverage-step > span:last-child {
    display: flex;
    flex: 1;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 8px;
  }
  .exam-coverage-step strong {
    font-size: 12px;
  }
  .exam-coverage-step small {
    display: block;
    font-size: 10px;
    margin: 2px 0 0;
  }
  .exam-step-square {
    width: 25px;
    height: 25px;
  }
  .exam-main {
    padding: 0 16px;
  }
  .exam-question-meta {
    gap: 10px;
    min-height: 100px;
    font-size: 12px;
    align-items: center;
    padding: 14px 0;
  }
  .exam-question-meta > span:not(.exam-type-tag) {
    padding-top: 0;
  }
  .exam-type-tag {
    min-width: 65px;
    height: 30px;
    font-size: 12px;
  }
  .exam-flag {
    margin-left: 0;
    font-size: 12px !important;
    min-height: 40px;
  }
  .exam-mobile-rail {
    margin-left: auto;
    font-size: 12px !important;
    min-height: 40px;
  }
  .exam-answer-body,
  .exam-answer-footer {
    margin-left: 0;
  }
  .exam-answer-footer {
    padding: 22px 0 28px;
    margin-top: 44px;
    flex-wrap: wrap;
  }
  .exam-answer-footer > span {
    order: 3;
    flex-basis: 100%;
    text-align: center;
    font-size: 12px;
    margin-top: 5px;
  }
  .exam-previous,
  .exam-submit {
    min-height: 44px;
  }
  .exam-error {
    padding: 12px 16px;
  }
}
</style>
