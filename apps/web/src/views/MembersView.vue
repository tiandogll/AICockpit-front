<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Building2, Layers, Plus, RefreshCw, Users } from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import PlatformLearnersPanel from '../components/PlatformLearnersPanel.vue'
import {
  addOrganizationMember,
  assignCohortMember,
  changeOrganizationRole,
  createAdminCohort,
  listAdminCohorts,
  listOrganizationMembers,
  type CohortOption,
  type OrganizationMember,
  type OrganizationRole,
} from '../services/adminWorkspaceApi'

const access = useAccessStore()
const auth = useAuthStore()
const allowed = computed(
  () => !access.singlePlatform && access.ready && Boolean(access.organizationId) && access.can('members'),
)
const members = ref<OrganizationMember[]>([])
const cohorts = ref<CohortOption[]>([])
const roles = ref<Record<string, OrganizationRole>>({})
const roleLabels: Record<string, string> = {
  learner: '学员',
  evaluator: '评估员',
  org_admin: '组织管理员',
  system_admin: '历史系统角色',
}
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const notice = ref('')
const search = ref('')
const newUserId = ref('')
const newRole = ref<OrganizationRole>('learner')
const cohortName = ref('')
const cohortCode = ref('')
const cohortKind = ref<'class' | 'department'>('class')
const assignedUser = ref('')
const assignedCohort = ref('')
let generation = 0
let requestGeneration = 0
let cohortAttempt = { fingerprint: '', key: '' }
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return members.value.filter((member) =>
    `${member.display_name} ${member.username ?? ''} ${member.email ?? ''} ${member.user_id}`
      .toLowerCase()
      .includes(query),
  )
})
const activeCohorts = computed(() => cohorts.value.filter((cohort) => cohort.is_active))
const describeError = (caught: unknown) =>
  caught instanceof Error ? caught.message : '操作未完成，请重试。'

async function loadMembers() {
  const ticket = ++requestGeneration
  const scope = generation
  const org = access.organizationId
  members.value = []
  cohorts.value = []
  roles.value = {}
  error.value = ''
  if (!allowed.value) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    const [loadedMembers, loadedCohorts] = await Promise.all([
      listOrganizationMembers(org),
      listAdminCohorts(org),
    ])
    if (ticket !== requestGeneration || scope !== generation || !allowed.value) return
    members.value = loadedMembers
    cohorts.value = loadedCohorts
    roles.value = Object.fromEntries(
      loadedMembers
        .filter((member) => member.role !== 'system_admin')
        .map((member) => [member.user_id, member.role as OrganizationRole]),
    )
  } catch (caught) {
    if (ticket === requestGeneration && scope === generation) error.value = describeError(caught)
  } finally {
    if (ticket === requestGeneration && scope === generation) loading.value = false
  }
}

async function mutate(
  operation: (org: string) => Promise<unknown>,
  message: string,
  after?: () => void,
) {
  if (!allowed.value || saving.value) return false
  const scope = generation
  const org = access.organizationId
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    await operation(org)
    if (scope !== generation || !allowed.value) return false
    after?.()
    notice.value = message
    await loadMembers()
    return true
  } catch (caught) {
    if (scope === generation) error.value = describeError(caught)
    return false
  } finally {
    if (scope === generation) saving.value = false
  }
}
function addMember() {
  const userId = newUserId.value.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    error.value = '请输入完整的已注册用户 ID（UUID）。'
    return
  }
  void mutate(
    (org) => addOrganizationMember(org, userId, newRole.value),
    '成员已添加。',
    () => {
      newUserId.value = ''
    },
  )
}
async function saveRole(member: OrganizationMember) {
  const role = roles.value[member.user_id]
  if (!role || role === member.role) return
  const saved = await mutate(
    (org) => changeOrganizationRole(org, member.user_id, role),
    '成员角色已保存。',
  )
  if (saved && member.user_id === auth.user?.id) await access.load(true)
}
function createCohort() {
  const payload = {
    name: cohortName.value.trim(),
    kind: cohortKind.value,
    code: cohortCode.value.trim(),
  }
  if (!payload.name || !/^[A-Za-z0-9_-]+$/.test(payload.code)) {
    error.value = '请填写名称，并使用英文字母、数字、下划线或短横线作为分组代号。'
    return
  }
  const fingerprint = JSON.stringify([access.organizationId, payload])
  if (cohortAttempt.fingerprint !== fingerprint)
    cohortAttempt = { fingerprint, key: crypto.randomUUID() }
  void mutate(
    (org) => createAdminCohort(org, payload, cohortAttempt.key),
    '班级或部门已创建。',
    () => {
      cohortName.value = ''
      cohortCode.value = ''
      cohortAttempt = { fingerprint: '', key: '' }
    },
  )
}
function assignMember() {
  if (
    !members.value.some((member) => member.user_id === assignedUser.value) ||
    !activeCohorts.value.some((cohort) => cohort.id === assignedCohort.value)
  )
    return
  void mutate(
    (org) => assignCohortMember(org, assignedCohort.value, assignedUser.value, crypto.randomUUID()),
    '成员已加入所选分组。',
  )
}
watch(
  () => [access.organizationId, access.ready, allowed.value, auth.user?.id],
  () => {
    generation += 1
    saving.value = false
    notice.value = ''
    search.value = ''
    newUserId.value = ''
    newRole.value = 'learner'
    cohortName.value = ''
    cohortCode.value = ''
    assignedUser.value = ''
    assignedCohort.value = ''
    cohortAttempt = { fingerprint: '', key: '' }
    void loadMembers()
  },
  { immediate: true, flush: 'sync' },
)
onMounted(() => {
  void access.load()
})
onUnmounted(() => {
  generation += 1
  requestGeneration += 1
})
</script>

