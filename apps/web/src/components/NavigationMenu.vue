<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BookmarkCheck,
  Check,
  Clock3,
  Ellipsis,
  HelpCircle,
  LogOut,
  Monitor,
  Newspaper,
  SquareCheck,
  TableProperties,
  Zap,
  UserRound,
  ArrowLeftRight,
} from '@lucide/vue'
import BrandMark from './BrandMark.vue'
import PersonalProfileDialog from './PersonalProfileDialog.vue'
import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { isStaffPath, navigationGroups } from '../domain/navigation'
import { staffDestination } from '../domain/loginPortal'
import { requestAssessmentLeave } from '../domain/assessmentLeave'
const emit = defineEmits<{ navigate: [] }>()
const auth = useAuthStore(),
  access = useAccessStore(),
  route = useRoute(),
  router = useRouter()
const staffPortal = computed(() => isStaffPath(route.path, access.can))
const canEnterStaff = computed(() => Boolean(staffDestination(access)))
const groups = computed(() =>
  navigationGroups(access.can, access.singlePlatform, staffPortal.value ? 'staff' : 'learner'),
)
const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const menuId = useId()
const menuButton = ref<HTMLButtonElement | null>(null)
const profile = ref<InstanceType<typeof PersonalProfileDialog> | null>(null)
watch(
  () => route.path,
  () => {
    menuOpen.value = false
  },
)
function closeOnBlur(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null))
    menuOpen.value = false
}
function closeOnOutside(event: PointerEvent) {
  if (!menuRoot.value?.contains(event.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener('pointerdown', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutside))
function toggleMenu(event: MouseEvent) {
  menuOpen.value =
    event.detail > 0 && window.matchMedia('(hover: hover) and (pointer: fine)').matches
      ? true
      : !menuOpen.value
}
function showProfile() {
  menuOpen.value = false
  profile.value?.show()
}
function escapeMenu() {
  menuOpen.value = false
  menuButton.value?.focus()
}
const referenceIcons = {
  '/workspace': Monitor,
  '/assessment': SquareCheck,
  '/reports': Newspaper,
  '/training': BookmarkCheck,
  '/history': Clock3,
  '/analytics': Zap,
  '/item-bank': TableProperties,
  '/reviews': Check,
}
function navigationIcon(item: { path: string; icon: unknown }) {
  return referenceIcons[item.path as keyof typeof referenceIcons] ?? item.icon
}
const roles: Record<string, string> = {
  learner: '学员',
  evaluator: '评估员',
  org_admin: '组织管理员',
  system_admin: '系统管理员',
}
const accountRole = computed(() => {
  if (access.singlePlatform) return access.can('system') ? '管理员' : '学员'
  if (access.can('system')) return '系统管理员'
  const role = access.organization?.role ?? ''
  if (access.can('content_author'))
    return role === 'org_admin' || role === 'evaluator'
      ? `${roles[role]} · 指派维护`
      : '教师 · 指派维护'
  return roles[role] ?? '个人空间'
})
function active(path: string) {
  return (
    route.path === path ||
    (path === '/assessment' && route.path.startsWith('/assessment/')) ||
    (path === '/reports' && route.path.startsWith('/reports/'))
  )
}
async function logout() {
  if (!(await requestAssessmentLeave())) return
  access.clear()
  await auth.logout()
  emit('navigate')
  await router.push('/login')
}
</script>
<template>
  <div class="navigation-menu">
    <RouterLink
      class="measure-brand"
      :to="staffPortal ? '/teaching' : '/workspace'"
      @click="emit('navigate')"
      ><BrandMark /><span>AI Measure</span></RouterLink
    >
    <nav aria-label="主导航">
      <section v-for="group in groups" :key="group.title">
        <h2>{{ group.title }}</h2>
        <RouterLink
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          :title="item.label"
          :class="{ selected: active(item.path) }"
          :aria-current="active(item.path) ? 'page' : undefined"
          @click="emit('navigate')"
          ><component :is="navigationIcon(item)" :size="20" /><span>{{ item.label }}</span
          ><i v-if="active(item.path)"></i
        ></RouterLink>
      </section>
    </nav>
    <div class="navigation-bottom">
      <div class="account">
        <span class="account-avatar">{{ Array.from(auth.user?.display_name || '我')[0] }}</span>
        <div class="account-info">
          <strong>{{ auth.user?.display_name ?? '当前用户' }}</strong
          ><small :title="accountRole">{{ accountRole }}</small>
        </div>
        <div
          ref="menuRoot"
          class="account-menu"
          @pointerenter="$event.pointerType === 'mouse' && (menuOpen = true)"
          @pointerleave="$event.pointerType === 'mouse' && (menuOpen = false)"
          @focusout="closeOnBlur"
          @keydown.esc.stop.prevent="escapeMenu"
        >
          <button
            ref="menuButton"
            type="button"
            class="account-trigger"
            title="账号操作"
            aria-label="账号操作"
            :aria-controls="menuId"
            :aria-expanded="menuOpen"
            @click="toggleMenu"
            @keydown.down.prevent="menuOpen = true"
          >
            <Ellipsis :size="20" />
          </button>
          <div v-if="menuOpen" :id="menuId" class="account-popover" aria-label="账号操作列表">
            <button data-testid="logout" title="退出登录" aria-label="退出登录" @click="logout">
              <LogOut :size="17" /><span>退出登录</span>
            </button>
            <button type="button" data-testid="personal-profile" @click="showProfile">
              <UserRound :size="17" /><span>个人资料</span>
            </button>
            <RouterLink
              v-if="staffPortal || canEnterStaff"
              :to="staffPortal ? '/workspace' : '/staff/login'"
              data-testid="portal-switch"
              @click="emit('navigate')"
            >
              <ArrowLeftRight :size="17" /><span>{{
                staffPortal ? '切换到学员端' : '切换到教师管理端'
              }}</span>
            </RouterLink>
          </div>
        </div>
      </div>
      <RouterLink class="help-link" to="/help" title="问题与帮助" @click="emit('navigate')"
        ><HelpCircle :size="23" /><span>问题与帮助</span></RouterLink
      >
    </div>
    <PersonalProfileDialog ref="profile" :role-label="accountRole" @closed="menuButton?.focus()" />
  </div>
</template>
<style scoped>
.navigation-menu {
  --nav-unit: var(--reference-unit, 1px);
  --nav-text: #208c9c;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  color: var(--nav-text);
}
.measure-brand {
  height: calc(98 * var(--nav-unit));
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: calc(14 * var(--nav-unit));
  padding: 0 calc(25 * var(--nav-unit));
  color: var(--nav-text);
  background: var(--reference-brand, #8dcad3);
  white-space: nowrap;
}
.measure-brand :deep(.brand-mark),
.measure-brand :deep(svg) {
  width: calc(46 * var(--nav-unit));
  height: calc(46 * var(--nav-unit));
  flex-shrink: 0;
}
.measure-brand > span {
  color: #fff;
  font-family: Outfit, 'Segoe UI', sans-serif;
  font-size: calc(28 * var(--nav-unit));
  font-weight: 600;
  font-synthesis: none;
  font-kerning: normal;
  letter-spacing: -0.025em;
  line-height: 1.15;
}
nav {
  flex: 1;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: #8fbfc8 transparent;
  padding: calc(45 * var(--nav-unit)) 0 calc(16 * var(--nav-unit));
}
section + section {
  margin-top: calc(25 * var(--nav-unit));
}
.navigation-menu h2 {
  margin: 0 calc(8 * var(--nav-unit)) calc(7 * var(--nav-unit));
  font-size: calc(19 * var(--nav-unit));
  line-height: calc(28 * var(--nav-unit));
  color: var(--nav-text);
  font-weight: 600;
}
nav a {
  display: flex;
  align-items: center;
  gap: calc(21 * var(--nav-unit));
  height: calc(70 * var(--nav-unit));
  min-height: 44px;
  padding: 0 calc(23 * var(--nav-unit));
  margin: calc(5 * var(--nav-unit)) 0 0;
  border: 1px solid #a8d8de;
  border-radius: calc(16 * var(--nav-unit));
  color: var(--nav-text);
  font-size: calc(20 * var(--nav-unit));
  font-weight: 700;
}
nav a:hover {
  background: #bbdfe5;
}
nav a.selected {
  border-color: #169cb0;
  background: #afd9e1;
  color: var(--nav-text);
  font-weight: 700;
}
nav a i {
  margin-left: auto;
  width: calc(6 * var(--nav-unit));
  height: calc(6 * var(--nav-unit));
  background: #199daf;
  border-radius: 50%;
}
nav a svg {
  width: calc(21 * var(--nav-unit));
  height: calc(21 * var(--nav-unit));
  flex-shrink: 0;
}
.navigation-bottom {
  flex-shrink: 0;
  margin: 0 12px;
  border-top: 1px solid #a9d5dc;
  padding: 16px 4px 12px;
}
.help-link {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  margin-top: 10px;
  padding: 0 8px;
  color: #20a0b3;
  font-size: 14px;
  white-space: nowrap;
}
.account {
  display: flex;
  align-items: center;
  gap: 10px;
}
.account-avatar {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 14px;
  background: #eef6f7;
  color: #1a96a9;
  font-size: 20px;
  font-weight: 650;
}
.account-info {
  flex: 1;
  min-width: 0;
}
.account strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 700;
}
.account small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #48666f;
  font-size: 12px;
}
.account-menu {
  position: relative;
  flex-shrink: 0;
  margin-left: auto;
}
.account-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  list-style: none;
  width: 44px;
  height: 44px;
  cursor: pointer;
  border: 0;
  color: inherit;
  background: transparent;
  border-radius: 12px;
}
.account-popover {
  position: absolute;
  right: 0;
  bottom: 100%;
  min-width: 176px;
  padding: 8px;
  border: 1px solid #a8d8de;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 5px 16px #183b4614;
  z-index: 2;
}
.account-popover button,
.account-popover a {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 8px 14px;
  border: 0;
  border-radius: 8px;
  background: #fff;
  color: #187c8e;
  font-size: 14px;
  white-space: nowrap;
  cursor: pointer;
  z-index: 1;
}
.account-menu button:hover,
.account-menu a:hover {
  background: #f2fafb;
}
.account-trigger:focus-visible,
.account-menu button:focus-visible,
.account-menu a:focus-visible {
  outline: 3px solid #137f91;
  outline-offset: 1px;
}
@media (min-width: 960px) and (max-width: 1279px) {
  .measure-brand {
    justify-content: center;
    padding: 0;
  }
  .measure-brand :deep(.brand-mark),
  .measure-brand :deep(svg) {
    width: 42px;
    height: 42px;
  }
  .measure-brand > span,
  .navigation-menu h2,
  nav a span,
  nav a i,
  .help-link span,
  .account-info {
    display: none;
  }
  nav {
    padding: 18px 6px;
  }
  nav a {
    justify-content: center;
    height: 54px;
    padding: 12px;
    border-radius: 12px;
  }
  nav a svg {
    width: 22px;
    height: 22px;
  }
  .navigation-bottom {
    margin: 0;
    padding: 14px 8px;
  }
  .account {
    flex-direction: column;
    gap: 0;
  }
  .account-avatar {
    width: 40px;
    height: 40px;
    font-size: 18px;
  }
  .account-menu {
    margin: 0;
  }
  .account-popover {
    right: auto;
    left: 0;
  }
  .help-link {
    justify-content: center;
    padding: 0;
    margin-top: 0;
  }
}
@media (max-width: 959px) {
  .navigation-menu {
    --nav-unit: 0.94px;
  }
  nav {
    padding-top: 44px;
  }
  nav a {
    height: 52px;
  }
  .navigation-menu h2 {
    font-size: 16px;
  }
  .account-avatar {
    width: 48px;
    height: 48px;
    font-size: 22px;
  }
  .account strong,
  .help-link {
    font-size: 15px;
  }
  .account small {
    font-size: 14px;
  }
  .navigation-bottom {
    padding-bottom: 16px;
  }
}
</style>
