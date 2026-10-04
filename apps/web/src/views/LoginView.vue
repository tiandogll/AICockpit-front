<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, Eye, EyeOff, LockKeyhole, UserRound } from '@lucide/vue'
import AuthPageFrame from '../components/AuthPageFrame.vue'
import { safeRedirect, staffDestination } from '../domain/loginPortal'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'

const route = useRoute(),
  router = useRouter(),
  auth = useAuthStore()
const access = useAccessStore()
const staff = computed(() => route.name === 'staff-login' || route.path === '/staff/login')
const identifier = ref(
  typeof route.query.account === 'string' ? route.query.account.slice(0, 320) : '',
)
const password = ref(''),
  busy = ref(false),
  error = ref('')
const showPassword = ref(false)
const permissionDenied = ref(false)
let generation = 0
const redirect = computed(() =>
  safeRedirect(typeof route.query.redirect === 'string' ? route.query.redirect : undefined),
)
async function enterStaff(ticket: number) {
  const actor = auth.user?.id
  await access.load(true)
  if (ticket !== generation || !auth.isAuthenticated || auth.user?.id !== actor) return
  if (access.error || !access.ready)
    throw new Error(access.error || '暂时无法确认管理权限，请重试。')
  const destination = staffDestination(access, redirect.value)
  if (!destination) {
    permissionDenied.value = true
    return
  }
  // Only choose a scope that was present in the freshly loaded server capability response.
  access.organizationId = destination.organizationId
  await router.replace(destination.path)
}
async function checkStaffAccess() {
  if (busy.value || !staff.value || !auth.isAuthenticated) return
  const ticket = ++generation
  busy.value = true
  error.value = ''
  permissionDenied.value = false
  try {
    await enterStaff(ticket)
  } catch (caught) {
    if (ticket === generation)
      error.value = caught instanceof Error ? caught.message : '暂时无法确认管理权限，请重试。'
  } finally {
    if (ticket === generation) busy.value = false
  }
}
async function switchAccount() {
  showPassword.value = false
  generation += 1
  identifier.value = ''
  password.value = ''
  error.value = ''
  permissionDenied.value = false
  busy.value = true
  await auth.logout()
  busy.value = false
}
watch(staff, () => {
  showPassword.value = false
  generation += 1
  password.value = ''
  error.value = ''
  permissionDenied.value = false
  busy.value = false
  if (staff.value && auth.isAuthenticated) void checkStaffAccess()
})
onMounted(() => {
  if (staff.value && auth.isAuthenticated) void checkStaffAccess()
})
onBeforeUnmount(() => {
  generation += 1
})
async function submit() {
  if (busy.value) return
  if (staff.value && auth.isAuthenticated) {
    await checkStaffAccess()
    return
  }
  error.value = ''
  if (!identifier.value.trim() || !password.value || Array.from(password.value).length > 256) {
    error.value = '请输入用户名或邮箱，以及不超过 256 字符的密码。'
    return
  }
  busy.value = true
  const ticket = ++generation
  try {
    await auth.login(identifier.value, password.value)
    if (ticket !== generation) return
    password.value = ''
    if (staff.value) await enterStaff(ticket)
    else await router.replace(redirect.value)
  } catch (caught) {
    if (ticket === generation)
      error.value = caught instanceof Error ? caught.message : '登录未完成，请重新输入。'
  } finally {
    if (ticket === generation) busy.value = false
  }
}
</script>

