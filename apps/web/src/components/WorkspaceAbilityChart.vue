<script setup lang="ts">
import { computed } from 'vue'
import { DIMENSIONS, LEVEL_NAMES } from '../domain/capabilities'
import type { WorkspaceDimension } from '../services/workspaceApi'

const props = defineProps<{ dimensions: WorkspaceDimension[] }>()
const colors = ['#6c27b4', '#11a5e4', '#7c94cd', '#f7a919', '#27bcd0', '#81a3bc']
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
      color: colors[i],
    }
  }),
)
const validCount = computed(() => rows.value.filter((row) => row.index !== null).length)
const complete = computed(() => validCount.value === 6)
const polygon = computed(() =>
  rows.value.map((row) => point(row.angle, (row.index ?? 0) * 0.76)).join(' '),
)
function point(angle: number, value: number) {
  return `${100 + Math.cos(angle) * value},${100 + Math.sin(angle) * value}`
}
function displayIndex(value: number | null) {
  return value === null ? '—' : Number.isInteger(value) ? String(value) : value.toFixed(1)
}
</script>

<template>
  <div class="workspace-ability-chart">
    <div class="radar-wrap">
      <div class="radar-plot">
        <svg
          viewBox="0 0 200 200"
          role="img"
          :aria-label="
            complete ? '六维能力指数，详细数值见列表' : '能力证据不完整，缺失维度不绘制为零'
          "
        >
          <polygon
            v-for="radius in [20, 39, 58, 77]"
            :key="radius"
            :points="rows.map((row) => point(row.angle, radius)).join(' ')"
            fill="none"
            stroke="#e0e3e6"
          />
          <line
            v-for="row in rows"
            :key="row.code"
            x1="100"
            y1="100"
            :x2="100 + Math.cos(row.angle) * 77"
            :y2="100 + Math.sin(row.angle) * 77"
            stroke="#eceef0"
          />
          <polygon
            v-if="complete"
            data-testid="radar-profile"
            :points="polygon"
            fill="#54b5c2"
            fill-opacity=".025"
            stroke="#5ebbc7"
            stroke-width="2.5"
          />
          <template v-for="row in rows" :key="row.code">
            <circle
              v-if="row.index !== null"
              data-evidence
              :cx="100 + Math.cos(row.angle) * row.index * 0.76"
              :cy="100 + Math.sin(row.angle) * row.index * 0.76"
              r="5"
              fill="#62bac5"
            />
          </template>
        </svg>
        <span
          class="radar-coverage"
          data-testid="radar-coverage"
          :aria-label="`${validCount} 个维度已有有效证据`"
          >{{ validCount }}/6</span
        >
      </div>
      <p>{{ complete ? '六维证据齐全' : validCount ? '部分维度待补充' : '等待测评结果' }}</p>
    </div>
    <dl class="dimension-values">
      <div v-for="row in rows" :key="row.code" :data-dimension="row.code">
        <dt><i :style="{ background: row.color }"></i>{{ row.name }}</dt>
        <dd
          :title="row.index === null ? '证据不足' : `${row.level} ${LEVEL_NAMES[row.level] || ''}`"
        >
          <strong :class="{ 'low-index': row.index !== null && row.index < 60 }">{{
            displayIndex(row.index)
          }}</strong
          ><span v-if="row.index === null" class="missing-note">证据不足</span
          ><span v-else class="visually-hidden"
            >{{ row.level }} {{ LEVEL_NAMES[row.level] || '' }}</span
          >
        </dd>
      </div>
    </dl>
  </div>
</template>

<style scoped>
.workspace-ability-chart {
  --u: var(--reference-unit, 1px);
  display: grid;
  grid-template-columns: calc(189 * var(--u)) minmax(0, 1fr);
  column-gap: calc(18 * var(--u));
  align-items: center;
  min-height: calc(199 * var(--u));
  color: #208c9c;
}
.radar-wrap {
  min-width: 0;
  padding-top: calc(5 * var(--u));
}
.radar-plot {
  position: relative;
}
.radar-plot svg {
  display: block;
  width: 100%;
  height: calc(168 * var(--u));
}
.radar-coverage {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  background: #ffffffd9;
  font-size: calc(25 * var(--u));
  line-height: 1.15;
  padding: 0 calc(3 * var(--u));
  font-variant-numeric: tabular-nums;
}
.radar-wrap p {
  margin: calc(-4 * var(--u)) 0 0;
  text-align: center;
  font-size: calc(18 * var(--u));
  line-height: calc(25 * var(--u));
  font-weight: 600;
}
.dimension-values {
  min-width: 0;
  margin: 0;
}
.dimension-values > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(8 * var(--u));
  min-height: calc(36 * var(--u));
  border-bottom: 1px solid #c2c2c2;
}
.dimension-values dt {
  display: flex;
  align-items: center;
  gap: calc(10 * var(--u));
  font-size: calc(17 * var(--u));
  font-weight: 600;
  white-space: nowrap;
}
.dimension-values dt i {
  width: calc(8 * var(--u));
  height: calc(8 * var(--u));
  border-radius: 50%;
  flex: none;
}
.dimension-values dd {
  margin: 0;
  display: flex;
  align-items: center;
  gap: calc(5 * var(--u));
  text-align: right;
  white-space: nowrap;
}
.dimension-values dd strong {
  font-size: calc(18 * var(--u));
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.dimension-values dd .low-index {
  color: #eea014;
}
.missing-note {
  font-size: calc(12 * var(--u));
  color: #71828c;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
@media (max-width: 960px) {
  .workspace-ability-chart {
    --u: 1px;
    grid-template-columns: minmax(140px, 0.8fr) 1fr;
    gap: 20px;
  }
  .radar-plot svg {
    height: 180px;
  }
}
@media (max-width: 520px) {
  .workspace-ability-chart {
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 9px;
  }
  .radar-plot svg {
    height: 145px;
  }
  .radar-coverage {
    font-size: 21px;
  }
  .radar-wrap p {
    font-size: 12px;
  }
  .dimension-values dt {
    gap: 5px;
    font-size: 13px;
  }
  .dimension-values dd strong {
    font-size: 14px;
  }
  .missing-note {
    font-size: 10px;
  }
  .dimension-values > div {
    min-height: 31px;
    gap: 5px;
  }
}
</style>
