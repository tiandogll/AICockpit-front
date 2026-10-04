<script setup lang="ts">
import { useAuthStore } from '../stores/auth'
const auth = useAuthStore()
</script>

<template>
  <section class="not-found surface">
    <span class="not-found-code" aria-hidden="true">404</span>
    <h1>页面不存在</h1>
    <p>这个链接可能已失效，或地址输入有误。你可以返回后重新选择功能。</p>
    <RouterLink class="primary-button" :to="auth.isAuthenticated ? '/workspace' : '/about'">
      {{ auth.isAuthenticated ? '返回工作台' : '返回首页' }}
    </RouterLink>
  </section>
</template>

<style scoped>
.not-found {
  max-width: 680px;
  margin: 48px auto;
  padding: 40px 24px;
  text-align: center;
}
.not-found-code {
  color: var(--signal-dark);
  font-size: 48px;
  font-weight: 700;
}
.not-found h1 {
  margin: 12px 0;
  font-size: 28px;
}
.not-found p {
  color: var(--muted);
  margin: 16px 0 28px;
  line-height: 1.7;
}
</style>
