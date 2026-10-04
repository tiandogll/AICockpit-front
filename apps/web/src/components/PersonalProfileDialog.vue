<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue'
import {
  Building2,
  Check,
  ChevronRight,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from '@lucide/vue'
import { useAuthStore, type ProfileUpdate } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import PasswordChangeForm from './PasswordChangeForm.vue'

defineProps<{ roleLabel: string }>()
const emit = defineEmits<{ closed: [] }>()
const auth = useAuthStore()
const access = useAccessStore()
const dialog = ref<HTMLDialogElement | null>(null)
const id = useId()
const draft = reactive({ display_name: '', affiliation: '', specialty: '', learning_goal: '' })
const error = ref(''),
  saved = ref(false),
  busy = ref(false),
  confirmingClose = ref(false)
let opening = 0
const savedValues = ref('')
const dirty = computed(() => JSON.stringify(draft) !== savedValues.value)
const section = ref<'profile' | 'security'>('profile')
const securityBusy = ref(false),
  securityDirty = ref(false),
  confirmingSection = ref(false)
const allBusy = computed(() => busy.value || securityBusy.value)
const initial = computed(
  () => Array.from(draft.display_name.trim() || auth.user?.display_name || '我')[0],
)
const joined = computed(() => {
  if (!auth.user?.created_at) return '暂无记录'
  const date = new Date(auth.user.created_at)
  return Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleDateString('zh-CN')
})
function show() {
  if (dialog.value?.open) return
  opening += 1
  Object.assign(draft, {
    display_name: auth.user?.display_name ?? '',
    affiliation: auth.user?.affiliation ?? '',
    specialty: auth.user?.specialty ?? '',
    learning_goal: auth.user?.learning_goal ?? '',
  })
  savedValues.value = JSON.stringify(draft)
  error.value = ''
  saved.value = false
  busy.value = false
  confirmingClose.value = false
  confirmingSection.value = false
  section.value = 'profile'
  securityBusy.value = false
  securityDirty.value = false
  dialog.value?.showModal()
}
function requestClose() {
  if (allBusy.value) return
  if (dirty.value || securityDirty.value) {
    confirmingSection.value = false
    confirmingClose.value = true
    return
  }
  dialog.value?.close()
}
function closed() {
  opening += 1
  section.value = 'profile'
  securityBusy.value = false
  securityDirty.value = false
  confirmingClose.value = false
  confirmingSection.value = false
  emit('closed')
}
function selectSection(next: 'profile' | 'security') {
  if (allBusy.value || section.value === next) return
  if (next === 'security' && dirty.value) {
    error.value = '资料尚未保存，请先保存资料，或取消并放弃修改后再进入账号安全。'
    return
  }
  if (next === 'profile' && securityDirty.value) {
    confirmingClose.value = false
    confirmingSection.value = true
    return
  }
  section.value = next
  securityDirty.value = false
  confirmingClose.value = false
  confirmingSection.value = false
}
function discardSecurity() {
  securityDirty.value = false
  if (confirmingSection.value) selectSection('profile')
  else dialog.value?.close()
}
function continueSecurity() {
  confirmingClose.value = false
  confirmingSection.value = false
}
watch(
  () => auth.user?.id,
  () => {
    opening += 1
    dialog.value?.close()
  },
)
watch(
  draft,
  () => {
    saved.value = false
    confirmingClose.value = false
  },
  { flush: 'sync' },
)
async function save() {
  if (busy.value) return
  error.value = ''
  saved.value = false
  const value: ProfileUpdate = {
    display_name: draft.display_name.trim(),
    affiliation: draft.affiliation.trim(),
    specialty: draft.specialty.trim(),
    learning_goal: draft.learning_goal.trim().replace(/\r\n/g, '\n'),
  }
  if (!value.display_name || Array.from(value.display_name).length > 80) {
    error.value = '请输入 1–80 个字符的显示姓名。'
    return
  }
  if (
    Array.from(value.affiliation ?? '').length > 100 ||
    Array.from(value.specialty ?? '').length > 80 ||
    Array.from(value.learning_goal ?? '').length > 200
  ) {
    error.value = '学校／单位最多 100 字，专业／岗位最多 80 字，学习目标最多 200 字。'
    return
  }
  if (
    Object.entries(value).some(([field, text]) =>
      (field === 'learning_goal'
        ? /[\u0000-\u0009\u000b-\u001f\u007f]/
        : /[\u0000-\u001f\u007f]/
      ).test(text ?? ''),
    )
  ) {
    error.value = '资料中含有不支持的字符，请调整后保存（仅学习目标允许换行）。'
    return
  }
  const ticket = opening
  busy.value = true
  try {
    await auth.updateProfile(value)
    if (ticket !== opening) return
    Object.assign(draft, value)
    savedValues.value = JSON.stringify(draft)
    saved.value = true
  } catch (cause) {
    if (ticket === opening)
      error.value =
        cause instanceof TypeError
          ? '网络连接失败，请检查连接后重试，填写内容已保留。'
          : cause instanceof Error
            ? cause.message
            : '保存失败，请稍后重试。'
  } finally {
    if (ticket === opening) busy.value = false
  }
}
defineExpose({ show })
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="profile-dialog"
      :aria-labelledby="`${id}-heading`"
      @cancel.prevent="requestClose"
      @close="closed"
    >
      <header class="profile-heading">
        <div>
          <span class="heading-kicker">我的账号 <ChevronRight :size="12" /></span>
          <h2 :id="`${id}-heading`">个人资料</h2>
        </div>
        <button
          type="button"
          class="close-profile"
          aria-label="关闭个人资料"
          :disabled="allBusy"
          @click="requestClose"
        >
          <X :size="20" />
        </button>
      </header>
      <nav class="profile-sections" aria-label="个人资料设置">
        <button
          type="button"
          :aria-pressed="section === 'profile'"
          :disabled="allBusy"
          @click="selectSection('profile')"
        >
          <UserRound :size="16" />个人资料
        </button>
        <button
          type="button"
          :aria-pressed="section === 'security'"
          :disabled="allBusy"
          @click="selectSection('security')"
        >
          <LockKeyhole :size="16" />账号安全
        </button>
      </nav>
      <PasswordChangeForm
        v-if="section === 'security'"
        @busy="securityBusy = $event"
        @dirty="securityDirty = $event"
      />
      <footer
        v-if="section === 'security' && (confirmingClose || confirmingSection)"
        class="security-discard profile-footer"
      >
        <p class="discard-hint" role="status">密码尚未提交，离开后将清空输入。</p>
        <div class="profile-actions">
          <button type="button" class="profile-secondary" @click="continueSecurity">
            继续编辑
          </button>
          <button type="button" class="profile-secondary" @click="discardSecurity">
            清空并离开
          </button>
        </div>
      </footer>
      <form v-if="section === 'profile'" :aria-busy="busy" @submit.prevent="save">
        <div class="profile-body">
          <div class="profile-identity">
            <span class="profile-avatar" aria-hidden="true">{{ initial }}</span>
            <div>
              <strong>{{ draft.display_name.trim() || '你的姓名' }}</strong>
              <p>让每一次成长，都有你的名字</p>
            </div>
            <span class="profile-role"><ShieldCheck :size="14" />{{ roleLabel }}</span>
          </div>
          <section :aria-labelledby="`${id}-basic`" class="profile-section">
            <div class="section-heading">
              <h3 :id="`${id}-basic`">个人信息</h3>
              <span>除姓名外均为选填</span>
            </div>
            <label class="profile-field">
              <span
                >显示姓名
                <span class="field-count"
                  >{{ Array.from(draft.display_name).length }}/80</span
                ></span
              >
              <input
                v-model="draft.display_name"
                name="display_name"
                autocomplete="nickname"
                :disabled="busy"
                :aria-describedby="`${id}-name-help`"
                placeholder="怎么称呼你"
              />
            </label>
            <p :id="`${id}-name-help`" class="field-help">
              保存后同步更新侧栏和工作台，不改变登录账号。
            </p>
            <div class="profile-field-grid">
              <label class="profile-field"
                ><span>学校／单位</span
                ><input
                  v-model="draft.affiliation"
                  name="affiliation"
                  autocomplete="organization"
                  :disabled="busy"
                  placeholder="例如：某某大学"
              /></label>
              <label class="profile-field"
                ><span>专业／岗位</span
                ><input
                  v-model="draft.specialty"
                  name="specialty"
                  autocomplete="organization-title"
                  :disabled="busy"
                  placeholder="例如：计算机专业／产品经理"
              /></label>
            </div>
            <label class="profile-field goal-field"
              ><span
                >学习目标
                <span class="field-count"
                  >{{ Array.from(draft.learning_goal).length }}/200</span
                ></span
              ><textarea
                v-model="draft.learning_goal"
                name="learning_goal"
                rows="2"
                :disabled="busy"
                placeholder="例如：学会核验 AI 生成的信息，提高工作效率"
              />
            </label>
            <p class="field-help">
              {{
                access.singlePlatform
                  ? '仅用于保存个人资料，不会更改账号权限、正式测评分数或自动发送给 AI。'
                  : '仅用于保存个人资料，不会更改组织归属、正式测评分数或自动发送给 AI。'
              }}
            </p>
          </section>
          <section :aria-labelledby="`${id}-account`" class="profile-section account-section">
            <div class="section-heading">
              <h3 :id="`${id}-account`">账号信息</h3>
              <span><LockKeyhole :size="12" />只读</span>
            </div>
            <dl class="profile-details">
              <div>
                <dt><UserRound :size="15" />登录账号</dt>
                <dd>{{ auth.user?.username || '未设置用户名' }}</dd>
              </div>
              <div>
                <dt><Mail :size="15" />邮箱</dt>
                <dd>{{ auth.user?.email || '未填写（不影响登录）' }}</dd>
              </div>
              <div>
                <dt>
                  <Building2 :size="15" />{{ access.singlePlatform ? '所属平台' : '当前空间' }}
                </dt>
                <dd>
                  {{
                    access.organization?.name ||
                    (access.singlePlatform
                      ? '平台信息未加载'
                      : access.ready
                        ? '暂无所属空间'
                        : '空间信息未加载')
                  }}
                </dd>
              </div>
              <div>
                <dt><ShieldCheck :size="15" />账号状态</dt>
                <dd>
                  {{ auth.user?.is_active ? '正常使用' : '不可用'
                  }}<span class="joined-date">加入于 {{ joined }}</span>
                </dd>
              </div>
            </dl>
          </section>
        </div>
        <footer class="profile-footer">
          <div class="profile-feedback" aria-live="polite">
            <p v-if="error" role="alert" class="save-error">{{ error }}</p>
            <p v-else-if="saved" class="save-success"><Check :size="16" />资料已保存</p>
            <p v-else-if="confirmingClose" class="discard-hint">修改尚未保存</p>
            <p v-else>{{ dirty ? '有未保存的修改' : '选填信息可随时清空' }}</p>
          </div>
          <div v-if="confirmingClose" class="profile-actions">
            <button type="button" class="profile-secondary" @click="confirmingClose = false">
              继续编辑</button
            ><button type="button" class="profile-secondary" @click="dialog?.close()">
              放弃修改
            </button>
          </div>
          <div v-else class="profile-actions">
            <button type="button" class="profile-secondary" :disabled="busy" @click="requestClose">
              取消</button
            ><button type="submit" class="profile-primary" :disabled="busy || !dirty">
              {{ busy ? '保存中…' : '保存资料' }}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.profile-dialog {
  margin: auto;
  width: min(640px, calc(100vw - 32px));
  max-height: calc(100dvh - 32px);
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  color: var(--text);
  background: var(--paper-strong);
  box-shadow: 0 24px 80px #183b4633;
}
.profile-dialog[open] {
  display: flex;
  flex-direction: column;
}
.profile-dialog::backdrop {
  background: #183b4660;
  backdrop-filter: blur(3px);
}
.profile-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 28px 16px;
  flex-shrink: 0;
}
.heading-kicker {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.profile-heading h2 {
  margin-top: 4px;
  font-size: 22px;
  font-weight: 700;
  line-height: 1.3;
}
.close-profile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 50%;
  color: var(--muted);
  background: var(--paper);
  cursor: pointer;
}
.profile-sections {
  display: flex;
  gap: 8px;
  padding: 0 28px 20px;
  flex-shrink: 0;
}
.profile-sections button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper-strong);
  color: var(--muted);
  font-size: 14px;
  cursor: pointer;
}
.profile-sections button[aria-pressed='true'] {
  background: var(--mist);
  border-color: var(--signal);
  color: var(--signal-dark);
  font-weight: 600;
}
.profile-sections button:focus-visible,
.profile-actions button:focus-visible,
.close-profile:focus-visible {
  outline: 2px solid var(--signal-dark);
  outline-offset: 3px;
}
.security-discard {
  font-size: 12px;
}
form {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.profile-body {
  padding: 0 28px 24px;
  overflow: auto;
  overscroll-behavior: contain;
}
.profile-identity {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border-radius: var(--radius-md);
  background: var(--mist);
}
.profile-avatar {
  flex: 0 0 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: 18px;
  background: var(--paper-strong);
  color: var(--signal-dark);
  font-size: 26px;
  font-weight: 700;
  box-shadow: 0 4px 12px #137f910d;
}
.profile-identity > div {
  min-width: 0;
  flex: 1;
}
.profile-identity strong {
  display: block;
  font-size: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.profile-identity p {
  color: var(--muted);
  font-size: 12px;
  margin-top: 4px;
}
.profile-role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
  font-size: 12px;
  color: var(--signal-dark);
  padding: 4px 8px;
  border: 1px solid #badde3;
  border-radius: 20px;
  background: #ffffffa6;
}
.profile-role svg {
  flex-shrink: 0;
}
.profile-section {
  margin-top: 24px;
}
.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.section-heading h3 {
  font-size: 15px;
  font-weight: 700;
}
.section-heading > span {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--muted);
  font-size: 12px;
}
.profile-field {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}
.profile-field > span {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.field-count {
  color: var(--muted);
  font-size: 12px;
  font-weight: 400;
}
.profile-field input,
.profile-field textarea {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--paper-strong);
  color: var(--text);
  font-size: 14px;
  font-weight: 400;
  line-height: 1.5;
  transition: border-color 0.15s;
}
.profile-field textarea {
  resize: vertical;
  min-height: 72px;
  max-height: 160px;
}
.profile-field input:hover,
.profile-field textarea:hover {
  border-color: var(--signal);
}
.profile-field input::placeholder,
.profile-field textarea::placeholder {
  color: var(--muted);
}
.profile-field input:focus-visible,
.profile-field textarea:focus-visible {
  border-color: var(--signal-dark);
  outline: 2px solid var(--mist);
  outline-offset: 2px;
}
.field-help {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  margin-top: 6px;
}
.profile-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin: 16px 0;
}
.account-section {
  border-top: 1px solid var(--line);
  padding-top: 20px;
}
.profile-details {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 24px;
}
.profile-details > div {
  min-width: 0;
}
.profile-details dt {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
}
.profile-details dd {
  margin: 4px 0 0 21px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.joined-date {
  display: block;
  color: var(--muted);
  font-size: 12px;
}
.profile-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 28px;
  border-top: 1px solid var(--line);
  background: var(--paper);
}
.profile-feedback {
  color: var(--muted);
  font-size: 12px;
}
.save-success {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--signal-dark);
}
.save-error,
.discard-hint {
  color: #a43e2c;
}
.profile-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}
.profile-actions button {
  min-height: 44px;
  padding: 8px 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.profile-secondary {
  background: var(--paper-strong);
  color: var(--text);
}
.profile-actions .profile-primary {
  background: var(--signal-dark);
  border-color: var(--signal-dark);
  color: var(--paper-strong);
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
@media (max-width: 520px) {
  .profile-heading {
    padding: 16px 20px;
  }
  .profile-body {
    padding: 0 20px 20px;
  }
  .profile-sections {
    padding: 0 20px 16px;
  }
  .profile-identity {
    padding: 16px;
    gap: 12px;
    flex-wrap: wrap;
  }
  .profile-identity p {
    display: none;
  }
  .profile-avatar {
    flex-basis: 44px;
    height: 44px;
    border-radius: 14px;
    font-size: 22px;
  }
  .profile-identity strong {
    font-size: 18px;
  }
  .profile-role {
    max-width: 100%;
  }
  .profile-field-grid {
    grid-template-columns: 1fr;
  }
  .profile-details {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  .profile-footer {
    padding: 12px 20px;
    align-items: stretch;
    flex-direction: column;
    gap: 8px;
  }
  .profile-actions {
    justify-content: flex-end;
  }
}
@media (prefers-reduced-motion: reduce) {
  .profile-field input,
  .profile-field textarea {
    transition: none;
  }
}
</style>
