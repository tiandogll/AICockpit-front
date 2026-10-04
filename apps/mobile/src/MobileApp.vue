<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, BookOpen, ChevronRight, Ellipsis, FileChartColumn, House, Maximize, ShieldCheck, Sprout, UserRound, X } from '@lucide/vue'
import BrandMark from '../../web/src/components/BrandMark.vue'
import GrowthAssistantEntry from '../../web/src/components/GrowthAssistantEntry.vue'
import MobileRobot from './MobileRobot.vue'
import { useAuthStore } from '../../web/src/stores/auth'
import { useAccessStore } from '../../web/src/stores/access'
import { useFeatureStore } from '../../web/src/stores/features'
import { hasRouteAccess } from '../../web/src/domain/routeAccess'
import robotUrl from '../../web/src/assets/growth-robot-user.png'

const route = useRoute(), router = useRouter()
const auth = useAuthStore(), access = useAccessStore(), features = useFeatureStore()
const content = ref<HTMLElement | null>(null)
const appFrame = ref<HTMLElement | null>(null)
const menu = ref<HTMLDialogElement | null>(null)
const assistant = ref<HTMLDialogElement | null>(null)
const focused = computed(() => route.path.startsWith('/assessment/'))
const compactPage = computed(() => {
  const section = route.path.split('/')[1]
  return ['assessment', 'reports', 'training'].includes(section ?? '')
    ? `mobile-page-${section}`
    : ''
})
const title = computed(() => {
  const titles: Record<string, string> = {
    '/': 'AI Measure', '/workspace': 'AI Measure', '/assessment': '能力测评',
    '/reports': '能力报告', '/training': '成长训练', '/profile': '我的空间',
    '/history': '测评记录', '/login': '登录', '/staff/login': '教师管理端',
    '/register': '创建账号', '/help': '使用指南', '/about': '了解平台',
    '/item-bank': '题库管理', '/teaching': '教师工作台', '/reviews': '评分复核',
  }
  return titles[route.path] ?? (focused.value ? '正在测评' : route.path.startsWith('/reports/') ? '报告详情' : 'AI Measure')
})
const home = computed(() => route.path === '/' || route.path === '/workspace')
const backLabel = computed(() => route.path.startsWith('/reports/') ? '返回能力报告' : '返回首页')
const tabs = [
  { path: '/workspace', label: '首页', icon: House },
  { path: '/assessment', label: '测评', icon: ShieldCheck },
  { path: '/reports', label: '报告', icon: FileChartColumn },
  { path: '/training', label: '训练', icon: Sprout },
  { path: '/profile', label: '我的', icon: UserRound },
]
function active(path: string) {
  return path === '/workspace' ? home.value : route.path === path || route.path.startsWith(path + '/')
}
async function back() {
  await router.push(route.path.startsWith('/reports/') ? '/reports' : '/workspace')
}
async function navigate(path: string) {
  menu.value?.close()
  await router.push(path)
}
function openAssistant() {
  if (!auth.isAuthenticated) { void router.push('/login'); return }
  void features.load(true)
  assistant.value?.showModal()
}
async function fullscreen() {
  const doc = window.self !== window.top ? window.parent.document : document
  if (doc.fullscreenElement) await doc.exitFullscreen()
  else await doc.documentElement.requestFullscreen().catch(() => {})
}
watch(() => route.fullPath, async () => {
  menu.value?.close()
  assistant.value?.close()
  await nextTick()
  content.value?.scrollTo({ top: 0 })
})
watch(() => [auth.user?.id, auth.isAuthenticated], () => {
  assistant.value?.close()
  if (auth.isAuthenticated) { void access.load(); void features.load() }
})
watch(() => [access.ready, access.organizationId], () => {
  if (!access.loading && route.meta.requiresAuth && !hasRouteAccess(route.meta.capabilities, access.can))
    void router.replace('/access-denied')
})
onMounted(() => {
  if (auth.isAuthenticated) { void access.load(); void features.load() }
})
</script>

