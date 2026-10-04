<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { DIMENSIONS } from '../domain/capabilities'
import ItemVersionEditor from './ItemVersionEditor.vue'
import BlueprintTimingEditor from './BlueprintTimingEditor.vue'
import BlueprintPlanWizard from './BlueprintPlanWizard.vue'
import ContentAssignmentPanel from './ContentAssignmentPanel.vue'
import { useAccessStore } from '../stores/access'
import {
  getContent,
  listContent,
  transitionContent,
  type ContentKind,
  type ContentRecord,
  type ContentStatus,
  type ContentIdentity,
} from '../services/contentApi'
const props = defineProps<{ kind: ContentKind }>()
const access = useAccessStore()
const emit = defineEmits<{ busy: [value: boolean] }>()
const editing = ref(false)
const editorSource = ref<ContentRecord | null>(null)
const notice = ref('')
const editorRegion = ref<HTMLElement | null>(null)
function openEditor(source: ContentRecord | null) {
  if (busy.value) return
  editorSource.value = source
  closeDetail()
  notice.value = ''
  editing.value = true
  void nextTick(() => {
    editorRegion.value?.scrollIntoView({ block: 'start' })
    editorRegion.value?.focus({ preventScroll: true })
  })
}
async function saved(identity: ContentIdentity) {
  editing.value = false
  notice.value = identity.publication_status === 'published'
    ? (access.singlePlatform
      ? '测评方案已发布！平台学员现在可以在「能力测评」选择此方案，无需加入或切换空间。'
      : '测评方案已发布！所选组织的成员现在可在「能力测评」选择此方案。请确认学员属于所选组织；不会自动添加成员。')
    : `已保存 v${identity.version} 草稿。尚未审核或发布，正式测评仍使用原发布版本。`
  offset.value = 0
  status.value = identity.publication_status
  await load()
  if (!error.value) await detail(identity)
}
const labels: Record<ContentStatus, string> = {
  draft: '草稿',
  in_review: '待审核',
  published: '已发布',
  retired: '已退役',
}
const rows = ref<ContentRecord[]>([]),
  total = ref(0),
  offset = ref(0),
  status = ref(''),
  loading = ref(false),
  busy = ref(false),
  error = ref(''),
  selected = ref<ContentRecord | null>(null)
const typeLabels: Record<string, string> = { objective: '客观题', dialogue: '对话题', practical: '实操题' }
const pagePublished = computed(() => rows.value.filter((row) => row.publication_status === 'published').length)
const pageDrafts = computed(() => rows.value.filter((row) => ['draft', 'in_review'].includes(row.publication_status)).length)
const confirmation = ref<HTMLDialogElement | null>(null),
  target = ref<ContentStatus>('in_review')
