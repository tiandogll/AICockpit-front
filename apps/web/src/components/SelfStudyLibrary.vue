<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { BookOpen, ArrowRight, X } from '@lucide/vue'
import { LEARNING_GUIDANCE } from '../domain/learningGuidance'

const props = defineProps<{ initialCode?: string }>()
const selectedCode = ref('')
const selected = computed(() => LEARNING_GUIDANCE.find((item) => item.code === selectedCode.value))
const dialog = ref<HTMLDialogElement | null>(null)
async function open(code: string) {
  selectedCode.value = code
  if (dialog.value?.open) return
  await nextTick()
  if (selectedCode.value === code && selected.value && !dialog.value?.open)
    dialog.value?.showModal()
}
watch(
  () => props.initialCode,
  (code) => {
    if (code && LEARNING_GUIDANCE.some((item) => item.code === code)) open(code)
  },
  { flush: 'post' },
)
onMounted(() => {
  if (props.initialCode) open(props.initialCode)
})
</script>

<template>
  <section class="self-study" aria-label="自主学习资料">
    <header>
      <div>
        <span class="study-label">自主学习</span>
        <h2>选一个方向，先练一个方法</h2>
        <p>不必等到出现短板才开始学习。以下是通用方法，不是对你能力不足的判断。</p>
      </div>
      <BookOpen :size="28" aria-hidden="true" />
    </header>
    <div class="study-grid">
      <article
        v-for="item in LEARNING_GUIDANCE"
        :key="item.code"
        :class="{ suggested: initialCode === item.code }"
      >
        <span>{{ item.name }}</span>
        <h3>{{ item.title }}</h3>
        <p>{{ item.summary }}</p>
        <button @click="open(item.code)" :aria-label="`阅读方法：${item.name}`">
          阅读方法 <ArrowRight :size="16" />
        </button>
      </article>
    </div>
    <p class="study-boundary">
      工程编写的通用学习资料，尚未经专家审定；阅读不会生成个人训练计划、记录完成进度或改变正式成绩。不调用
      AI，也不上传材料。
    </p>
    <dialog ref="dialog" class="study-dialog" aria-label="自主学习方法">
      <template v-if="selected">
        <header>
          <div>
            <span class="study-label">{{ selected.name }} · 自主学习</span>
            <h2>{{ selected.title }}</h2>
          </div>
          <button aria-label="关闭学习方法" @click="dialog?.close()"><X :size="22" /></button>
        </header>
        <div class="study-body">
          <p>{{ selected.summary }}</p>
          <section class="study-example">
            <h3>练习示例</h3>
            <p>{{ selected.example }}</p>
          </section>
          <h3>可以这样做</h3>
          <ol>
            <li v-for="step in selected.steps" :key="step">{{ step }}</li>
          </ol>
          <section class="study-check">
            <h3>自己检查</h3>
            <p>{{ selected.check }}</p>
          </section>
          <p class="study-boundary">
            请使用公开或虚构材料。这里提供方法阅读，不进行作答评分或任务保存。
          </p>
          <button class="study-done" @click="dialog?.close()">返回学习目录</button>
        </div>
      </template>
    </dialog>
  </section>
</template>

<style scoped>
.self-study {
  color: var(--ink, #173e4b);
}
.self-study > header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  margin: 24px 0 18px;
}
.study-label {
  color: #208c9c;
  font-size: 13px;
  font-weight: 700;
}
.self-study h2 {
  font-size: 24px;
  line-height: 1.4;
  margin: 6px 0;
}
.self-study p {
  color: #607b8b;
  line-height: 1.8;
  font-size: 14px;
}
.study-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.study-grid article {
  display: flex;
  flex-direction: column;
  border: 1px solid #cee4ea;
  border-radius: 14px;
  padding: 22px;
  background: white;
}
.study-grid article.suggested {
  border-color: #219bac;
}
.study-grid article > span {
  font-size: 12px;
  color: #208c9c;
}
.study-grid h3 {
  font-size: 18px;
  margin: 10px 0;
  line-height: 1.5;
}
.study-grid p {
  flex: 1;
  margin: 0 0 18px;
}
.study-grid button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
  background: #eef8fa;
  color: #137f91;
  border: 0;
  border-radius: 8px;
  padding: 10px 14px;
  font: inherit;
  cursor: pointer;
}
.self-study .study-boundary {
  font-size: 12px;
  margin: 16px 0;
}
.study-dialog {
  margin: auto;
  padding: 0;
  width: min(720px, calc(100vw - 28px));
  max-height: 88dvh;
  overflow: auto;
  border: 1px solid #cee4ea;
  border-radius: 18px;
  color: #173e4b;
}
.study-dialog::backdrop {
  background: #173a4966;
}
.study-dialog > header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: start;
  position: sticky;
  top: 0;
  padding: 24px;
  background: white;
  border-bottom: 1px solid #e1edf0;
}
.study-dialog header button {
  flex: none;
  border: 0;
  background: #eef8fa;
  width: 44px;
  height: 44px;
  border-radius: 8px;
  color: #137f91;
  cursor: pointer;
}
.study-body {
  padding: 4px 24px 24px;
}
.study-body > h3 {
  margin: 20px 0 8px;
  font-size: 16px;
}
.study-body li {
  margin: 10px 0;
  line-height: 1.8;
  font-size: 15px;
}
.study-body ol {
  padding-left: 24px;
}
.study-example,
.study-check {
  background: #eef8fa;
  padding: 16px 20px;
  border-radius: 12px;
  margin: 18px 0;
}
.study-body section h3 {
  font-size: 15px;
  margin: 0 0 6px;
}
.study-body section p {
  margin: 0;
}
.study-done {
  min-height: 44px;
  border: 0;
  border-radius: 8px;
  padding: 12px 20px;
  background: #137f91;
  color: white;
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 3px solid #427eff;
  outline-offset: 3px;
}
@media (max-width: 1000px) {
  .study-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .study-grid {
    grid-template-columns: 1fr;
  }
  .self-study h2 {
    font-size: 21px;
  }
  .study-dialog > header {
    padding: 18px;
  }
  .study-body {
    padding: 4px 18px 18px;
  }
}
</style>
