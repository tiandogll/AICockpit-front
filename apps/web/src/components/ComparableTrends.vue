<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  dimensionLabels,
  formatWorkspaceDate,
  getWorkspaceTrends,
  modeLabels,
  scenarioLabels,
  type TrendGroup,
} from '../services/workspaceApi'
import { LEVEL_NAMES } from '../domain/capabilities'

const props = defineProps<{
  organizationId: string
  ready: boolean
  mode: string
  scenario: string
}>()
const groups = ref<TrendGroup[]>([])
const selectedIndex = ref('0')
const total = ref(0)
const offset = ref(0)
const limit = 100
const loading = ref(false)
const error = ref('')
const plotElement = ref<HTMLElement | null>(null)
const plotWidth = ref(600)
let plotObserver: ResizeObserver | undefined
watch(plotElement, (element) => {
  plotObserver?.disconnect()
  if (!element || typeof ResizeObserver === 'undefined') return
  plotObserver = new ResizeObserver(([entry]) => {
    if (entry && entry.contentRect.width > 0) plotWidth.value = entry.contentRect.width
  })
  plotObserver.observe(element)
})
let generation = 0
const selected = computed(() => groups.value[Number(selectedIndex.value)])
const points = computed(() =>
  (selected.value?.points ?? []).map((point) => {
    const time = point.completed_at ? new Date(point.completed_at).getTime() : Number.NaN
    const valid =
      Number.isFinite(time) &&
      typeof point.index === 'number' &&
      Number.isFinite(point.index) &&
      point.index >= 0 &&
      point.index <= 100 &&
      point.evidence_count > 0
    return { ...point, time, valid }
  }),
)
const validPoints = computed(() => points.value.filter((point) => point.valid))
const chronological = computed(() =>
  [...validPoints.value].sort((a, b) => a.time - b.time || a.report_id.localeCompare(b.report_id)),
)
const recentPair = computed(() => chronological.value.slice(-2))
const comparisonDialog = ref<HTMLDialogElement | null>(null)
const firstReport = ref('')
const secondReport = ref('')
const pair = computed(() => {
  const first = chronological.value.find((point) => point.report_id === firstReport.value)
  const second = chronological.value.find((point) => point.report_id === secondReport.value)
  return first && second && first.report_id !== second.report_id && first.time < second.time
    ? ([first, second] as const)
    : null
})
function compare() {
  firstReport.value = recentPair.value[0]?.report_id ?? ''
  secondReport.value = recentPair.value.length > 1 ? recentPair.value[1]!.report_id : ''
  comparisonDialog.value?.showModal()
}
watch(selectedIndex, () => {
  comparisonDialog.value?.close?.()
  firstReport.value = ''
  secondReport.value = ''
})
const span = computed(() => {
  const times = points.value.map((point) => point.time).filter(Number.isFinite)
  return { min: Math.min(...times), max: Math.max(...times) }
})
function x(time: number) {
  return span.value.max === span.value.min
    ? plotWidth.value / 2
    : 44 + ((time - span.value.min) / (span.value.max - span.value.min)) * (plotWidth.value - 88)
}
function y(index: number) {
  return 180 - index * 1.5
}
const segments = computed(() => {
  const result: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 1) result.push(current.join(' '))
    current = []
  }
  for (const point of points.value) {
    if (point.valid) current.push(`${x(point.time)},${y(point.index)}`)
    else flush()
  }
  flush()
  return result
})
function label(group: TrendGroup) {
  return `${dimensionLabels[group.dimension_code] ?? group.dimension_code} · ${modeLabels[group.mode] ?? group.mode} · ${scenarioLabels[group.scenario] ?? group.scenario} · 蓝图 v${group.blueprint_version ?? '未记录'} · ${group.blueprint_version_id?.slice(0, 8) ?? '未记录版本 ID'}`
}
async function load() {
  comparisonDialog.value?.close?.()
  const ticket = ++generation
  groups.value = []
  selectedIndex.value = '0'
  total.value = 0
  error.value = ''
  loading.value = false
  if (!props.ready || !props.organizationId) return
  loading.value = true
  try {
    const page = await getWorkspaceTrends({
      organization_id: props.organizationId,
      mode: props.mode,
      scenario: props.scenario,
      limit,
      offset: offset.value,
    })
    if (!Array.isArray(page.groups) || !Number.isInteger(page.total) || page.total < 0)
      throw new Error('可比记录格式异常，请重新读取。')
    if (ticket === generation) {
      groups.value = page.groups
      total.value = page.total
    }
  } catch (caught) {
    if (ticket === generation)
      error.value = caught instanceof Error ? caught.message : '无法读取成长记录，请重试。'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function changeWindow(next: number) {
  offset.value = next
  void load()
}
watch(
  () => [props.organizationId, props.ready, props.mode, props.scenario],
  () => {
    offset.value = 0
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation += 1
  plotObserver?.disconnect()
})
</script>

<template>
  <section
    v-if="selected && chronological.length && !loading && !error"
    class="growth-summary"
    aria-label="当前比较组摘要"
  >
    <div>
      <span>GROWTH SIGNAL</span>
      <h2>
        {{ dimensionLabels[selected.dimension_code] ?? selected.dimension_code }} · 同口径变化
        <b v-if="chronological.length > 1"
          >{{
            chronological[chronological.length - 1]!.index - chronological[0]!.index >= 0
              ? '+'
              : ''
          }}{{
            (chronological[chronological.length - 1]!.index - chronological[0]!.index).toFixed(1)
          }}</b
        >
      </h2>
      <p>当前报告窗口内的首末记录比较，不代表综合能力或训练因果效果。</p>
    </div>
    <div>
      <small>有效测量点</small><strong>{{ chronological.length }}</strong>
    </div>
    <div>
      <small>最近维度指数</small
      ><strong>{{ chronological[chronological.length - 1]!.index.toFixed(1) }}</strong>
    </div>
    <div>
      <small>最近维度等级</small
      ><strong>{{ chronological[chronological.length - 1]!.level }}</strong>
    </div>
  </section>
  <section class="comparable-trends" aria-labelledby="growth-heading">
    <header class="trend-heading">
      <div>
        <p class="eyebrow">个人成长趋势 · 同一测量标准下的变化</p>
        <h2 id="growth-heading" aria-label="个人成长趋势">能力成长曲线</h2>
      </div>
      <span class="scope-note">仅使用已定稿报告</span>
    </header>
    <div v-if="error" class="trend-state" role="alert">
      {{ error }} <button type="button" data-testid="retry-trends" @click="load">重新读取</button>
    </div>
    <p v-else-if="loading || !ready" class="trend-state" role="status">正在读取可比记录…</p>
    <p v-else-if="!groups.length" class="trend-state">
      暂无可比记录。完成并定稿一次测评后，这里会保留真实测量点；同版本复测后可查看变化。
    </p>
    <template v-else>
      <label class="group-picker"
        >选择比较组<select v-model="selectedIndex" data-testid="trend-group">
          <option v-for="(group, index) in groups" :key="index" :value="String(index)">
            {{ label(group) }} · {{ group.construct === 'objective' ? '客观测量' : '综合证据' }} ·
            {{ group.method_version }} · {{ group.scoring_policy_version ?? '原始客观策略' }}
          </option>
        </select></label
      >
      <template v-if="selected">
        <details class="measurement-details">
          <summary>查看测量口径与版本</summary>
          <p class="explanation">
            不同维度、模式、场景或评分版本分别展示；训练记录不计入正式分数。筛选条件沿用下方历史记录的模式与场景。
          </p>
          <dl class="version-key">
            <div>
              <dt>能力构念</dt>
              <dd>{{ selected.construct === 'objective' ? '客观测量' : '综合证据' }}</dd>
            </div>
            <div>
              <dt>方法版本</dt>
              <dd>{{ selected.method_version }}</dd>
            </div>
            <div>
              <dt>评分策略</dt>
              <dd>{{ selected.scoring_policy_version ?? '原始客观策略' }}</dd>
            </div>
            <div>
              <dt>题卷版本</dt>
              <dd>
                蓝图 v{{ selected.blueprint_version ?? '未记录' }} ·
                {{ selected.blueprint_version_id ?? '未记录 ID，不跨报告比较' }}
              </dd>
            </div>
          </dl>
        </details>
        <div class="trend-reference-columns">
          <div>
            <div v-if="validPoints.length" ref="plotElement" class="plot-wrap">
              <svg
                :viewBox="`0 0 ${plotWidth} 216`"
                role="img"
                aria-label="当前比较组的能力证据指数，完整日期和数值见下方记录表"
              >
                <g v-for="tick in [0, 25, 50, 75, 100]" :key="tick">
                  <line x1="44" :x2="plotWidth - 44" :y1="y(tick)" :y2="y(tick)" stroke="#dcebef" />
                  <text x="33" :y="y(tick) + 4" text-anchor="end">{{ tick }}</text>
                </g>
                <polyline
                  v-for="(segment, index) in segments"
                  :key="index"
                  data-testid="trend-line"
                  :points="segment"
                  fill="none"
                  stroke="#137f91"
                  stroke-width="2.5"
                />
                <circle
                  v-for="point in validPoints"
                  :key="point.report_id"
                  data-testid="trend-point"
                  :cx="x(point.time)"
                  :cy="y(point.index)"
                  r="4.5"
                  fill="#fff"
                  stroke="#08afbd"
                  stroke-width="2"
                >
                  <title>
                    {{ formatWorkspaceDate(point.completed_at) }} · {{ point.index.toFixed(1) }}
                  </title>
                </circle>
                <text x="44" y="205">
                  {{ formatWorkspaceDate(validPoints[0]?.completed_at).slice(0, 10) }}
                </text>
                <text :x="plotWidth - 44" y="205" text-anchor="end">
                  {{
                    formatWorkspaceDate(validPoints[validPoints.length - 1]?.completed_at).slice(
                      0,
                      10,
                    )
                  }}
                </text>
              </svg>
            </div>
            <p v-if="validPoints.length === 1" class="chart-note">
              只有一次有效记录，暂不判断成长趋势。完成相同测量标准的复测后再比较。
            </p>
            <p v-else-if="!validPoints.length" class="chart-note">当前组证据不足，不绘制指数。</p>
            <p v-else class="chart-note">
              纵轴为 0–100
              证据指数；缺失证据不计零，也不跨缺失记录连线。不代表人群常模或训练因果效果。
            </p>
          </div>
          <aside class="latest-comparison">
            <span>LATEST CHANGE</span>
            <h3>最近两次对比</h3>
            <p>
              {{ dimensionLabels[selected.dimension_code] ?? selected.dimension_code }} ·
              同一测量口径
            </p>
            <template v-if="recentPair.length === 2"
              ><div class="pair-values">
                <div v-for="point in recentPair" :key="point.report_id">
                  <small>{{ formatWorkspaceDate(point.completed_at).slice(0, 10) }}</small
                  ><strong>{{ point.index.toFixed(1) }}</strong
                  ><b>{{ point.level }}</b>
                </div>
              </div>
              <p class="pair-delta">
                证据指数变化
                <strong
                  >{{ recentPair[1]!.index - recentPair[0]!.index >= 0 ? '+' : ''
                  }}{{ (recentPair[1]!.index - recentPair[0]!.index).toFixed(1) }}</strong
                >
              </p></template
            >
            <p v-else>至少需要两份同口径、有证据的报告，才能比较变化。</p>
            <button type="button" :disabled="chronological.length < 2" @click="compare">
              选择记录对比
            </button>
            <p class="pair-note">不代表综合能力涨分，也不证明训练的因果效果。</p>
          </aside>
        </div>
        <details class="trend-record-details">
          <summary>查看原始测量记录与报告</summary>
          <div class="trend-table">
            <table>
              <caption class="visually-hidden">
                当前比较组的原始测量记录
              </caption>
              <thead>
                <tr>
                  <th>完成时间</th>
                  <th>证据指数 / 等级</th>
                  <th>证据数</th>
                  <th>原始报告</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="point in points" :key="point.report_id">
                  <td>{{ formatWorkspaceDate(point.completed_at) }}</td>
                  <td>
                    {{
                      point.valid
                        ? `${point.index.toFixed(1)} · ${LEVEL_NAMES[point.level] ?? point.level}`
                        : '证据不足'
                    }}
                  </td>
                  <td>{{ point.evidence_count }}</td>
                  <td>
                    <RouterLink :to="`/reports/${encodeURIComponent(point.session_id)}`"
                      >查看报告 · 修订 {{ point.revision }}</RouterLink
                    >
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      </template>
    </template>
    <footer v-if="!loading && !error && total > limit" class="trend-pagination">
      <span
        >最近 {{ offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }} 份定稿报告 ·
        仅连接当前窗口内的可比记录</span
      >
      <div>
        <button
          type="button"
          :disabled="offset === 0"
          @click="changeWindow(Math.max(0, offset - limit))"
        >
          较新记录</button
        ><button
          type="button"
          data-testid="older-trends"
          :disabled="offset + limit >= total"
          @click="changeWindow(offset + limit)"
        >
          更早记录
        </button>
      </div>
    </footer>
    <dialog
      v-if="chronological.length >= 2"
      ref="comparisonDialog"
      class="trend-comparison-dialog"
      aria-label="可比报告对比"
    >
      <header>
        <h2>同口径记录对比</h2>
        <button aria-label="关闭对比" @click="comparisonDialog?.close()">关闭</button>
      </header>
      <p>只列出当前维度、场景、模式和版本组内的有效报告。请选择时间较早和较晚的两份记录。</p>
      <label
        >较早记录<select v-model="firstReport" data-testid="comparison-first">
          <option value="">请选择</option>
          <option v-for="point in chronological" :key="point.report_id" :value="point.report_id">
            {{ formatWorkspaceDate(point.completed_at) }} · {{ point.index.toFixed(1) }} · R{{
              point.revision
            }}
          </option>
        </select></label
      ><label
        >较晚记录<select v-model="secondReport" data-testid="comparison-second">
          <option value="">请选择</option>
          <option v-for="point in chronological" :key="point.report_id" :value="point.report_id">
            {{ formatWorkspaceDate(point.completed_at) }} · {{ point.index.toFixed(1) }} · R{{
              point.revision
            }}
          </option>
        </select></label
      ><template v-if="pair"
        ><div class="pair-values">
          <div v-for="point in pair" :key="point.report_id">
            <small>{{ formatWorkspaceDate(point.completed_at) }}</small
            ><strong>{{ point.index.toFixed(1) }} · {{ point.level }}</strong
            ><RouterLink :to="`/reports/${encodeURIComponent(point.session_id)}`"
              >查看原报告 · 修订 {{ point.revision }}</RouterLink
            >
          </div>
        </div>
        <p data-testid="comparison-delta">
          指数差值：{{ (pair[1].index - pair[0].index).toFixed(1) }}；本次对比仅限
          {{ dimensionLabels[selected?.dimension_code ?? ''] ?? '当前维度' }}。
        </p></template
      >
      <p v-else role="status">请选择两份不同、时间顺序正确的有效报告。</p>
    </dialog>
  </section>
</template>

<style scoped>
.comparable-trends {
  padding: 24px;
  margin-bottom: 24px;
  border: 1px solid #d6e8ed;
  border-radius: 16px;
  background: #fff;
  color: #183b46;
}
.measurement-details {
  margin: 8px 0 12px;
  font-size: 12px;
  color: #6683a3;
}
.measurement-details summary {
  cursor: pointer;
}
.trend-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.eyebrow {
  font-size: 12px;
  color: #137f91;
  font-weight: 700;
}
.trend-heading h2 {
  font-size: 22px;
  margin: 5px 0;
}
.scope-note {
  font-size: 12px;
  color: #476975;
  background: #eef8fa;
  padding: 7px 10px;
  border-radius: 7px;
}
.explanation,
.chart-note {
  font-size: 13px;
  color: #5d727a;
  line-height: 1.7;
  margin: 12px 0;
}
.group-picker {
  display: grid;
  gap: 8px;
  font-size: 13px;
  font-weight: 700;
  margin-top: 18px;
}
.group-picker select {
  max-width: 100%;
  width: 100%;
  padding: 11px;
  border: 1px solid #bed9e1;
  border-radius: 8px;
  color: inherit;
  background: #f7fcfd;
  font: inherit;
}
.version-key {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 24px;
  margin: 16px 0;
  font-size: 12px;
}
.version-key div {
  display: grid;
  grid-template-columns: 65px minmax(0, 1fr);
  gap: 8px;
}
.version-key dt {
  color: #5d727a;
}
.version-key dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.plot-wrap {
  max-width: 850px;
  margin: auto;
}
.plot-wrap svg {
  display: block;
  width: 100%;
  max-height: 300px;
}
.plot-wrap text {
  fill: #5d727a;
  font-size: 11px;
}
.trend-table {
  overflow: auto;
}
.trend-table table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 13px;
  white-space: nowrap;
}
.trend-table th,
.trend-table td {
  padding: 11px 12px;
  border-bottom: 1px solid #e0edf0;
}
.trend-table th {
  background: #f1f8fa;
  color: #476975;
}
.trend-table a {
  color: #137f91;
}
.trend-state {
  padding: 20px 0;
  font-size: 14px;
  line-height: 1.7;
}
.trend-pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-top: 16px;
  font-size: 12px;
  color: #5d727a;
}
.trend-pagination div {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
button {
  border: 1px solid #bfdce4;
  border-radius: 7px;
  background: #f3fafc;
  color: #166b7b;
  cursor: pointer;
  padding: 8px 12px;
  font: inherit;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button:focus-visible,
select:focus-visible {
  outline: 2px solid #137f91;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .comparable-trends {
    padding: 17px;
  }
  .trend-heading,
  .trend-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
  .version-key {
    grid-template-columns: 1fr;
  }
  .scope-note {
    align-self: flex-start;
  }
  .plot-wrap {
    margin: 0 -8px;
  }
}
</style>
<style scoped>
.growth-summary {
  display: grid;
  grid-template-columns: 2.8fr repeat(3, 1fr);
  align-items: center;
  gap: 22px;
  background: linear-gradient(110deg, #ecfcfe, #e6f9fc);
  border: 1px solid #bde8f1;
  border-radius: 12px;
  padding: 14px 24px;
  margin-bottom: 14px;
  color: #073b59;
}
.growth-summary > div + div {
  border-left: 1px solid #bde8f1;
  padding-left: 24px;
}
.growth-summary span {
  color: #009fae;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
}
.growth-summary h2 {
  font-size: 21px;
  margin: 4px 0;
}
.growth-summary h2 b {
  color: #00aebb;
  margin-left: 6px;
}
.growth-summary p,
.growth-summary small {
  color: #6683a3;
  font-size: 12px;
}
.growth-summary strong {
  display: block;
  font-size: 27px;
}
@media (min-width: 1100px) {
  .comparable-trends {
    position: relative;
    padding: 14px 18px;
    margin-bottom: 12px;
  }
  .trend-heading {
    width: 35%;
    min-height: 38px;
  }
  .trend-heading .eyebrow,
  .scope-note {
    display: none;
  }
  .trend-heading h2 {
    font-size: 21px;
  }
  .group-picker {
    position: absolute;
    top: 14px;
    right: 18px;
    width: 58%;
    margin: 0;
    font-size: 0;
    gap: 0;
  }
  .group-picker select {
    font-size: 12px;
    padding: 8px;
  }
  .explanation {
    margin: 0 0 3px;
    font-size: 12px;
  }
  .measurement-details {
    margin: 0 0 5px;
  }
  .plot-wrap {
    margin-top: 0;
  }
  .plot-wrap svg {
    height: 228px;
    min-height: 0;
  }
  .trend-reference-columns {
    gap: 16px;
  }
  .latest-comparison {
    padding: 12px 16px;
  }
  .latest-comparison h3 {
    font-size: 20px;
  }
  .latest-comparison p {
    margin: 4px 0;
  }
  .pair-values {
    margin: 8px 0;
  }
  .pair-values > div {
    padding: 8px;
  }
  .latest-comparison .pair-delta {
    padding-block: 5px;
  }
  .latest-comparison .pair-note {
    font-size: 11px;
  }
  .trend-record-details {
    margin-top: 6px;
    padding-top: 6px;
  }
  .trend-pagination {
    margin-top: 6px;
  }
}
@media (max-width: 700px) {
  .growth-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    padding: 16px;
  }
  .growth-summary > div:first-child {
    grid-column: 1 / -1;
  }
  .growth-summary > div + div {
    padding-left: 8px;
  }
  .growth-summary h2 {
    font-size: 19px;
  }
  .growth-summary strong {
    font-size: 22px;
  }
}
</style>
<style scoped>
.comparable-trends {
  border-color: #bde8f1;
  border-radius: 12px;
  padding: 20px;
  color: #073b59;
}
.trend-heading h2 {
  font-size: 22px;
}
.trend-reference-columns {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(250px, 1fr);
  gap: 20px;
}
.plot-wrap {
  margin-top: 18px;
}
.plot-wrap svg {
  width: 100%;
  min-height: 230px;
}
.plot-wrap svg polyline {
  stroke: #08afbd;
  stroke-width: 2.5;
}
.latest-comparison {
  border: 1px solid #bde8f1;
  border-radius: 11px;
  padding: 18px;
  align-self: start;
  background: #fff;
}
.latest-comparison > span {
  color: #3477ee;
  font-size: 12px;
  letter-spacing: 1px;
  font-weight: 700;
}
.latest-comparison h3 {
  font-size: 21px;
  margin: 2px 0 8px;
}
.latest-comparison p {
  font-size: 12px;
  color: #6683a3;
  margin: 8px 0;
}
.pair-values {
  display: flex;
  gap: 16px;
  margin: 14px 0;
}
.pair-values > div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  text-align: center;
  background: #eafbfd;
  border-radius: 10px;
  padding: 14px 8px;
}
.pair-values small {
  font-size: 12px;
  color: #6683a3;
}
.pair-values strong {
  font-size: 26px;
  color: #073b59;
  margin: 3px 0;
}
.pair-values b,
.pair-values a {
  font-size: 13px;
  color: #2875e8;
}
.latest-comparison .pair-delta {
  display: flex;
  justify-content: space-between;
  padding-block: 12px;
  border-block: 1px solid #e0edf4;
}
.pair-delta strong {
  font-size: 20px;
  color: #009ca8;
}
.latest-comparison button {
  width: 100%;
  padding: 10px;
  background: #08a7b7;
  color: #fff;
  border: 0;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 700;
}
.latest-comparison button:disabled {
  background: #d9e9ee;
  color: #567587;
  cursor: not-allowed;
}
.pair-note {
  line-height: 1.6;
}
.trend-record-details {
  margin-top: 16px;
  border-top: 1px solid #dcebf1;
  padding-top: 12px;
}
.trend-record-details summary {
  cursor: pointer;
  color: #007a95;
  font-weight: 600;
}
.version-key {
  font-size: 12px;
  background: #f5fbfd;
  border-radius: 8px;
  padding: 10px !important;
}
.trend-comparison-dialog {
  margin: auto;
  max-width: 680px;
  width: calc(100vw - 32px);
  max-height: 85vh;
  overflow: auto;
  padding: 24px;
  border: 1px solid #bde8f1;
  border-radius: 14px;
  color: #073b59;
}
.trend-comparison-dialog::backdrop {
  background: #173d5366;
}
.trend-comparison-dialog header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
.trend-comparison-dialog header button {
  border: 0;
  background: none;
  color: #007c99;
  cursor: pointer;
}
.trend-comparison-dialog p {
  font-size: 14px;
  color: #6683a3;
  margin: 16px 0;
}
.trend-comparison-dialog label {
  display: grid;
  gap: 6px;
  font-size: 14px;
  margin: 12px 0;
}
.trend-comparison-dialog select {
  max-width: 100%;
  padding: 10px;
  border: 1px solid #bde8f1;
  border-radius: 8px;
  background: white;
  color: #073b59;
}
@media (max-width: 1000px) {
  .trend-reference-columns {
    grid-template-columns: 1fr;
  }
  .latest-comparison {
    max-width: none;
  }
}
@media (max-width: 560px) {
  .comparable-trends {
    padding: 15px;
  }
  .pair-values {
    gap: 8px;
  }
  .pair-values strong {
    font-size: 21px;
  }
}
</style>
<style scoped>
@media (min-width: 1100px) {
  .comparable-trends {
    padding: 12px 18px;
    margin-bottom: 12px;
  }
  .trend-heading h2 {
    font-size: 21px;
  }
  .plot-wrap {
    margin-top: 0;
  }
  .plot-wrap svg {
    height: 220px;
    min-height: 0;
  }
  .latest-comparison {
    padding: 10px 14px;
  }
  .latest-comparison p {
    margin: 3px 0;
  }
  .latest-comparison .pair-delta {
    padding-block: 5px;
  }
  .pair-values {
    margin: 8px 0;
  }
  .pair-values > div {
    padding: 6px;
  }
  .trend-record-details {
    margin-top: 6px;
    padding-top: 6px;
  }
}
</style>
<style scoped>
@media (min-width: 1100px) {
  .comparable-trends {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(250px, 1fr);
    column-gap: 18px;
    align-items: start;
  }
  .trend-heading {
    grid-column: 1;
    grid-row: 1;
    width: auto;
  }
  .group-picker {
    right: calc(25% + 22px);
    width: 43%;
  }
  .trend-reference-columns {
    display: contents;
  }
  .trend-reference-columns > div {
    grid-column: 1;
    grid-row: 2;
  }
  .latest-comparison {
    grid-column: 2;
    grid-row: 1 / 5;
  }
  .measurement-details {
    grid-column: 1;
    grid-row: 3;
    margin: 0;
  }
  .trend-record-details {
    grid-column: 1;
    grid-row: 4;
    margin: 0;
    padding-top: 4px;
  }
  .trend-pagination {
    grid-column: 1 / -1;
  }
  .trend-state {
    grid-column: 1 / -1;
  }
  .plot-wrap {
    max-width: none;
  }
  .plot-wrap svg {
    height: 205px;
    max-height: none;
  }
  .chart-note {
    margin: 3px 0;
    font-size: 11px;
  }
  .latest-comparison .pair-note {
    font-size: 11px;
  }
  .growth-summary {
    padding-block: 10px;
  }
}
</style>
