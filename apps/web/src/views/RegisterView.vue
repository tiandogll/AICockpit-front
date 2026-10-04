<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowRight, ChevronRight, Eye, EyeOff, Info, LoaderCircle, ShieldCheck } from '@lucide/vue'
import RegistrationAbilityIllustration from '../components/RegistrationAbilityIllustration.vue'
import { safeRedirect } from '../router'
import { registerLearner } from '../services/registrationApi'

const route = useRoute(),
  router = useRouter()
const username = ref(''),
  displayName = ref(''),
  email = ref(''),
  password = ref(''),
  confirmation = ref('')
const busy = ref(false),
  error = ref(''),
  registered = ref(false)
const showPassword = ref(false),
  showConfirmation = ref(false)
const errorField = ref('')
const form = ref<HTMLFormElement | null>(null)
const loginLocation = computed(() => ({
  name: 'login',
  query: {
    redirect: redirect.value,
    ...(registered.value ? { registered: '1', account: username.value.trim().toLowerCase() } : {}),
  },
}))
async function invalid(field: string, message: string) {
  error.value = message
  errorField.value = field
  await nextTick()
  form.value?.querySelector<HTMLInputElement>(`#${field}`)?.focus()
}
const redirect = computed(() =>
  safeRedirect(typeof route.query.redirect === 'string' ? route.query.redirect : undefined),
)
async function submit() {
  if (busy.value || registered.value) return
  error.value = ''
  errorField.value = ''
  const account = username.value.trim().toLowerCase(),
    name = displayName.value.trim(),
    contact = email.value.trim()
  if (!/^[a-z][a-z0-9._-]{2,31}$/.test(account)) {
    await invalid(
      'register-username',
      '用户名须为 3–32 位，以英文字母开头，只能包含字母、数字、点、下划线或连字符。',
    )
    return
  }
  if (!name || Array.from(name).length > 80) {
    await invalid('register-display-name', '显示名称须为 1–80 个字符。')
    return
  }
  if (Array.from(password.value).length < 8 || Array.from(password.value).length > 256) {
    await invalid('register-password', '密码须为 8–256 个字符，首尾空格也会保留。')
    return
  }
  if (password.value !== confirmation.value) {
    await invalid('register-confirm', '两次密码不一致，请重新确认。')
    return
  }
  if (contact && (contact.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact))) {
    await invalid('register-email', '请输入有效邮箱，或留空。')
    return
  }
  busy.value = true
  try {
    await registerLearner({
      username: account,
      password: password.value,
      display_name: name,
      ...(contact ? { email: contact } : {}),
    })
    registered.value = true
    password.value = ''
    confirmation.value = ''
    await router.replace({
      name: 'login',
      query: { registered: '1', account, redirect: redirect.value },
    })
  } catch (caught) {
    error.value = registered.value
      ? '账号已创建。请点击下方“返回登录”，不要重复注册。'
      : caught instanceof TypeError
        ? '暂时无法连接注册服务，请检查网络或稍后重试。'
        : caught instanceof Error
          ? caught.message
          : '注册未完成，请检查连接后重试。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="registration-page" aria-label="注册学员账号">
    <div class="registration-story">
      <p class="registration-eyebrow">AI MEASURE · 开启成长之旅</p>
      <h1>从这里开始，<br /><em>看见你的 AI 能力</em></h1>
      <p class="registration-lead">
        用一次测评，了解自己的六维能力。<br />让每一步成长，都有迹可循。
      </p>
      <div class="registration-art"><RegistrationAbilityIllustration /></div>
      <ol class="registration-steps" aria-label="从注册到报告的使用流程">
        <li v-for="(step, index) in ['创建账号', '完成测评', '查看报告']" :key="step">
          <span class="step-number">0{{ index + 1 }}</span
          ><strong>{{ step }}</strong>
          <ChevronRight v-if="index < 2" :size="20" aria-hidden="true" />
        </li>
      </ol>
      <p class="registration-privacy">
        <ShieldCheck :size="23" aria-hidden="true" />回答默认不用于模型训练
      </p>
    </div>
    <div class="registration-card">
      <span class="registration-badge">学员注册</span>
      <h2 id="registration-title">创建你的学习账号</h2>
      <p class="registration-caption">创建学员账号，开启测评与成长。</p>
      <form
        ref="form"
        novalidate
        aria-labelledby="registration-title"
        :aria-busy="busy"
        @submit.prevent="submit"
      >
        <div class="identity-fields">
          <div class="registration-field">
            <label for="register-username">用户名</label>
            <input
              id="register-username"
              v-model="username"
              type="text"
              autocomplete="username"
              autocapitalize="none"
              :spellcheck="false"
              minlength="3"
              maxlength="32"
              placeholder="设置用户名"
              :disabled="busy || registered"
              required
              :aria-invalid="errorField === 'register-username'"
              :aria-describedby="
                errorField === 'register-username'
                  ? 'username-rule registration-error'
                  : 'username-rule'
              "
            />
          </div>
          <div class="registration-field">
            <label for="register-display-name">显示名称</label>
            <input
              id="register-display-name"
              v-model="displayName"
              type="text"
              autocomplete="nickname"
              placeholder="你的姓名或昵称"
              :disabled="busy || registered"
              required
              :aria-invalid="errorField === 'register-display-name'"
              :aria-describedby="
                errorField === 'register-display-name'
                  ? 'name-rule registration-error'
                  : 'name-rule'
              "
            />
            <span id="name-rule" class="registration-sr-only"
              >1–80 个字符，用于个人工作台和报告。</span
            >
          </div>
          <p id="username-rule" class="registration-rule">
            用户名 3–32 位，以英文字母开头。<span class="registration-sr-only"
              >可用字母、数字、点、下划线和连字符，不区分大小写。</span
            >
          </p>
        </div>
        <div class="registration-field">
          <label for="register-password">密码</label>
          <div class="password-input">
            <input
              id="register-password"
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="8"
              placeholder="设置 8 位及以上密码"
              :disabled="busy || registered"
              required
              :aria-invalid="errorField === 'register-password'"
              :aria-describedby="
                errorField === 'register-password'
                  ? 'password-rule registration-error'
                  : 'password-rule'
              "
            />
            <button
              type="button"
              :aria-label="showPassword ? '隐藏密码' : '显示密码'"
              :aria-pressed="showPassword"
              aria-controls="register-password"
              :disabled="busy || registered"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" :size="19" /><Eye v-else :size="19" />
            </button>
          </div>
          <span id="password-rule" class="registration-sr-only"
            >8–256 个字符。请勿与其他网站共用密码，首尾空格会保留。</span
          >
        </div>
        <div class="registration-field">
          <label for="register-confirm">确认密码</label>
          <div class="password-input">
            <input
              id="register-confirm"
              v-model="confirmation"
              :type="showConfirmation ? 'text' : 'password'"
              autocomplete="new-password"
              minlength="8"
              placeholder="再次输入密码"
              :disabled="busy || registered"
              required
              :aria-invalid="errorField === 'register-confirm'"
              :aria-describedby="
                errorField === 'register-confirm' ? 'registration-error' : undefined
              "
            />
            <button
              type="button"
              :aria-label="showConfirmation ? '隐藏确认密码' : '显示确认密码'"
              :aria-pressed="showConfirmation"
              aria-controls="register-confirm"
              :disabled="busy || registered"
              @click="showConfirmation = !showConfirmation"
            >
              <EyeOff v-if="showConfirmation" :size="19" /><Eye v-else :size="19" />
            </button>
          </div>
        </div>
        <div class="registration-field">
          <label for="register-email">邮箱 <span class="optional-label">选填</span></label>
          <input
            id="register-email"
            v-model="email"
            type="email"
            autocomplete="email"
            maxlength="254"
            placeholder="填写常用邮箱（可选）"
            :disabled="busy || registered"
            :aria-invalid="errorField === 'register-email'"
            :aria-describedby="
              errorField === 'register-email' ? 'email-rule registration-error' : 'email-rule'
            "
          />
          <span id="email-rule" class="registration-sr-only"
            >可留空，填写后也可用邮箱登录。目前不提供邮箱验证或密码找回。</span
          >
        </div>
        <p class="registration-info">
          <Info :size="19" aria-hidden="true" /><span
            >注册后进入统一平台；作答与报告仍仅按账号权限访问。</span
          >
        </p>
        <div v-if="error" id="registration-error" class="registration-error" role="alert">
          {{ error }}
        </div>
        <div v-if="registered" class="registration-success" role="status">
          账号已创建，请返回登录。不要重复注册。
        </div>
        <button class="registration-submit" type="submit" :disabled="busy || registered">
          <LoaderCircle v-if="busy" class="registration-spinner" :size="20" aria-hidden="true" />
          <span>{{
            busy ? '正在创建账号…' : registered ? '账号已创建' : '创建账号，开始探索'
          }}</span>
          <ArrowRight v-if="!busy && !registered" :size="23" aria-hidden="true" />
        </button>
        <p class="registration-login">
          已有账号？
          <RouterLink :to="loginLocation">{{ registered ? '返回登录' : '立即登录' }}</RouterLink>
        </p>
      </form>
      <p class="registration-staff">管理员账号由平台负责人授权</p>
    </div>
  </section>
</template>
<style scoped src="../assets/registration-form.css"></style>
