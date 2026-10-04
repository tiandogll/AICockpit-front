<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  SlidersHorizontal,
} from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import ComparableTrends from '../components/ComparableTrends.vue'
import AssessmentOriginNotice from '../components/AssessmentOriginNotice.vue'
import {
  formatWorkspaceDate,
  getWorkspaceHistory,
  modeLabels,
  reportStatusLabels,
  scenarioLabels,
  type HistoryEntry,
} from '../services/workspaceApi'

const access = useAccessStore()
const filters = reactive({ mode: '', scenario: '', status: '' })
const statuses: Record<string, string> = {
  active: '进行中',
  completed: '已完成',
  abandoned: '已结束',
}
const items = ref<HistoryEntry[]>([])
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
    const page = await getWorkspaceHistory({
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
      error.value = cause instanceof Error ? cause.message : '无法读取测评历史，请稍后重试。'
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
  <div class="history-page">
    <header class="page-heading">
      <div>
        <p class="kicker">ASSESSMENT ARCHIVE</p>
        <h1>历史记录</h1>
        <p>继续未完成的测评，或查看已封存的报告。</p>
      </div>
      <RouterLink class="quiet-button" to="/reports"><FileText :size="16" />能力报告</RouterLink>
    </header>
    <ComparableTrends
      :organization-id="access.organizationId"
      :ready="access.ready && !access.error"
      :mode="filters.mode"
      :scenario="filters.scenario"
    />
    <section class="filter-panel" aria-label="历史记录筛选">
      <span class="filter-label"><SlidersHorizontal :size="17" />筛选记录</span
      ><label
        >测评模式<select v-model="filters.mode">
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
        >测评状态<select v-model="filters.status" data-testid="status-filter">
          <option value="">全部状态</option>
          <option v-for="(label, value) in statuses" :key="value" :value="value">
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
      正在读取测评历史…
    </div>
    <div v-else-if="!items.length" class="state-panel empty-state">
      <History :size="32" />
      <h2>暂无符合条件的测评</h2>
      <p>调整筛选条件，或开始一次新的测评。</p>
      <RouterLink class="action-button" to="/assessment"
        >开始测评<ArrowRight :size="16"
      /></RouterLink>
    </div>
    <section v-else class="history-list" aria-label="测评记录">
      <header class="history-table-heading">
        <div>
          <h2>测评记录</h2>
          <p>报告与会话状态来自本人的测评记录</p>
        </div>
        <span>共 {{ total }} 条</span>
      </header>
      <div class="history-table-scroll">
        <table>
          <thead>
            <tr>
              <th>记录</th>
              <th>类型</th>
              <th>作答情况</th>
              <th>完成时间</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="entry in items" :key="entry.id">
              <td>
                <div class="record-name">
                  <span class="record-symbol" :class="entry.mode">{{
                    entry.mode === 'standard'
                      ? '标'
                      : entry.mode === 'specialized'
                        ? '专'
                        : entry.mode === 'rapid'
                          ? '速'
                          : '固'
                  }}</span>
                  <div>
                    <strong>{{ entry.name }}</strong
                    ><small>{{ scenarioLabels[entry.scenario] || entry.scenario }}</small
                    ><AssessmentOriginNotice :origin="entry.data_origin" />
                  </div>
                </div>
              </td>
              <td>{{ modeLabels[entry.mode] || entry.mode }}</td>
              <td>
                已保存 {{ entry.answered }} 题<small>{{
                  entry.max_items === null ? '最大题量未记录' : `题量上限 ${entry.max_items} 题`
                }}</small>
              </td>
              <td>
                {{
                  formatWorkspaceDate(
                    entry.completed_at ?? entry.ended_at,
                    entry.status === 'active' ? '尚未完成' : '未记录',
                  )
                }}<small>开始：{{ formatWorkspaceDate(entry.created_at) }}</small>
              </td>
              <td>
                <span class="status-badge" :class="entry.status">{{
                  entry.ended_reason === 'timeout'
                    ? '已超时 · 未完成'
                    : entry.ended_reason === 'user_ended'
                      ? '提前结束 · 未完成'
                      : statuses[entry.status] || entry.status
                }}</span
                ><small v-if="entry.report_id">{{
                  reportStatusLabels[entry.report_status ?? ''] || '报告状态未记录'
                }}</small>
              </td>
              <td>
                <RouterLink
                  v-if="entry.status === 'active'"
                  class="text-link"
                  :to="`/assessment/${entry.session_id}`"
                  >继续测评 <ArrowRight :size="14" /></RouterLink
                ><RouterLink
                  v-else-if="entry.report_id"
                  class="text-link"
                  :to="`/reports/${entry.session_id}`"
                  >查看报告 <ArrowRight :size="14" /></RouterLink
                ><RouterLink v-else class="text-link" :to="`/assessment/${entry.session_id}`"
                  >只读回看 <ArrowRight :size="14"
                /></RouterLink>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <nav v-if="total !== null && total > 0" class="pagination" aria-label="历史记录分页">
      <span>共 {{ total }} 条记录 · 第 {{ Math.floor(offset / limit) + 1 }} 页</span>
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
          :disabled="offset + limit >= total || loading"
          aria-label="下一页"
          @click="offset += limit"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </nav>
    <aside class="comparison-note">
      <History :size="18" />
      <p>
        历史结果保留测评当时的评分版本。不同测评模式、场景或能力构念的结果不直接比较，也不合并为成长百分比。
      </p>
    </aside>
  </div>
</template>

<style scoped>
.history-page {
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
.history-list {
  padding: 6px 26px;
  background: #fff;
  border: 1px solid #e3edf0;
  border-radius: 16px;
}
.history-row {
  display: flex;
  gap: 18px;
  align-items: center;
  padding: 26px 0;
  border-bottom: 1px solid #e9f0f2;
}
.history-row:last-child {
  border: 0;
}
.timeline-marker {
  align-self: flex-start;
  display: grid;
  place-items: center;
  flex: none;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #edf7f9;
  color: #137f91;
}
.history-content {
  flex: 1;
  min-width: 0;
}
.history-content header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.history-content h2 {
  font-size: 17px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.status-badge {
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 12px;
  color: #5d727a;
  background: #f0f4f5;
}
.status-badge.active {
  color: #137f91;
  background: #eaf6f8;
}
.status-badge.completed {
  color: #287765;
  background: #edf7f3;
}
.metadata {
  color: #5d727a;
  font-size: 12px;
  margin: 8px 0 14px;
}
.metadata > span {
  display: block;
  margin-top: 4px;
}
.history-content dl {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 26px;
  font-size: 12px;
}
.history-content dl > div {
  display: flex;
  gap: 8px;
}
.history-content dt {
  color: #7a8e95;
}
.history-content dd {
  color: #5d727a;
}
.record-action {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 9px;
  flex: none;
  font-size: 12px;
  color: #5d727a;
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
.comparison-note {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 20px 4px;
  color: #5d727a;
  font-size: 12px;
}
.comparison-note svg {
  flex: none;
  color: #137f91;
}
button:focus-visible,
a:focus-visible,
select:focus-visible {
  outline: 3px solid #137f9160;
  outline-offset: 3px;
}
@media (max-width: 1300px) {
  .filter-label {
    flex-basis: 100%;
  }
}
@media (max-width: 700px) {
  .page-heading {
    align-items: flex-start;
    flex-direction: column;
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
  .history-list {
    padding: 0 17px;
  }
  .history-row {
    flex-wrap: wrap;
    gap: 12px;
  }
  .history-content {
    flex-basis: calc(100% - 52px);
  }
  .record-action {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    margin-left: 50px;
    flex: 1;
  }
  .history-content dl {
    flex-direction: column;
    gap: 6px;
  }
  .history-content h2 {
    font-size: 16px;
  }
}
</style>
<style scoped>
.history-page {
  color: #073b59;
  position: relative;
}
.page-heading {
  margin-bottom: 5px;
}
.page-heading h1 {
  font-size: 32px;
  color: #073b59;
  margin: 3px 0;
  line-height: 1.25;
}
.page-heading .kicker {
  font-size: 12px;
  letter-spacing: 1px;
  color: #6683a3;
}
.filter-panel {
  border-color: #bde8f1;
  border-radius: 10px;
  background: #f2fcff;
  padding: 8px 14px;
  margin-bottom: 12px;
}
.history-list {
  display: block;
  border: 1px solid #bde8f1;
  border-radius: 12px;
  padding: 16px 20px;
  background: white;
}
.history-table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.history-table-heading h2 {
  font-size: 21px;
}
.history-table-heading p,
.history-table-heading > span {
  font-size: 13px;
  color: #6683a3;
}
.history-table-scroll {
  overflow: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 880px;
  font-size: 13px;
}
th {
  text-align: left;
  color: #6683a3;
  font-weight: 500;
  padding: 10px 6px;
  border-block: 1px solid #e1ebf3;
}
td {
  padding: 8px 6px;
  border-bottom: 1px solid #e1ebf3;
  color: #315d84;
}
td small {
  display: block;
  color: #6683a3;
  font-size: 11px;
  margin-top: 3px;
}
.record-name {
  display: flex;
  align-items: center;
  gap: 14px;
}
.record-name strong {
  color: #073b59;
  font-size: 14px;
}
.record-symbol {
  display: grid;
  place-items: center;
  background: #356de6;
  border-radius: 8px;
  color: white;
  width: 34px;
  height: 34px;
  flex: none;
  font-size: 15px;
}
.record-symbol.specialized {
  background: #825ddd;
}
.record-symbol.rapid {
  background: #dda53d;
}
.record-symbol.fixed {
  background: #00a6b5;
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #2875e8;
  white-space: nowrap;
}
.comparison-note {
  background: #edfafd;
  border-color: #bde8f1;
}
.pagination {
  margin-top: 12px;
}
@media (max-width: 560px) {
  .history-list {
    padding: 14px;
  }
  .page-heading h1 {
    font-size: 28px;
  }
}
</style>
<style scoped>
@media (min-width: 1400px) {
  .filter-panel {
    position: absolute;
    top: 8px;
    right: 122px;
    background: transparent;
    border: 0;
    padding: 0;
    gap: 12px;
  }
  .filter-panel .filter-label {
    display: none;
  }
  .filter-panel label {
    font-size: 0;
    gap: 0;
  }
  .filter-panel select {
    min-width: 120px;
    min-height: 42px;
  }
  .history-list {
    padding: 10px 20px;
  }
  .history-table-heading {
    margin-bottom: 4px;
  }
  .history-table-heading h2 {
    font-size: 20px;
  }
  td {
    padding-block: 7px;
  }
}
</style>
