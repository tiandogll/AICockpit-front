<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Eye, EyeOff, ShieldCheck } from '@lucide/vue'
import { requestAssessmentLeave } from '../domain/assessmentLeave'
import { isStaffPath } from '../domain/navigation'
import { useAccessStore } from '../stores/access'
import { useAuthStore, type PasswordChange } from '../stores/auth'

const emit = defineEmits<{ busy: [value: boolean]; dirty: [value: boolean] }>()
const auth = useAuthStore(),
  access = useAccessStore(),
  route = useRoute(),
  router = useRouter()
const id = useId()
const draft = reactive<PasswordChange>({
  current_password: '',
  new_password: '',
  confirm_password: '',
})
const visible = reactive({ current_password: false, new_password: false, confirm_password: false })
const busy = ref(false),
  error = ref('')
const available = computed(() => auth.user?.password_change_available === true)
// Vue Router matches these paths case-insensitively; safety checks must agree.
const normalizedPath = computed(() => route.path.toLowerCase())
const editingPage = computed(() =>
  ['/authoring', '/item-bank', '/content-trials'].some(
    (path) => normalizedPath.value === path || normalizedPath.value.startsWith(`${path}/`),
  ),
)
const fields = [
  {
    key: 'current_password',
    label: '当前密码',
    autocomplete: 'current-password',
    placeholder: '输入当前登录密码',
  },
  {
    key: 'new_password',
    label: '新密码',
    autocomplete: 'new-password',
    placeholder: '设置 8–256 个字符的新密码',
  },
  {
    key: 'confirm_password',
    label: '确认新密码',
    autocomplete: 'new-password',
    placeholder: '再次输入新密码',
  },
] as const
const dirty = computed(() => Object.values(draft).some(Boolean))
let generation = 0
watch(busy, (value) => emit('busy', value), { flush: 'sync' })
watch(dirty, (value) => emit('dirty', value), { flush: 'sync' })
function reset() {
  for (const field of fields) {
    draft[field.key] = ''
    visible[field.key] = false
  }
}
watch(
  () => [auth.user?.id, available.value, editingPage.value],
  () => {
    generation += 1
    reset()
    error.value = ''
    busy.value = false
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  generation += 1
  reset()
})

async function submit() {
  if (busy.value) return
  error.value = ''
  if (!available.value || editingPage.value) return
  const currentLength = Array.from(draft.current_password).length
  const newLength = Array.from(draft.new_password).length
  if (!currentLength || currentLength > 256) {
    error.value = '请输入当前密码，最多 256 个字符。'
    return
  }
  if (newLength < 8 || newLength > 256) {
    error.value = '新密码须为 8–256 个字符。'
    return
  }
  if (draft.new_password !== draft.confirm_password) {
    error.value = '两次输入的新密码不一致，请重新确认。'
    return
  }
  if (draft.new_password === draft.current_password) {
    error.value = '新密码不能与当前密码相同。'
    return
  }
  const ticket = ++generation
  const destination = isStaffPath(normalizedPath.value, access.can) ? '/staff/login' : '/login'
  busy.value = true
  try {
    if (!(await requestAssessmentLeave())) {
      if (ticket === generation)
        error.value = '未能确认测评已安全暂存，请先处理测评页面的提示，再修改密码。'
      return
    }
    if (ticket !== generation) return
    await auth.changePassword({ ...draft })
    reset()
    // Successful change intentionally clears auth and closes the parent dialog.
    // Still finish navigation; never redirect an account established in the meantime.
    if (!auth.isAuthenticated && !auth.user)
      await router.replace({ path: destination, query: { password_changed: '1' } })
  } catch (cause) {
    if (ticket === generation)
      error.value = cause instanceof Error ? cause.message : '密码修改未能确认，请重新登录后检查。'
  } finally {
    if (ticket === generation) busy.value = false
  }
}
</script>

