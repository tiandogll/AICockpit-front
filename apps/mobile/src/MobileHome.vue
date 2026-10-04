<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ArrowRight, BookOpen, Check, ChevronRight, CircleCheck, ClipboardCheck, Clock3, FileChartColumn, Layers3, ShieldCheck, Sparkles, Sprout, Zap } from '@lucide/vue'
import BrandMark from '../../web/src/components/BrandMark.vue'
import { useAuthStore } from '../../web/src/stores/auth'
import { useAccessStore } from '../../web/src/stores/access'
import { useFeatureStore } from '../../web/src/stores/features'
import { getWorkspaceOverview, reportStatusLabels, formatWorkspaceDate, type WorkspaceOverview } from '../../web/src/services/workspaceApi'
import { getTrainingPlans, type TrainingPlan } from '../../web/src/services/trainingApi'
import robotUrl from '../../web/src/assets/growth-robot-user.png'

defineEmits<{ assistant: [] }>()
const auth = useAuthStore(), access = useAccessStore(), features = useFeatureStore()
const overview = ref<WorkspaceOverview | null>(null), plan = ref<TrainingPlan | null>(null)
const loading = ref(false), error = ref(''), trainingError = ref('')
let generation = 0, trainingGeneration = 0
const current = computed(() => overview.value?.active_sessions[0])
const recent = computed(() => overview.value?.recent_reports[0])
const covered = computed(() => recent.value?.dimensions.filter(d => d.index !== null && d.evidence_count > 0).length ?? 0)
const done = computed(() => plan.value?.tasks.filter(task => task.status === 'completed').length ?? 0)
const greeting = new Date().getHours() < 12 ? '上午好' : new Date().getHours() < 18 ? '下午好' : '晚上好'
const steps = [
  { title: '选择测评', text: '找到适合的方式', icon: Layers3, path: '/assessment' },
  { title: '完成作答', text: '留下能力证据', icon: ClipboardCheck, path: '/assessment' },
  { title: '查看报告', text: '看清优势与短板', icon: FileChartColumn, path: '/reports' },
  { title: '针对训练', text: '走好成长下一步', icon: Sprout, path: '/training' },
]
const shortcuts = [
  { title: '极速测', text: '快速了解六维能力', icon: Zap, mode: 'rapid', className: 'cyan' },
  { title: '标准测', text: '获得更完整的画像', icon: Layers3, mode: 'standard', className: 'mint' },
  { title: '专项测', text: '聚焦一个能力方向', icon: ShieldCheck, mode: 'specialized', className: 'amber' },
  { title: '固定卷', text: '按固定方案测评', icon: ClipboardCheck, mode: 'fixed', className: 'blue' },
]
async function load() {
  const ticket = ++generation
  overview.value = null; error.value = ''; loading.value = false
  if (!auth.isAuthenticated || !access.ready || access.error) return
  loading.value = true
  try {
    const value = await getWorkspaceOverview(access.organizationId)
    if (ticket === generation) overview.value = value
  } catch (cause) {
    if (ticket === generation) error.value = cause instanceof Error ? cause.message : '无法读取学习记录，请重试。'
  } finally { if (ticket === generation) loading.value = false }
}
async function loadTraining() {
  const ticket = ++trainingGeneration
  plan.value = null; trainingError.value = ''
  if (!auth.isAuthenticated || !access.ready || access.error || !features.trainingEnabled) return
  try {
    const page = await getTrainingPlans(access.organizationId, 1, 0)
    if (ticket === trainingGeneration) plan.value = page.items[0] ?? null
  } catch { if (ticket === trainingGeneration) trainingError.value = '训练进度暂时无法读取' }
}
watch(() => [auth.user?.id, access.organizationId, access.ready, access.error], load, { immediate: true })
watch(() => [auth.user?.id, access.organizationId, access.ready, features.trainingEnabled], loadTraining, { immediate: true })
onBeforeUnmount(() => { generation++; trainingGeneration++ })
</script>

