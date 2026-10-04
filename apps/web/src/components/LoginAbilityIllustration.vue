<script setup lang="ts">
// Decorative example only: these points never represent a signed-in user's results.
const labels = ['基础认知', '提示词工程', '工具使用', '结果评估', '人机协同', '伦理合规']
const point = (i: number, radius: number) => {
  const angle = ((i * 60 - 90) * Math.PI) / 180
  return { x: 260 + Math.cos(angle) * radius, y: 190 + Math.sin(angle) * radius }
}
const polygon = (radii: number[]) =>
  radii
    .map((r, i) => {
      const p = point(i, r)
      return `${p.x},${p.y}`
    })
    .join(' ')
const example = [90, 100, 79, 103, 106, 92]
</script>
<template>
  <svg
    class="login-radar"
    viewBox="0 0 560 390"
    role="img"
    aria-label="六维能力示意，非个人测评结果"
  >
    <g fill="none" stroke="#b6e8f3" stroke-width="0.8">
      <polygon
        v-for="radius in [30, 60, 90, 120, 150]"
        :key="radius"
        :points="polygon(Array(6).fill(radius))"
      />
      <line
        v-for="(_, i) in labels"
        :key="i"
        x1="260"
        y1="190"
        :x2="point(i, 150).x"
        :y2="point(i, 150).y"
      />
    </g>
    <polygon :points="polygon(example)" fill="#54c8db" fill-opacity="0.17" stroke="#7cdae8" />
    <g v-for="(label, i) in labels" :key="label">
      <circle
        :cx="point(i, 150).x"
        :cy="point(i, 150).y"
        r="4.8"
        fill="#0aa6bf"
        stroke="white"
        stroke-width="1.5"
      />
      <circle
        :cx="point(i, example[i]!).x"
        :cy="point(i, example[i]!).y"
        r="5.2"
        fill="#0aa6bf"
        stroke="white"
        stroke-width="1.5"
      />
      <text
        :x="point(i, 171).x"
        :y="point(i, 171).y + 6"
        :text-anchor="i === 0 || i === 3 ? 'middle' : i < 3 ? 'start' : 'end'"
      >
        {{ label }}
      </text>
    </g>
    <path d="M425 343h15" stroke="#0aa6bf" stroke-width="2" />
    <text x="450" y="348" class="legend">六维能力示意</text>
  </svg>
</template>
<style scoped>
.login-radar {
  display: block;
  width: 100%;
  max-width: 540px;
  margin-top: 20px;
  overflow: visible;
}
text {
  fill: #234c64;
  font-size: 17px;
  font-weight: 600;
}
.legend {
  font-size: 13px;
  font-weight: 400;
  fill: #65899f;
}
</style>
