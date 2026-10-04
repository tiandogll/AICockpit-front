<script setup lang="ts">
import { useId } from 'vue'

const id = `registration-orbit-${useId()}`
const point = (index: number, radius: number) => {
  const angle = ((index * 60 - 90) * Math.PI) / 180
  return { x: 296 + Math.cos(angle) * radius, y: 202 + Math.sin(angle) * radius }
}
const polygon = (radius: number) =>
  Array.from({ length: 6 }, (_, i) => `${point(i, radius).x},${point(i, radius).y}`).join(' ')
const labels = [
  { text: '基础认知', x: 296, y: 40, anchor: 'middle' },
  { text: '提示词工程', x: 442, y: 132, anchor: 'start' },
  { text: '工具使用', x: 442, y: 286, anchor: 'start' },
  { text: '结果评估', x: 296, y: 377, anchor: 'middle' },
  { text: '人机协同', x: 153, y: 286, anchor: 'end' },
  { text: '伦理合规', x: 153, y: 132, anchor: 'end' },
]
</script>

<template>
  <svg
    class="registration-constellation"
    viewBox="0 0 640 400"
    role="img"
    aria-label="六维能力坐标示意，非个人测评成绩"
  >
    <defs>
      <radialGradient :id="`${id}-halo`">
        <stop stop-color="#75d9ee" stop-opacity=".17" />
        <stop offset="1" stop-color="#e0f8fd" stop-opacity="0" />
      </radialGradient>
      <radialGradient :id="`${id}-node`" cx=".36" cy=".25">
        <stop stop-color="#54ecf1" />
        <stop offset=".56" stop-color="#0cacc4" />
        <stop offset="1" stop-color="#087c95" />
      </radialGradient>
      <radialGradient :id="`${id}-pearl`" cx=".34" cy=".25">
        <stop stop-color="#efffff" />
        <stop offset=".62" stop-color="#afeaf6" />
        <stop offset="1" stop-color="#e6f9fc" stop-opacity=".5" />
      </radialGradient>
      <linearGradient :id="`${id}-glass`" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#e4fdff" stop-opacity=".75" />
        <stop offset=".52" stop-color="#73d8ed" stop-opacity=".18" />
        <stop offset="1" stop-color="#f1ffff" stop-opacity=".6" />
      </linearGradient>
      <linearGradient :id="`${id}-core`" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#93f4fa" />
        <stop offset="1" stop-color="#139ebc" stop-opacity=".56" />
      </linearGradient>
      <filter :id="`${id}-glow`" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
    <ellipse cx="296" cy="206" rx="250" ry="181" :fill="`url(#${id}-halo)`" />
    <ellipse
      cx="296"
      cy="209"
      rx="316"
      ry="118"
      transform="rotate(-25 296 209)"
      fill="#dcf6fc"
      fill-opacity=".27"
    />
    <g fill="none" stroke="#97e2f4" stroke-width=".8">
      <ellipse cx="296" cy="212" rx="314" ry="137" transform="rotate(-22 296 212)" />
      <ellipse cx="296" cy="212" rx="265" ry="123" transform="rotate(14 296 212)" opacity=".65" />
      <path d="M122 28C215-26 454-16 521 22" opacity=".3" />
      <path d="M213 388C414 411 620 265 585 76" opacity=".55" />
    </g>
    <g :fill="`url(#${id}-pearl)`">
      <circle cx="-35" cy="243" r="18" />
      <circle cx="48" cy="162" r="9" />
      <circle cx="513" cy="22" r="9" />
      <circle cx="53" cy="381" r="7" />
    </g>
    <polygon :points="polygon(145)" fill="#d1f6fb" fill-opacity=".16" stroke="#d8f7fb" />
    <polygon :points="polygon(137)" :fill="`url(#${id}-glass)`" stroke="#71d2e6" stroke-width="1" />
    <g fill="none" stroke="#8bddeb" stroke-width=".8" opacity=".65">
      <polygon v-for="radius in [40, 73, 105]" :key="radius" :points="polygon(radius)" />
      <line
        v-for="i in 6"
        :key="i"
        x1="296"
        y1="202"
        :x2="point(i - 1, 137).x"
        :y2="point(i - 1, 137).y"
      />
    </g>
    <polygon :points="polygon(75)" :fill="`url(#${id}-glass)`" stroke="#89e5f2" />
    <polygon :points="polygon(51)" :fill="`url(#${id}-glass)`" stroke="white" stroke-width="1.2" />
    <path d="M296 151 340 177 296 202 252 177Z" fill="#b3f7fb" fill-opacity=".5" stroke="#e9ffff" />
    <path
      d="M252 177 296 202 296 253 252 227Z"
      fill="#4fcde2"
      fill-opacity=".26"
      stroke="#e9ffff"
    />
    <path d="M296 202 340 177 340 227 296 253Z" :fill="`url(#${id}-core)`" stroke="#e9ffff" />
    <polygon :points="polygon(29)" :fill="`url(#${id}-core)`" opacity=".55" />
    <g v-for="i in 6" :key="i">
      <circle
        :cx="point(i - 1, 137).x"
        :cy="point(i - 1, 137).y"
        r="12"
        fill="#22c2d9"
        opacity=".55"
        :filter="`url(#${id}-glow)`"
      />
      <circle
        :cx="point(i - 1, 137).x"
        :cy="point(i - 1, 137).y"
        r="9"
        fill="#ccf8fc"
        stroke="#efffff"
      />
      <circle
        :cx="point(i - 1, 137).x"
        :cy="point(i - 1, 137).y"
        r="6.6"
        :fill="`url(#${id}-node)`"
      />
    </g>
    <text
      v-for="label in labels"
      :key="label.text"
      :x="label.x"
      :y="label.y"
      :text-anchor="label.anchor"
    >
      {{ label.text }}
    </text>
  </svg>
</template>

<style scoped>
.registration-constellation {
  display: block;
  width: 100%;
  overflow: visible;
}
text {
  fill: #113950;
  font-size: 17px;
  font-weight: 700;
}
@media (min-width: 961px) and (max-width: 1199px) {
  text {
    font-size: 20px;
  }
}
</style>
