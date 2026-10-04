<script setup lang="ts">
import '../assets/admin-workspaces.css'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import ContentVersionPanel from '../components/ContentVersionPanel.vue'
import BankReviewPanel from '../components/BankReviewPanel.vue'
import ContentOperationsRail from '../components/ContentOperationsRail.vue'
import { useAuthStore } from '../stores/auth'
import { DIMENSIONS } from '../domain/capabilities'
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
} from '@lucide/vue'

type ImportIssue = {
  row: number | null
  field: string | null
  code: string
  message: string
}

type ImportPreview = {
  digest: string
  filename: string
  row_count: number
  valid_count: number
  error_count: number
  errors: ImportIssue[]
  dimension_counts: Record<string, number>
  item_type_counts: Record<string, number>
  difficulty_bands: Record<string, number>
  can_commit: boolean
}

type ImportCommit = {
  batch_id: string
  digest: string
  filename: string
  imported_count: number
  publication_status: string
}

const dimensionLabels = Object.fromEntries(DIMENSIONS.map((row) => [row.code, row.name]))
const auth = useAuthStore()
type BankTab = 'items' | 'rubrics' | 'blueprints' | 'import' | 'reviews'
const route = useRoute()
const tab = ref<BankTab>(route?.query.tab === 'reviews' ? 'reviews' : route?.query.tab === 'blueprints' ? 'blueprints' : 'items')
const reviewPanel = ref<InstanceType<typeof BankReviewPanel> | null>(null)
function changeTab(next: BankTab) {
  if (next === tab.value) return
  if (tab.value === 'reviews' && reviewPanel.value && !reviewPanel.value.mayLeave()) return
  tab.value = next
}
const typeLabels: Record<string, string> = {
  objective: '客观题',
  dialogue: '对话题',
  practical: '实操题',
}
const difficultyLabels: Record<string, string> = {
  easy: '基础',
  medium: '中阶',
  advanced: '进阶',
}

const file = ref<File | null>(null)
const dragging = ref(false)
const busy = ref<'preview' | 'commit' | 'download' | ''>('')
const contentBusy = ref(false)
const error = ref('')
const preview = ref<ImportPreview | null>(null)
const committed = ref<ImportCommit | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const fileSize = computed(() => {
  if (!file.value) return ''
  return file.value.size < 1024 * 1024
    ? `${(file.value.size / 1024).toFixed(1)} KB`
    : `${(file.value.size / 1024 / 1024).toFixed(2)} MB`
})

function selectFile(next: File | undefined) {
  if (!next) return
  file.value = next
  preview.value = null
  committed.value = null
  error.value = ''
}

function onDrop(event: DragEvent) {
  dragging.value = false
  selectFile(event.dataTransfer?.files[0])
}

async function responseDetail(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as { detail?: string }
    return payload.detail ?? fallback
  } catch {
    return fallback
  }
}

function validateReady() {
  if (!auth.isAuthenticated) throw new Error('请先使用系统管理员账号登录。')
  if (!file.value) throw new Error('请先选择 CSV 或 XLSX 题库文件。')
}

async function runPreview() {
  error.value = ''
  committed.value = null
  try {
    validateReady()
    busy.value = 'preview'
    const body = new FormData()
    body.append('file', file.value!)
    const response = await auth.request('/admin/items/imports/preview', {
      method: 'POST',
      body,
    })
    if (!response.ok) throw new Error(await responseDetail(response, '题库预检未能完成。'))
    preview.value = (await response.json()) as ImportPreview
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '题库预检未能完成。'
  } finally {
    busy.value = ''
  }
}

async function commitImport() {
  if (!preview.value?.can_commit) return
  error.value = ''
  try {
    validateReady()
    busy.value = 'commit'
    const body = new FormData()
    body.append('file', file.value!)
    const response = await auth.request('/admin/items/imports/commit', {
      method: 'POST',
      headers: {
        'Expected-Digest': preview.value.digest,
      },
      body,
    })
    if (!response.ok) throw new Error(await responseDetail(response, '正式入库未能完成。'))
    committed.value = (await response.json()) as ImportCommit
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '正式入库未能完成。'
  } finally {
    busy.value = ''
  }
}

async function downloadTemplate() {
  error.value = ''
  try {
    if (!auth.isAuthenticated) throw new Error('请先使用系统管理员账号登录。')
    busy.value = 'download'
    const response = await auth.request('/admin/items/imports/template')
    if (!response.ok) throw new Error(await responseDetail(response, '模板下载失败。'))
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'AI-Measure题库导入模板.xlsx'
    link.click()
    URL.revokeObjectURL(url)
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '模板下载失败。'
  } finally {
    busy.value = ''
  }
}

