<script setup lang="ts">
defineProps<{ origin?: string | null }>()
</script>

<template>
  <p
    v-if="origin === 'synthetic'"
    class="assessment-origin-note"
    data-testid="assessment-origin-note"
  >
    <strong>本地体验 · 非正式比赛题库</strong><span>不计入正式统计</span>
  </p>
</template>

<style scoped>
.assessment-origin-note {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 10px 0;
  padding: 8px 11px;
  border: 1px solid #ead9b7;
  border-radius: 7px;
  background: #fff8e9;
  color: #725320;
  font-size: 13px;
  line-height: 1.65;
}
.assessment-origin-note strong {
  font-size: inherit;
  font-weight: 600;
}
</style>
