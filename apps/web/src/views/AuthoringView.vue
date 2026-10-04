<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import ItemVersionEditor from '../components/ItemVersionEditor.vue'
import BankReviewPanel from '../components/BankReviewPanel.vue'
import { DIMENSIONS } from '../domain/capabilities'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { ApiError } from '../services/apiClient'
import {
  createAssignedVersion,
  getAssignedItem,
  listAssignedItems,
  listAssignedRubrics,
  submitAssignedItem,
  type AuthoringAdapter,
} from '../services/authoringApi'
import type { ContentIdentity, ContentRecord, ContentStatus } from '../services/contentApi'

const auth = useAuthStore(),
  access = useAccessStore()
const reviewTab = ref(false),
  reviewBusy = ref(false)
const reviewPanel = ref<InstanceType<typeof BankReviewPanel> | null>(null)
function changeWorkspace(showReviews: boolean) {
  if (busy.value || reviewBusy.value || editing.value) return
  if (reviewTab.value && reviewPanel.value && !reviewPanel.value.mayLeave()) return
  reviewTab.value = showReviews
}
const allowed = computed(
  () => auth.isAuthenticated && access.ready && !access.error && access.can('content_author'),
)
const rows = ref<ContentRecord[]>([]),
  selected = ref<ContentRecord | null>(null)
const total = ref(0),
  offset = ref(0),
  status = ref('')
const loading = ref(false),
  detailLoading = ref(false),
  busy = ref(false),
  dirty = ref(false)
const editing = ref(false),
  error = ref(''),
  notice = ref('')
const editorAdapter = shallowRef<AuthoringAdapter | null>(null)
const pendingSubmit = ref<{ id: string; key: string } | null>(null)
const labels: Record<ContentStatus, string> = {
  draft: '草稿',
  in_review: '待审核',
  published: '已发布',
  retired: '已退役',
}
let epoch = 0,
  listTicket = 0,
  detailTicket = 0