const detailDialog = ref<HTMLDialogElement | null>(null)
const detailHeadingId = useId()
const detailTitle = computed(() => ({ items: '题目详情', rubrics: '量规详情', blueprints: '测评方案详情' })[props.kind])
const detailLoading = ref(false)
const detailError = ref('')
const detailId = ref('')
watch([busy, editing], ([value, isEditing]) => emit('busy', value || (isEditing && props.kind === 'blueprints')), { flush: 'sync' })
let generation = 0, detailGeneration = 0
function resetDetail() {
  detailGeneration += 1
  if (detailDialog.value?.open) detailDialog.value.close()
  selected.value = null
  detailLoading.value = false
  detailError.value = ''
  detailId.value = ''
}
function closeDetail() {
  if (!busy.value) resetDetail()
}
async function load() {
  const ticket = ++generation
  resetDetail()
  error.value = ''
  loading.value = true
  rows.value = []
  selected.value = null
  try {
    const data = await listContent(props.kind, status.value, offset.value)
    if (ticket === generation) {
      rows.value = data.items
      total.value = data.total
    }
  } catch (caught) {
    if (ticket === generation) error.value = caught instanceof Error ? caught.message : '读取失败'
  } finally {
    if (ticket === generation) loading.value = false
  }
}
async function detail(row: Pick<ContentRecord, 'id'>) {
  if (busy.value || loading.value || editing.value) return
  const scope = generation, ticket = ++detailGeneration, kind = props.kind
  detailId.value = row.id
  detailError.value = ''
  detailLoading.value = true
  selected.value = null
  await nextTick()
  if (scope !== generation || ticket !== detailGeneration) return
  if (!detailDialog.value?.open) detailDialog.value?.showModal()
  try {
    const data = await getContent(kind, row.id)
    if (scope === generation && ticket === detailGeneration) selected.value = data
  } catch (caught) {
    if (scope === generation && ticket === detailGeneration)
      detailError.value = caught instanceof Error ? caught.message : '详情读取失败，请重试。'
  } finally {
    if (scope === generation && ticket === detailGeneration) detailLoading.value = false
  }
}
function changePage(nextOffset: number) {
  if (busy.value || loading.value) return
  offset.value = nextOffset
  void load()
}
function confirm(next: ContentStatus) {
  target.value = next
  confirmation.value?.showModal()
}
async function applyTransition() {
  if (!selected.value || busy.value) return
  const id = selected.value.id,
    kind = props.kind
  busy.value = true
  error.value = ''
  try {
    await transitionContent(kind, id, target.value)
    confirmation.value?.close()
    await load()
  } catch (caught) {
    detailError.value = caught instanceof Error ? caught.message : '状态修改失败，请重新读取详情后核对。'
    confirmation.value?.close()
    selected.value = null
  } finally {
    busy.value = false
  }
}
watch(
  () => props.kind,
  () => {
    editing.value = false
    editorSource.value = null
    notice.value = ''
    offset.value = 0
    status.value = ''
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation += 1
  resetDetail()
  if (confirmation.value?.open) confirmation.value.close()
})
</script>
<template>
  <section class="content-version">
    <div v-if="editing" ref="editorRegion" class="editor-anchor" tabindex="-1" aria-label="内容编辑区"></div>
    <p v-if="notice" class="content-notice" role="status">{{ notice }}</p>
    <BlueprintPlanWizard
      v-if="editing && kind === 'blueprints'"
      @saved="saved"
      @cancel="editing = false"
      @busy="busy = $event"
    />
    <ItemVersionEditor
      v-else-if="editing && kind === 'items'"
      :source="editorSource"
      @saved="saved"
      @cancel="editing = false"
      @busy="busy = $event"
    />
    <template v-else>
      <div v-if="kind === 'blueprints'" class="content-notice">
        <strong>测评方案决定学员做哪些题</strong>
        <p v-if="access.singlePlatform">新建方案 → 选择已发布题目 → 设置出题规则 → 向平台学员开放 → 校验并发布。管理员统一维护、审核和发布题目；草稿和隔离审题包不能直接用于正式测评。</p>
        <p v-else>新建方案 → 选择已发布题目 → 设置出题规则 → 选择开放组织 → 校验并发布。教师维护题目，系统管理员负责发布；草稿和隔离审题包不能直接用于正式测评。</p>
        <button class="primary-button" type="button" :disabled="busy" @click="openEditor(null)">新建测评方案</button>
      </div>
      <section class="library-summary" aria-label="内容版本摘要">
        <article><span>当前筛选版本数</span><strong>{{ loading || error ? '—' : total }}</strong><small>包含同一题目的不同版本</small></article>
        <article><span>本页已发布</span><strong>{{ loading || error ? '—' : pagePublished }}</strong><small>发布状态以服务端为准</small></article>
        <article><span>本页草稿 / 待审核</span><strong>{{ loading || error ? '—' : pageDrafts }}</strong><small>尚不能用于正式测评</small></article>
      </section>
      <form class="content-filter" @submit.prevent="changePage(0)">
        <label
          >发布状态<select v-model="status" :disabled="busy">
            <option value="">全部状态</option>
            <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
          </select></label
        ><button class="secondary-button" :disabled="busy || loading">筛选</button
        ><button
          v-if="kind === 'items'"
          class="primary-button"
          type="button"
          data-testid="new-item"
          :disabled="busy || loading"
          @click="openEditor(null)"
        >
          新建题目</button
        >
      </form>
      <div v-if="error" role="alert" class="content-error">
        {{ error }}
        <button class="secondary-button" :disabled="busy" @click="load">重新读取</button>
      </div>
      <div v-if="loading" class="content-empty" role="status">正在读取内容版本…</div>
      <template v-else-if="!error || rows.length"
        ><div class="content-table surface" role="region" aria-label="内容版本列表，可横向滚动" tabindex="0">
          <table>
            <thead>
              <tr>
                <th>{{ kind === 'items' ? '题目与版本记录' : '内容' }}</th>
                <th v-if="kind === 'items'">题型 / 难度</th>
                <th>版本</th>
                <th>状态</th>
                <th>维度 / 场景</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td>
                  <strong class="record-title" :title="row.stem ?? row.title ?? row.name">{{ row.stem ?? row.title ?? row.name }}</strong
                  ><small :title="row.id">{{ row.logical_id.slice(0, 8) }} · 更新于 {{ new Date(row.updated_at).toLocaleDateString('zh-CN') }}</small>
                </td>
                <td v-if="kind === 'items'"><span>{{ typeLabels[row.item_type ?? ''] ?? '未配置' }}</span><small>难度 {{ row.difficulty ?? '—' }}</small></td>
                <td>v{{ row.version }}</td>
                <td><span class="version-badge" :class="row.publication_status">{{ labels[row.publication_status] }}</span></td>
                <td>
                  {{
                    DIMENSIONS.find((d) => d.code === row.dimension_code)?.name ??
                    row.scenario ??
                    '评分量规'
                  }}
                </td>
                <td>
                  <button class="text-button" aria-haspopup="dialog" :disabled="busy || loading" @click="detail(row)">
                    查看详情
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="!rows.length" class="content-empty">当前条件下没有版本记录。</div>
        </div>
        <footer>
          <span>共 {{ total }} 个版本</span
          ><button
            class="secondary-button"
            :disabled="offset === 0 || busy || loading"
            @click="changePage(offset - 20)"
          >
            上一页</button
          ><button
            class="secondary-button"
            :disabled="offset + 20 >= total || offset >= 10000 || busy || loading"
            @click="changePage(offset + 20)"
          >
            下一页
          </button>
        </footer></template
      >
      <dialog ref="detailDialog" class="content-detail surface" :aria-labelledby="detailHeadingId" @cancel.prevent="closeDetail">
        <header class="detail-dialog-heading">
          <h2 :id="detailHeadingId">{{ detailTitle }}</h2>
          <button type="button" class="secondary-button" :disabled="busy" autofocus @click="closeDetail">关闭详情</button>
        </header>
        <div class="detail-dialog-body" :aria-busy="detailLoading">
        <p v-if="detailLoading" role="status" class="content-empty">正在读取{{ detailTitle }}…</p>
        <div v-if="detailError" role="alert" class="content-error">
          {{ detailError }}
          <button class="secondary-button" :disabled="busy || detailLoading" @click="detail({ id: detailId })">重新读取详情</button>
        </div>
        <template v-if="selected">
        <header>
          <div>
            <h2>{{ selected.stem ?? selected.title ?? selected.name }}</h2>
            <p>
              逻辑 ID {{ selected.logical_id }} · v{{ selected.version }} ·
              {{ labels[selected.publication_status] }}
            </p>
          </div>
        </header>
        <dl>
          <div v-if="selected.item_type">
            <dt>题型 / 难度</dt>
            <dd>{{ selected.item_type }} / {{ selected.difficulty }}</dd>
          </div>
          <div v-if="selected.rubric_version_id">
            <dt>绑定量规版本</dt>
            <dd>{{ selected.rubric_version_id }}</dd>
          </div>
          <div>
            <dt>审核时间</dt>
            <dd>
              {{
                selected.approved_at
                  ? new Date(selected.approved_at).toLocaleString('zh-CN')
                  : '尚未审核发布'
              }}
            </dd>
          </div>
        </dl>
        <div class="config-grid">
          <section
            v-for="key in ['configuration', 'criteria', 'answer_key'] as const"
            v-show="selected[key]"
            :key="key"
          >
            <h3>
              {{
                key === 'answer_key'
                  ? '正确答案（仅系统管理员）'
                  : key === 'criteria'
                    ? '评分准则'
                    : '题目 / 蓝图配置'
              }}
            </h3>
            <pre>{{ JSON.stringify(selected[key], null, 2) }}</pre>
          </section>
        </div>
        <BlueprintTimingEditor
          v-if="kind === 'blueprints'"
          :key="selected.id"
          :source="selected"
          :disabled="busy"
          @busy="busy = $event"
          @saved="saved"
        />
        <div class="content-actions">
          <button
            v-if="kind === 'items'"
            type="button"
            class="secondary-button"
            data-testid="edit-item"
            :disabled="busy"
            @click="openEditor(selected)"
          >
            基于此版本编辑
          </button>
          <button
            v-if="selected.publication_status === 'draft'"
            class="primary-button"
            :disabled="busy"
            @click="confirm('in_review')"
          >
            提交审核</button
          ><template v-if="selected.publication_status === 'in_review'"
            ><button class="primary-button" :disabled="busy" @click="confirm('published')">
              审核并发布
            </button></template
          ><button
            v-if="selected.publication_status === 'published'"
            class="secondary-button"
            :disabled="busy"
            @click="confirm('retired')"
          >
            退役此版本
          </button>
        </div>
        <ContentAssignmentPanel
          v-if="kind === 'items' && !access.singlePlatform"
          :key="selected.id"
          :item-id="selected.id"
          :disabled="busy"
          @busy="busy = $event"
        />
        </template>
        </div>
      </dialog>
      <dialog ref="confirmation" class="content-confirm" @cancel="busy && $event.preventDefault()">
        <h2>确认{{ labels[target] }}操作</h2>
        <p>{{ selected?.stem ?? selected?.title ?? selected?.name }} · v{{ selected?.version }}</p>
        <p v-if="target === 'published'">
          发布会使相同逻辑内容的上一已发布版本退役。现有测评和报告不会被改写，但依赖旧版本的后续复测可能无法启动。
        </p>
        <p v-else-if="target === 'retired'">
          退役后不能用于新测评；既有测评与历史报告仍保留其原始版本。
        </p>
        <p v-else>本次仅调整当前版本的审核状态，未发布内容不能进入正式测评。</p>
        <div>
          <button class="secondary-button" :disabled="busy" @click="confirmation?.close()">
            取消</button
          ><button class="primary-button" :disabled="busy" @click="applyTransition">
            {{ busy ? '正在提交…' : '确认操作' }}
          </button>
        </div>
      </dialog>
    </template>
  </section>
