<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Pencil, RefreshCw, Search, ShieldCheck, Users } from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import {
  listLearners,
  updateLearner,
  type PlatformLearner,
  type LearnerUpdate,
} from '../services/platformLearnersApi'

const access = useAccessStore()
const allowed = computed(() => access.ready && access.singlePlatform && access.can('system'))
const rows = ref<PlatformLearner[]>([]),
  total = ref(0),
  offset = ref(0)
const search = ref(''),
  appliedSearch = ref(''),
  loading = ref(false),
  saving = ref(false)
const error = ref(''),
  notice = ref(''),
  editing = ref<PlatformLearner | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const form = ref<LearnerUpdate>({
  display_name: '',
  email: null,
  affiliation: null,
  specialty: null,
  learning_goal: null,
  is_active: true,
  expected_updated_at: '',
})
let generation = 0,
  saveGeneration = 0
const dateLabel = (value: string) => new Date(value).toLocaleDateString('zh-CN')
const message = (caught: unknown) =>
  caught instanceof Error ? caught.message : '操作未完成，请重试。'

async function load(nextOffset = offset.value) {
  const ticket = ++generation
  loading.value = allowed.value
  error.value = ''
  rows.value = []
  if (!allowed.value) {
    total.value = 0
    return
  }
  try {
    const result = await listLearners(appliedSearch.value, nextOffset)
    if (ticket !== generation || !allowed.value) return
    rows.value = result.items
    total.value = result.total
    offset.value = result.offset
  } catch (caught) {
    if (ticket === generation) error.value = message(caught)
  } finally {
    if (ticket === generation) loading.value = false
  }
}
function find() {
  appliedSearch.value = search.value.trim()
  editing.value = null
  notice.value = ''
  void load(0)
}
function refresh() {
  editing.value = null
  void load()
}
function pageTo(nextOffset: number) {
  editing.value = null
  void load(nextOffset)
}
async function edit(row: PlatformLearner) {
  editing.value = row
  error.value = ''
  notice.value = ''
  form.value = {
    display_name: row.display_name,
    email: row.email,
    affiliation: row.affiliation,
    specialty: row.specialty,
    learning_goal: row.learning_goal,
    is_active: row.is_active,
    expected_updated_at: row.updated_at,
  }
  await nextTick()
  nameInput.value?.focus()
}
async function save() {
  if (!editing.value || saving.value || !allowed.value) return
  if (!form.value.display_name.trim()) {
    error.value = '请输入学员姓名或显示名称。'
    return
  }
  const ticket = ++saveGeneration
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await updateLearner(
      editing.value.id,
      {
        ...form.value,
        display_name: form.value.display_name.trim(),
        email: form.value.email?.trim() || null,
        affiliation: form.value.affiliation?.trim() || null,
        specialty: form.value.specialty?.trim() || null,
        learning_goal: form.value.learning_goal?.trim() || null,
      },
      crypto.randomUUID(),
    )
    if (ticket !== saveGeneration || !allowed.value) return
    editing.value = null
    notice.value = '学员信息已保存。'
    await load()
  } catch (caught) {
    if (ticket === saveGeneration) error.value = message(caught)
  } finally {
    if (ticket === saveGeneration) saving.value = false
  }
}
watch(
  allowed,
  () => {
    ++saveGeneration
    editing.value = null
    saving.value = false
    notice.value = ''
    total.value = 0
    void load(0)
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(() => {
  ++generation
  ++saveGeneration
})
</script>

<template>
  <section class="platform-learners shell">
    <header class="page-header">
      <div>
        <span class="eyebrow">教师管理端 · 管理员权限</span>
        <h1>学员管理</h1>
        <p>管理 AI Measure 平台的全部学员。新注册账号自动出现在这里，无需加入或切换空间。</p>
      </div>
      <span class="platform-badge"><ShieldCheck :size="18" />统一平台</span>
    </header>
    <section v-if="!access.ready" class="surface" role="status">
      <p>{{ access.error || '正在确认管理权限…' }}</p>
      <button v-if="access.error" class="secondary-button" @click="access.load(true)">
        重新加载
      </button>
    </section>
    <p v-else-if="!allowed" class="surface" role="alert">仅管理员可以查看和管理学员信息。</p>
    <template v-else>
      <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      <p v-if="notice" class="notice-banner" role="status">{{ notice }}</p>
      <section class="surface learner-directory" :aria-busy="loading">
        <div class="directory-heading">
          <h2>
            <Users :size="24" />平台学员 <small>{{ total }} 人</small>
          </h2>
          <button
            class="secondary-button"
            :disabled="loading || saving"
            @click="refresh"
          >
            <RefreshCw :size="16" />刷新
          </button>
        </div>
        <form class="learner-search" @submit.prevent="find">
          <label for="learner-search">查找学员</label>
          <div>
            <input
              id="learner-search"
              v-model="search"
              placeholder="输入用户名、姓名或邮箱"
              maxlength="100"
              :disabled="saving"
            />
            <button class="primary-button" :disabled="loading || saving">
              <Search :size="16" />搜索
            </button>
          </div>
        </form>
        <p v-if="loading" role="status">正在读取学员信息…</p>
        <p v-else-if="!rows.length && !error">
          {{
            appliedSearch
              ? '没有找到匹配的学员，请调整搜索内容。'
              : '暂无学员。学员注册后会自动加入平台。'
          }}
        </p>
        <div v-else class="learner-table-wrap">
          <table>
            <caption class="sr-only">
              平台学员信息
            </caption>
            <thead>
              <tr>
                <th>学员</th>
                <th>联系方式 / 学习信息</th>
                <th>账号状态</th>
                <th>注册与测评</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.id">
                <td>
                  <strong>{{ row.display_name }}</strong
                  ><span>{{ row.username || '邮箱账号' }}</span>
                  <details>
                    <summary>用户 ID</summary>
                    <code>{{ row.id }}</code>
                  </details>
                </td>
                <td>
                  <span>{{ row.email || '未填写邮箱' }}</span
                  ><span>{{
                    [row.affiliation, row.specialty].filter(Boolean).join(' · ') ||
                    '未填写学校 / 专业'
                  }}</span>
                </td>
                <td>
                  <span class="learner-status" :class="{ disabled: !row.is_active }">{{
                    row.is_active ? '可用' : '已停用'
                  }}</span>
                </td>
                <td>
                  <span>{{ dateLabel(row.created_at) }}</span
                  ><span>测评记录 {{ row.assessment_count }} 次</span>
                </td>
                <td>
                  <button
                    class="secondary-button"
                    :data-testid="`edit-${row.id}`"
                    :disabled="saving"
                    @click="edit(row)"
                  >
                    <Pencil :size="15" />查看 / 编辑
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <nav v-if="total > 20" class="learner-pagination" aria-label="学员列表分页">
          <button
            class="secondary-button"
            :disabled="loading || saving || offset === 0"
            @click="pageTo(offset - 20)"
          >
            上一页
          </button>
          <span>{{ Math.floor(offset / 20) + 1 }} / {{ Math.ceil(total / 20) }}</span>
          <button
            class="secondary-button"
            :disabled="loading || saving || offset + 20 >= total"
            @click="pageTo(offset + 20)"
          >
            下一页
          </button>
        </nav>
        <p class="directory-note">
          这里只展示平台学员，不包含管理员及历史自动化测试账号。测评次数包含历史记录，不代表已完成次数或正式成绩。
        </p>
      </section>
      <form
        v-if="editing"
        class="surface learner-editor"
        data-testid="learner-edit-form"
        :aria-busy="saving"
        @submit.prevent="save"
      >
        <h2>
          编辑学员信息 <small>{{ editing.username || editing.email }}</small>
        </h2>
        <p>用户名及已提交的答案、成绩不会被修改。停用后该账号将无法访问平台，原记录仍然保留。</p>
        <div class="learner-fields">
          <label for="learner-display-name"
            >姓名 / 显示名称<input
              id="learner-display-name"
              ref="nameInput"
              v-model="form.display_name"
              maxlength="80"
              required
              :disabled="saving"
          /></label>
          <label for="learner-email"
            >邮箱（可选）<input
              id="learner-email"
              v-model="form.email"
              type="email"
              maxlength="320"
              :disabled="saving"
          /></label>
          <label for="learner-affiliation"
            >学校 / 单位（可选）<input
              id="learner-affiliation"
              v-model="form.affiliation"
              maxlength="100"
              :disabled="saving"
          /></label>
          <label for="learner-specialty"
            >专业 / 岗位（可选）<input
              id="learner-specialty"
              v-model="form.specialty"
              maxlength="80"
              :disabled="saving"
          /></label>
          <label for="learner-goal" class="full-field"
            >学习目标（可选）<input
              id="learner-goal"
              v-model="form.learning_goal"
              maxlength="200"
              :disabled="saving"
          /></label>
        </div>
        <label class="learner-active"
          ><input
            v-model="form.is_active"
            type="checkbox"
            :disabled="saving"
          />允许该学员登录和使用平台</label
        >
        <p v-if="!form.is_active" class="disable-warning">
          保存后将停用此账号并撤销其刷新登录凭证；不会删除学习记录。
        </p>
        <footer>
          <button type="button" class="secondary-button" :disabled="saving" @click="editing = null">
            取消
          </button>
          <button class="primary-button" :disabled="saving">
            {{ saving ? '保存中…' : '保存学员信息' }}
          </button>
        </footer>
      </form>
    </template>
  </section>
</template>

<style scoped>
.platform-learners {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  gap: 24px;
}
.platform-learners .surface {
  min-width: 0;
  padding: 28px;
}
.platform-badge,
.directory-heading,
h2,
.learner-search div,
.learner-pagination,
.learner-editor footer {
  display: flex;
  align-items: center;
  gap: 12px;
}
.directory-heading {
  justify-content: space-between;
  margin-bottom: 24px;
}
.platform-badge {
  color: #208c9c;
  white-space: nowrap;
}
h2 {
  margin: 0;
  font-size: 23px;
}
h2 small {
  font-size: 15px;
  color: #637d87;
  font-weight: 400;
}
.learner-search {
  margin-bottom: 24px;
}
.learner-search label {
  display: block;
  margin-bottom: 10px;
  font-weight: 600;
}
.learner-search input {
  flex: 1;
  min-width: 0;
}
input:not([type='checkbox']) {
  width: 100%;
  border: 1px solid #cfe2e8;
  border-radius: 10px;
  padding: 12px 14px;
  color: #193e4b;
  background: white;
}
input:focus-visible,
button:focus-visible {
  outline: 3px solid #219bac;
  outline-offset: 3px;
}
.learner-table-wrap {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}
th {
  background: #f3f8fa;
  color: #526e7a;
}
th,
td {
  padding: 16px;
  border-bottom: 1px solid #d5e4e9;
  vertical-align: top;
}
td span {
  display: block;
  margin-top: 7px;
  color: #617b87;
}
td code {
  font-size: 11px;
  word-break: break-all;
}
details {
  margin-top: 8px;
}
.learner-status {
  display: inline-block;
  width: fit-content;
  border-radius: 7px;
  padding: 4px 9px;
  background: #e7f5f7;
  color: #137b8a;
}
.learner-status.disabled {
  background: #fff0e8;
  color: #9b4e22;
}
.directory-note,
.learner-editor p {
  color: #617b87;
  line-height: 1.7;
  margin: 18px 0 0;
}
.learner-pagination {
  justify-content: flex-end;
  margin-top: 20px;
}
.learner-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin: 24px 0;
}
.learner-fields label {
  display: grid;
  gap: 8px;
  font-weight: 600;
}
.full-field {
  grid-column: 1 / -1;
}
.learner-active {
  display: flex;
  align-items: center;
  gap: 10px;
}
.learner-active input {
  width: 18px;
  height: 18px;
}
.learner-editor footer {
  justify-content: flex-end;
  margin-top: 22px;
}
.learner-editor .disable-warning {
  color: #96531c;
}
.notice-banner {
  padding: 15px;
  border-radius: 8px;
  background: #e7f5f7;
  color: #147b78;
}
@media (max-width: 700px) {
  .platform-learners .surface {
    padding: 18px;
  }
  .learner-fields {
    grid-template-columns: 1fr;
  }
  .platform-badge {
    display: none;
  }
  th,
  td {
    padding: 12px;
    min-width: 110px;
  }
  .directory-heading {
    align-items: start;
  }
}
</style>
