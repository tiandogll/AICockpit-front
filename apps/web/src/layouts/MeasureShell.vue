<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronRight, Menu, Search, X } from '@lucide/vue'
import BrandMark from '../components/BrandMark.vue'
import PublicBackdrop from '../components/PublicBackdrop.vue'
import NavigationMenu from '../components/NavigationMenu.vue'
import { navigationGroups, helpLink, isStaffPath } from '../domain/navigation'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { apiUrl } from '../services/apiClient'
import { hasRouteAccess } from '../domain/routeAccess'
import { requestAssessmentLeave } from '../domain/assessmentLeave'
import { safeRedirect } from '../domain/loginPortal'
import '../assets/public-pages.css'
import '../assets/registration-page.css'
const auth = useAuthStore(),
  access = useAccessStore(),
  route = useRoute(),
  router = useRouter()
const drawer = ref<HTMLDialogElement | null>(null),
  searchDialog = ref<HTMLDialogElement | null>(null)
const searchText = ref(''),
  connected = ref<'unknown' | 'available' | 'unavailable'>('unknown')
const publicMenu = ref(false)
const publicMenuButton = ref<HTMLButtonElement | null>(null)
function closePublicMenu() {
  publicMenu.value = false
  publicMenuButton.value?.focus()
}
const publicDesign = computed(() =>
  ['home', 'about', 'help', 'login', 'staff-login', 'register'].includes(String(route.name)),
)
const publicLoginLocation = computed(() => {
  if (auth.isAuthenticated) return '/workspace'
  if (route.name !== 'register' || route.query.redirect === undefined) return '/login'
  return {
    path: '/login',
    query: {
      redirect: safeRedirect(
        typeof route.query.redirect === 'string' ? route.query.redirect : undefined,
      ),
    },
  }
})
const appLayout = computed(
  () =>
    auth.isAuthenticated &&
    route.path !== '/' &&
    route.name !== 'about' &&
    route.name !== 'help' &&
    route.name !== 'login' &&
    route.name !== 'staff-login' &&
    route.name !== 'register',
)
const formal = computed(
  () => Boolean(route.params.sessionId) && route.path.startsWith('/assessment/'),
)
const assistantDockRoute = computed(() =>
  /^(?:\/assessment\/[^/?#]+|\/(?:reports?|training|pilot-lab)(?:[/?#]|$))/.test(route.fullPath),
)
const referencePage = computed(
  () =>
    ['/assessment', '/training', '/history', '/cat-lab'].includes(route.path) ||
    route.path.startsWith('/reports/'),
)
const personalScope = computed(() =>
  ['/workspace', '/assessment', '/reports', '/training', '/history'].some(
    (path) => route.path === path || route.path.startsWith(path + '/'),
  ),
)
const selectableOrganizations = computed(() =>
  personalScope.value
    ? access.organizations.filter(
        (organization) => organization.can_participate_assessment !== false,
      )
    : access.organizations,
)
watch(
  () =>
    [
      personalScope.value,
      access.ready,
      access.organizationId,
      selectableOrganizations.value,
    ] as const,
  () => {
    if (!personalScope.value || !access.ready || access.error || formal.value) return
    if (!selectableOrganizations.value.some((row) => row.id === access.organizationId)) {
      // Context already contains server-checked per-organization capabilities.
      // This changes the selected UI scope, never grants membership or permissions.
      access.organizationId = selectableOrganizations.value[0]?.id ?? ''
    }
  },
  { immediate: true },
)
const staffPortal = computed(() => isStaffPath(route.path, access.can))
const links = computed(() => [
  ...navigationGroups(
    access.can,
    access.singlePlatform,
    staffPortal.value ? 'staff' : 'learner',
  ).flatMap((group) => group.items),
  helpLink,
])
const searchResults = computed(() =>
  links.value.filter((item) => item.label.includes(searchText.value.trim())),
)
const title = computed(
  () =>
    links.value.find((item) => route.path === item.path)?.label ??
    (route.path === '/content-trials' || route.path.startsWith('/content-trials/')
      ? '题质试答'
      : route.path.startsWith('/reports/')
        ? '能力报告详情'
        : formal.value
          ? '能力测评'
          : access.singlePlatform
            ? '学员中心'
            : '个人空间'),
)
async function logout() {
  if (!(await requestAssessmentLeave())) return
  access.clear()
  await auth.logout()
  await router.push('/login')
}
async function navigate(path: string) {
  searchDialog.value?.close()
  await router.push(path)
}
function openSearch() {
  searchText.value = ''
  searchDialog.value?.showModal()
}
async function checkConnection() {
  connected.value = 'unknown'
  try {
    const response = await fetch(apiUrl('/health'), { signal: AbortSignal.timeout(5000) })
    connected.value = response.ok ? 'available' : 'unavailable'
  } catch {
    connected.value = 'unavailable'
  }
}
watch(
  () => route.fullPath,
  () => {
    drawer.value?.close()
    publicMenu.value = false
  },
)
watch(
  () => [access.ready, access.organizationId] as const,
  () => {
    if (!access.loading && !hasRouteAccess(route.meta.capabilities, access.can))
      void router.replace('/access-denied')
  },
)
watch(
  () => auth.isAuthenticated,
  (value) => {
    if (value) void access.load()
    else access.clear()
  },
)
onMounted(() => {
  if (auth.isAuthenticated) void access.load()
  void checkConnection()
})
</script>
<template>
  <div
    class="measure-app"
    :class="{
      'app-layout': appLayout,
      'focus-layout': formal,
      'assistant-dock-layout': assistantDockRoute,
      'reference-page-layout': referencePage,
      'public-design': publicDesign,
      'registration-design': route.name === 'register',
    }"
  >
    <a class="skip-link" href="#page-content">跳到主要内容</a>
    <PublicBackdrop v-if="publicDesign" />
    <template v-if="appLayout">
      <aside class="measure-sidebar"><NavigationMenu /></aside>
      <dialog ref="drawer" class="mobile-drawer" aria-label="应用导航">
        <button class="drawer-close icon-button" aria-label="关闭导航" @click="drawer?.close()">
          <X :size="20" /></button
        ><NavigationMenu @navigate="drawer?.close()" />
      </dialog>
      <header class="measure-toolbar">
        <button class="mobile-menu icon-button" aria-label="打开导航" @click="drawer?.showModal()">
          <Menu :size="21" />
        </button>
        <div class="breadcrumb">
          <span>{{ staffPortal ? 'AI Measure教师管理端' : 'AI Measure测评中心' }}</span
          ><span class="breadcrumb-divider" aria-hidden="true">/</span><strong>{{ title }}</strong>
        </div>
        <div class="toolbar-actions">
          <select
            v-if="
              !access.singlePlatform &&
              selectableOrganizations.length > 1 &&
              !route.params.sessionId
            "
            :value="access.organizationId"
            aria-label="当前组织"
            :disabled="formal || access.loading"
            @change="access.selectOrganization(($event.target as HTMLSelectElement).value)"
          >
            <option
              v-for="organization in selectableOrganizations"
              :key="organization.id"
              :value="organization.id"
            >
              {{ organization.name }}
            </option></select
          ><button class="icon-button" aria-label="搜索功能与帮助" @click="openSearch">
            <Search :size="20" /></button
          ><button
            class="connection-status"
            :class="connected"
            title="仅检测 API 连接，不代表全部依赖状态；点击重新检测"
            @click="checkConnection"
          >
            <i></i
            >{{
              connected === 'available'
                ? 'API 连接可用'
                : connected === 'unavailable'
                  ? '连接暂不可用'
                  : '连接待检测'
            }}
          </button>
        </div>
      </header>
    </template>
    <header v-else class="public-toolbar shell">
      <RouterLink class="measure-brand" to="/about"
        ><BrandMark /><span>AI Measure<small>AI能力测评与成长平台</small></span></RouterLink
      >
      <button
        v-if="publicDesign"
        ref="publicMenuButton"
        class="public-menu-toggle icon-button"
        :aria-expanded="publicMenu"
        aria-controls="public-navigation"
        aria-label="切换公开导航"
        @click="publicMenu = !publicMenu"
      >
        <Menu v-if="!publicMenu" :size="23" /><X v-else :size="23" />
      </button>
      <nav
        id="public-navigation"
        aria-label="公开导航"
        :class="{ 'is-open': publicMenu }"
        @keydown.esc="closePublicMenu"
      >
        <RouterLink
          to="/about"
          :class="{ 'public-active': route.name === 'home' || route.name === 'about' }"
          :aria-current="route.name === 'home' || route.name === 'about' ? 'page' : undefined"
          >了解平台</RouterLink
        ><RouterLink to="/help" :class="{ 'public-active': route.name === 'help' }"
          >使用帮助</RouterLink
        >
        <RouterLink class="primary-button" :to="publicLoginLocation">{{
          auth.isAuthenticated
            ? '进入工作台'
            : route.name === 'register'
              ? '已有账号？登录'
              : '登录测评'
        }}</RouterLink
        ><button
          v-if="auth.isAuthenticated"
          data-testid="logout"
          class="icon-button"
          @click="logout"
        >
          退出
        </button>
      </nav>
    </header>
    <main id="page-content" class="measure-content" tabindex="-1">
      <div v-if="appLayout && access.error" class="access-alert" role="alert">
        {{ access.error }}<button @click="access.load(true)">重新读取权限</button>
      </div>
      <RouterView v-slot="{ Component }"
        ><component
          :is="Component"
          :key="route.path + ':' + (formal || publicDesign ? '' : access.organizationId)"
      /></RouterView>
    </main>
    <footer v-if="!appLayout" class="public-footer shell">
      <span>AI Measure · 让能力可见，让成长有据</span><span>2026 数字马力杯 A01</span>
    </footer>
    <dialog ref="searchDialog" class="function-search">
      <form method="dialog">
        <h2>搜索功能与帮助</h2>
        <button class="icon-button" aria-label="关闭搜索"><X :size="19" /></button>
      </form>
      <input
        v-model="searchText"
        autofocus
        placeholder="输入功能名称，如：能力报告"
        aria-label="功能名称"
      />
      <p>仅搜索你有权使用的功能入口。</p>
      <ul>
        <li v-for="item in searchResults" :key="item.path">
          <button @click="navigate(item.path)">
            <component :is="item.icon" :size="18" />{{ item.label }}<ChevronRight :size="16" />
          </button>
        </li>
      </ul>
      <p v-if="!searchResults.length">没有匹配入口，请换个关键词。</p>
    </dialog>
  </div>
</template>
<style scoped>
.measure-app {
  --reference-unit: clamp(0.82px, 0.05807201vw, 1.115px);
  --reference-sidebar: calc(280 * var(--reference-unit));
  --reference-toolbar: calc(82 * var(--reference-unit));
  --reference-chrome: #c9e4ea;
  --reference-brand: #8dcad3;
  --reference-accent: #208c9c;
  min-height: 100vh;
}
.app-layout {
  padding-left: var(--reference-sidebar);
  padding-top: var(--reference-toolbar);
  background: #f8f8fa;
}
.skip-link {
  position: fixed;
  top: -60px;
  left: calc(var(--reference-sidebar) + 18px);
  padding: 12px;
  background: white;
  z-index: 100;
}
.skip-link:focus {
  top: 10px;
}
.measure-sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--reference-sidebar);
  background: var(--reference-chrome);
  z-index: 30;
  border-right: 1px solid #bdbdbd;
}
.measure-toolbar {
  position: fixed;
  inset: 0 0 auto var(--reference-sidebar);
  height: var(--reference-toolbar);
  padding: 0 calc(49 * var(--reference-unit)) 0 calc(72 * var(--reference-unit));
  background: var(--reference-chrome);
  border-bottom: 1px solid #bdbdbd;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  z-index: 20;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: calc(9 * var(--reference-unit));
  min-width: 0;
  font-size: calc(17 * var(--reference-unit));
  color: var(--reference-accent);
  white-space: nowrap;
}
.breadcrumb strong {
  font-size: calc(20 * var(--reference-unit));
  font-weight: 700;
}
.breadcrumb-divider {
  font-size: calc(22 * var(--reference-unit));
}
.toolbar-actions {
  display: flex;
  align-items: center;
  gap: calc(18 * var(--reference-unit));
}
.toolbar-actions select {
  max-width: 180px;
  padding: 6px 10px;
  background: transparent;
  border: 1px solid #c8dfe4;
  border-radius: 7px;
  color: var(--text);
  font-size: 12px;
}
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 40px;
  min-height: 40px;
  padding: 6px;
  border: 0;
  background: transparent;
  color: var(--reference-accent);
  cursor: pointer;
}
.connection-status {
  display: flex;
  align-items: center;
  gap: calc(10 * var(--reference-unit));
  border: 0;
  border-radius: calc(24 * var(--reference-unit));
  min-height: calc(36 * var(--reference-unit));
  padding: calc(6 * var(--reference-unit)) calc(14 * var(--reference-unit));
  background: #b0dce3;
  color: #516e77;
  font-size: max(12px, calc(14 * var(--reference-unit)));
  cursor: pointer;
  white-space: nowrap;
}
.connection-status i {
  width: calc(16 * var(--reference-unit));
  height: calc(16 * var(--reference-unit));
  border: 1px solid currentColor;
  box-shadow: inset 0 0 0 calc(3 * var(--reference-unit)) #b0dce3;
  background: currentColor;
  border-radius: 50%;
}
.connection-status.available {
  color: var(--reference-accent);
  background: #b0dce3;
}
.connection-status.unavailable {
  color: #925619;
  background: #fff0d9;
}
.measure-content {
  min-width: 0;
}
.app-layout > .measure-content {
  padding: 28px 32px 32px;
  max-width: none;
  margin: 0 auto;
}
.measure-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--signal-dark);
  white-space: nowrap;
}
.measure-brand :deep(.brand-mark),
.measure-brand :deep(svg) {
  width: 35px;
  height: 35px;
}
.measure-brand > span {
  font-size: 21px;
  font-weight: 750;
  letter-spacing: -0.6px;
}
.measure-brand small {
  display: block;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2px;
  color: #476e78;
}
.public-toolbar {
  height: 84px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.public-toolbar nav {
  display: flex;
  align-items: center;
  gap: 24px;
  font-size: 14px;
}
.public-footer {
  display: flex;
  justify-content: space-between;
  padding: 25px 0;
  color: var(--muted);
  font-size: 12px;
  border-top: 1px solid var(--line);
}
.mobile-menu {
  display: none;
}
.mobile-drawer {
  position: fixed;
  inset: 0 auto 0 0;
  width: 265px;
  height: 100dvh;
  max-height: none;
  max-width: 90vw;
  margin: 0;
  padding: 0;
  border: 0;
  background: var(--reference-chrome);
}
.mobile-drawer::backdrop,
.function-search::backdrop {
  background: #183b4666;
}
.drawer-close {
  position: absolute;
  right: 5px;
  top: calc(100 * var(--reference-unit));
  z-index: 1;
}
.access-alert {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  background: #fff3df;
  border: 1px solid #ebd3aa;
  border-radius: 10px;
  margin-bottom: 20px;
  color: #83541d;
  font-size: 13px;
}
.access-alert button {
  background: none;
  border: 0;
  text-decoration: underline;
  color: inherit;
  cursor: pointer;
}
.function-search {
  position: fixed;
  inset: 18vh auto auto 50%;
  transform: translateX(-50%);
  width: min(540px, calc(100vw - 32px));
  padding: 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  color: var(--text);
  box-shadow: var(--shadow);
}
.function-search form {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.function-search h2 {
  font-size: 20px;
}
.function-search input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
}
.function-search p {
  font-size: 12px;
  color: var(--muted);
  margin: 12px 0;
}
.function-search ul {
  list-style: none;
  max-height: 360px;
  overflow: auto;
}
.function-search li button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 12px;
  border: 0;
  border-radius: 7px;
  background: white;
  padding: 11px 8px;
  color: var(--text);
  cursor: pointer;
}
.function-search li button:hover {
  background: var(--paper);
}
.function-search li button svg:last-child {
  margin-left: auto;
}
@media (min-width: 960px) and (max-width: 1279px) {
  .app-layout {
    padding-left: 72px;
  }
  .measure-sidebar {
    width: 72px;
  }
  .measure-toolbar {
    left: 72px;
    padding-left: 28px;
    padding-right: 28px;
  }
  .breadcrumb > span:not(.breadcrumb-divider) {
    display: none;
  }
  .app-layout > .measure-content {
    padding: 32px 28px;
  }
}
@media (max-width: 959px) {
  .app-layout {
    padding-left: 0;
  }
  .measure-sidebar {
    display: none;
  }
  .measure-toolbar {
    left: 0;
    padding: 0 16px;
  }
  .mobile-menu {
    display: flex;
  }
  .breadcrumb > span,
  .breadcrumb > svg {
    display: none;
  }
  .toolbar-actions {
    gap: 6px;
  }
  .app-layout > .measure-content {
    padding: 22px 18px 40px;
  }
  .skip-link {
    left: 18px;
  }
  .public-toolbar {
    height: 76px;
  }
  .public-toolbar nav {
    gap: 10px;
  }
  .measure-app:not(.public-design) .public-toolbar nav > a:not(.primary-button) {
    display: none;
  }
}
@media (max-width: 560px) {
  .toolbar-actions select {
    max-width: 125px;
  }
  .connection-status {
    display: none;
  }
  .breadcrumb strong {
    font-size: 13px;
  }
  .public-toolbar .measure-brand > span {
    font-size: 18px;
  }
  .public-toolbar .measure-brand small {
    display: none;
  }
  .app-layout > .measure-content {
    padding: 20px 14px 36px;
  }
  .public-footer {
    flex-direction: column;
    gap: 8px;
  }
}
.app-layout.focus-layout > .measure-content {
  max-width: none;
  margin: 0;
  padding: 0;
  background: #fff;
}
@media (max-width: 600px) {
  .app-layout.assistant-dock-layout .measure-toolbar {
    padding-right: 76px;
  }
}
.app-layout.reference-page-layout {
  background: #fff;
}
</style>
