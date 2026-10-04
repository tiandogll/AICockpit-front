<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Check, LockKeyhole, X } from '@lucide/vue'
import type { TrainingPlan, TrainingTask } from '../services/trainingApi'
import { trainingUnavailableReason } from '../services/trainingApi'
import { dimensionLabels, formatWorkspaceDate } from '../services/workspaceApi'
import TrainingTaskReview from './TrainingTaskReview.vue'
const props = defineProps<{ plan: TrainingPlan }>()
const emit = defineEmits<{ start: [] }>()
const current = computed(() => props.plan.tasks.find((task) => task.status === 'pending'))
const percent = computed(() =>
  props.plan.total_tasks > 0
    ? Math.min(100, (props.plan.completed_tasks / props.plan.total_tasks) * 100)
    : 0,
)
const review = ref<TrainingTask | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const showRules = ref(false)
const kinds = {
  learning: '方法学习',
  exercise: '针对练习',
  application: '应用核验',
  retest: '正式复测',
}
function openTask(task: TrainingTask) {
  if (task.id === current.value?.id && !props.plan.privacy_redacted) {
    emit('start')
    return
  }
  review.value = task
  showRules.value = false
  dialog.value?.showModal()
}
function rules() {
  review.value = null
  showRules.value = true
  dialog.value?.showModal()
}
function continueCurrent() {
  if (!current.value || props.plan.privacy_redacted) return
  dialog.value?.close()
  emit('start')
}
watch(
  () => props.plan.id,
  () => {
    dialog.value?.close?.()
    review.value = null
    showRules.value = false
  },
)
</script>
<template>
  <section class="training-overview" aria-label="训练计划概览">
    <p v-if="plan.data_origin === 'synthetic'" class="origin-notice">
      合成演示记录：用于验证训练流程，不是你的真实学习成果，也不计入正式能力统计。
    </p>
    <div class="target-band">
      <div class="target-copy">
        <span class="overline">当前提升目标</span>
        <h2>
          提升「{{
            plan.dimensions.map((d) => dimensionLabels[d.code] ?? d.code).join('、')
          }}」<br />让核验成为习惯
        </h2>
        <p>依据已定稿报告安排学习、练习、应用核验与正式复测。</p>
        <div class="target-meta">
          <strong
            >{{ plan.completed_tasks }} / {{ plan.total_tasks }}<small>任务已完成</small></strong
          ><strong>R{{ plan.source_report_revision }}<small>来源报告修订</small></strong
          ><strong
            >{{ plan.status === 'completed' ? '完成' : '进行中' }}<small>计划状态</small></strong
          >
        </div>
      </div>
      <div class="target-road">
        <div class="road-progress">
          <span
            ><b>{{ plan.completed_tasks }}</b
            >已完成</span
          ><progress
            :value="plan.completed_tasks"
            :max="Math.max(1, plan.total_tasks)"
            aria-label="计划任务完成进度"
          /><span
            ><b>{{ plan.total_tasks }}</b
            >总任务</span
          >
        </div>
        <div class="road-stages">
          <button
            v-for="task in plan.tasks"
            :key="task.id"
            :class="{ current: task.id === current?.id }"
            @click="openTask(task)"
          >
            <small>阶段 {{ task.sequence }}</small
            ><strong>{{ kinds[task.kind] }}</strong
            ><span>{{
              task.status === 'completed'
                ? '已完成 · 可回顾'
                : task.id === current?.id
                  ? '当前任务'
                  : '待前项完成 · 可预览'
            }}</span
            ><Check v-if="task.status === 'completed'" :size="18" />
          </button>
        </div>
      </div>
    </div>
    <div class="overview-columns">
      <section class="overview-panel today-panel">
        <span class="overline">PERSONAL GROWTH PATH</span>
        <h2>当前训练</h2>
        <div v-if="current && !plan.privacy_redacted" class="today-task">
          <b class="task-no">{{ String(current.sequence).padStart(2, '0') }}</b>
          <div>
            <span class="task-kind">{{ kinds[current.kind] }}</span>
            <h3>{{ current.title }}</h3>
            <p>{{ current.content.instructions }}</p>
            <small>按顺序完成 · 提交后保留记录 · 不改变正式成绩</small>
          </div>
          <button class="overview-primary" @click="emit('start')">
            {{ current.kind === 'retest' ? '查看复测' : '开始训练' }} <ArrowRight :size="15" />
          </button>
        </div>
        <p v-else class="overview-empty">
          {{
            plan.privacy_redacted
              ? '训练证据已进行隐私处理，当前只读。'
              : '本计划任务已完成，能力变化以正式复测结果为准。'
          }}
        </p>
        <header class="task-list-heading">
          <h3>计划任务</h3>
          <span>按建议顺序完成</span>
        </header>
        <div class="overview-task-list">
          <div v-for="task in plan.tasks" :key="task.id" class="overview-task-row">
            <span class="task-state" :class="{ done: task.status === 'completed' }"
              ><Check v-if="task.status === 'completed'" :size="18" /><template v-else>{{
                task.sequence
              }}</template></span
            >
            <div>
              <strong>{{ task.title }}</strong
              ><small
                >{{ kinds[task.kind] }} ·
                {{
                  task.completed_at
                    ? formatWorkspaceDate(task.completed_at)
                    : task.id === current?.id
                      ? '当前可执行'
                      : '待前项完成'
                }}</small
              >
            </div>
            <button @click="openTask(task)">
              {{
                task.status === 'completed'
                  ? '回顾'
                  : task.id === current?.id && !plan.privacy_redacted
                    ? '开始'
                    : '预览'
              }}
            </button>
          </div>
        </div>
      </section>
      <aside class="overview-side">
        <section class="overview-panel">
          <h3>训练依据</h3>
          <RouterLink :to="`/reports/${plan.source_session_id}`"
            >查看能力报告 <ArrowRight :size="14"
          /></RouterLink>
          <div v-for="dimension in plan.dimensions" :key="dimension.code" class="basis-row">
            <div>
              <span>{{ dimensionLabels[dimension.code] ?? dimension.code }}</span
              ><strong>{{
                dimension.index === null ? '证据不足' : dimension.index.toFixed(1)
              }}</strong>
            </div>
            <progress
              v-if="dimension.index !== null"
              :value="dimension.index"
              max="100"
              :aria-label="`${dimensionLabels[dimension.code]}来源指数`"
            /><small>{{ dimension.evidence_count }} 项证据 · 来源报告指数，非训练后成绩</small>
          </div>
          <p v-if="plan.source_report_changed" class="overview-warning">
            来源报告已更新，本计划仍保留原修订快照。
          </p>
        </section>
        <section class="overview-panel">
          <h3>任务完成进度</h3>
          <p class="completion-value">{{ percent.toFixed(0) }}<small>%</small></p>
          <progress
            :value="plan.completed_tasks"
            :max="Math.max(1, plan.total_tasks)"
            aria-label="已完成任务占比"
          />
          <p>完成记录真实保存；学习时长和每周日程尚未启用，不显示估算值。</p>
        </section>
        <section class="overview-panel retest-panel">
          <span class="overline">RETEST</span>
          <h3>正式复测</h3>
          <p>先完成应用核验，再开始同组织、模式、场景及题卷版本兼容的新测评。</p>
          <p v-if="!plan.retest_available" class="overview-warning">
            <LockKeyhole :size="14" />{{
              trainingUnavailableReason(plan.retest_unavailable_reason)
            }}
          </p>
          <button class="overview-secondary" @click="rules">查看复测要求</button>
        </section>
      </aside>
    </div>
    <dialog ref="dialog" class="training-review-dialog" aria-label="训练任务详情">
      <header>
        <h2>{{ showRules ? '正式复测要求' : review?.title }}</h2>
        <button aria-label="关闭任务详情" @click="dialog?.close()"><X :size="20" /></button>
      </header>
      <div class="review-body">
        <template v-if="showRules"
          ><ol>
            <li>按顺序完成学习、针对练习和应用核验。</li>
            <li>在应用核验完成后开始新的正式测评。</li>
            <li>组织、模式、场景及题卷版本必须兼容。</li>
            <li>新报告评分及复核完成后，关联到当前计划。</li>
          </ol>
          <p>最终是否可关联由服务端校验，不按预计日期自动解锁。</p></template
        ><template v-else-if="review"
          ><p v-if="plan.privacy_redacted">内容已按隐私策略移除。</p>
          <template v-else
            ><p v-if="plan.data_origin === 'synthetic'" class="origin-notice">
              合成演示记录：下方回答来自流程演示，不代表真实学员能力。
            </p>
            <p v-if="review.status !== 'completed'">
              这是任务说明预览。请先完成当前任务，不能在这里跳过顺序提交。
            </p>
            <TrainingTaskReview :task="review" />
            <button
              v-if="review.status === 'completed' && current"
              class="review-next"
              data-testid="review-next-task"
              @click="continueCurrent"
            >
              继续当前任务：{{ current.title }} <ArrowRight :size="16" />
            </button> </template
        ></template>
      </div>
    </dialog>
  </section>