</template>
<style scoped>
.library-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 14px; background: var(--paper-strong); overflow: hidden; }
.library-summary article { padding: 18px; border-right: 1px solid var(--line); }
.library-summary article:last-child { border-right: 0; }
.library-summary span, .library-summary small { display: block; color: var(--muted); font-size: 12px; }
.library-summary strong { display: block; margin: 4px 0; color: var(--signal-dark); font: 700 28px/1.4 'Cascadia Mono', Consolas, monospace; }
.version-badge { display: inline-block; border-radius: 6px; padding: 4px 8px; background: var(--paper); color: var(--muted); font-size: 12px; white-space: nowrap; }
.version-badge.published { background: var(--mist); color: var(--signal-dark); }
.version-badge.in_review { background: #fff4df; color: #865710; }
.record-title { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; line-height: 1.8; }
.content-notice {
  padding: 13px 16px;
  margin: 16px 0;
  border: 1px solid #c3e1e8;
  border-radius: 8px;
  background: #eef9fb;
  color: #176b7b;
  font-size: 13px;
  line-height: 1.7;
}
.content-filter {
  display: flex;
  align-items: end;
  gap: 14px;
  margin: 20px 0;
  flex-wrap: wrap;
}
.content-filter label {
  display: grid;
  gap: 7px;
  font-size: 13px;
}
.content-filter select {
  padding: 9px 14px;
  background: white;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.content-filter > span {
  margin-left: auto;
  max-width: 430px;
  font-size: 13px;
  color: var(--muted);
}
.content-table {
  overflow: auto;
}
.content-table table {
  min-width: 750px;
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 14px;
}
th,
td {
  padding: 18px 14px;
  border-bottom: 1px solid var(--line);
}
th {
  background: var(--paper);
  font-size: 13px;
  color: var(--muted);
}
td:first-child {
  min-width: 240px;
  max-width: 450px;
}
td small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  overflow-wrap: anywhere;
  margin-top: 5px;
}
.text-button {
  color: var(--signal-dark);
  background: none;
  border: 0;
  cursor: pointer;
  white-space: nowrap;
}
.content-empty {
  padding: 32px;
  color: var(--muted);
  text-align: center;
}
footer {
  display: flex;
  align-items: center;
  justify-content: end;
  gap: 14px;
  padding: 20px 0;
  font-size: 13px;
}
footer > span {
  margin-right: auto;
}
.content-detail {
  position: fixed;
  inset: 0 0 0 auto;
  margin: 0;
  padding: 0;
  width: min(960px, calc(100% - 24px));
  max-width: 100%;
  height: 100dvh;
  max-height: 100dvh;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--line);
  border-radius: 20px 0 0 20px;
  color: var(--text);
  background: var(--paper-strong);
}
.content-detail::backdrop {
  background: #183b4666;
}
.detail-dialog-heading {
  position: sticky;
  top: 0;
  z-index: 1;
  align-items: center;
  padding: 18px 26px;
  border-bottom: 1px solid var(--line);
  background: var(--paper-strong);
}
.detail-dialog-body {
  padding: 26px;
  overflow-wrap: anywhere;
}
.editor-anchor {
  scroll-margin-top: 90px;
}
.content-detail header {
  display: flex;
  gap: 20px;
  justify-content: space-between;
}
.content-detail h2 {
  font-size: 20px;
}
.content-detail p {
  font-size: 13px;
  color: var(--muted);
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.content-detail dl {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin: 20px 0;
  font-size: 13px;
}
.content-detail dt {
  color: var(--muted);
}
.config-grid {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
}
.config-grid h3 {
  font-size: 14px;
}
.config-grid pre {
  font-size: 13px;
  line-height: 1.8;
  background: var(--paper);
  padding: 16px;
  border-radius: 10px;
  overflow: auto;
  max-height: 440px;
  margin-top: 10px;
}
.content-actions {
  display: flex;
  gap: 12px;
  margin-top: 20px;
  flex-wrap: wrap;
}
.content-error {
  padding: 18px;
  background: #fff0ed;
  color: #97382d;
  margin-bottom: 18px;
}
.content-error button {
  margin-left: 12px;
}
.content-confirm {
  position: fixed;
  inset: 0;
  margin: auto;
  max-width: min(560px, calc(100vw - 32px));
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: 16px;
}
.content-confirm::backdrop {
  background: #183b4666;
}
.content-confirm h2 {
  font-size: 20px;
}
.content-confirm p {
  margin: 16px 0;
  line-height: 1.9;
}
.content-confirm > div {
  display: flex;
  justify-content: end;
  gap: 12px;
}
@media (max-width: 700px) {
  .library-summary { grid-template-columns: minmax(0, 1fr); }
  .library-summary article { border-right: 0; border-bottom: 1px solid var(--line); }
  .library-summary article:last-child { border-bottom: 0; }
  .content-filter {
    flex-wrap: wrap;
  }
  .content-filter > span {
    max-width: none;
    margin-left: 0;
  }
  .content-detail {
    width: 100%;
    padding: 0;
    border-radius: 0;
  }
  .detail-dialog-body,
  .detail-dialog-heading {
    padding: 18px;
  }
  .content-detail header {
    flex-direction: column;
  }
  .content-detail .detail-dialog-heading {
    flex-direction: row;
  }
}
</style>