<template>
  <div ref="appFrame" class="mobile-app" data-mobile-design="compact-v2" :class="[compactPage, { 'focus-mode': focused }]">
    <a class="mobile-skip" href="#mobile-content">跳到主要内容</a>
    <header class="mini-header">
      <RouterLink v-if="home" to="/" class="mini-title"><BrandMark /><span>AI Measure</span></RouterLink>
      <div v-else class="mini-page-title">
        <button class="mini-back" :aria-label="backLabel" @click="back"><ArrowLeft :size="20" /></button>
        <strong>{{ title }}</strong>
      </div>
      <div class="mini-capsule">
        <button aria-label="更多功能" @click="menu?.showModal()"><Ellipsis :size="22" /></button>
        <i></i><button aria-label="切换全屏演示" @click="fullscreen"><Maximize :size="16" /></button>
      </div>
    </header>
    <main id="mobile-content" ref="content" class="mobile-content" tabindex="-1">
      <RouterView v-slot="{ Component }"><component :is="Component" :key="route.path" @assistant="openAssistant" /></RouterView>
      <p v-if="!focused" class="mobile-page-end">让能力可见，让成长有据</p>
    </main>
    <nav v-if="!focused" class="bottom-tabs" aria-label="手机主导航">
      <RouterLink v-for="tab in tabs" :key="tab.path" :to="tab.path" :class="{ active: active(tab.path) }" :aria-current="active(tab.path) ? 'page' : undefined">
        <span class="tab-icon"><component :is="tab.icon" :size="22" :stroke-width="active(tab.path) ? 2.25 : 1.7" /></span>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>
    <MobileRobot v-if="auth.isAuthenticated && !focused" :boundary="appFrame" @open="openAssistant" />
    <dialog ref="menu" class="mobile-menu-sheet" aria-label="更多功能" @click="($event.target === menu) && menu?.close()">
      <header><h2>更多功能</h2><button class="sheet-close" aria-label="关闭更多功能" @click="menu?.close()"><X :size="20" /></button></header>
      <div class="menu-items">
        <button @click="navigate('/profile')"><UserRound :size="20" /><span>个人资料与账号安全</span><ChevronRight :size="17" /></button>
        <button @click="navigate('/history')"><FileChartColumn :size="20" /><span>全部测评记录</span><ChevronRight :size="17" /></button>
        <button @click="navigate('/help')"><BookOpen :size="20" /><span>使用指南</span><ChevronRight :size="17" /></button>
        <button v-if="access.can('content')" @click="navigate('/item-bank')"><ShieldCheck :size="20" /><span>题库管理</span><ChevronRight :size="17" /></button>
        <button v-if="access.can('reviews')" @click="navigate('/reviews')"><ShieldCheck :size="20" /><span>评分复核</span><ChevronRight :size="17" /></button>
        <button v-if="!auth.isAuthenticated" @click="navigate('/staff/login')"><UserRound :size="20" /><span>教师管理端登录</span><ChevronRight :size="17" /></button>
      </div>
      <label v-if="!access.singlePlatform && access.organizations.length > 1 && !focused" class="mobile-org-picker">
        当前组织<select :value="access.organizationId" @change="access.selectOrganization(($event.target as HTMLSelectElement).value)"><option v-for="org in access.organizations" :key="org.id" :value="org.id">{{ org.name }}</option></select>
      </label>
    </dialog>
    <dialog ref="assistant" class="mobile-assistant-sheet" aria-label="成长助手">
      <header class="mobile-assistant-heading"><img :src="robotUrl" alt="" /><div><h2>成长助手</h2><p>测评使用 · 报告解读 · 训练建议</p></div><button class="sheet-close" aria-label="关闭成长助手" @click="assistant?.close()"><X :size="21" /></button></header>
      <div class="mobile-assistant-body"><GrowthAssistantEntry :key="`${auth.user?.id}-${access.organizationId}`" embedded /></div>
    </dialog>
  </div>
</template>
