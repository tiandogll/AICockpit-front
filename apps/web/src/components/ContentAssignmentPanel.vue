<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import {
  listItemAssignments,
  setItemAssignment,
  type ContentAssignment,
} from '../services/authoringApi'
const props = defineProps<{ itemId: string; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean] }>()
const auth = useAuthStore(),
  access = useAccessStore()
const allowed = computed(
  () => auth.isAuthenticated && access.ready && !access.error && access.can('content'),
)
const assignments = ref<ContentAssignment[]>([]),
  userId = ref(''),
  error = ref(''),
  notice = ref('')
const loading = ref(false),
  busy = ref(false)
const intent = ref<{ userId: string; active: boolean; key: string } | null>(null)
let epoch = 0,
  loadTicket = 0
function current(scope: number) {
  return scope === epoch && allowed.value
}
function reset() {
  epoch += 1
  loadTicket += 1
  assignments.value = []
  userId.value = ''
  error.value = ''
  notice.value = ''
  intent.value = null
  loading.value = false
  busy.value = false
  emit('busy', false)
}
async function load() {
  if (!allowed.value) return
  const scope = epoch,
    ticket = ++loadTicket,
    id = props.itemId
  error.value = ''
  loading.value = true
  assignments.value = []
  try {
    const rows = await listItemAssignments(id)
    if (current(scope) && ticket === loadTicket) assignments.value = rows
  } catch (caught) {
    if (current(scope) && ticket === loadTicket)
      error.value = caught instanceof Error ? caught.message : '题目指派读取失败。'
  } finally {
    if (current(scope) && ticket === loadTicket) loading.value = false
  }
}
function confirm(target: string, active: boolean) {
  if (!allowed.value || busy.value || props.disabled) return
  const id = target.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    error.value = '请填写已注册账号的完整用户 ID（UUID），不能填写邮箱或用户名。'
    return
  }
  error.value = ''
  notice.value = ''
  if (intent.value?.userId !== id || intent.value.active !== active)
    intent.value = { userId: id, active, key: `item-assignment-${crypto.randomUUID()}` }
}
async function apply() {
  if (!allowed.value || busy.value || props.disabled || !intent.value) return
  const scope = epoch,
    pending = intent.value,
    id = props.itemId
  busy.value = true
  emit('busy', true)
  error.value = ''
  try {
    const assignment = await setItemAssignment(id, pending.userId, pending.active, pending.key)
    if (!current(scope)) return
    notice.value =
      assignment.active !== pending.active
        ? `指派状态已被后续操作改变；${assignment.active ? '维护权限仍有效' : '维护权限当前无效'}。本次重试未重新施加旧操作，如需更改，请重新确认操作。`
        : assignment.active
          ? '已指派此题的维护任务。该账号重新读取权限后可进入“我的出题任务”。'
          : '已撤销此题的维护任务，后续读取、保存和提交将由服务端拒绝。'
    intent.value = null
    userId.value = ''
    await load()
  } catch (caught) {
    if (current(scope))
      error.value = caught instanceof Error ? caught.message : '题目指派更新失败，请重试。'
  } finally {
    if (current(scope)) {
      busy.value = false
      emit('busy', false)
    }
  }
}
watch(
  () => [
    props.itemId,
    auth.user?.id,
    auth.isAuthenticated,
    access.organizationId,
    access.ready,
    access.error,
    access.can('content'),
  ],
  () => {
    reset()
    if (allowed.value) void load()
  },
  { immediate: true, flush: 'sync' },
)
onBeforeUnmount(reset)
</script>
<template>
  <section v-if="allowed" class="assignment-panel" aria-labelledby="assignment-heading">
    <h3 id="assignment-heading">指派教师维护此题</h3>
    <p>指派覆盖此逻辑题目的所有版本，允许创建继任草稿和提交审核；不会授予全库管理或发布权限。</p>
    <form @submit.prevent="confirm(userId, true)">
      <label
        >已注册账号的用户 ID<input
          v-model="userId"
          data-testid="assignment-user"
          placeholder="完整用户 UUID"
          autocomplete="off"
          :disabled="busy || disabled" /></label
      ><button class="secondary-button" :disabled="busy || disabled">指派维护</button>
    </form>
    <p class="hint">用户 ID 可从“成员与班级”的既有成员记录获取。本处不发送邀请、不创建账号。</p>
    <p v-if="notice" role="status" class="assignment-notice">{{ notice }}</p>
    <div v-if="error" role="alert" class="assignment-error">
      {{ error
      }}<button
        v-if="!intent"
        type="button"
        class="secondary-button"
        :disabled="busy || disabled"
        @click="load"
      >
        重新读取指派
      </button>
    </div>
    <p v-if="loading" role="status">正在读取指派记录…</p>
    <ul v-else-if="assignments.length" class="assignment-list">
      <li v-for="row in assignments" :key="row.id">
        <div>
          <strong>{{ row.display_name }}</strong
          ><small>{{ row.user_id }}</small
          ><span>{{ row.active ? '维护中' : '已撤销' }}</span>
        </div>
        <button
          type="button"
          class="secondary-button"
          :data-testid="row.active ? 'revoke-assignment' : 'restore-assignment'"
          :disabled="busy || disabled"
          @click="confirm(row.user_id, !row.active)"
        >
          {{ row.active ? '撤销指派' : '恢复指派' }}
        </button>
      </li>
    </ul>
    <p v-else-if="!error">此题尚无指派记录。</p>
    <section v-if="intent" class="assignment-confirm" aria-labelledby="assignment-confirm-heading">
      <h4 id="assignment-confirm-heading">{{ intent.active ? '确认指派' : '确认撤销' }}</h4>
      <p>
        账号 {{ intent.userId }}。{{
          intent.active
            ? '此账号将能够读取此题的题干、答案、标注及关联量规，并保存新草稿、提交审核。'
            : '此账号将不再能够维护此逻辑题的所有版本，已保存的版本仍保留。'
        }}
      </p>
      <div>
        <button class="secondary-button" :disabled="busy || disabled" @click="intent = null">
          取消</button
        ><button
          class="primary-button"
          data-testid="confirm-assignment"
          :disabled="busy || disabled"
          @click="apply"
        >
          {{ busy ? '正在更新…' : intent.active ? '确认指派维护' : '确认撤销指派' }}
        </button>
      </div>
    </section>
  </section>
