<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { Activity, Play, ShieldCheck, RotateCcw, X } from '@lucide/vue'

type SimulationResult = {
  examinee_count: number
  cat_average_items: number
  fixed_average_items: number
  item_reduction_rate: number
  exact_level_agreement: number
  adjacent_level_agreement: number
  cat_rmse: number
  fixed_rmse: number
  precision_stop_rate: number
  exposure_fallback_count: number
  cat_item_exposure: Record<string, number>
  cat_stop_reasons: Record<string, number>
  measurement_note: string
}

const auth = useAuthStore()
const blueprintId = ref('')
const examineeCount = ref(200)
const seed = ref(20260813)
const running = ref(false)
const error = ref('')
const result = ref<SimulationResult | null>(null)
const versionDialog = ref<HTMLDialogElement | null>(null)
const snapshot = ref<{ blueprint: string; count: number; seed: number } | null>(null)
const exposureRows = computed(() =>
  Object.entries(result.value?.cat_item_exposure ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10),
)
const stopLabels: Record<string, string> = {
  target_precision_reached: '达到目标精度',
  max_items_reached: '达到题量上限',
  item_pool_exhausted: '题池耗尽',
}
function resetExperiment() {
  if (running.value) return
  result.value = null
  snapshot.value = null
  error.value = ''
}

const maxExposure = computed(() => {
  if (!result.value) return 0
  return Math.max(0, ...Object.values(result.value.cat_item_exposure))
})

const percent = (value: number) => `${(value * 100).toFixed(1)}%`

async function runSimulation() {
  if (running.value) return
  error.value = ''
  result.value = null
  snapshot.value = null
  if (!auth.isAuthenticated || !blueprintId.value.trim()) {
    error.value = '请登录系统管理员账号，并填写已发布的纯客观题蓝图 ID。'
    return
  }
  if (
    !Number.isInteger(examineeCount.value) ||
    examineeCount.value < 10 ||
    examineeCount.value > 2000 ||
    !Number.isInteger(seed.value) ||
    seed.value < 0
  ) {
    error.value = '虚拟人数必须为 10–2000 的整数，随机种子必须为非负整数。'
    return
  }
  const input = {
    blueprint: blueprintId.value.trim(),
    count: examineeCount.value,
    seed: seed.value,
  }
  running.value = true
  try {
    const response = await auth.request('/admin/cat/simulations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blueprint_version_id: input.blueprint,
        examinee_count: input.count,
        seed: input.seed,
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload.detail ?? '仿真实验未能完成。')
    result.value = payload as SimulationResult
    snapshot.value = input
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '仿真实验未能完成。'
  } finally {
    running.value = false
  }
}
</script>