</template>
<style scoped>
.training-overview {
  color: #073b59;
  margin: 16px 0 22px;
}
.target-band {
  display: grid;
  grid-template-columns: 35% 65%;
  background: linear-gradient(110deg, #effcff, #e9fafd);
  border: 1px solid #bde8f1;
  border-radius: 12px;
  padding: 14px 20px;
}
.target-copy {
  border-right: 1px solid #bde8f1;
  padding-right: 20px;
}
.overline {
  font-size: 12px;
  letter-spacing: 1px;
  color: #009da9;
  font-weight: 700;
}
.target-copy h2 {
  font-size: 26px;
  line-height: 1.3;
  margin: 6px 0;
  color: #073b59;
}
.target-copy > p {
  font-size: 12px;
  color: #6683a3;
}
.target-meta {
  display: flex;
  margin-top: 10px;
  gap: 20px;
}
.target-meta strong {
  font-size: 21px;
  border-right: 1px solid #bde8f1;
  padding-right: 20px;
}
.target-meta strong:last-child {
  border: 0;
}
.target-meta small {
  display: block;
  font-size: 12px;
  color: #6683a3;
  font-weight: 400;
}
.target-road {
  padding: 0 0 0 24px;
}
.road-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 18px;
}
.road-progress > span {
  border: 1px solid #a8e3ee;
  border-radius: 50%;
  width: 62px;
  height: 62px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  font-size: 11px;
  color: #6683a3;
}
.road-progress b {
  font-size: 20px;
  color: #006d88;
}
.road-progress progress {
  flex: 1;
  min-width: 0;
}
.road-stages {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.road-stages button {
  position: relative;
  text-align: left;
  background: #f2fcff;
  border: 1px solid #bde8f1;
  border-radius: 8px;
  padding: 12px;
  color: #073b59;
  cursor: pointer;
}
.road-stages button.current {
  background: #d6f4f8;
  border-color: #05afbe;
}
.road-stages small,
.road-stages strong,
.road-stages span {
  display: block;
}
.road-stages small {
  color: #008aa3;
  font-size: 11px;
}
.road-stages strong {
  font-size: 13px;
  margin: 3px 0;
}
.road-stages span {
  color: #6683a3;
  font-size: 11px;
}
.road-stages svg {
  position: absolute;
  right: 8px;
  top: 8px;
  color: #00a9b3;
}
.overview-columns {
  display: grid;
  grid-template-columns: minmax(0, 2.24fr) minmax(0, 1fr);
  gap: 14px;
  margin-top: 14px;
}
.overview-panel {
  border: 1px solid #bde8f1;
  border-radius: 12px;
  background: #fff;
  padding: 20px;
}
.overview-panel h2 {
  font-size: 22px;
}
.overview-panel h3 {
  font-size: 18px;
}
.today-task {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 20px;
  background: #ecfbfe;
  border: 1px solid #bde8f1;
  border-radius: 12px;
  margin: 12px 0 20px;
}
.task-no {
  font-size: 36px;
  color: #009ba9;
}
.today-task > div {
  flex: 1;
  min-width: 0;
}
.task-kind {
  display: inline-block;
  background: #d6f3f7;
  padding: 2px 10px;
  border-radius: 20px;
  color: #00859c;
  font-size: 12px;
}
.today-task h3 {
  font-size: 20px;
  margin: 4px 0;
}
.today-task p {
  color: #6683a3;
  font-size: 13px;
}
.today-task small {
  display: block;
  font-size: 12px;
  color: #6683a3;
  margin-top: 8px;
}
.overview-primary,
.overview-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #11aebb;
  border-radius: 8px;
  background: #08a7b7;
  color: white;
  padding: 9px 14px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
}
.overview-secondary {
  background: white;
  color: #007b95;
  width: 100%;
  margin-top: 12px;
}
.task-list-heading {
  display: flex;
  justify-content: space-between;
  margin: 8px 0;
}
.task-list-heading > span {
  font-size: 13px;
  color: #6683a3;
}
.overview-task-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 11px 0;
  border-top: 1px solid #dfeaf2;
}
.task-state {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid #a8c7da;
  border-radius: 50%;
  flex: none;
}
.task-state.done {
  background: #09b2b9;
  color: white;
  border-color: #09b2b9;
}
.overview-task-row > div {
  flex: 1;
}
.overview-task-row strong {
  font-size: 14px;
}
.overview-task-row small {
  display: block;
  color: #6683a3;
  font-size: 12px;
}
.overview-task-row button {
  color: #2875e8;
  background: none;
  border: 0;
  padding: 8px;
  cursor: pointer;
}
.overview-side {
  display: grid;
  align-content: start;
  gap: 12px;
}
.overview-side .overview-panel {
  padding: 16px 20px;
}
.overview-side a {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #2875e8;
  font-size: 12px;
  margin: 6px 0;
}
.basis-row {
  padding: 12px 0;
  border-top: 1px solid #deedf3;
}
.basis-row > div {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}
.basis-row strong {
  font-size: 20px;
}
.basis-row small {
  font-size: 11px;
  color: #6683a3;
}
.overview-side p {
  font-size: 13px;
  color: #6683a3;
}
.overview-side .completion-value {
  font-size: 32px;
  color: #008fa2;
  font-weight: 700;
}
.completion-value small {
  font-size: 16px;
}
.retest-panel {
  background: #effcff;
}
.overview-warning {
  color: #906019 !important;
  background: #fff9eb;
  padding: 10px;
  border-radius: 8px;
  font-size: 13px;
}
.overview-empty {
  padding: 28px 0;
  color: #6683a3;
}
progress {
  appearance: none;
  display: block;
  width: 100%;
  height: 6px;
  border: 0;
  border-radius: 5px;
  overflow: hidden;
  background: #d9eef3;
  margin: 8px 0;
}
progress::-webkit-progress-bar {
  background: #d9eef3;
}
progress::-webkit-progress-value {
  background: #08afbd;
}
progress::-moz-progress-bar {
  background: #08afbd;
}
.training-review-dialog {
  margin: auto;
  width: min(960px, calc(100vw - 30px));
  max-height: 90dvh;
  overflow: auto;
  border: 1px solid #bde8f1;
  border-radius: 14px;
  padding: 0;
  background: #fff;
  color: #073b59;
}
.training-review-dialog::backdrop {
  background: #173d5366;
}
.training-review-dialog > header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 22px 26px;
  background: #fff;
  border-bottom: 1px solid #bde8f1;
}
.training-review-dialog > header h2 {
  font-size: 21px;
  margin: 0;
  line-height: 1.5;
}
.training-review-dialog > header button {
  border: 0;
  background: none;
  cursor: pointer;
  color: #007b95;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 8px;
}
.review-body {
  padding: 4px 26px 26px;
}
.review-body > p,
.review-body > ol {
  margin: 14px 0;
  line-height: 1.8;
}
.review-body > ol {
  padding-left: 22px;
}
.origin-notice {
  background: #f0fafc;
  border: 1px solid #bde8f1;
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
  line-height: 1.7;
  color: #52758b;
}
.review-next {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 8px;
  background: #007b95;
  color: #fff;
  padding: 12px 18px;
  margin-top: 24px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.review-next:focus-visible,
.training-review-dialog > header button:focus-visible {
  outline: 2px solid #007b95;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .training-review-dialog > header {
    padding: 16px;
    gap: 10px;
  }
  .training-review-dialog > header h2 {
    font-size: 18px;
  }
  .review-body {
    padding: 0 16px 20px;
  }
  .review-next {
    width: 100%;
  }
}
@media (max-width: 1100px) {
  .target-band {
    grid-template-columns: 1fr;
  }
  .target-copy {
    border: 0;
  }
  .target-road {
    padding: 16px 0 0;
  }
  .today-task {
    flex-wrap: wrap;
  }
  .overview-columns {
    grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr);
  }
}
@media (max-width: 760px) {
  .overview-columns {
    grid-template-columns: 1fr;
  }
  .road-stages {
    grid-template-columns: 1fr 1fr;
  }
  .target-copy h2 {
    font-size: 23px;
  }
  .target-meta {
    gap: 12px;
  }
  .target-meta strong {
    font-size: 18px;
    padding-right: 12px;
  }
  .overview-panel {
    padding: 16px;
  }
  .today-task {
    padding: 15px;
    gap: 12px;
  }
  .today-task h3 {
    font-size: 17px;
  }
  .task-list-heading {
    flex-wrap: wrap;
    gap: 5px;
  }
}
</style>
