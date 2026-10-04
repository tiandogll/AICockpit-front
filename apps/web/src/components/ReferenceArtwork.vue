<script setup lang="ts">
import { computed } from 'vue'
import methodSource from '../assets/reference-art/method-source.png'
import guideSource from '../assets/reference-art/guide-source.png'
import radarSource from '../assets/reference-art/radar-source.png'
const props = defineProps<{ kind: 'adaptive' | 'process' | 'evidence' | 'guide' | 'radar' }>()
// Viewports expose illustrations only. No form, button, heading or report data
// is flattened into an image. Supplied source PNGs remain byte-for-byte intact.
const art = computed(() => ({
  adaptive: { source: methodSource, box: '140 488 405 213', width: 1586, height: 992 },
  process: { source: methodSource, box: '606 478 377 219', width: 1586, height: 992 },
  evidence: { source: methodSource, box: '1048 461 402 249', width: 1586, height: 992 },
  guide: { source: guideSource, box: '961 94 277 165', width: 1513, height: 1040 },
  radar: { source: radarSource, box: '221 639 328 297', width: 1586, height: 992 },
})[props.kind])
const bounds = computed(() => art.value.box.split(' ').map(Number))
const clipping = computed(() => {
  const [x = 0, y = 0, w = 0, h = 0] = bounds.value
  // Exclude the printed card index: that number is rendered as accessible text.
  const inset = props.kind === 'process' || props.kind === 'evidence' ? 35 : 0
  return `${x + inset},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h} ${x},${y + inset} ${x + inset},${y + inset}`
})
</script>
<template>
  <svg class="reference-artwork public-illustration" :class="`reference-artwork--${kind}`" :viewBox="art.box" aria-hidden="true" focusable="false">
    <defs>
      <clipPath :id="`art-clip-${kind}`"><polygon :points="clipping" /></clipPath>
    </defs>
    <image :href="art.source" :width="art.width" :height="art.height" :clip-path="`url(#art-clip-${kind})`"/>
  </svg>
</template>
<style scoped>
.reference-artwork{display:block;width:100%;height:auto;overflow:hidden;pointer-events:none;mix-blend-mode:multiply}
.reference-artwork--radar { mask-image: linear-gradient(transparent, #000 8%, #000 92%, transparent), linear-gradient(90deg, transparent, #000 8%, #000 92%, transparent); mask-composite: intersect; }
</style>
