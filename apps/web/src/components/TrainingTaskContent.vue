<script setup lang="ts">
import type { TrainingTask } from '../services/trainingApi'
import TrainingLessons from './TrainingLessons.vue'
defineProps<{ task: TrainingTask }>()
</script>

<template>
  <div class="training-task-content">
    <p class="task-instructions">{{ task.content.instructions }}</p>
    <TrainingLessons v-if="task.content.lessons?.length" :lessons="task.content.lessons" />
    <section v-if="task.content.material" class="original-material">
      <h3>学习材料</h3>
      <p>{{ task.content.material }}</p>
    </section>
    <section v-if="task.content.prompt" class="practice-brief">
      <h3>{{ task.kind === 'application' ? '应用任务' : '练习情境与要求' }}</h3>
      <p>{{ task.content.prompt }}</p>
    </section>
    <section
      v-if="task.content.checklist?.length && task.kind !== 'learning'"
      class="practice-checks"
    >
      <h3>作答自查清单</h3>
      <ul>
        <li v-for="item in task.content.checklist" :key="item">{{ item }}</li>
      </ul>
      <p class="check-note">用于提醒你补全思路，不是自动判分标准。</p>
    </section>
  </div>
</template>

<style scoped>
.training-task-content {
  color: #073b59;
}
.task-instructions {
  margin: 10px 0 20px;
  color: #52758b;
  line-height: 1.8;
  font-size: 15px;
}
.original-material,
.practice-brief {
  margin: 18px 0;
  padding: 20px;
  border: 1px solid #bde8f1;
  border-radius: 12px;
  background: #fff;
}
.practice-brief {
  background: #f0fafc;
}
.training-task-content h3 {
  font-size: 17px;
  margin: 0 0 12px;
}
.original-material p,
.practice-brief p {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 1.85;
}
.practice-checks {
  margin: 22px 0;
}
.practice-checks ul {
  padding-left: 22px;
  line-height: 1.85;
  margin: 0;
}
.practice-checks li + li {
  margin-top: 8px;
}
.check-note {
  font-size: 13px;
  color: #52758b;
}
</style>
