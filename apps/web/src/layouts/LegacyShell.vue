<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpRight, LogOut, UserRound } from '@lucide/vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { useRoute } from 'vue-router'
import { isStaffPath, navigationGroups } from '../domain/navigation'
import { staffDestination } from '../domain/loginPortal'

const auth = useAuthStore()
const router = useRouter()
const access = useAccessStore()
const route = useRoute()
const staffPortal = computed(() => isStaffPath(route.path, access.can))
const navigation = computed(() =>
  navigationGroups(
    access.can,
    access.singlePlatform,
    staffPortal.value ? 'staff' : 'learner',
  ).flatMap((group) => group.items),
)
const canEnterStaff = computed(() => Boolean(staffDestination(access)))

async function handleLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="app-frame">
    <header class="topbar shell">
      <RouterLink class="brand" to="/" aria-label="智鉴AI首页">
        <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
        <span>
          <strong>智鉴AI</strong>
          <small>AI CAPABILITY ATLAS</small>
        </span>
      </RouterLink>
      <nav aria-label="主导航">
        <template v-if="auth.isAuthenticated">
          <RouterLink v-for="item in navigation" :key="item.path" :to="item.path">{{
            item.label
          }}</RouterLink>
          <RouterLink
            v-if="staffPortal || canEnterStaff"
            :to="staffPortal ? '/workspace' : '/staff/login'"
            >{{ staffPortal ? '学员端' : '教师管理端' }}</RouterLink
          >
        </template>
        <template v-else>
          <RouterLink to="/about">了解平台</RouterLink>
          <RouterLink to="/help">使用帮助</RouterLink>
        </template>
      </nav>
      <div v-if="auth.isAuthenticated" class="account-action">
        <RouterLink to="/assessment"
          ><UserRound :size="16" /><span>{{
            auth.user?.display_name ?? '当前学员'
          }}</span></RouterLink
        >
        <button data-testid="logout" type="button" @click="handleLogout">
          <LogOut :size="15" />退出
        </button>
      </div>
      <RouterLink v-else class="nav-action" to="/login">
        登录测评
        <ArrowUpRight :size="17" />
      </RouterLink>
    </header>

    <div v-if="auth.isAuthenticated" class="legacy-scope shell">
      <label v-if="!route.params.sessionId"
        >当前组织
        <select
          :value="access.organizationId"
          :disabled="access.loading || Boolean(route.params.sessionId)"
          @change="access.selectOrganization(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="org in access.organizations" :key="org.id" :value="org.id">
            {{ org.name }}
          </option>
        </select></label
      >
      <p v-if="access.error" role="alert">
        {{ access.error }} <button @click="access.load(true)">重试</button>
      </p>
    </div>
    <main>
      <RouterView v-slot="{ Component }"
        ><component
          :is="Component"
          :key="route.path + ':' + (route.params.sessionId ? '' : access.organizationId)"
      /></RouterView>
    </main>

    <footer class="footer shell">
      <span>智鉴AI · 让每一次评分都有证据</span>
      <span>2026 数字马力杯 A01</span>
    </footer>
  </div>
</template>

<style scoped>
.legacy-scope {
  padding: 12px 0;
}
.legacy-scope select {
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  max-width: 240px;
}
.app-frame {
  min-height: 100vh;
}

.topbar {
  display: grid;
  min-height: 84px;
  align-items: center;
  grid-template-columns: 1fr auto 1fr;
  gap: 30px;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  justify-self: start;
}

.brand-mark {
  display: grid;
  width: 38px;
  height: 38px;
  align-items: end;
  padding: 8px;
  border-radius: 12px;
  background: var(--ink-950);
  grid-template-columns: repeat(3, 1fr);
  gap: 3px;
}

.brand-mark i {
  display: block;
  border-radius: 2px 2px 0 0;
  background: var(--signal);
}

.brand-mark i:nth-child(1) {
  height: 45%;
}
.brand-mark i:nth-child(2) {
  height: 80%;
}
.brand-mark i:nth-child(3) {
  height: 62%;
}

.brand strong,
.brand small {
  display: block;
}

.brand strong {
  color: var(--ink-950);
  font-family: 'Source Han Serif SC', 'Songti SC', serif;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.brand small {
  margin-top: -4px;
  color: var(--muted);
  font:
    600 8px/1.2 'Cascadia Mono',
    monospace;
  letter-spacing: 0.1em;
}

nav {
  display: flex;
  align-items: center;
  gap: clamp(12px, 1.45vw, 20px);
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
}

nav a {
  padding: 6px 0;
  border-bottom: 2px solid transparent;
}

nav a:hover,
nav a.router-link-active {
  border-color: var(--signal-dark);
  color: var(--ink-950);
}

.nav-action {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  justify-self: end;
  color: var(--ink-950);
  font-size: 14px;
  font-weight: 750;
}
.account-action {
  display: flex;
  align-items: center;
  justify-self: end;
  gap: 9px;
}
.account-action a,
.account-action button {
  display: flex;
  align-items: center;
  gap: 6px;
}
.account-action a {
  color: var(--ink-950);
  font-size: 13px;
  font-weight: 750;
}
.account-action button {
  padding: 7px 9px;
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.55);
  font-size: 11px;
  cursor: pointer;
}
.account-action button:hover {
  border-color: var(--signal-dark);
  color: var(--signal-dark);
}

.footer {
  display: flex;
  min-height: 96px;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}

@media (max-width: 1300px) and (min-width: 821px) {
  .account-action a span {
    display: none;
  }
}

@media (max-width: 820px) {
  .topbar {
    grid-template-columns: 1fr auto;
  }

  nav {
    display: none;
  }
}

@media (max-width: 520px) {
  .brand small,
  .nav-action svg {
    display: none;
  }

  .nav-action {
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .account-action a span {
    display: none;
  }

  .footer {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
  }
}
</style>
