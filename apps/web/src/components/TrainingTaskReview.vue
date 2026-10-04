<script setup lang="ts">
import { computed } from 'vue'
import type { TrainingTask } from '../services/trainingApi'
import { formatWorkspaceDate } from '../services/workspaceApi'
import TrainingTaskContent from './TrainingTaskContent.vue'
import TrainingLessons from './TrainingLessons.vue'
const props = defineProps<{ task: TrainingTask }>()
const isChecklist = computed(() => props.task.content.feedback_mode === 'local_checklist_v2')
</script>

<template>
  <div class="task-review">
    <TrainingTaskContent :task="task" />
    <template v-if="task.status === 'completed'">
      <div class="record-meta">
        <span>已保存 · 只读记录</span><time>{{ formatWorkspaceDate(task.completed_at) }}</time>
      </div>
      <section v-if="task.submission?.response" class="saved-response" data-testid="saved-response">
        <h3>{{ task.kind === 'learning' ? '你的反思' : '你的练习回答' }}</h3>
        <p>{{ task.submission.response }}</p>
      </section>
      <section v-if="task.submission?.application" class="saved-response">
        <h3>你的应用过程</h3>
        <p>{{ task.submission.application }}</p>
      </section>
      <section v-if="task.submission?.verification" class="saved-response">
        <h3>你的核验记录</h3>
        <p>{{ task.submission.verification }}</p>
      </section>
      <section v-if="task.feedback" class="saved-feedback" data-testid="saved-feedback">
        <h3>{{ isChecklist ? '规则自查反馈 · 非 AI 评分' : '当时的反馈' }}</h3>
        <p>{{ task.feedback }}</p>
        <small v-if="!isChecklist && task.kind !== 'retest'"
          >历史反馈原样保留；保存成功不代表内容已通过评价，也不代表能力已提升。</small
        >
      </section>
      <p v-if="task.content.next_step" class="next-step">
        <strong>接下来怎么做</strong>{{ task.content.next_step }}
      </p>
      <RouterLink
        v-if="task.submission?.session_id"
        class="report-link"
        :to="`/reports/${task.submission.session_id}`"
        >查看复测报告 →</RouterLink
      >
    </template>
    <details v-if="task.supplemental_lessons?.length" class="supplemental-reading">
      <summary>补充学习材料 · 新版案例与方法</summary>
      <p>以下是后来补充的学习内容，不属于当时的原任务，不改写你的历史回答、反馈或成绩。</p>
      <TrainingLessons :lessons="task.supplemental_lessons" />
    </details>
  </div>
</template>

<style scoped>
.task-review {
  color: #073b59;
}
.task-review h3 {
  margin: 0 0 12px;
  font-size: 17px;
}
.record-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: space-between;
  border-top: 1px solid #bde8f1;
  padding-top: 20px;
  margin: 24px 0 12px;
  font-size: 12px;
  color: #52758b;
}
.saved-response {
  padding: 20px;
  border-radius: 12px;
  background: #f0fafc;
  margin: 12px 0;
  border-left: 3px solid #007b95;
}
.saved-feedback {
  padding: 20px;
  border: 1px solid #bde8f1;
  border-radius: 12px;
  margin: 16px 0;
}
.saved-response p,
.saved-feedback p {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  margin: 0;
  line-height: 1.9;
  font-size: 15px;
}
.saved-feedback small {
  display: block;
  line-height: 1.7;
  color: #52758b;
  margin-top: 12px;
}
.next-step {
  background: #f6f8fa;
  border-radius: 10px;
  padding: 16px 20px;
  line-height: 1.8;
  font-size: 14px;
}
.next-step strong {
  display: block;
  margin-bottom: 6px;
}
.report-link {
  display: inline-block;
  margin: 12px 0;
  color: #007b95;
  text-decoration: underline;
  text-underline-offset: 4px;
}
.supplemental-reading {
  border-top: 1px solid #bde8f1;
  margin-top: 24px;
  padding-top: 18px;
}
.supplemental-reading summary {
  color: #007b95;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  padding: 8px 0;
}
.supplemental-reading > p {
  color: #52758b;
  line-height: 1.7;
  font-size: 13px;
  margin: 10px 0 18px;
}
.supplemental-reading summary:focus-visible,
.report-link:focus-visible {
  outline: 2px solid #007b95;
  outline-offset: 4px;
}
</style>
