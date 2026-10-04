<script setup lang="ts">
import { useId } from 'vue'
import logoUrl from '../assets/ai-measure-logo.png'
const clipId = `brand-symbol-${useId()}`
</script>

<template>
  <svg class="brand-mark" viewBox="250 215 800 610" aria-hidden="true" focusable="false">
    <!-- The supplied PNG stays byte-for-byte intact; this viewport shows its symbol. -->
    <defs>
      <clipPath :id="clipId"><rect x="250" y="215" width="800" height="610" /></clipPath>
    </defs>
    <image :href="logoUrl" width="1254" height="1254" :clip-path="`url(#${clipId})`" />
  </svg>
</template>

<style scoped>
.brand-mark {
  overflow: hidden;
}
</style>
