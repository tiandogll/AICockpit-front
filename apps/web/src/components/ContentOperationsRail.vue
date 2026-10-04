<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Cpu, ShieldCheck, ListChecks } from '@lucide/vue'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { listReviews, type ReviewQueueItem } from '../services/reviewApi'
import { readProviderHealth, type ProviderHealth } from '../services/adminWorkspaceApi'

const access = useAccessStore()
const auth = useAuthStore()
const queue = ref<ReviewQueueItem[] | null>(null)
const provider = ref<ProviderHealth | null>(null)
const reviewError = ref('')
const providerError = ref('')
const loading = ref(false)
const signedIn = computed(() => auth.isAuthenticated && Boolean(auth.user?.id))
const canReview = computed(() => signedIn.value && access.ready && Boolean(access.organizationId) && access.can('reviews'))
const canSystem = computed(() => signedIn.value && access.ready && access.can('system'))
const canGovernance = computed(() => signedIn.value && access.ready && (access.can('system') || access.can('governance')))
const usedPercent = computed(() => provider.value && provider.value.daily_token_quota > 0
  ? Math.min(100, Math.max(0, provider.value.tokens_used_today / provider.value.daily_token_quota * 100)) : null)
const providerStatus = computed(() => {
  const value = provider.value
  if (!value) return ''
  if (value.daily_token_quota === 0) return '调用已停用'
  if (!value.configured) return '尚未配置'
  if (value.tokens_used_today >= value.daily_token_quota) return '额度已用完'
  return value.ready ? '配置就绪' : '暂不可用'
})
const providerReasons = computed(() => {
  const value = provider.value
  if (!value) return []
  const reasons: string[] = []
  if (!value.configured) reasons.push('后端尚未配置可用的模型服务凭据。')
  if (value.daily_token_quota === 0) reasons.push('每日额度设为 0，模型调用已关闭；重新连接不会改变此设置。')
  else if (value.tokens_used_today >= value.daily_token_quota)
    reasons.push('今日配置额度已用完，请等待额度重置或联系管理员。')
  if (value.configured && !value.ready)
    reasons.push('模型服务暂未就绪，请到服务状态页查看熔断与错误记录。')
  return reasons
})
let generation = 0
async function load() {
  const ticket = ++generation
  queue.value = null
  provider.value = null
  reviewError.value = ''
  providerError.value = ''
  loading.value = canReview.value || canSystem.value
  const results = await Promise.allSettled([
    canReview.value ? listReviews(access.organizationId) : Promise.resolve(null),
    canSystem.value ? readProviderHealth() : Promise.resolve(null),
  ])
  if (ticket !== generation) return
  if (results[0].status === 'fulfilled') queue.value = results[0].value
  else reviewError.value = '复核摘要读取失败'
  if (results[1].status === 'fulfilled') provider.value = results[1].value
  else providerError.value = '服务状态读取失败'
  loading.value = false
}
watch(() => [auth.user?.id, signedIn.value, access.ready, access.organizationId, canReview.value, canSystem.value], load, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => { generation += 1 })
</script>

