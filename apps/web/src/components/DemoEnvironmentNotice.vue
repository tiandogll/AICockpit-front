<script setup lang="ts">
defineProps<{ enabled: boolean }>()
</script>

<template>
  <aside v-if="enabled" class="demo-environment-notice" role="note">
    独立演示 · 合成案例，非正式成绩 · 本轮 AI 调用已关闭
  </aside>
</template>

<style scoped>
.demo-environment-notice {
  position: fixed;
  z-index: 100;
  bottom: 8px;
  left: 50%;
  transform: translateX(-50%);
  max-width: calc(100vw - 24px);
  padding: 5px 12px;
  border: 1px solid #c6dee4;
  border-radius: 8px;
  background: #f0fafc;
  color: #385e69;
  font: 12px/1.5 sans-serif;
  text-align: center;
  pointer-events: none;
}
</style>