<template>
  <PlatformLearnersPanel v-if="access.singlePlatform" />
  <section v-else class="members-page shell">
    <header class="page-header">
      <div>
        <span class="eyebrow">组织管理</span>
        <h1>成员与班级</h1>
        <p>在同一组织内管理成员角色，以及班级和部门分组。</p>
      </div>
      <span v-if="access.organization" class="scope-label"
        ><Building2 :size="18" aria-hidden="true" />{{ access.organization.name }}</span
      >
    </header>
    <section
      v-if="!access.ready"
      class="surface state-panel"
      :role="access.error ? 'alert' : 'status'"
    >
      <p>{{ access.error || '正在确认访问权限…' }}</p>
      <button v-if="access.error" class="secondary-button" @click="access.load(true)">
        重试权限读取
      </button>
    </section>
    <section v-else-if="!access.organizationId" class="surface state-panel">
      <h2>请选择组织</h2>
      <p>从页面顶部选择可访问的组织后，再管理其成员。</p>
    </section>
    <section v-else-if="!allowed" class="surface state-panel">
      <h2>没有成员管理权限</h2>
      <p>只有当前组织管理员或已授权的系统管理员可以管理成员。</p>
    </section>
    <template v-else>
      <div v-if="error" class="error-panel" role="alert">
        <p>{{ error }}</p>
        <button :disabled="loading || saving" @click="loadMembers">重新读取</button>
      </div>
      <p v-if="notice" class="notice" role="status">{{ notice }}</p>
      <div class="member-layout">
        <div class="records-column">
          <section class="surface panel">
            <header class="panel-header">
              <div>
                <Users :size="20" aria-hidden="true" />
                <h2>组织成员</h2>
                <span v-if="!loading">{{ members.length }} 人</span>
              </div>
              <button
                class="icon-button"
                aria-label="刷新成员"
                :disabled="loading || saving"
                @click="loadMembers"
              >
                <RefreshCw :size="18" />
              </button>
            </header>
            <label class="search-label"
              >查找成员<input v-model="search" type="search" placeholder="姓名、邮箱或用户 ID"
            /></label>
            <p v-if="loading" class="empty" role="status">正在读取组织成员…</p>
            <div
              v-else-if="members.length"
              class="table-scroll"
              tabindex="0"
              aria-label="组织成员表，可横向滚动"
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">成员</th>
                    <th scope="col">状态</th>
                    <th scope="col">组织角色</th>
                    <th scope="col">操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="member in filtered" :key="member.user_id">
                    <td>
                      <strong>{{ member.display_name }}</strong
                      ><span v-if="member.username" class="member-email">{{ member.username }}</span
                      ><span class="member-email">{{ member.email ?? '未填写邮箱' }}</span>
                      <details>
                        <summary>用户 ID</summary>
                        <code>{{ member.user_id }}</code>
                      </details>
                    </td>
                    <td>
                      <span :class="['state-tag', { inactive: !member.is_active }]">{{
                        member.is_active ? '可用' : '已停用'
                      }}</span>
                    </td>
                    <td>
                      <select
                        v-if="member.role !== 'system_admin'"
                        v-model="roles[member.user_id]"
                        :data-testid="`role-${member.user_id}`"
                        :aria-label="`${member.display_name}的组织角色`"
                        :disabled="saving"
                      >
                        <option value="learner">学员</option>
                        <option value="evaluator">评估员</option>
                        <option value="org_admin">组织管理员</option></select
                      ><span v-else>{{ roleLabels[member.role] }}（只读）</span>
                    </td>
                    <td>
                      <button
                        v-if="member.role !== 'system_admin'"
                        class="text-button"
                        :data-testid="`save-role-${member.user_id}`"
                        :disabled="saving || roles[member.user_id] === member.role"
                        @click="saveRole(member)"
                      >
                        保存角色
                      </button>
                    </td>
                  </tr>
                  <tr v-if="!filtered.length">
                    <td colspan="4" class="empty">没有匹配的成员。</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else-if="!error" class="empty">暂无组织成员。可通过右侧表单添加已注册用户。</p>
            <p class="support-note">最后一位组织管理员不能降级。此处不授予全局系统管理权限。</p>
          </section>
          <section class="surface panel">
            <header class="panel-header">
              <div>
                <Layers :size="20" aria-hidden="true" />
                <h2>班级与部门</h2>
              </div>
            </header>
            <p v-if="loading" class="empty">正在读取分组…</p>
            <div v-else-if="cohorts.length" class="cohort-list">
              <article v-for="cohort in cohorts" :key="cohort.id">
                <div>
                  <strong>{{ cohort.name }}</strong>
                  <p>
                    {{ cohort.kind === 'class' ? '班级' : '部门' }} · {{ cohort.code
                    }}<span v-if="!cohort.is_active"> · 已停用</span>
                  </p>
                </div>
                <span>{{ cohort.member_count }} 人</span>
              </article>
            </div>
            <p v-else-if="!error" class="empty">暂无班级或部门。创建分组后，可以添加本组织成员。</p>
            <p class="support-note">
              当前接口提供分组人数，不提供分组内成员名单；页面不会猜测归属。
            </p>
          </section>
        </div>
        <aside class="forms-column">
          <form class="surface panel" @submit.prevent="addMember">
            <h2><Plus :size="18" aria-hidden="true" />添加已有用户</h2>
            <p class="support-note">
              请向用户确认其已注册的用户 ID。此操作不会创建账号或发送邀请。
            </p>
            <label
              >已注册用户 ID<input
                v-model="newUserId"
                required
                maxlength="36"
                placeholder="完整 UUID"
                autocomplete="off"
                :disabled="saving" /></label
            ><label
              >加入后的角色<select v-model="newRole" :disabled="saving">
                <option value="learner">学员</option>
                <option value="evaluator">评估员</option>
                <option value="org_admin">组织管理员</option>
              </select></label
            ><button class="primary-button" :disabled="saving || loading">添加成员</button>
          </form>
          <form class="surface panel" @submit.prevent="createCohort">
            <h2>新建班级或部门</h2>
            <label
              >分组名称<input v-model="cohortName" required maxlength="120" :disabled="saving"
            /></label>
            <div class="form-pair">
              <label
                >类型<select v-model="cohortKind" :disabled="saving">
                  <option value="class">班级</option>
                  <option value="department">部门</option>
                </select></label
              ><label
                >分组代号<input
                  v-model="cohortCode"
                  required
                  maxlength="80"
                  pattern="[A-Za-z0-9_-]+"
                  placeholder="如 class_2026"
                  :disabled="saving"
              /></label>
            </div>
            <button class="secondary-button" :disabled="saving || loading">创建分组</button>
          </form>
          <form class="surface panel" @submit.prevent="assignMember">
            <h2>将成员加入分组</h2>
            <label
              >组织成员<select v-model="assignedUser" required :disabled="saving || loading">
                <option disabled value="">选择成员</option>
                <option v-for="member in members" :key="member.user_id" :value="member.user_id">
                  {{ member.display_name }} · {{ member.username ?? member.email ?? '未填写邮箱' }}
                </option>
              </select></label
            ><label
              >班级或部门<select v-model="assignedCohort" required :disabled="saving || loading">
                <option disabled value="">选择分组</option>
                <option v-for="cohort in activeCohorts" :key="cohort.id" :value="cohort.id">
                  {{ cohort.name }}
                </option>
              </select></label
            ><button
              class="secondary-button"
              :disabled="saving || loading || !assignedUser || !assignedCohort"
            >
              加入分组
            </button>
          </form>
        </aside>
      </div>
    </template>
  </section>