function resetBatch() {
  file.value = null
  preview.value = null
  committed.value = null
  error.value = ''
  if (fileInput.value) fileInput.value.value = ''
}
</script>

<template>
  <section class="forge shell admin-workspace">
    <header class="forge-heading">
      <div>
        <span class="eyebrow">Content &amp; scoring</span>
        <h1 data-testid="item-bank-title">内容与评分中心</h1>
        <p class="admin-description">题库与量规、版本发布与人工复核，在同一工作区有序衔接。</p>
      </div>
      <div class="heading-note">
        <span>版本可追溯 · 发布有依据</span>
        <p>草稿、审核与发布分开管理，进行中的测评继续使用冻结版本。</p>
      </div>
    </header>

    <nav class="content-tabs" aria-label="内容类型">
      <button
        v-for="entry in [
          ['items', '题目版本'],
          ['rubrics', '评分量规'],
          ['blueprints', '测评方案（蓝图）'],
          ['import', '批量导入'],
          ['reviews', '待审核题目'],
        ] as const"
        :key="entry[0]"
        :aria-pressed="tab === entry[0]"
        :disabled="Boolean(busy) || contentBusy"
        @click="changeTab(entry[0])"
      >
        {{ entry[1] }}
      </button>
    </nav>
    <div class="content-workspace" :class="{ 'has-rail': (tab === 'items' || tab === 'rubrics' || tab === 'blueprints') && !(tab === 'blueprints' && contentBusy) }">
    <div class="content-workspace-main">
    <KeepAlive>
      <ContentVersionPanel
        v-if="tab !== 'import' && tab !== 'reviews'"
        :key="tab"
        :kind="tab"
        @busy="contentBusy = $event"
      />
    </KeepAlive>
    <BankReviewPanel v-if="tab === 'reviews'" ref="reviewPanel" @busy="contentBusy = $event" />
    <div v-show="tab === 'import'" class="forge-grid">
      <aside class="intake surface">
        <div class="panel-number">01 / INTAKE</div>
        <p class="privacy">当前使用已登录的系统管理员身份。文件只进入草稿库，审核发布独立完成。</p>
        <button
          class="template-button"
          type="button"
          :disabled="Boolean(busy)"
          @click="downloadTemplate"
        >
          <Download :size="17" />
          {{ busy === 'download' ? '正在准备模板' : '下载标准 XLSX 模板' }}
        </button>

        <input
          ref="fileInput"
          class="file-input"
          type="file"
          accept=".csv,.xlsx"
          data-testid="item-file"
          @change="selectFile(($event.target as HTMLInputElement).files?.[0])"
        />
        <button
          class="drop-zone"
          :class="{ dragging, loaded: file }"
          type="button"
          @click="fileInput?.click()"
          @dragenter.prevent="dragging = true"
          @dragover.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
          @drop.prevent="onDrop"
        >
          <FileSpreadsheet v-if="file" :size="34" />
          <UploadCloud v-else :size="34" />
          <strong>{{ file?.name ?? '拖入 CSV / XLSX 文件' }}</strong>
          <span>{{ file ? `${fileSize} · 点击重新选择` : '最大 2 MiB，最多 500 行' }}</span>
        </button>

        <button
          class="primary-button inspect-button"
          type="button"
          :disabled="Boolean(busy)"
          @click="runPreview"
        >
          <LoaderCircle v-if="busy === 'preview'" class="spin" :size="18" />
          <ShieldCheck v-else :size="18" />
          {{ busy === 'preview' ? '正在执行预检' : '执行零写入预检' }}
        </button>
        <p v-if="error" class="error-message" role="alert">
          <AlertTriangle :size="16" />{{ error }}
        </p>
        <p class="privacy">
          <ShieldCheck :size="15" />文件摘要用于防止预检后被替换；预检本身不写入题库。
        </p>
      </aside>

      <div class="inspection">
        <div v-if="committed" class="receipt committed" data-testid="commit-success">
          <div class="receipt-icon"><Check :size="30" /></div>
          <span>IMPORT BATCH SEALED</span>
          <h2>{{ committed.imported_count }} 道题已安全入库</h2>
          <p>全部保持草稿状态，发布前仍需人工审核。批次号可追溯文件摘要、题目版本和原始行号。</p>
          <code>{{ committed.batch_id }}</code>
          <button class="secondary-button" type="button" @click="resetBatch">
            <RotateCcw :size="17" />开始下一批
          </button>
        </div>

        <template v-else-if="preview">
          <div class="inspection-head" :class="{ rejected: !preview.can_commit }">
            <div>
              <span>{{ preview.can_commit ? 'BATCH READY' : 'BATCH REJECTED' }}</span>
              <h2>
                {{
                  preview.can_commit
                    ? '预检通过，可以封存入库'
                    : `发现 ${preview.error_count} 个问题`
                }}
              </h2>
            </div>
            <div class="count-stamp">
              <strong>{{ preview.row_count }}</strong
              ><small>ROWS</small>
            </div>
          </div>

          <div class="summary-grid">
            <article>
              <span>六维覆盖</span>
              <div v-for="(count, code) in preview.dimension_counts" :key="code" class="bar-row">
                <small>{{ dimensionLabels[code] ?? code }}</small
                ><i
                  ><b
                    :style="{
                      width: `${preview.row_count ? (count / preview.row_count) * 100 : 0}%`,
                    }"
                  ></b></i
                ><em>{{ count }}</em>
              </div>
            </article>
            <article>
              <span>题型构成</span>
              <div class="chip-list">
                <div v-for="(count, code) in preview.item_type_counts" :key="code">
                  <strong>{{ count }}</strong
                  ><small>{{ typeLabels[code] ?? code }}</small>
                </div>
              </div>
            </article>
            <article>
              <span>难度分层</span>
              <div class="chip-list">
                <div v-for="(count, code) in preview.difficulty_bands" :key="code">
                  <strong>{{ count }}</strong
                  ><small>{{ difficultyLabels[code] ?? code }}</small>
                </div>
              </div>
            </article>
          </div>

          <div v-if="preview.errors.length" class="issue-ledger">
            <header><span>错误清单</span><small>修复原文件后重新预检</small></header>
            <div
              v-for="(issue, index) in preview.errors"
              :key="`${issue.row}-${issue.field}-${index}`"
              class="issue-row"
            >
              <b>{{ issue.row ? `R${issue.row}` : 'FILE' }}</b>
              <code>{{ issue.field ?? issue.code }}</code>
              <span>{{ issue.message }}</span>
            </div>
          </div>

          <div v-else class="commit-dock">
            <div>
              <Database :size="21" />
              <p><strong>全批原子写入</strong><span>写入后为 draft，不会自动发布</span></p>
            </div>
            <button
              class="seal-button"
              type="button"
              :disabled="Boolean(busy)"
              @click="commitImport"
            >
              <LoaderCircle v-if="busy === 'commit'" class="spin" :size="18" />
              <Database v-else :size="18" />
              {{ busy === 'commit' ? '正在封存批次' : '正式入库' }}
            </button>
          </div>
          <code class="digest">SHA-256 / {{ preview.digest }}</code>
        </template>

        <div v-else class="receipt empty">
          <div class="grid-mark" aria-hidden="true"></div>
          <span>INSPECTION SHEET</span>
          <h2>等待一份题库批次</h2>
          <p>左侧上传文件并执行预检后，这里会生成六维覆盖、题型构成、难度分层与逐行错误清单。</p>
          <div class="empty-steps"><i>01 上传</i><i>02 预检</i><i>03 入库</i></div>
        </div>
      </div>
    </div>
    </div>
    <ContentOperationsRail v-if="(tab === 'items' || tab === 'rubrics' || tab === 'blueprints') && !(tab === 'blueprints' && contentBusy)" />
    </div>
  </section>
