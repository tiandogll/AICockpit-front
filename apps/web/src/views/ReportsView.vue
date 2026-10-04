<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowRight, ChevronLeft, ChevronRight, FileText, SlidersHorizontal } from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import AssessmentOriginNotice from '../components/AssessmentOriginNotice.vue'
import {
  dimensionLabels,
  formatWorkspaceDate,
  getWorkspaceReports,
  modeLabels,
  reportStatusLabels,
  scenarioLabels,
  type ReportSummary,
} from '../services/workspaceApi'

const access = useAccessStore()
const filters = reactive({ mode: '', scenario: '', status: '' })
const items = ref<ReportSummary[]>([])
const total = ref<number | null>(null)
const offset = ref(0)
const limit = 12
const loading = ref(false)
const error = ref('')
let generation = 0
async function load() {
  const request = ++generation
  items.value = []
  total.value = null
  error.value = ''
  loading.value = false
  if (!access.ready || access.error) return
  loading.value = true
  try {
    const page = await getWorkspaceReports({
      organization_id: access.organizationId,
      ...filters,
      limit,
      offset: offset.value,
    })
    if (request === generation) {
      items.value = page.items
      total.value = page.total
    }
  } catch (cause) {
    if (request === generation)
      error.value = cause instanceof Error ? cause.message : '无法读取能力报告，请稍后重试。'
  } finally {
    if (request === generation) loading.value = false
  }
}
watch(
  () => [
    access.organizationId,
    access.ready,
    access.error,
    filters.mode,
    filters.scenario,
    filters.status,
  ],
  () => {
    if (offset.value) offset.value = 0
    else void load()
  },
  { immediate: true },
)
watch(offset, load)
onMounted(() => {
  if (!access.ready && !access.error) void access.load()
})
onBeforeUnmount(() => {
  generation += 1
})
</script>