<template>
  <AuthPageFrame :staff="staff">
    <nav class="login-portals" aria-label="选择登录入口">
      <RouterLink
        :to="{ path: '/login', query: { redirect } }"
        :aria-current="!staff ? 'page' : undefined"
        :aria-disabled="busy || undefined"
        data-testid="student-login-tab"
        @click="busy && $event.preventDefault()"
        >学员端</RouterLink
      >
      <RouterLink
        :to="{ path: '/staff/login', query: { redirect } }"
        :aria-current="staff ? 'page' : undefined"
        :aria-disabled="busy || undefined"
        data-testid="staff-login-tab"
        @click="busy && $event.preventDefault()"
        >教师管理端</RouterLink
      >
    </nav>
    <form novalidate :aria-busy="busy" @submit.prevent="submit">
      <h2>欢迎回来</h2>
      <p>
        {{ staff ? '登录，进入教师管理工作台' : '登录，继续你的能力成长之旅' }}
      </p>
      <div v-if="!staff && route.query.registered === '1'" role="status">
        注册成功。请使用刚设置的密码登录，进入学员工作台。
      </div>
      <div v-if="route.query.password_changed === '1'" role="status">
        密码已修改，原有登录会话已失效。请使用新密码重新登录。
      </div>
      <template v-if="!staff || !auth.isAuthenticated">
        <label for="login-identifier">用户名或邮箱</label>
        <input
          id="login-identifier"
          v-model="identifier"
          type="text"
          autocomplete="username"
          placeholder="请输入用户名或邮箱"
          autocapitalize="none"
          :spellcheck="false"
          maxlength="320"
          :disabled="busy"
          required
        />
        <label for="login-password">密码</label>
        <div class="password-field">
          <input
            id="login-password"
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="请输入密码"
            autocomplete="current-password"
            :disabled="busy"
            required
          />
          <button
            type="button"
            class="password-toggle"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            :aria-pressed="showPassword"
            :disabled="busy"
            @click="showPassword = !showPassword"
          >
            <EyeOff v-if="showPassword" :size="22" /><Eye v-else :size="22" />
          </button>
        </div>
      </template>
      <div v-if="staff && auth.isAuthenticated" class="staff-session">
        <p>当前账号：{{ auth.user?.display_name || '已登录账号' }}</p>
        <p v-if="busy" role="status">正在确认教师管理端权限…</p>
        <p v-else-if="permissionDenied" role="status">
          当前账号没有教师管理端权限。请联系管理员确认授权，或返回学员工作台继续使用。
        </p>
      </div>
      <div v-if="error" role="alert">{{ error }}</div>
      <button
        v-if="!staff || !auth.isAuthenticated"
        class="primary-button"
        type="submit"
        :disabled="busy"
      >
        <span>{{ busy ? '正在登录…' : staff ? '登录教师管理端' : '登录并继续测评' }}</span
        ><ArrowRight v-if="!busy" :size="18" />
      </button>
      <div v-else class="staff-session-actions">
        <button
          type="button"
          class="primary-button"
          :disabled="busy"
          data-testid="retry-staff-access"
          @click="checkStaffAccess"
        >
          {{ busy ? '正在确认权限' : '重新检查管理权限' }}
        </button>
        <RouterLink class="secondary-button" to="/workspace" data-testid="return-student"
          >返回学员工作台</RouterLink
        >
        <button
          type="button"
          class="switch-account"
          :disabled="busy"
          data-testid="switch-login-account"
          @click="switchAccount"
        >
          退出并切换账号
        </button>
      </div>
      <p v-if="!staff" class="auth-switch">
        还没有账号？<RouterLink :to="{ name: 'register', query: { redirect } }"
          >注册学员账号</RouterLink
        >
      </p>
      <p v-else class="auth-switch">需要管理权限？请联系平台负责人</p>
      <div class="login-notes">
        <p><LockKeyhole :size="20" />请妥善保管账号和密码</p>
        <p><UserRound :size="20" />登录遇到问题？请联系管理员</p>
      </div>
    </form>
  </AuthPageFrame>
</template>

<style scoped>
.login-portals {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  padding: 0;
  margin-bottom: 36px;
  background: var(--mist);
  border-radius: 10px;
}
.login-portals a {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 54px;
  padding: 8px 6px;
  color: var(--muted);
  font-size: 18px;
  text-align: center;
  border-radius: 7px;
}
.login-portals a[aria-current='page'] {
  background: var(--paper-strong);
  color: var(--signal-dark);
  font-weight: 600;
  box-shadow:
    0 2px 0 #0a9fb8,
    0 2px 6px #183b4610;
}
.login-portals a[aria-disabled='true'] {
  opacity: 0.6;
  cursor: wait;
}
.password-field {
  position: relative;
}
.password-field #login-password {
  padding-right: 54px;
}
.password-toggle {
  position: absolute;
  right: 6px;
  top: 5px;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
  color: #607b90;
  cursor: pointer;
}
.login-notes {
  margin-top: 26px;
  padding-top: 20px;
  border-top: 1px solid #dfedf2;
  color: #678093;
  font-size: 14px;
}
.login-notes p {
  display: flex;
  align-items: center;
  gap: 16px;
  line-height: 1.6;
}
.login-notes p + p {
  margin-top: 14px;
}
.login-notes svg {
  flex-shrink: 0;
}
@media (max-width: 680px) {
  .login-portals {
    margin-bottom: 28px;
  }
  .login-portals a {
    font-size: 15px;
  }
  .login-notes {
    font-size: 12px;
  }
}
.staff-session {
  margin-top: 22px;
  font-size: 14px;
  color: var(--text);
  line-height: 1.8;
}
.staff-session-actions {
  display: grid;
  gap: 12px;
  margin-top: 22px;
}
.staff-session-actions .primary-button,
.staff-session-actions .secondary-button {
  min-height: 44px;
  justify-content: center;
}
.switch-account {
  border: 0;
  background: transparent;
  min-height: 40px;
  color: var(--muted);
  font-size: 13px;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
a:focus-visible,
button:focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
}
</style>
