<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowUpRight, BookOpen, ChevronRight, Clock3, FileChartColumn, Fingerprint, LogOut, Settings2, ShieldCheck, Sprout, Target } from '@lucide/vue'
import { useAuthStore } from '../../web/src/stores/auth'
import { useAccessStore } from '../../web/src/stores/access'
import { useFeatureStore } from '../../web/src/stores/features'
import { getWorkspaceOverview, formatWorkspaceDate, reportStatusLabels, type WorkspaceOverview } from '../../web/src/services/workspaceApi'
import { getTrainingPlans, type TrainingPlan } from '../../web/src/services/trainingApi'
import { requestAssessmentLeave } from '../../web/src/domain/assessmentLeave'
import { staffDestination } from '../../web/src/domain/loginPortal'
import PersonalProfileDialog from '../../web/src/components/PersonalProfileDialog.vue'
import './account.css'

const auth = useAuthStore(), access = useAccessStore(), features = useFeatureStore(), router = useRouter()
const profile = ref<InstanceType<typeof PersonalProfileDialog> | null>(null)
const logoutDialog = ref<HTMLDialogElement | null>(null)
const busy = ref(false)
const overview = ref<WorkspaceOverview | null>(null), plan = ref<TrainingPlan | null>(null)
const loading = ref(false), trainingLoading = ref(false)
const error = ref(''), trainingError = ref('')
let generation = 0, trainingGeneration = 0
const staff = computed(() => staffDestination(access))
const role = computed(() => access.can('system') ? '管理员' : staff.value ? '教师 / 管理员' : '学员')
const initial = computed(() => Array.from(auth.user?.display_name || '我')[0])
const current = computed(() => overview.value?.active_sessions[0])
const recent = computed(() => overview.value?.recent_reports[0])
const covered = computed(() => recent.value?.dimensions.filter(d => d.index !== null && d.evidence_count > 0).length ?? 0)
const completedTasks = computed(() => plan.value?.tasks.filter(task => task.status === 'completed').length ?? 0)
const trainingProgress = computed(() => plan.value?.tasks.length ? Math.round(completedTasks.value / plan.value.tasks.length * 100) : 0)
const trainingCount = computed(() => !features.ready || trainingLoading.value || trainingError.value || !features.trainingEnabled ? '—' : completedTasks.value)
const learningGoal = computed(() => auth.user?.learning_goal?.trim())
const archiveNote = computed(() => !overview.value ? '每一次真实作答，都是成长的起点。' : overview.value.report_count > 0 ? '让能力有迹可循，让下一步更清晰。' : '从第一份报告，开始建立你的能力档案。')

async function loadOverview() {
  const ticket = ++generation
  overview.value = null; error.value = ''; loading.value = false
  if (!auth.user?.id || !auth.isAuthenticated || !access.ready || access.error) return
  const actor = auth.user.id, organization = access.organizationId
  loading.value = true
  try {
    const value = await getWorkspaceOverview(organization)
    if (ticket === generation && actor === auth.user?.id && organization === access.organizationId) overview.value = value
  } catch (cause) {
    if (ticket === generation) error.value = cause instanceof Error ? cause.message : '成长记录暂时无法读取，请重试。'
  } finally { if (ticket === generation) loading.value = false }
}
async function loadTraining() {
  const ticket = ++trainingGeneration
  plan.value = null; trainingError.value = ''; trainingLoading.value = false
  if (!auth.user?.id || !auth.isAuthenticated || !access.ready || access.error || !features.trainingEnabled) return
  const actor = auth.user.id, organization = access.organizationId
  trainingLoading.value = true
  try {
    const page = await getTrainingPlans(organization, 1, 0)
    if (ticket === trainingGeneration && actor === auth.user?.id && organization === access.organizationId) plan.value = page.items[0] ?? null
  } catch { if (ticket === trainingGeneration) trainingError.value = '训练进度暂时无法读取' }
  finally { if (ticket === trainingGeneration) trainingLoading.value = false }
}
function retry() { void loadOverview(); void loadTraining() }
watch(() => [auth.user?.id, auth.isAuthenticated, access.organizationId, access.ready, access.error], loadOverview, { immediate: true, flush: 'sync' })
watch(() => [auth.user?.id, auth.isAuthenticated, access.organizationId, access.ready, access.error, features.trainingEnabled], loadTraining, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { generation++; trainingGeneration++ })
async function logout() {
  if (busy.value || !(await requestAssessmentLeave())) return
  busy.value = true
  try { await auth.logout(); access.clear(); logoutDialog.value?.close(); await router.replace('/login') }
  finally { busy.value = false }
}
</script>