</template>

<style scoped>
.content-workspace { min-width: 0; }
.content-workspace.has-rail { display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 24px; align-items: start; }
.content-workspace-main { min-width: 0; }
@media (max-width: 1150px) { .content-workspace.has-rail { grid-template-columns: minmax(0, 1fr); } }
.content-tabs {
  display: flex;
  gap: 24px;
  border-bottom: 1px solid var(--line);
  margin: 24px 0 20px;
  overflow: auto;
}
.content-tabs button {
  padding: 12px 3px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--muted);
  white-space: nowrap;
  cursor: pointer;
  font-size: 15px;
}
.content-tabs button[aria-pressed='true'] {
  border-bottom-color: var(--signal-dark);
  color: var(--signal-dark);
  font-weight: 700;
}
.forge {
  padding: 4px 0 40px;
}
.forge-heading {
  display: grid;
  grid-template-columns: 1.2fr 0.8fr;
  gap: 24px;
  align-items: end;
  margin-bottom: 24px;
}
h1 {
  margin: 15px 0 0;
  color: var(--ink-950);
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: -0.06em;
}
h1 em {
  color: var(--signal-dark);
  font-style: normal;
}
.heading-note {
  padding-left: 22px;
  border-left: 2px solid var(--line);
}
.heading-note span {
  color: var(--signal-dark);
  font:
    700 12px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.12em;
}
.heading-note p {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.forge-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr);
  gap: 18px;
}
.intake {
  padding: 26px;
  align-self: start;
}
.panel-number {
  color: var(--signal-dark);
  font:
    700 12px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.16em;
}
.token-field {
  display: grid;
  gap: 8px;
  margin-top: 25px;
  color: var(--ink-800);
  font-size: 12px;
  font-weight: 750;
}
.token-field input {
  width: 100%;
  min-height: 44px;
  padding: 0 13px;
  border: 1px solid var(--line);
  border-radius: 9px;
  outline: none;
  background: white;
  font:
    12px 'Cascadia Mono',
    monospace;
}
.token-field input:focus {
  border-color: var(--signal-dark);
  box-shadow: 0 0 0 3px rgba(49, 212, 156, 0.13);
}
.template-button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  margin-top: 13px;
  padding: 0;
  border: 0;
  cursor: pointer;
  color: var(--signal-dark);
  background: none;
  font-size: 12px;
  font-weight: 750;
}
.file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  opacity: 0;
}
.drop-zone {
  display: grid;
  width: 100%;
  min-height: 175px;
  place-items: center;
  align-content: center;
  gap: 9px;
  margin-top: 25px;
  padding: 20px;
  border: 1.5px dashed #abc0bc;
  border-radius: 16px;
  cursor: pointer;
  color: #52716e;
  background: #f4f9f7;
  transition: 160ms ease;
}
.drop-zone:hover,
.drop-zone.dragging {
  border-color: var(--signal-dark);
  background: #eaf8f3;
  transform: translateY(-2px);
}
.drop-zone.loaded {
  border-style: solid;
  color: var(--ink-950);
}
.drop-zone strong {
  max-width: 100%;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drop-zone span {
  color: var(--muted);
  font-size: 12px;
}
.inspect-button {
  width: 100%;
  margin-top: 18px;
}
.inspect-button:disabled,
.template-button:disabled,
.seal-button:disabled {
  cursor: progress;
  opacity: 0.65;
}
.privacy,
.error-message {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 14px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
.privacy {
  color: var(--muted);
}
.error-message {
  color: #a33a2c;
}
.inspection {
  min-width: 0;
}
.receipt {
  position: relative;
  min-height: 570px;
  overflow: hidden;
  padding: 42px;
  border-radius: var(--radius-md);
  color: #ecf6f2;
  background: var(--ink-950);
  box-shadow: 0 25px 60px rgba(7, 26, 36, 0.16);
}
.receipt.empty {
  display: grid;
  place-content: center;
  justify-items: start;
  background-image: radial-gradient(circle at 73% 32%, rgba(49, 212, 156, 0.13), transparent 30%);
}
.receipt > span,
.inspection-head span {
  color: var(--signal);
  font:
    700 12px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.15em;
}
.receipt h2 {
  max-width: 520px;
  margin: 14px 0 0;
  font:
    700 36px 'Source Han Serif SC',
    serif;
}
.receipt p {
  max-width: 550px;
  margin: 16px 0 0;
  color: #9ab0b2;
  font-size: 14px;
  line-height: 1.8;
}
.grid-mark {
  width: 84px;
  height: 84px;
  margin-bottom: 34px;
  opacity: 0.7;
  background-image:
    linear-gradient(rgba(49, 212, 156, 0.5) 1px, transparent 1px),
    linear-gradient(90deg, rgba(49, 212, 156, 0.5) 1px, transparent 1px);
  background-size: 21px 21px;
}
.empty-steps {
  display: flex;
  gap: 10px;
  margin-top: 36px;
}
.empty-steps i {
  padding: 8px 13px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 999px;
  color: #9ab0b2;
  font:
    normal 10px 'Cascadia Mono',
    monospace;
}
.inspection-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 26px 30px;
  border-radius: 16px 16px 0 0;
  color: #eaf8f3;
  background: var(--ink-950);
}
.inspection-head.rejected {
  background: #532f29;
}
.inspection-head.rejected span {
  color: #ffb5a5;
}
.inspection-head h2 {
  margin: 7px 0 0;
  font:
    700 24px 'Source Han Serif SC',
    serif;
}
.count-stamp {
  display: grid;
  justify-items: end;
}
.count-stamp strong {
  font:
    500 42px 'Cascadia Mono',
    monospace;
}
.count-stamp small {
  color: #89a19f;
  font:
    9px 'Cascadia Mono',
    monospace;
  letter-spacing: 0.16em;
}
.summary-grid {
  display: grid;
  grid-template-columns: 1.35fr 1fr 1fr;
  border: 1px solid var(--line);
  border-top: 0;
  background: rgba(255, 255, 255, 0.85);
}
.summary-grid article {
  min-height: 190px;
  padding: 24px;
  border-right: 1px solid var(--line);
}
.summary-grid article:last-child {
  border: 0;
}
.summary-grid article > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 750;
}
.bar-row {
  display: grid;
  grid-template-columns: 62px 1fr 18px;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
.bar-row small {
  color: var(--ink-800);
  font-size: 12px;
}
.bar-row i {
  height: 5px;
  overflow: hidden;
  border-radius: 9px;
  background: #e4ece9;
}
.bar-row b {
  display: block;
  height: 100%;
  background: var(--signal-dark);
}
.bar-row em {
  color: var(--ink-950);
  font:
    normal 10px 'Cascadia Mono',
    monospace;
  text-align: right;
}
.chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 18px;
}
.chip-list div {
  min-width: 68px;
  padding: 10px;
  border-radius: 9px;
  background: #f1f6f4;
}
.chip-list strong,
.chip-list small {
  display: block;
}
.chip-list strong {
  color: var(--ink-950);
  font:
    500 22px 'Cascadia Mono',
    monospace;
}
.chip-list small {
  margin-top: 2px;
  color: var(--muted);
  font-size: 12px;
}
.issue-ledger {
  border: 1px solid #edd3cd;
  border-top: 0;
  background: #fffaf8;
}
.issue-ledger header,
.issue-row {
  display: grid;
  grid-template-columns: 58px 150px 1fr;
  align-items: center;
  gap: 12px;
  padding: 13px 20px;
  border-bottom: 1px solid #f0dfda;
}
.issue-ledger header {
  display: flex;
  justify-content: space-between;
  color: #943e2e;
  font-size: 12px;
  font-weight: 800;
}
.issue-ledger header small {
  font-weight: 500;
}
.issue-row b {
  color: var(--signal-dark);
  font:
    700 12px 'Cascadia Mono',
    monospace;
}
.issue-row code {
  color: #6c514b;
  font-size: 12px;
}
.issue-row span {
  color: #57433f;
  font-size: 12px;
}
.commit-dock {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 25px 28px;
  border: 1px solid var(--line);
  border-top: 0;
  background: white;
}
.commit-dock > div {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--signal-dark);
}
.commit-dock p,
.commit-dock strong,
.commit-dock span {
  display: block;
  margin: 0;
}
.commit-dock strong {
  color: var(--ink-950);
  font-size: 13px;
}
.commit-dock span {
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
}
.seal-button {
  display: inline-flex;
  min-height: 46px;
  align-items: center;
  gap: 9px;
  padding: 0 23px;
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  color: white;
  background: var(--signal-dark);
  font-weight: 800;
  box-shadow: 0 10px 22px rgba(228, 95, 66, 0.22);
}
.digest {
  display: block;
  overflow: hidden;
  padding: 12px 16px;
  color: #70827f;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: #edf3f1;
}
.receipt.committed {
  display: grid;
  place-content: center;
  justify-items: start;
  background-image: radial-gradient(circle at 75% 35%, rgba(49, 212, 156, 0.18), transparent 35%);
}
.receipt-icon {
  display: grid;
  width: 68px;
  height: 68px;
  place-items: center;
  margin-bottom: 30px;
  border: 1px solid var(--signal);
  border-radius: 50%;
  color: var(--signal);
}
.receipt.committed code {
  display: block;
  margin-top: 25px;
  color: #8ca4a4;
  font-size: 12px;
}
.receipt.committed button {
  margin-top: 28px;
  border-color: rgba(255, 255, 255, 0.2);
  color: white;
  background: transparent;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 940px) {
  .forge-heading,
  .forge-grid {
    grid-template-columns: 1fr;
  }
  .forge-heading {
    gap: 24px;
  }
  .summary-grid {
    grid-template-columns: 1fr;
  }
  .summary-grid article {
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
}
@media (max-width: 560px) {
  .forge {
    padding-top: 4px;
  }
  .intake,
  .receipt {
    padding: 22px;
  }
  .inspection-head {
    align-items: flex-start;
  }
  .issue-row {
    grid-template-columns: 48px 1fr;
  }
  .issue-row span {
    grid-column: 1 / -1;
  }
  .commit-dock {
    align-items: stretch;
    flex-direction: column;
    gap: 18px;
  }
  .seal-button {
    justify-content: center;
  }
}
</style>