<template>
  <div v-if="!available" class="security-unavailable" role="status">
    <ShieldCheck :size="28" aria-hidden="true" />
    <h3>当前服务尚未开放修改密码</h3>
    <p>请更新后端后再试。当前账号密码和登录状态不受影响。</p>
  </div>
  <div v-else-if="editingPage" class="security-unavailable" role="status">
    <ShieldCheck :size="28" aria-hidden="true" />
    <h3>先保存当前编辑，再修改密码</h3>
    <p>
      请先保存或退出当前编辑并返回工作台，再进入账号安全。避免重新登录时丢失未保存的题目、审核意见或试答。
    </p>
  </div>
  <form v-else class="password-change-form" novalidate :aria-busy="busy" @submit.prevent="submit">
    <div class="security-body">
      <div class="security-intro">
        <span class="security-symbol" aria-hidden="true"><ShieldCheck :size="24" /></span>
        <div>
          <h3>修改登录密码</h3>
          <p>只修改当前账号，不改变角色、资料和测评记录。</p>
        </div>
      </div>
      <p :id="`${id}-policy`" class="security-policy">
        新密码须为 8–256 个字符，且不能与当前密码相同。
      </p>
      <div v-for="field in fields" :key="field.key" class="security-field">
        <label :for="`${id}-${field.key}`">{{ field.label }}</label>
        <div class="security-input">
          <input
            :id="`${id}-${field.key}`"
            v-model="draft[field.key]"
            :name="field.key"
            :type="visible[field.key] ? 'text' : 'password'"
            :autocomplete="field.autocomplete"
            :placeholder="field.placeholder"
            :aria-describedby="`${id}-policy ${id}-warning`"
            :disabled="busy"
            :spellcheck="false"
            autocapitalize="none"
            required
          />
          <button
            type="button"
            :aria-label="`${visible[field.key] ? '隐藏' : '显示'}${field.label}`"
            :aria-pressed="visible[field.key]"
            :disabled="busy"
            @click="visible[field.key] = !visible[field.key]"
          >
            <EyeOff v-if="visible[field.key]" :size="19" /><Eye v-else :size="19" />
          </button>
        </div>
      </div>
      <p :id="`${id}-warning`" class="security-warning">
        <ShieldCheck :size="17" />修改成功后，所有已登录会话都会失效，需使用新密码重新登录。
      </p>
      <p v-if="error" class="security-error" role="alert">{{ error }}</p>
    </div>
    <footer class="security-footer">
      <span>请勿与他人共用密码</span>
      <button type="submit" :disabled="busy">
        {{ busy ? '正在安全更新…' : '修改并重新登录' }}<ArrowRight v-if="!busy" :size="17" />
      </button>
    </footer>
  </form>
</template>

<style scoped>
.password-change-form {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.security-unavailable {
  padding: 28px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.security-unavailable svg {
  color: var(--signal-dark);
}
.security-unavailable h3 {
  margin: 12px 0 8px;
  color: var(--text);
  font-size: 18px;
}
.security-body {
  padding: 0 28px 24px;
  overflow: auto;
  overscroll-behavior: contain;
}
.security-intro {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--mist);
}
.security-symbol {
  flex: 0 0 44px;
  height: 44px;
  display: grid;
  place-items: center;
  color: var(--signal-dark);
  background: var(--paper-strong);
  border-radius: 14px;
}
.security-intro h3 {
  font-size: 18px;
  line-height: 1.5;
  font-weight: 700;
}
.security-intro p,
.security-policy {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.security-policy {
  margin: 18px 0 12px;
}
.security-field + .security-field {
  margin-top: 16px;
}
.security-field label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 600;
}
.security-input {
  position: relative;
}
.security-input input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  padding: 10px 52px 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper-strong);
  color: var(--text);
  font: inherit;
  font-size: 14px;
}
.security-input input::placeholder {
  color: var(--muted);
}
.security-input input:hover {
  border-color: var(--signal);
}
.security-input button {
  position: absolute;
  top: 1px;
  right: 3px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}
.security-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 20px;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--mist);
  color: var(--signal-dark);
  font-size: 12px;
  line-height: 1.7;
}
.security-warning svg {
  flex-shrink: 0;
  margin-top: 2px;
}
.security-error {
  margin-top: 14px;
  color: #a43e2c;
  font-size: 13px;
  line-height: 1.7;
}
.security-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 28px;
  flex-shrink: 0;
  border-top: 1px solid var(--line);
  background: var(--paper);
}
.security-footer > span {
  color: var(--muted);
  font-size: 12px;
}
.security-footer button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 44px;
  padding: 10px 18px;
  border: 1px solid var(--signal-dark);
  border-radius: var(--radius-sm);
  color: var(--paper-strong);
  background: var(--signal-dark);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
button:disabled,
input:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
input:focus-visible,
button:focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
}
@media (max-width: 520px) {
  .security-body {
    padding: 0 20px 20px;
  }
  .security-intro {
    padding: 14px;
    gap: 10px;
  }
  .security-footer {
    padding: 12px 20px;
    flex-direction: column;
    align-items: stretch;
  }
  .security-footer > span {
    text-align: center;
  }
}
</style>
