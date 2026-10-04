<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { parseAssessmentMedia } from '../domain/assessmentMedia'

const props = defineProps<{ media?: unknown }>()
const media = computed(() => parseAssessmentMedia(props.media))
const failedSources = ref(new Set<string>())

watch(
  () => props.media,
  () => {
    failedSources.value = new Set()
  },
  { deep: true },
)
</script>

<template>
  <section
    v-if="media.images.length || media.hasRejectedImages"
    class="question-media"
    aria-label="题干图片材料"
  >
    <figure v-for="(image, index) in media.images" :key="`${image.src}:${index}`">
      <img
        v-if="!failedSources.has(image.src)"
        :src="image.src"
        :alt="image.alt"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="failedSources.add(image.src)"
      />
      <p v-else class="media-error" role="alert">
        <strong>图片暂时无法加载，请刷新页面重试。</strong>
        <span>图片说明：{{ image.alt }}</span>
      </p>
      <figcaption v-if="image.caption">{{ image.caption }}</figcaption>
    </figure>
    <p v-if="media.hasRejectedImages" class="media-error" role="alert">
      图片材料格式不正确，未加载。请联系测评管理员确认题目材料。
    </p>
  </section>
</template>

<style scoped>
.question-media {
  display: grid;
  min-width: 0;
  gap: 14px;
  margin: 20px 0;
}

figure {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper-strong);
}

img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 440px;
  object-fit: contain;
  background: var(--mist);
}

figcaption {
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}

.media-error {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 14px;
  border-left: 3px solid var(--signal-dark);
  color: var(--text);
  background: var(--mist);
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.media-error strong {
  font-weight: 600;
}
</style>
