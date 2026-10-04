<script setup lang="ts">
import type { TrainingLesson } from '../services/trainingApi'
defineProps<{ lessons: TrainingLesson[] }>()
</script>

<template>
  <div class="training-lessons">
    <article v-for="lesson in lessons" :key="lesson.code" class="lesson">
      <header class="lesson-heading">
        <span>学习材料</span>
        <h3>{{ lesson.title }}</h3>
        <p>{{ lesson.objective }}</p>
      </header>
      <div class="lesson-reading">
        <p v-for="paragraph in lesson.paragraphs" :key="paragraph">{{ paragraph }}</p>
      </div>
      <section class="worked-case" aria-label="虚构教学案例">
        <h4>看一个案例 <small>虚构情境 · 非真实个人数据</small></h4>
        <p>{{ lesson.case.scenario }}</p>
        <div class="case-comparison">
          <div class="case-pitfall">
            <strong>容易踩的坑</strong>
            <p>{{ lesson.case.pitfall }}</p>
          </div>
          <div class="case-approach">
            <strong>换一种做法</strong>
            <p>{{ lesson.case.approach }}</p>
          </div>
        </div>
      </section>
      <div class="lesson-actions">
        <section>
          <h4>你可以这样做</h4>
          <ol>
            <li v-for="step in lesson.steps" :key="step">{{ step }}</li>
          </ol>
        </section>
        <section>
          <h4>写反思前，问问自己</h4>
          <ul>
            <li v-for="question in lesson.reflection_questions" :key="question">{{ question }}</li>
          </ul>
        </section>
      </div>
    </article>
  </div>
</template>

<style scoped>
.training-lessons {
  display: grid;
  gap: 24px;
  color: #073b59;
}
.lesson {
  border: 1px solid #bde8f1;
  border-radius: 14px;
  overflow: hidden;
  background: white;
}
.lesson-heading {
  padding: 20px 24px;
  background: #f0fafc;
}
.lesson-heading span {
  color: #007b95;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.lesson-heading h3 {
  margin: 5px 0 8px;
  font-size: 22px;
  line-height: 1.4;
}
.lesson-heading p {
  margin: 0;
  line-height: 1.7;
  font-size: 15px;
}
.lesson-reading {
  padding: 4px 24px 10px;
}
.lesson p,
.lesson li {
  font-size: 15px;
  line-height: 1.85;
  overflow-wrap: anywhere;
}
.worked-case {
  margin: 0 24px 20px;
  padding-top: 18px;
  border-top: 1px solid #bde8f1;
}
.lesson h4 {
  font-size: 16px;
  margin: 0 0 10px;
}
.worked-case h4 small {
  font-weight: 400;
  color: #6683a3;
  font-size: 12px;
  display: inline-block;
  margin-left: 10px;
}
.case-comparison {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.case-comparison > div {
  padding: 16px;
  border-radius: 10px;
}
.case-comparison strong {
  font-size: 14px;
}
.case-comparison p {
  margin: 8px 0 0;
}
.case-pitfall {
  background: #f6f7f9;
  border-left: 3px solid #8ca2ae;
}
.case-approach {
  background: #f0fafc;
  border-left: 3px solid #007b95;
}
.lesson-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  border-top: 1px solid #bde8f1;
  padding: 20px 24px;
}
.lesson-actions ol,
.lesson-actions ul {
  margin: 0;
  padding-left: 21px;
}
.lesson-actions li + li {
  margin-top: 8px;
}
@media (max-width: 600px) {
  .lesson-heading,
  .lesson-actions {
    padding: 16px;
  }
  .lesson-reading {
    padding: 0 16px 8px;
  }
  .worked-case {
    margin: 0 16px 16px;
  }
  .case-comparison,
  .lesson-actions {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .lesson-heading h3 {
    font-size: 20px;
  }
  .worked-case h4 small {
    display: block;
    margin: 6px 0 0;
  }
}
</style>