<template>
  <div class="mobile-account-redesign" data-testid="mobile-account">
    <header class="acct-person">
      <span class="acct-avatar" aria-hidden="true">{{ initial }}<i></i></span>
      <div class="acct-person-copy"><span class="acct-welcome">很高兴见到你</span><h1>{{ auth.user?.display_name || '我的空间' }}</h1><p>@{{ auth.user?.username || '学员' }}<span><ShieldCheck :size="11" />{{ role }}</span></p></div>
      <button class="acct-edit" aria-label="编辑个人资料" @click="profile?.show()"><Settings2 :size="19" /></button>
    </header>

    <section class="acct-passport" aria-label="我的成长档案" :aria-busy="loading">
      <div class="acct-passport-top"><span class="acct-eyebrow"><Fingerprint :size="15" />我的成长档案</span><span class="acct-record-label">真实记录</span></div>
      <h2>把每一步，留在这里。</h2><p class="acct-passport-note">{{ archiveNote }}</p>
      <div class="acct-passport-stats">
        <RouterLink to="/reports"><strong>{{ loading || !overview ? '—' : overview.report_count }}<small>份</small></strong><span>能力报告</span><FileChartColumn :size="15" /></RouterLink>
        <RouterLink to="/assessment"><strong>{{ loading || !overview ? '—' : overview.active_sessions.length }}<small>场</small></strong><span>进行中测评</span><Clock3 :size="15" /></RouterLink>
        <RouterLink to="/training"><strong>{{ trainingCount }}<small v-if="plan && !trainingLoading && !trainingError"> / {{ plan.tasks.length }}</small></strong><span>当前训练进度</span><Sprout :size="15" /></RouterLink>
      </div>
      <div class="acct-passport-foot"><span class="acct-six-dots" aria-hidden="true"><i v-for="dot in 6" :key="dot" :class="{ filled: recent && dot <= covered }"></i></span><span>{{ recent ? `最新报告：${covered} / 6 维度已有证据` : '六维能力 · 以作答证据为依据' }}</span></div>
    </section>

    <div v-if="access.error || error || trainingError" class="acct-load-notice" role="alert"><span>{{ access.error || error || trainingError }}</span><button @click="access.error ? access.load() : retry()">重试</button></div>

    <section class="acct-moment" aria-label="最近的成长记录">
      <RouterLink v-if="current" :to="`/assessment/${current.id}`" class="acct-next-card">
        <span class="acct-next-icon"><Clock3 :size="23" /></span><div><small>接着上次，继续向前</small><strong>{{ current.name }}</strong><p>已保存 {{ current.answered }} 题 · 继续作答</p></div><ArrowUpRight :size="19" />
      </RouterLink>
      <RouterLink v-else-if="recent" :to="`/reports/${recent.session_id}`" class="acct-next-card">
        <span class="acct-next-icon"><FileChartColumn :size="23" /></span><div><small>最近一份能力报告 · {{ reportStatusLabels[recent.status] ?? '已保存' }}</small><strong>{{ recent.name }}</strong><p>{{ formatWorkspaceDate(recent.completed_at) }}</p></div><ArrowUpRight :size="19" />
      </RouterLink>
      <RouterLink v-else to="/assessment" class="acct-next-card">
        <span class="acct-next-icon"><Target :size="23" /></span><div><small>下一步，从了解自己开始</small><strong>开始一次能力测评</strong><p>选择适合你的方式，建立第一份报告</p></div><ArrowUpRight :size="19" />
      </RouterLink>
    </section>

    <div class="acct-shortcuts" aria-label="学习快捷入口">
      <RouterLink to="/history"><span class="acct-shortcut-icon"><Clock3 :size="21" /></span><strong>测评记录</strong><small>回看每一次作答</small><ChevronRight :size="15" /></RouterLink>
      <RouterLink to="/training"><span class="acct-shortcut-icon warm"><Sprout :size="21" /></span><strong>我的训练</strong><small>{{ plan ? `${trainingProgress}% · 当前计划已完成` : '找到适合的练习' }}</small><ChevronRight :size="15" /></RouterLink>
    </div>

    <section v-if="learningGoal" class="acct-goal"><Target :size="17" /><div><small>我想达成的学习目标</small><p>{{ learningGoal }}</p></div><button aria-label="修改学习目标" @click="profile?.show()"><Settings2 :size="16" /></button></section>

    <section class="acct-settings" aria-label="账号与帮助">
      <h2>账号与帮助<span>ACCOUNT & SUPPORT</span></h2>
      <div class="acct-settings-list">
        <button aria-label="个人资料与账号安全" @click="profile?.show()"><span class="acct-setting-icon"><ShieldCheck :size="20" /></span><div><strong>个人资料与账号安全</strong><small>资料、学习目标与密码管理</small></div><ChevronRight :size="17" /></button>
        <RouterLink to="/reports"><span class="acct-setting-icon blue"><FileChartColumn :size="20" /></span><div><strong>我的能力报告</strong><small>查看画像、依据与成长建议</small></div><ChevronRight :size="17" /></RouterLink>
        <RouterLink to="/help"><span class="acct-setting-icon warm"><BookOpen :size="20" /></span><div><strong>使用指南</strong><small>了解测评流程与常见问题</small></div><ChevronRight :size="17" /></RouterLink>
        <RouterLink v-if="staff" :to="staff.path"><span class="acct-setting-icon"><Settings2 :size="20" /></span><div><strong>教师与管理端</strong><small>按账号权限管理题库与评分</small></div><ChevronRight :size="17" /></RouterLink>
      </div>
    </section>
    <p class="acct-privacy"><ShieldCheck :size="15" /><span>学习记录按账号权限保护<br />回答默认不用于模型训练</span></p>
    <button class="acct-logout" @click="logoutDialog?.showModal()"><LogOut :size="17" />退出当前账号</button>
    <PersonalProfileDialog ref="profile" :role-label="role" />
    <dialog ref="logoutDialog" class="mobile-confirm" aria-label="退出登录确认"><h2>退出当前账号？</h2><p>已保存的测评与训练记录不会删除。</p><div><button @click="logoutDialog?.close()">取消</button><button class="primary-button" :disabled="busy" @click="logout">{{ busy ? '正在退出…' : '退出登录' }}</button></div></dialog>
  </div>
</template>