function current(ticket: number) {
  return ticket === epoch && allowed.value
}
function clear() {
  epoch += 1
  listTicket += 1
  detailTicket += 1
  rows.value = []
  selected.value = null
  total.value = 0
  offset.value = 0
  status.value = ''
  editing.value = false
  editorAdapter.value = null
  dirty.value = false
  busy.value = false
  loading.value = false
  detailLoading.value = false
  error.value = ''
  notice.value = ''
  pendingSubmit.value = null
}
function failure(caught: unknown, fallback: string) {
  if (caught instanceof ApiError && [401, 403, 404].includes(caught.status)) {
    // An assignment can be revoked while other assignments keep the global capability active.
    // Invalidate all editor/read requests, rather than waiting for a route-capability change.
    const hadEditor = editing.value
    clear()
    error.value = hadEditor
      ? '当前题目的维护权限已失效，题目、答案、量规及未保存草稿已清除。请重新读取任务。'
      : '题目维护权限已失效或内容已不可访问，已清除当前题目信息。请重新读取任务。'
    return
  }
  error.value = caught instanceof Error ? caught.message : fallback
}
async function load() {
  if (!allowed.value) return
  const scope = epoch,
    ticket = ++listTicket
  detailTicket += 1
  selected.value = null
  rows.value = []
  total.value = 0
  pendingSubmit.value = null
  error.value = ''
  loading.value = true
  detailLoading.value = false
  try {
    const page = await listAssignedItems(status.value, offset.value)
    if (current(scope) && ticket === listTicket) {
      rows.value = page.items
      total.value = page.total
    }
  } catch (caught) {
    if (current(scope) && ticket === listTicket) failure(caught, '指派任务读取失败，请重试。')
  } finally {
    if (current(scope) && ticket === listTicket) loading.value = false
  }
}
async function detail(id: string) {
  if (!allowed.value || busy.value || editing.value) return
  const scope = epoch,
    ticket = ++detailTicket
  selected.value = null
  pendingSubmit.value = null
  error.value = ''
  detailLoading.value = true
  try {
    const value = await getAssignedItem(id)
    if (current(scope) && ticket === detailTicket) selected.value = value
  } catch (caught) {
    if (current(scope) && ticket === detailTicket) failure(caught, '题目详情读取失败，请重试。')
  } finally {
    if (current(scope) && ticket === detailTicket) detailLoading.value = false
  }
}
function changePage(next: number) {
  if (busy.value || editing.value || loading.value) return
  offset.value = next
  void load()
}
function closeDetail() {
  if (busy.value) return
  selected.value = null
  pendingSubmit.value = null
}
function startEdit() {
  if (!selected.value || !allowed.value || busy.value) return
  const id = selected.value.id,
    scope = epoch
  async function editorRequest<T>(request: () => Promise<T>): Promise<T> {
    if (!current(scope)) throw new Error('访问上下文已改变，请重新打开指派任务。')
    try {
      const result = await request()
      if (!current(scope)) throw new Error('访问上下文已改变，请重新打开指派任务。')
      return result
    } catch (caught) {
      if (current(scope) && caught instanceof ApiError && [401, 403, 404].includes(caught.status))
        failure(caught, '题目维护权限已失效。')
      throw caught
    }
  }
  editorAdapter.value = {
    save: (body, key) => editorRequest(() => createAssignedVersion(id, body, key)),
    rubrics: (pageOffset) => editorRequest(() => listAssignedRubrics(id, pageOffset)),
  }
  dirty.value = false
  editing.value = true
  pendingSubmit.value = null
  error.value = ''
  notice.value = ''
}
function mayLeave() {
  if (busy.value) return false
  return !dirty.value || window.confirm('题目修改尚未保存，确定放弃这些修改吗？')
}
function cancelEdit() {
  if (!mayLeave()) return
  editing.value = false
  dirty.value = false
  editorAdapter.value = null
}
async function saved(identity: ContentIdentity) {
  const scope = epoch
  if (!allowed.value) return
  editing.value = false
  dirty.value = false
  busy.value = false
  editorAdapter.value = null
  notice.value = `已保存 v${identity.version} 草稿。请核对后单独提交审核，管理员发布前不会进入正式测评。`
  offset.value = 0
  status.value = 'draft'
  await load()
  if (current(scope) && !error.value) await detail(identity.id)
}
function confirmSubmit() {
  if (!selected.value || selected.value.publication_status !== 'draft' || busy.value) return
  if (pendingSubmit.value?.id !== selected.value.id)
    pendingSubmit.value = { id: selected.value.id, key: `item-submit-${crypto.randomUUID()}` }
  error.value = ''
}
async function submit() {
  if (
    !allowed.value ||
    busy.value ||
    !pendingSubmit.value ||
    selected.value?.id !== pendingSubmit.value.id
  )
    return
  const scope = epoch,
    intent = pendingSubmit.value
  busy.value = true
  error.value = ''
  try {
    const identity = await submitAssignedItem(intent.id, intent.key)
    if (!current(scope)) return
    if (selected.value?.id === identity.id) selected.value = { ...selected.value, ...identity }
    rows.value = rows.value.map((row) => (row.id === identity.id ? { ...row, ...identity } : row))
    pendingSubmit.value = null
    notice.value = '已提交审核。教师不能发布题目；请等待系统管理员审核并发布。'
  } catch (caught) {
    if (current(scope)) failure(caught, '提交审核未完成，请重试。')
  } finally {
    if (current(scope)) busy.value = false
  }
}
watch(
  () => [
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
    access.can('content_author'),
  ],
  () => {
    clear()
    if (allowed.value) void load()
  },
  { immediate: true, flush: 'sync' },
)
function beforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value && !busy.value) return
  event.preventDefault()
  event.returnValue = ''
}
window.addEventListener('beforeunload', beforeUnload)
onBeforeRouteLeave(mayLeave)
onBeforeUnmount(() => {
  clear()
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <section class="authoring-page">
    <header class="page-heading">
      <p class="eyebrow">统一题库 · 指派维护</p>
      <h1>我的出题任务</h1>
      <p>只维护管理员指派的题目。修改保存为新版本草稿，提交审核后由管理员发布。</p>
    </header>
    <div v-if="!allowed" class="surface state-message" role="status">
      {{
        access.error ||
        (!access.ready ? '正在核对题目维护权限…' : '尚无题目维护权限，请联系系统管理员指派题目。')
      }}
    </div>
    <template v-else>
      <nav class="authoring-tabs" aria-label="教师题目工作区">
        <button
          type="button"
          :aria-pressed="!reviewTab"
          :disabled="busy || reviewBusy || editing"
          @click="changeWorkspace(false)"
        >
          题目维护
        </button>
        <button
          type="button"
          :aria-pressed="reviewTab"
          :disabled="busy || reviewBusy || editing"
          @click="changeWorkspace(true)"
        >
          待审核题目
        </button>
      </nav>
      <BankReviewPanel v-if="reviewTab" ref="reviewPanel" @busy="reviewBusy = $event" />
      <template v-else>
        <ol class="authoring-flow" aria-label="题目维护流程">
          <li>管理员指派题目</li>
          <li>教师保存新草稿</li>
          <li>提交审核，由管理员发布</li>
        </ol>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <ItemVersionEditor
          v-if="editing && selected && editorAdapter"
          :key="selected.id"
          :source="selected"
          :authoring="editorAdapter"
          @saved="saved"
          @cancel="cancelEdit"
          @busy="busy = $event"
          @dirty="dirty = $event"
        />
        <template v-else>
          <form class="task-filter" @submit.prevent="changePage(0)">
            <label
              >版本状态<select v-model="status" :disabled="busy || loading">
                <option value="">全部状态</option>
                <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
              </select></label
            >
            <button class="secondary-button" :disabled="busy || loading">读取任务</button>
          </form>
          <div v-if="error" class="error-message" role="alert">
            {{ error
            }}<button v-if="!pendingSubmit" class="secondary-button" :disabled="busy" @click="load">
              重新读取
            </button>
          </div>
          <div v-if="loading" class="state-message" role="status">正在读取指派题目…</div>
          <template v-else-if="!error || rows.length">
            <div class="surface task-table">
              <table v-if="rows.length">
                <thead>
                  <tr>
                    <th>指派题目</th>
                    <th>版本 / 状态</th>
                    <th>能力维度</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.id">
                    <td>
                      <strong>{{ row.stem }}</strong
                      ><small>{{ row.logical_id }}</small>
                    </td>
                    <td>v{{ row.version }} · {{ labels[row.publication_status] }}</td>
                    <td>
                      {{
                        DIMENSIONS.find((d) => d.code === row.dimension_code)?.name ??
                        row.dimension_code
                      }}
                    </td>
                    <td>
                      <button
                        class="secondary-button"
                        data-testid="author-detail"
                        :disabled="busy || detailLoading"
                        @click="detail(row.id)"
                      >
                        查看题目
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-else class="state-message">
                暂无指派题目。新题任务须由管理员先建立草稿，再指派给你。
              </div>
            </div>
            <footer class="pagination">
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
            </footer>
          </template>
          <p v-if="detailLoading" class="state-message" role="status">正在读取题目详情…</p>
          <section v-if="selected" class="surface task-detail">
            <header>
              <div>
                <h2>{{ selected.stem }}</h2>
                <p>
                  v{{ selected.version }} · {{ labels[selected.publication_status] }} ·
                  {{ selected.logical_id }}
                </p>
              </div>
              <button class="secondary-button" :disabled="busy" @click="closeDetail">
                收起详情
              </button>
            </header>
            <div class="detail-grid">
              <section>
                <h3>题目配置与标注</h3>
                <pre>{{ JSON.stringify(selected.configuration, null, 2) }}</pre>
              </section>
              <section v-if="selected.answer_key">
                <h3>正确答案（仅限已指派题目）</h3>
                <pre>{{ JSON.stringify(selected.answer_key, null, 2) }}</pre>
              </section>
            </div>
            <p v-if="selected.rubric_version_id">关联量规版本：{{ selected.rubric_version_id }}</p>
            <div class="actions">
              <button
                class="secondary-button"
                data-testid="author-edit"
                :disabled="busy"
                @click="startEdit"
              >
                基于此版本编辑</button
              ><button
                v-if="selected.publication_status === 'draft'"
                class="primary-button"
                data-testid="author-submit"
                :disabled="busy"
                @click="confirmSubmit"
              >
                提交审核
              </button>
            </div>
            <section v-if="pendingSubmit" class="confirmation" aria-labelledby="submit-heading">
              <h3 id="submit-heading">确认提交 v{{ selected.version }} 审核</h3>
              <p>本次只将草稿送交管理员审核，不会发布或替换当前正式题目。</p>
              <div class="actions">
                <button class="secondary-button" :disabled="busy" @click="pendingSubmit = null">
                  取消</button
                ><button
                  class="primary-button"
                  data-testid="confirm-author-submit"
                  :disabled="busy"
                  @click="submit"
                >
                  {{ busy ? '正在提交…' : '确认提交审核' }}
                </button>
              </div>
            </section>
          </section>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.authoring-tabs {
  display: flex;
  gap: 24px;
  margin: 24px 0;
  border-bottom: 1px solid var(--line);
}
.authoring-tabs button {
  padding: 12px 3px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.authoring-tabs button[aria-pressed='true'] {
  color: var(--signal-dark);
  border-bottom-color: var(--signal-dark);
  font-weight: 700;
}
.authoring-page {
  padding-bottom: 36px;
  color: var(--ink-950);
}
.eyebrow {
  font-size: 12px;
  color: var(--signal-dark);
  font-weight: 700;
}
h1 {
  font-size: 28px;
  margin: 8px 0;
}
.page-heading > p:last-child {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.authoring-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 30px;
  padding: 16px 20px 16px 40px;
  margin: 22px 0;
  border-left: 3px solid var(--signal-dark);
  background: var(--paper);
  font-size: 13px;
  line-height: 1.8;
}
.task-filter,
.actions,
.pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.task-filter {
  margin: 20px 0;
  align-items: end;
}
.task-filter label {
  display: grid;
  gap: 7px;
  font-size: 13px;
}
select {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 10px;
  background: white;
  font: inherit;
}
.notice,
.error-message {
  padding: 16px;
  margin: 16px 0;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
}
.notice {
  color: var(--signal-dark);
  background: var(--paper);
  border: 1px solid var(--line);
}
.error-message {
  color: #97382d;
  background: #fff0ed;
}
.error-message button {
  margin-left: 12px;
}
.state-message {
  padding: 30px 20px;
  text-align: center;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.8;
}
.task-table {
  overflow: auto;
}
table {
  width: 100%;
  min-width: 670px;
  border-collapse: collapse;
  text-align: left;
  font-size: 14px;
}
th,
td {
  padding: 16px;
  border-bottom: 1px solid var(--line);
}
th {
  background: var(--paper);
  color: var(--muted);
  font-size: 13px;
}
td:first-child {
  max-width: 440px;
}
small {
  display: block;
  font-size: 12px;
  color: var(--muted);
  margin-top: 6px;
  overflow-wrap: anywhere;
}
.pagination {
  margin: 18px 0;
  justify-content: end;
  font-size: 13px;
}
.pagination span {
  margin-right: auto;
}
.task-detail {
  margin-top: 20px;
  padding: 26px;
}
.task-detail header {
  display: flex;
  align-items: start;
  gap: 18px;
  justify-content: space-between;
}
h2 {
  font-size: 20px;
  line-height: 1.6;
}
h3 {
  font-size: 14px;
}
.task-detail p {
  font-size: 13px;
  line-height: 1.8;
  color: var(--muted);
  margin: 8px 0;
  overflow-wrap: anywhere;
}
.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
  margin: 22px 0;
}
pre {
  background: var(--paper);
  padding: 16px;
  border-radius: 8px;
  max-height: 360px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.8;
  margin-top: 10px;
}
.confirmation {
  padding: 18px;
  margin-top: 22px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--signal-dark);
  border-radius: 8px;
}
.confirmation .actions {
  margin-top: 14px;
}
button {
  min-height: 42px;
}
:is(button, select):focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .task-detail {
    padding: 18px;
  }
  .task-detail header {
    flex-direction: column;
  }
  .authoring-flow {
    display: grid;
    gap: 7px;
  }
}
</style>