<template>
  <div class="mobile-home" data-testid="mobile-home">
    <section class="home-brand-row">
      <div class="home-brand"><BrandMark /><div><strong>AI Measure</strong><small>AI能力测评与成长平台</small></div></div>
      <RouterLink :to="auth.isAuthenticated ? '/assessment' : '/login'" class="brand-start">{{ auth.isAuthenticated ? '开始测评' : '登录' }}</RouterLink>
    </section>
    <p v-if="auth.isAuthenticated" class="home-greeting">{{ greeting }}，{{ auth.user?.display_name }}<span>今天也向前一步。</span></p>
    <section class="mobile-hero">
      <div class="hero-orbit orbit-one"></div><div class="hero-orbit orbit-two"></div>
      <span class="hero-eyebrow"><CircleCheck :size="13" /> 用真实作答，看见你的能力</span>
      <h1>测出你的 AI 能力<br />找到成长下一步</h1>
      <p>从一次测评开始，<br />让每一次进步都有据可循。</p>
      <div class="hero-tags"><span><Check :size="12" />六维能力画像</span><span><Check :size="12" />个性化成长路径</span></div>
      <button v-if="!auth.isAuthenticated" class="hero-robot" aria-label="登录后与成长助手聊天" @click="$emit('assistant')"><img :src="robotUrl" alt="AI成长助手" /><span><Sparkles :size="11" /> 和我聊聊</span></button>
      <div class="hero-actions"><RouterLink to="/assessment?mode=standard" class="hero-primary">开始能力测评 <ArrowRight :size="18" /></RouterLink><RouterLink to="/help" class="hero-secondary">使用指南 <ChevronRight :size="15" /></RouterLink></div>
    </section>
    <section v-if="current" class="mobile-resume" aria-label="继续未完成的测评">
      <span class="resume-mini-icon"><Clock3 :size="23" /></span><div><small>上次还没做完</small><strong>{{ current.name }}</strong><span>已保存 {{ current.answered }} 题</span></div><RouterLink :to="`/assessment/${current.id}`">继续 <ChevronRight :size="17" /></RouterLink>
    </section>
    <section class="home-section">
      <header class="home-section-heading"><h2><Layers3 :size="18" />一次测评，四步成长</h2><RouterLink to="/help">流程说明 <ChevronRight :size="13" /></RouterLink></header>
      <div class="journey-card"><RouterLink v-for="(step, index) in steps" :key="step.title" :to="step.path"><span class="journey-icon" :class="`step-${index}`"><component :is="step.icon" :size="22" /></span><strong>{{ step.title }}</strong><small>{{ step.text }}</small></RouterLink></div>
    </section>
    <section class="home-section">
      <header class="home-section-heading"><h2><ShieldCheck :size="18" />{{ auth.isAuthenticated ? '我的成长看板' : '认识你的 AI 能力' }}</h2><span class="live-label"><i></i>{{ auth.isAuthenticated ? '真实记录' : '六维模型' }}</span></header>
      <div v-if="access.error || error" class="home-load-error" role="alert"><p>{{ access.error || error }}</p><button @click="access.error ? access.load() : load()">重新加载</button></div>
      <div class="home-stats" v-if="auth.isAuthenticated">
        <RouterLink to="/reports"><span class="stat-icon cyan"><FileChartColumn :size="20" /></span><strong>{{ loading || !overview ? '—' : overview.report_count }}</strong><small>能力报告</small></RouterLink>
        <RouterLink to="/assessment"><span class="stat-icon mint"><Clock3 :size="20" /></span><strong>{{ loading || !overview ? '—' : overview.active_sessions.length }}</strong><small>进行中</small></RouterLink>
        <RouterLink to="/training"><span class="stat-icon amber"><CircleCheck :size="20" /></span><strong>{{ trainingError ? '—' : done }}<em v-if="!trainingError"> / {{ plan?.tasks.length ?? 0 }}</em></strong><small>当前训练进度</small></RouterLink>
        <RouterLink to="/reports"><span class="stat-icon blue"><Layers3 :size="20" /></span><strong>{{ loading || !overview ? '—' : covered }}<em> / 6</em></strong><small>最新报告覆盖</small></RouterLink>
      </div>
      <div v-else class="guest-facts"><div><strong>6<span>维</span></strong><small>能力模型</small></div><div><strong>3<span>类</span></strong><small>互补题型</small></div><div><strong>4<span>种</span></strong><small>测评方式</small></div><div><ShieldCheck :size="27" /><small>证据可追溯</small></div></div>
    </section>
    <section class="home-section">
      <header class="home-section-heading"><h2><ClipboardCheck :size="18" />选择适合你的测评</h2><RouterLink to="/assessment">全部方式 <ChevronRight :size="13" /></RouterLink></header>
      <div class="home-assessments"><RouterLink v-for="item in shortcuts" :key="item.mode" :to="`/assessment?mode=${item.mode}`"><span class="shortcut-icon" :class="item.className"><component :is="item.icon" :size="24" /></span><div><strong>{{ item.title }}</strong><small>{{ item.text }}</small></div><ChevronRight :size="17" /></RouterLink></div>
    </section>
    <section v-if="recent" class="home-section">
      <header class="home-section-heading"><h2><FileChartColumn :size="18" />最近一次报告</h2><RouterLink to="/reports">查看全部 <ChevronRight :size="13" /></RouterLink></header>
      <RouterLink :to="`/reports/${recent.session_id}`" class="mobile-recent-report"><span class="recent-report-tag">{{ reportStatusLabels[recent.status] ?? '报告已保存' }}</span><h3>{{ recent.name }}</h3><p>{{ formatWorkspaceDate(recent.completed_at) }}</p><div><span>{{ covered }} / 6 维度已有证据</span><strong>查看报告 <ArrowRight :size="16" /></strong></div></RouterLink>
    </section>
    <RouterLink to="/training" class="home-learning"><span class="learning-illustration"><BookOpen :size="35" /><i></i></span><div><small>GROW A LITTLE, EVERY DAY</small><h3>把下一步，变成进步</h3><p>跟随能力证据，找到适合的练习。</p></div><ChevronRight :size="18" /></RouterLink>
  </div>
</template>
