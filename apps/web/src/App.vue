<script setup lang="ts">
import LegacyShell from './layouts/LegacyShell.vue'
import MeasureShell from './layouts/MeasureShell.vue'
import { MEASURE_UI_ENABLED } from './domain/capabilities'
import WorkspaceAssistant from './components/WorkspaceAssistant.vue'
import DemoEnvironmentNotice from './components/DemoEnvironmentNotice.vue'
import { useAuthStore } from './stores/auth'
const auth = useAuthStore()
const isBusinessDemo = import.meta.env.VITE_BUSINESS_DEMO === 'true'
</script>
<template>
  <MeasureShell v-if="MEASURE_UI_ENABLED" />
  <LegacyShell v-else />
  <WorkspaceAssistant v-if="auth.isAuthenticated" :name="auth.user?.display_name ?? '欢迎回来'" />
  <DemoEnvironmentNotice :enabled="isBusinessDemo" />
</template>