<template>
  <aside class="operations-rail" aria-label="内容与评分辅助信息">
    <section class="operations-card surface">
      <header><ListChecks :size="18" /><h2>评分复核</h2></header>
      <template v-if="canReview">
        <div class="rail-total"><strong>{{ loading || queue === null ? '—' : queue.length }}</strong><span>份已加载待复核回答</span></div>
        <p class="rail-scope">{{ access.organization?.name }} · 当前队列</p>
        <p v-if="reviewError" role="alert">{{ reviewError }} <button @click="load">重试</button></p>
        <ul v-else-if="queue?.length" class="review-preview">
          <li v-for="item in queue.slice(0, 3)" :key="item.decision_id"><span>{{ item.review_reasons.includes('score_disagreement') ? '模型评分分歧' : item.review_reasons.includes('safety_flag') ? '安全标记待核验' : '回答证据待核验' }}</span><small>{{ item.provisional_score == null ? '待人工评分' : `模型建议 ${item.provisional_score} / 4` }}</small></li>
        </ul>
        <p v-else-if="!loading && queue">当前没有等待人工复核的回答。</p>
        <RouterLink to="/reviews" class="rail-link">进入评分复核工作台 <ArrowRight :size="15" /></RouterLink>
      </template>
      <p v-else>选择有评分复核权限的组织后，可查看待处理回答。题目审核请使用左侧“待审核题目”。</p>
    </section>
    <section class="operations-card surface">
      <header><Cpu :size="18" /><h2>模型服务状态</h2></header>
      <template v-if="canSystem">
        <p v-if="providerError" role="alert">{{ providerError }} <button @click="load">重试</button></p>
        <p v-else-if="loading">正在读取服务配置…</p>
        <template v-else-if="provider">
          <div class="provider-line"><strong>{{ provider.active_provider }}</strong><span class="admin-chip">{{ providerStatus }}</span></div>
          <p>{{ provider.model }}</p>
          <p v-if="providerReasons.length" class="provider-explanation" role="status">{{ providerReasons.join(' ') }}</p>
          <dl><div><dt>今日全局 Token 用量</dt><dd>{{ provider.tokens_used_today.toLocaleString() }}</dd></div><div><dt>每日配置额度</dt><dd>{{ provider.daily_token_quota.toLocaleString() }}</dd></div></dl>
          <progress v-if="usedPercent !== null" class="admin-progress" max="100" :value="usedPercent" aria-label="全局 Token 额度使用比例"></progress>
          <p class="rail-scope">配置与熔断状态摘要，不代表本次模型调用已成功；此页不会调用模型。</p>
        </template>
      </template>
      <p v-else>全局模型状态仅向系统管理员开放。</p>
      <RouterLink v-if="canGovernance" to="/system" class="rail-link">查看服务状态与调用审计 <ArrowRight :size="15" /></RouterLink>
    </section>
    <section class="operations-card publishing-note surface">
      <header><ShieldCheck :size="18" /><h2>从题库到学员</h2></header>
      <ol><li>补齐来源、答案和量规</li><li>完成题目审核与必要试答</li><li>发布题目并配置测评蓝图</li><li>学员从可用测评进入作答</li></ol>
      <p>审核记录、试答与正式评分分别保留。仅有草稿或审核通过，不等于已进入正式测评。</p>
    </section>
  </aside>
</template>

<style scoped>
.operations-rail { display: grid; gap: 20px; align-content: start; min-width: 0; }
.operations-card { padding: 22px; min-width: 0; }
.operations-card header { display: flex; align-items: center; gap: 9px; color: var(--signal-dark); }
.operations-card h2 { font: 700 17px/1.5 inherit; color: var(--text); }
.operations-card p { margin-top: 12px; color: var(--muted); font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.rail-total { display: flex; align-items: baseline; gap: 10px; margin-top: 18px; }
.rail-total strong { color: var(--signal-dark); font: 700 36px/1.2 var(--admin-number-font); }
.rail-total span { font-size: 12px; color: var(--muted); }
.operations-card .rail-scope { font-size: 12px; }
.review-preview { padding: 0; list-style: none; margin-top: 16px; }
.review-preview li { border-top: 1px solid var(--line); padding: 12px 0; font-size: 13px; }
.review-preview small { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }
.rail-link { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 13px; font-weight: 600; color: var(--signal-dark); }
.provider-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 16px; }
dl { margin: 16px 0; }
dl div { display: flex; justify-content: space-between; gap: 10px; margin-top: 10px; font-size: 12px; }
dt { color: var(--muted); }
dd { font-family: var(--admin-number-font); }
.publishing-note { background: var(--mist); }
.publishing-note ol { margin: 16px 0 0; padding-left: 20px; font-size: 13px; line-height: 2.3; }
button { border: 1px solid var(--line); border-radius: 8px; padding: 4px 12px; background: var(--paper-strong); color: var(--signal-dark); cursor: pointer; }
@media (min-width: 701px) and (max-width: 1150px) { .operations-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
