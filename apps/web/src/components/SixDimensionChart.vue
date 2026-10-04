<script setup lang="ts">
import { computed } from 'vue'
import { DIMENSIONS, LEVEL_NAMES } from '../domain/capabilities'
const props = defineProps<{
  dimensions: Array<{ code: string; index: number | null; level: string; evidence_count: number }>
  compact?: boolean
  radarOnly?: boolean
}>()
const rows = computed(() =>
  DIMENSIONS.map((dimension, i) => {
    const entry = props.dimensions.find((value) => value.code === dimension.code)
    const valid =
      entry &&
      typeof entry.index === 'number' &&
      Number.isFinite(entry.index) &&
      entry.index >= 0 &&
      entry.index <= 100 &&
      entry.evidence_count > 0
    return {
      ...dimension,
      index: valid ? entry.index : null,
      level: valid ? entry.level : '',
      angle: (i * Math.PI) / 3 - Math.PI / 2,
    }
  }),
)
function point(angle: number, value: number) {
  return `${120 + Math.cos(angle) * value},${120 + Math.sin(angle) * value}`
}
const complete = computed(() => rows.value.every((row) => row.index !== null))
const polygon = computed(() =>
  rows.value.map((row) => point(row.angle, (row.index ?? 0) * 0.86)).join(' '),
)
</script>
<template>
  <div class="six-chart" :class="{ compact, 'radar-only': radarOnly }">
    <div class="radar-wrap">
      <svg
        viewBox="0 0 240 240"
        role="img"
        :aria-label="
          complete ? '六维能力指数，详细数值见列表' : '能力证据不完整，缺失维度不绘制为零'
        "
      >
        <polygon
          v-for="radius in radarOnly ? [14, 29, 43, 57, 72, 86] : [22, 44, 66, 86]"
          :key="radius"
          :points="rows.map((row) => point(row.angle, radius)).join(' ')"
          fill="none"
          stroke="#D4E3E7"
        />
        <line
          v-for="row in rows"
          :key="row.code"
          x1="120"
          y1="120"
          :x2="120 + Math.cos(row.angle) * 86"
          :y2="120 + Math.sin(row.angle) * 86"
          :stroke="radarOnly ? 'none' : '#E2ECEF'"
        />
        <polygon
          v-if="complete"
          data-testid="radar-profile"
          :points="polygon"
          fill="#137F91"
          :fill-opacity="radarOnly ? 0 : 0.13"
          :stroke="radarOnly ? '#63B8C4' : '#137F91'"
          stroke-width="2"
        />
        <template v-for="row in rows" :key="row.code">
          <circle
            v-if="row.index !== null"
            :cx="120 + Math.cos(row.angle) * row.index * 0.86"
            :cy="120 + Math.sin(row.angle) * row.index * 0.86"
            r="4"
            :fill="radarOnly ? '#63B8C4' : '#137F91'"
          />
        </template>
        <circle v-if="radarOnly" cx="120" cy="120" r="4" fill="#527fe3" />
      </svg>
      <p>{{ rows.filter((row) => row.index !== null).length }} / 6 维有证据</p>
    </div>
    <dl v-if="!radarOnly" class="dimension-values">
      <div v-for="row in rows" :key="row.code" :data-dimension="row.code">
        <dt><i :style="{ background: row.color }"></i>{{ row.name }}</dt>
        <dd>
          <strong>{{ row.index === null ? '—' : row.index.toFixed(1) }}</strong
          ><span>{{
            row.index === null ? '证据不足' : `${row.level} ${LEVEL_NAMES[row.level] ?? ''}`
          }}</span>
        </dd>
      </div>
    </dl>
  </div>
</template>
<style scoped>
.radar-only {
  display: block !important;
}
.radar-only .radar-wrap svg {
  max-height: 230px;
}
.radar-only .radar-wrap p {
  font-size: 12px;
}
.six-chart {
  display: grid;
  grid-template-columns: minmax(170px, 0.8fr) 1fr;
  align-items: center;
  gap: 22px;
}
.radar-wrap svg {
  display: block;
  width: 100%;
  max-height: 270px;
}
.radar-wrap p {
  text-align: center;
  color: var(--muted);
  font-size: 13px;
}
.dimension-values > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 0;
  border-bottom: 1px solid var(--line);
}
dt {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
}
dt i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
dd {
  text-align: right;
}
dd strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--signal-dark);
}
dd span {
  display: block;
  font-size: 12px;
  color: var(--muted);
}
.compact {
  gap: 10px;
  grid-template-columns: minmax(130px, 0.85fr) 1fr;
}
.compact dt {
  font-size: 13px;
}
.compact dd span {
  font-size: 12px;
}
.compact .dimension-values > div {
  padding: 8px 0;
}
@media (max-width: 600px) {
  .six-chart {
    grid-template-columns: 1fr;
  }
  .radar-wrap svg {
    max-height: 210px;
  }
  .compact {
    grid-template-columns: 1fr;
  }
}
</style>