</template>

<style scoped>
.members-page {
  padding: 32px 0 60px;
  max-width: 1440px;
}
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin-bottom: 28px;
}
.page-header h1 {
  font-size: 28px;
  margin: 6px 0 8px;
}
.page-header p,
.support-note {
  color: var(--muted);
}
.scope-label {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--mist);
  border: 1px solid var(--line);
  padding: 10px 14px;
  border-radius: 10px;
  max-width: 40%;
  overflow-wrap: anywhere;
}
.member-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr);
  gap: 24px;
  align-items: start;
}
.records-column,
.forms-column {
  display: grid;
  gap: 24px;
  min-width: 0;
}
.panel {
  padding: 24px;
  min-width: 0;
}
.panel h2 {
  font-size: 20px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
}
.panel-header > div {
  display: flex;
  align-items: center;
  gap: 10px;
}
.panel-header > div > span {
  font-size: 13px;
  color: var(--muted);
}
.panel-header svg,
.scope-label svg {
  color: var(--signal-dark);
  flex-shrink: 0;
}
.icon-button {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  padding: 9px;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.search-label {
  margin-bottom: 12px;
}
label {
  display: grid;
  gap: 8px;
  margin: 16px 0;
  font-size: 13px;
  font-weight: 600;
}
input,
select {
  min-width: 0;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper-strong);
  color: var(--text);
  font-size: 15px;
  min-height: 44px;
}
.table-scroll {
  overflow-x: auto;
  max-width: 100%;
}
table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  text-align: left;
}
th {
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  background: var(--paper);
}
td,
th {
  padding: 14px 12px;
  border-bottom: 1px solid var(--line);
}
td {
  font-size: 15px;
  vertical-align: middle;
}
td select {
  min-width: 140px;
}
td strong {
  display: block;
}
details,
.member-email {
  font-size: 13px;
  color: var(--muted);
  display: block;
  margin-top: 4px;
}
summary {
  cursor: pointer;
}
code {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.state-tag {
  white-space: nowrap;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--mist);
  color: var(--signal-dark);
  font-size: 13px;
}
.state-tag.inactive {
  background: var(--paper);
  color: var(--muted);
}
.text-button {
  color: var(--signal-dark);
  background: none;
  border: 0;
  white-space: nowrap;
  font-weight: 600;
  cursor: pointer;
  font-size: 13px;
  min-height: 44px;
}
.support-note {
  font-size: 13px;
  line-height: 1.8;
  margin-top: 14px;
}
.cohort-list article {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.cohort-list p {
  font-size: 13px;
  color: var(--muted);
}
.cohort-list article > span {
  white-space: nowrap;
  color: var(--signal-dark);
  font-size: 13px;
}
.form-pair {
  display: grid;
  grid-template-columns: 1fr 1.3fr;
  gap: 12px;
}
.forms-column button {
  width: 100%;
  justify-content: center;
  min-height: 44px;
}
.empty {
  padding: 26px 0;
  color: var(--muted);
}
.state-panel {
  padding: 28px;
}
.state-panel h2 {
  font-size: 20px;
  margin-bottom: 10px;
}
.state-panel button {
  margin-top: 14px;
}
.error-panel {
  padding: 16px 20px;
  background: #fff3f0;
  border: 1px solid #e9c7bf;
  border-radius: 10px;
  color: #8b3e30;
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.error-panel button {
  color: inherit;
  border: 0;
  background: none;
  text-decoration: underline;
  white-space: nowrap;
  cursor: pointer;
}
.notice {
  padding: 14px 20px;
  background: var(--mist);
  color: var(--signal-dark);
  border-radius: 10px;
  margin-bottom: 20px;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
@media (max-width: 1120px) {
  .member-layout {
    grid-template-columns: minmax(0, 1fr);
  }
  .forms-column {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .members-page {
    padding-top: 24px;
  }
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .scope-label {
    max-width: 100%;
  }
  .forms-column {
    grid-template-columns: minmax(0, 1fr);
  }
  .panel {
    padding: 20px 16px;
  }
  .form-pair {
    grid-template-columns: 1fr;
  }
  .error-panel {
    flex-direction: column;
  }
  .page-header h1 {
    font-size: 28px;
  }
}
</style>
