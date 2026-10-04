import { createRouter, createWebHistory } from 'vue-router'

import { pinia } from '../stores/pinia'
import { AUTH_EXPIRED_EVENT, useAuthStore } from '../stores/auth'
import { useAccessStore } from '../stores/access'
import { hasRouteAccess } from '../domain/routeAccess'
import { loginRouteName, safeRedirect, STAFF_CAPABILITIES } from '../domain/loginPortal'

export { safeRedirect } from '../domain/loginPortal'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 16 }
    return { top: 0 }
  },
  routes: [
    {
      path: '/teaching',
      name: 'teaching',
      component: () => import('../views/TeachingView.vue'),
      meta: { requiresAuth: true, capabilities: STAFF_CAPABILITIES },
    },
    {
      path: '/workspace',
      name: 'workspace',
      component: () => import('../views/WorkspaceView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reports',
      name: 'reports',
      component: () => import('../views/ReportsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/HistoryView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/training',
      name: 'training',
      component: () => import('../views/TrainingView.vue'),
      meta: { requiresAuth: true },
    },
    { path: '/help', name: 'help', component: () => import('../views/HelpView.vue') },
    {
      path: '/members',
      name: 'members',
      component: () => import('../views/MembersView.vue'),
      meta: { requiresAuth: true, capabilities: ['members'] },
    },
    {
      path: '/system',
      name: 'system',
      component: () => import('../views/SystemView.vue'),
      meta: { requiresAuth: true, capabilities: ['system', 'governance'] },
    },
    {
      path: '/access-denied',
      name: 'access-denied',
      component: () => import('../views/AccessDeniedView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/assessment',
      name: 'assessment',
      component: () => import('../views/AssessmentView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/assessment/:sessionId',
      name: 'assessment-runner',
      component: () => import('../views/AssessmentRunnerView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/content-trials',
      name: 'content-trials',
      component: () => import('../views/ContentTrialView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/content-trials/:trialId',
      name: 'content-trial',
      component: () => import('../views/ContentTrialView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/assessment/:sessionId/practical/:itemId',
      name: 'formal-practical-workbench',
      component: () => import('../views/AssessmentRunnerView.vue'),
      props: (route) => ({
        formalSessionId: String(route.params.sessionId),
        formalItemId: String(route.params.itemId),
      }),
      meta: { requiresAuth: true },
    },
    {
      path: '/reports/:sessionId',
      name: 'report',
      component: () => import('../views/ReportView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/reviews',
      name: 'reviews',
      component: () => import('../views/ReviewWorkbenchView.vue'),
      meta: { requiresAuth: true, capabilities: ['reviews'] },
    },
    {
      path: '/analytics',
      name: 'organization-analytics',
      component: () => import('../views/OrganizationAnalyticsView.vue'),
      meta: { requiresAuth: true, capabilities: ['analytics'] },
    },
    {
      path: '/pilot-lab',
      name: 'pilot-lab',
      component: () => import('../views/PilotLabView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/staff/login',
      name: 'staff-login',
      component: () => import('../views/LoginView.vue'),
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('../views/RegisterView.vue'),
    },
    {
      path: '/cat-lab',
      name: 'cat-lab',
      component: () => import('../views/CatLabView.vue'),
      meta: { requiresAuth: true, capabilities: ['cat'] },
    },
    {
      path: '/authoring',
      name: 'authoring',
      component: () => import('../views/AuthoringView.vue'),
      meta: { requiresAuth: true, capabilities: ['content_author'] },
    },
    {
      path: '/item-bank',
      name: 'item-bank',
      component: () => import('../views/ItemBankView.vue'),
      meta: { requiresAuth: true, capabilities: ['content'] },
    },
    {
      path: '/workbench',
      name: 'practical-workbench',
      component: () => import('../views/PracticalWorkbenchView.vue'),
      meta: { requiresAuth: true, capabilities: ['system'] },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFoundView.vue'),
    },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore(pinia)
  await auth.initialize()
  if (to.name === 'home' && auth.isAuthenticated) return { name: 'workspace' }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return {
      name: loginRouteName(to.meta.capabilities),
      query: { redirect: safeRedirect(to.fullPath) },
    }
  }
  if (to.meta.requiresAuth && auth.isAuthenticated) {
    const access = useAccessStore(pinia)
    await access.load()
    if (access.singlePlatform && to.name === 'authoring')
      return { name: access.can('content') ? 'item-bank' : 'access-denied' }
    if (!hasRouteAccess(to.meta.capabilities, access.can)) return { name: 'access-denied' }
  }
  if ((to.name === 'login' || to.name === 'register') && auth.isAuthenticated) {
    const requested = typeof to.query.redirect === 'string' ? to.query.redirect : undefined
    return safeRedirect(requested)
  }
  return true
})

window.addEventListener(AUTH_EXPIRED_EVENT, () => {
  const current = router.currentRoute.value
  if (!current.meta.requiresAuth || current.name === 'login') return
  void router.replace({
    name: loginRouteName(current.meta.capabilities),
    query: { redirect: safeRedirect(current.fullPath) },
  })
})

export default router
