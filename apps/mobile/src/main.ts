import { createApp } from 'vue'
import '../../web/src/assets/main.css'
import '../../web/src/assets/public-pages.css'
import '../../web/src/assets/registration-page.css'
import './theme.css'
import './compact.css'
import './assessment-compact.css'
import './reports-compact.css'
import './training-compact.css'
import App from './MobileApp.vue'
import router from '../../web/src/router'
import { pinia } from '../../web/src/stores/pinia'
import MobileHome from './MobileHome.vue'
import MobileAccount from './MobileAccount.vue'
import MobileAssessment from './MobileAssessment.vue'

router.addRoute({ path: '/', name: 'home', component: MobileHome })
router.addRoute({
  path: '/workspace', name: 'workspace', component: MobileHome, meta: { requiresAuth: true },
})
router.addRoute({
  path: '/profile', name: 'mobile-profile', component: MobileAccount, meta: { requiresAuth: true },
})
router.addRoute({
  path: '/assessment', name: 'assessment', component: MobileAssessment, meta: { requiresAuth: true },
})

router.afterEach((to, _from, failure) => {
  if (!failure && window.self !== window.top) {
    window.parent.postMessage({ kind: 'ai-measure-mobile-route', path: router.resolve(to.fullPath).href }, window.location.origin)
  }
})

createApp(App).use(pinia).use(router).mount('#app')