<template>
  <section class="cat-reference">
    <div class="lab-top-row">
      <header class="lab-heading">
        <div>
          <p class="lab-kicker">ADAPTIVE ENGINE LAB</p>
          <h1 data-testid="cat-lab-title">CAT 自适应实验室</h1>
          <p>验证 Rasch / 1PL 能力更新、约束选题和终止条件。</p>
        </div>
      </header>
      <form class="lab-controls" @submit.prevent="runSimulation">
        <label
          >已发布的纯客观题蓝图 ID<input
            v-model="blueprintId"
            :disabled="running"
            type="text"
            placeholder="填写蓝图版本 ID"
            required
        /></label>
        <label
          >虚拟被试人数<input
            v-model.number="examineeCount"
            :disabled="running"
            type="number"
            min="10"
            max="2000"
            required
        /></label>
        <label
          >随机种子<input v-model.number="seed" :disabled="running" type="number" min="0" required
        /></label>
        <button class="lab-primary" :disabled="running" type="submit">
          <Activity v-if="running" :size="17" /><Play v-else :size="17" />{{
            running ? '正在运行配对实验' : `运行 ${examineeCount.toLocaleString()} 人仿真`
          }}
        </button>
        <button class="lab-secondary" type="button" :disabled="running" @click="resetExperiment">
          <RotateCcw :size="16" />重置实验
        </button>
      </form>
    </div>
    <p v-if="error" class="lab-error" role="alert">{{ error }}</p>
    <div class="lab-summary">
      <div>
        <span class="lab-status"
          ><i :class="{ running }" />{{
            running ? '仿真进行中' : result ? '配对实验已完成' : '准备配对实验'
          }}</span
        ><small>虚拟被试 · 不写正式作答数据</small>
      </div>
      <div>
        <span>虚拟人数</span><strong>{{ result?.examinee_count ?? '—' }}</strong
        ><small>同一批被试配对比较</small>
      </div>
      <div>
        <span>CAT 平均题量</span
        ><strong>{{ result ? result.cat_average_items.toFixed(1) : '—' }}</strong
        ><small>{{
          result ? `固定卷 ${result.fixed_average_items.toFixed(1)} 题` : '运行后显示真实结果'
        }}</small>
      </div>
      <div>
        <span>完全等级一致</span
        ><strong>{{ result ? percent(result.exact_level_agreement) : '—' }}</strong
        ><small>不与相邻一致率混用</small>
      </div>
      <div>
        <span>平均减题率</span
        ><strong>{{ result ? percent(result.item_reduction_rate) : '—' }}</strong
        ><small>相对配对固定卷</small>
      </div>
    </div>
    <div class="lab-reference-grid">
      <section class="lab-panel exposure-panel">
        <header>
          <div>
            <h2>题目曝光分布</h2>
            <p>当前真实仿真输出 · 曝光最高的前 10 道题</p>
          </div>
          <span class="chart-legend"><i />被选中比例</span>
        </header>
        <template v-if="result && exposureRows.length"
          ><div class="exposure-chart">
            <div v-for="[id, value] in exposureRows" :key="id" class="exposure-row">
              <span :title="id">{{ id }}</span>
              <div class="exposure-track">
                <i :style="{ width: percent(Math.max(0, Math.min(1, value))) }" />
              </div>
              <b>{{ percent(value) }}</b>
            </div>
          </div></template
        >
        <div v-else class="lab-empty">
          <Activity :size="34" />
          <h3>{{ running ? '正在计算真实仿真结果' : '实验图表等待运行' }}</h3>
          <p>选择已发布蓝图并运行，随后显示实际曝光结果。</p>
        </div>
        <p class="lab-note">逐题 θ 轨迹和可信区间尚未接入，本区不使用随机曲线冒充能力估计。</p>
      </section>
      <aside class="lab-panel">
        <p class="lab-kicker">EXPERIMENT SAFETY</p>
        <h2>实验约束</h2>
        <ul class="constraint-list">
          <li><ShieldCheck :size="17" />仅使用已发布纯客观题蓝图</li>
          <li><ShieldCheck :size="17" />固定随机种子支持复现</li>
          <li><ShieldCheck :size="17" />不改变正式成绩与答题记录</li>
        </ul>
        <p class="lab-note">
          当前同步接口上限为 2,000 人。10,000 人后台任务与逐题派发将在服务端接通后开放。
        </p>
        <div class="max-exposure">
          <span>最大题目曝光</span><strong>{{ result ? percent(maxExposure) : '—' }}</strong>
        </div>
        <p v-if="result" class="lab-note">
          曝光回退 {{ result.exposure_fallback_count }} 次。回退并不等于满足全部曝光目标。
        </p>
      </aside>
      <section class="lab-panel batch-panel">
        <header>
          <div>
            <h2>Monte Carlo 仿真结果</h2>
            <p>
              {{
                result
                  ? `${result.examinee_count.toLocaleString()} 名虚拟被试 · 配对仿真`
                  : '等待本次配对仿真'
              }}
            </p>
          </div>
          <span class="simulation-badge">仿真，非真实试测</span>
        </header>
        <div class="batch-metrics">
          <div>
            <span>完全等级一致</span
            ><strong>{{ result ? percent(result.exact_level_agreement) : '—' }}</strong
            ><small>不同于相邻等级一致</small>
          </div>
          <div>
            <span>相邻等级一致</span
            ><strong>{{ result ? percent(result.adjacent_level_agreement) : '—' }}</strong
            ><small>允许相差一个等级</small>
          </div>
          <div>
            <span>平均题量缩减</span
            ><strong>{{ result ? percent(result.item_reduction_rate) : '—' }}</strong
            ><small>相对固定卷</small>
          </div>
          <div>
            <span>达到目标精度</span
            ><strong>{{ result ? percent(result.precision_stop_rate) : '—' }}</strong
            ><small>不是所有终止的成功率</small>
          </div>
        </div>
        <table v-if="result">
          <thead>
            <tr>
              <th>对照方法</th>
              <th>平均题量</th>
              <th>RMSE</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>CAT</th>
              <td>{{ result.cat_average_items.toFixed(2) }}</td>
              <td>{{ result.cat_rmse.toFixed(3) }}</td>
            </tr>
            <tr>
              <th>固定卷</th>
              <td>{{ result.fixed_average_items.toFixed(2) }}</td>
              <td>{{ result.fixed_rmse.toFixed(3) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="result" class="lab-note">{{ result.measurement_note }}</p>
        <p v-else class="lab-note">结果未产生，不显示示例达标率或固定“门禁通过”标签。</p>
      </section>
      <aside class="lab-panel">
        <h2>实验参数</h2>
        <dl class="parameter-list">
          <div>
            <dt>随机种子</dt>
            <dd>{{ snapshot?.seed ?? seed }}</dd>
          </div>
          <div>
            <dt>虚拟人数</dt>
            <dd>{{ snapshot?.count ?? examineeCount }}</dd>
          </div>
          <div>
            <dt>结果状态</dt>
            <dd>{{ result ? '已完成' : running ? '运行中' : '尚未运行' }}</dd>
          </div>
          <div>
            <dt>题目曝光统计</dt>
            <dd>{{ result ? Object.keys(result.cat_item_exposure).length : '—' }} 道</dd>
          </div>
        </dl>
        <button
          class="lab-secondary full-width"
          :disabled="!snapshot"
          @click="versionDialog?.showModal()"
        >
          查看本次参数与终止记录
        </button>
      </aside>
    </div>
    <dialog ref="versionDialog" class="lab-dialog" aria-label="实验参数与终止记录">
      <header>
        <h2>本次实验参数</h2>
        <button aria-label="关闭实验详情" @click="versionDialog?.close()"><X :size="21" /></button>
      </header>
      <template v-if="snapshot"
        ><p>
          蓝图版本 ID：<code>{{ snapshot.blueprint }}</code>
        </p>
        <p>随机种子：{{ snapshot.seed }} · 虚拟人数：{{ snapshot.count }}</p>
        <h3>终止原因计数</h3>
        <ul>
          <li v-for="(count, reason) in result?.cat_stop_reasons" :key="reason">
            {{ stopLabels[reason] ?? reason }}：{{ count }}
          </li>
        </ul>
        <p class="lab-note">
          当前接口未返回完整算法版本清单；这里仅展示本次实际请求参数及服务端结果，不虚构版本日志。
        </p></template
      >
    </dialog>
  </section>
</template>
<style scoped>
.cat-reference {
  color: #073b59;
}
.lab-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 14px;
}
.lab-kicker {
  font-size: 12px;
  letter-spacing: 1px;
  color: #6683a3;
  font-weight: 700;
}
.lab-heading h1 {
  font-size: 34px;
  line-height: 1.4;
}
.lab-heading p:last-child {
  font-size: 14px;
  color: #6683a3;
}
.lab-controls {
  display: grid;
  grid-template-columns: minmax(180px, 1fr) 110px 120px auto auto;
  gap: 12px;
  align-items: end;
  margin-bottom: 14px;
}
.lab-controls label {
  font-size: 12px;
  color: #6683a3;
  display: grid;
  gap: 5px;
}
.lab-controls input {
  width: 100%;
  border: 1px solid #bde8f1;
  border-radius: 9px;
  padding: 10px;
  background: #fff;
  color: #073b59;
  min-width: 0;
}
.lab-primary,
.lab-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #9cd9e7;
  border-radius: 9px;
  background: white;
  color: #006e8b;
  font-size: 14px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 700;
}
.lab-primary {
  background: #08a7b7;
  border-color: #08a7b7;
  color: white;
}
.lab-primary:disabled,
.lab-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.lab-summary {
  display: grid;
  grid-template-columns: 1.5fr repeat(4, 1fr);
  gap: 0;
  background: linear-gradient(110deg, #edfbfe, #eaf8fb);
  border: 1px solid #bde8f1;
  border-radius: 13px;
  padding: 16px 20px;
  margin-bottom: 14px;
}
.lab-summary > div {
  border-right: 1px solid #bfdfec;
  padding: 0 25px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.lab-summary > div:first-child {
  padding-left: 0;
}
.lab-summary > div:last-child {
  border: 0;
}
.lab-summary span,
.lab-summary small {
  font-size: 12px;
  color: #6683a3;
}
.lab-summary strong {
  font-size: 25px;
  color: #073b59;
}
.lab-summary .lab-status {
  font-size: 21px;
  color: #073b59;
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 700;
}
.lab-status i {
  width: 14px;
  height: 14px;
  background: #7fb9c9;
  border: 3px solid #b8e7f0;
  border-radius: 50%;
  flex: none;
}
.lab-status i.running {
  background: #05b9c0;
}
.lab-reference-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.7fr) minmax(270px, 1fr);
  gap: 13px;
}
.lab-panel {
  border: 1px solid #bde8f1;
  background: white;
  border-radius: 13px;
  padding: 18px 22px;
}
.lab-panel h2 {
  font-size: 21px;
}
.lab-panel > header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: center;
}
.lab-panel header p {
  font-size: 12px;
  color: #6683a3;
}
.chart-legend {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #6683a3;
}
.chart-legend i {
  width: 23px;
  height: 3px;
  background: #08afbd;
}
.exposure-panel {
  min-height: 330px;
}
.exposure-chart {
  display: grid;
  gap: 10px;
  margin: 24px 0;
}
.exposure-row {
  display: grid;
  grid-template-columns: 130px 1fr 55px;
  align-items: center;
  gap: 15px;
  font-size: 12px;
}
.exposure-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #6683a3;
}
.exposure-row b {
  text-align: right;
  color: #007b95;
}
.exposure-track {
  background: #edf3f6;
  border-radius: 5px;
  height: 8px;
  overflow: hidden;
}
.exposure-track i {
  height: 100%;
  display: block;
  background: #08afbd;
  border-radius: 5px;
}
.lab-empty {
  min-height: 225px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: #6683a3;
  background: repeating-linear-gradient(to bottom, transparent 0, transparent 55px, #edf4f8 56px);
  margin-top: 16px;
}
.lab-empty h3 {
  font-size: 17px;
}
.lab-empty p {
  font-size: 13px;
  text-align: center;
}
.lab-note {
  font-size: 12px;
  color: #6683a3;
  line-height: 1.8;
  margin-top: 13px;
}
.constraint-list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: 16px;
  margin: 22px 0;
}
.constraint-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #315d84;
}
.constraint-list svg {
  color: #09aeb8;
  flex: none;
}
.max-exposure {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #dfecf4;
  margin-top: 20px;
  padding-top: 15px;
  color: #6683a3;
  font-size: 13px;
}
.max-exposure strong {
  color: #007d98;
  font-size: 23px;
}
.simulation-badge {
  background: #e8f8ed;
  color: #2b7753;
  border-radius: 30px;
  font-size: 12px;
  padding: 7px 12px;
  white-space: nowrap;
}
.batch-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 16px 0;
}
.batch-metrics > div {
  background: #edf9fc;
  border-radius: 10px;
  padding: 12px;
}
.batch-metrics span,
.batch-metrics small {
  display: block;
  font-size: 11px;
  color: #6683a3;
}
.batch-metrics strong {
  font-size: 23px;
  color: #073b59;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th,
td {
  text-align: left;
  padding: 7px;
  border-bottom: 1px solid #e0ebf3;
}
thead th {
  font-size: 12px;
  color: #6683a3;
  font-weight: 400;
}
.parameter-list {
  margin: 16px 0;
}
.parameter-list > div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border-top: 1px solid #dfeaf2;
  padding: 12px 0;
  font-size: 13px;
}
.parameter-list dt {
  color: #315d84;
}
.parameter-list dd {
  color: #3477e9;
  margin: 0;
}
.full-width {
  width: 100%;
  font-size: 12px;
}
.lab-error {
  background: #fff2ed;
  color: #9d3929;
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}
.lab-dialog {
  margin: auto;
  border: 1px solid #bde8f1;
  border-radius: 14px;
  padding: 24px;
  width: min(650px, calc(100vw - 32px));
  max-height: 85vh;
  overflow: auto;
  color: #073b59;
}
.lab-dialog::backdrop {
  background: #173d5366;
}
.lab-dialog header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
.lab-dialog header button {
  border: 0;
  background: none;
  cursor: pointer;
  color: #007b95;
}
.lab-dialog p {
  margin: 15px 0;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.lab-dialog ul {
  padding-left: 20px;
}
@media (max-width: 1050px) {
  .lab-controls {
    grid-template-columns: 1fr 1fr;
  }
  .lab-reference-grid {
    grid-template-columns: 1fr;
  }
  .lab-summary {
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }
  .lab-summary > div:first-child {
    grid-column: 1/-1;
    border: 0;
  }
  .lab-summary > div {
    padding-left: 0;
  }
  .lab-summary > div:nth-child(3) {
    border: 0;
  }
}
@media (max-width: 560px) {
  .lab-heading {
    align-items: flex-start;
  }
  .lab-heading h1 {
    font-size: 25px;
  }
  .lab-controls {
    grid-template-columns: 1fr;
  }
  .lab-panel {
    padding: 16px;
  }
  .batch-metrics {
    grid-template-columns: 1fr 1fr;
  }
  .lab-panel > header {
    flex-wrap: wrap;
  }
  .exposure-row {
    grid-template-columns: 90px 1fr 50px;
    gap: 8px;
  }
  .lab-heading > .lab-secondary {
    font-size: 12px;
    padding: 8px;
    white-space: nowrap;
  }
  .lab-heading > .lab-secondary svg {
    display: none;
  }
}
</style>
<style scoped>
@media (min-width: 1400px) {
  .lab-top-row {
    display: grid;
    grid-template-columns: minmax(350px, 1fr) minmax(0, 1.85fr);
    align-items: center;
    gap: 20px;
    min-height: 100px;
  }
  .lab-heading {
    margin-bottom: 0;
  }
  .lab-heading h1 {
    font-size: 32px;
  }
  .lab-controls {
    grid-template-columns: minmax(140px, 1fr) 82px 100px auto auto;
    gap: 8px;
    margin-bottom: 0;
  }
  .lab-controls button {
    padding-inline: 10px;
    font-size: 13px;
  }
  .lab-summary {
    padding-block: 10px;
  }
}
</style>