<template>
  <div class="reports-page">
    <header class="page-heading">
      <div>
        <p class="kicker">我的测评结果</p>
        <h1>能力报告</h1>
        <p>每一份报告，都保留当时的测评结果与评分证据。</p>
      </div>
      <RouterLink class="action-button" to="/assessment"
        >开始新测评<ArrowRight :size="16"
      /></RouterLink>
    </header>
    <section class="filter-panel" aria-label="报告筛选">
      <span class="filter-label"><SlidersHorizontal :size="17" />筛选报告</span
      ><label
        >测评模式<select v-model="filters.mode" data-testid="mode-filter">
          <option value="">全部模式</option>
          <option v-for="(label, value) in modeLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      ><label
        >应用场景<select v-model="filters.scenario">
          <option value="">全部场景</option>
          <option v-for="(label, value) in scenarioLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      ><label
        >评分状态<select v-model="filters.status">
          <option value="">全部状态</option>
          <option v-for="(label, value) in reportStatusLabels" :key="value" :value="value">
            {{ label }}
          </option>
        </select></label
      >
    </section>
    <div v-if="access.error" class="state-panel" role="alert">
      <p>{{ access.error }}</p>
      <button class="quiet-button" @click="access.load()">重新读取权限</button>
    </div>
    <div v-else-if="error" class="state-panel" role="alert">
      <p>{{ error }}</p>
      <button class="quiet-button" @click="load">重新加载</button>
    </div>
    <div v-else-if="loading || !access.ready" class="state-panel" role="status">
      正在读取能力报告…
    </div>
    <div v-else-if="!items.length" class="state-panel empty-state">
      <FileText :size="32" />
      <h2>没有符合条件的报告</h2>
      <p>
        {{
          filters.mode || filters.scenario || filters.status
            ? '调整筛选条件，查看其他测评记录。'
            : '完成一次测评后，你可以在这里回看报告和成长建议。'
        }}
      </p>
      <RouterLink
        v-if="!filters.mode && !filters.scenario && !filters.status"
        class="action-button"
        to="/assessment"
        >开始测评<ArrowRight :size="16"
      /></RouterLink>
    </div>
    <div v-else class="report-grid">
      <article v-for="report in items" :key="report.id" class="report-card">
        <header>
          <span class="report-icon"><FileText :size="23" /></span
          ><span class="status-badge" :class="report.status">{{
            reportStatusLabels[report.status] || report.status
          }}</span>
        </header>
        <h2>{{ report.name }}</h2>
        <AssessmentOriginNotice :origin="report.data_origin" />
        <p class="report-meta">
          {{ modeLabels[report.mode] || report.mode }} ·
          {{ scenarioLabels[report.scenario] || report.scenario }}
        </p>
        <dl class="dimension-grid">
          <div v-for="(label, code) in dimensionLabels" :key="code">
            <dt>{{ label }}</dt>
            <dd>
              {{
                report.dimensions.find((dimension) => dimension.code === code)?.index?.toFixed(1) ??
                '暂无数据'
              }}
            </dd>
          </div>
        </dl>
        <p class="missing-note">维度指数按原报告展示，缺失不计零分。</p>
        <footer>
          <span
            >{{ formatWorkspaceDate(report.completed_at, '完成时间未记录')
            }}<small>报告修订 {{ report.revision }}</small></span
          ><RouterLink class="text-link" :to="`/reports/${report.session_id}`"
            >查看报告<ArrowRight :size="15"
          /></RouterLink>
        </footer>
      </article>
    </div>
    <nav v-if="total !== null && total > 0" class="pagination" aria-label="报告分页">
      <span>共 {{ total }} 份报告 · 第 {{ Math.floor(offset / limit) + 1 }} 页</span>
      <div>
        <button
          class="quiet-button"
          :disabled="offset === 0 || loading"
          aria-label="上一页"
          @click="offset = Math.max(0, offset - limit)"
        >
          <ChevronLeft :size="16" /></button
        ><button
          class="quiet-button"
          data-testid="next-page"
          :disabled="offset + limit >= total || loading"
          aria-label="下一页"
          @click="offset += limit"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.reports-page {
  color: #183b46;
}
.page-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 28px;
}
.kicker {
  font-size: 13px;
  color: #137f91;
  font-weight: 700;
}
.page-heading h1 {
  font-size: 28px;
  letter-spacing: -0.035em;
  margin: 5px 0 8px;
}
.page-heading p:last-child {
  color: #5d727a;
  font-size: 13px;
}
.action-button,
.quiet-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  border-radius: 9px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.action-button {
  background: #137f91;
  color: #fff;
}
.quiet-button {
  background: #fff;
  border-color: #dce7eb;
  color: #183b46;
}
.quiet-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.filter-panel {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 18px;
  background: #fff;
  border: 1px solid #e3edf0;
  border-radius: 14px;
  padding: 18px 22px;
  margin-bottom: 24px;
}
.filter-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #183b46;
  font-weight: 600;
  margin-right: auto;
}
.filter-panel label {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12px;
  color: #5d727a;
}
.filter-panel select {
  min-width: 126px;
  min-height: 36px;
  padding: 6px 29px 6px 11px;
  border: 1px solid #dce7eb;
  border-radius: 7px;
  color: #183b46;
  background: #fff;
  font-size: 12px;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.report-card {
  padding: 24px;
  min-width: 0;
  background: #fff;
  border: 1px solid #e3edf0;
  border-radius: 16px;
  box-shadow: 0 4px 16px #183b4603;
}
.report-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 18px;
}
.report-icon {
  display: grid;
  place-items: center;
  width: 43px;
  height: 47px;
  background: #edf7f9;
  border-radius: 10px;
  color: #137f91;
}
.status-badge {
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  color: #946b26;
  background: #fff7e9;
}
.status-badge.complete {
  background: #edf7f3;
  color: #2f7965;
}
.report-card h2 {
  font-size: 18px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.report-meta {
  color: #5d727a;
  font-size: 12px;
  margin-top: 6px;
}
.dimension-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 12px;
  border-top: 1px solid #edf2f4;
  margin-top: 22px;
  padding-top: 20px;
}
.dimension-grid dt {
  font-size: 12px;
  color: #5d727a;
}
.dimension-grid dd {
  font-size: 17px;
  font-weight: 600;
  color: #137f91;
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.missing-note {
  margin-top: 18px;
  font-size: 12px;
  color: #7b8e95;
}
.report-card footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid #edf2f4;
  margin-top: 19px;
  padding-top: 16px;
}
.report-card footer > span {
  font-size: 12px;
  color: #5d727a;
}
.report-card footer small {
  display: block;
  font-size: 12px;
  margin-top: 3px;
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #137f91;
  white-space: nowrap;
}
.pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  color: #5d727a;
  font-size: 12px;
}
.pagination > div {
  display: flex;
  gap: 8px;
}
.pagination .quiet-button {
  padding: 8px 10px;
}
.state-panel {
  display: grid;
  justify-items: start;
  gap: 15px;
  padding: 34px;
  border: 1px solid #e3edf0;
  border-radius: 14px;
  background: #fff;
  color: #5d727a;
}
.state-panel[role='alert'] {
  color: #9a4e36;
}
.empty-state {
  justify-items: center;
  text-align: center;
  padding: 70px 24px;
}
.empty-state > svg {
  color: #137f91;
}
.empty-state h2 {
  color: #183b46;
  font-size: 18px;
}
.empty-state p {
  font-size: 13px;
}
button:focus-visible,
a:focus-visible,
select:focus-visible {
  outline: 3px solid #137f9160;
  outline-offset: 3px;
}
@media (max-width: 1300px) {
  .report-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .filter-label {
    flex-basis: 100%;
  }
}
@media (max-width: 650px) {
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
  }
  .report-grid {
    grid-template-columns: 1fr;
  }
  .filter-panel {
    padding: 17px;
    gap: 14px;
  }
  .filter-panel label {
    justify-content: space-between;
    width: 100%;
  }
  .filter-panel select {
    min-width: 170px;
  }
  .page-heading h1 {
    font-size: 25px;
  }
  .report-card {
    padding: 22px;
  }
  .pagination {
    align-items: flex-start;
  }
}
</style>