</template>
<style scoped>
.assignment-panel {
  border-top: 1px solid var(--line);
  margin-top: 26px;
  padding-top: 24px;
}
h3 {
  font-size: 16px;
}
h4 {
  font-size: 14px;
}
p {
  font-size: 13px;
  color: var(--muted);
  line-height: 1.8;
  margin: 10px 0;
  overflow-wrap: anywhere;
}
form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  margin: 16px 0 10px;
}
label {
  display: grid;
  gap: 8px;
  font-size: 13px;
  flex: 1;
  min-width: 240px;
}
input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  padding: 11px 12px;
  font: inherit;
}
.hint {
  font-size: 12px;
}
button {
  min-height: 42px;
}
.assignment-list {
  list-style: none;
  margin: 16px 0;
  padding: 0;
}
li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 15px 0;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
}
small {
  display: block;
  font-size: 12px;
  color: var(--muted);
  overflow-wrap: anywhere;
  margin: 5px 0;
}
.assignment-notice,
.assignment-confirm {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 16px;
}
.assignment-notice {
  color: var(--signal-dark);
}
.assignment-confirm > div {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 12px;
}
.assignment-error {
  padding: 14px;
  color: #97382d;
  background: #fff0ed;
  font-size: 13px;
  line-height: 1.8;
  border-radius: 8px;
}
.assignment-error button {
  margin-left: 12px;
}
:is(input, button):focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
}
@media (max-width: 600px) {
  li {
    align-items: flex-start;
    flex-direction: column;
  }
  label {
    min-width: 0;
    flex-basis: 100%;
  }
}
</style>
