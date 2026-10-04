<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, BookOpenCheck, ClipboardCheck, ShieldCheck } from '@lucide/vue'
import { navigationGroups } from '../domain/navigation'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'

const access = useAccessStore()
const auth = useAuthStore()
const available = computed(() => auth.isAuthenticated && access.ready && !access.error)
const groups = computed(() =>
  available.value
    ? navigationGroups(access.can, access.singlePlatform, 'staff')
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.path !== '/teaching'),
        }))
        .filter((group) => group.items.length)
    : [],
)
const descriptions: Record<string, string> = {
  '/authoring': '维护管理员指派的题目，保存新版本草稿并提交审核。',
  '/item-bank': '管理题目、评分量规与测评蓝图，审核发布可用版本。',
  '/reviews': '查看作答与评分依据，处理需要人工判断的复核记录。',
  '/analytics': '查看授权组织的测评汇总、能力分布与题目质量。',
  '/members': '维护组织成员与班级归属，按权限管理成员身份。',
  '/pilot-lab': '管理真实试测批次，检查样本、质量与验收结果。',
  '/cat-lab': '检查自适应选题、能力估计与仿真验证结果。',
  '/system': '查看模型服务、调用审计与数据安全配置。',
  '/workbench': '验证实操工作区的接口连接、过程事件与提交链路。',
}
const scopeSummary = computed(() => {
  if (access.can('system'))
    return '你以系统管理员身份使用同一个教师管理端。题库发布、权限配置与系统治理仍按实际授权执行。'
  if (access.can('content_author'))
    return '你可以维护已指派题目并提交审核，发布由管理员完成。评分复核与组织分析按授权开放。'
  return '这里仅显示当前组织授权的管理模块；组织分析、评分复核与成员管理分别受权限控制。'
})
</script>

<template>
  <section class="teaching-page" aria-labelledby="teaching-title">
    <header class="teaching-heading">
      <div>
        <p class="teaching-kicker">AI Measure · 教师管理端</p>
        <h1 id="teaching-title">教师管理工作台</h1>
        <p>从题目准备到评分复核，在同一个工作区开展测评管理。</p>
      </div>
      <RouterLink class="secondary-button learner-link" to="/workspace">
        进入学员端 <ArrowRight :size="17" aria-hidden="true" />
      </RouterLink>
    </header>

    <section v-if="access.error" class="surface teaching-state" role="alert">
      <h2>管理权限读取失败</h2>
      <p>{{ access.error }}</p>
      <button class="secondary-button" :disabled="access.loading" @click="access.load(true)">
        {{ access.loading ? '正在重试…' : '重新读取权限' }}
      </button>
    </section>
    <section v-else-if="!access.ready" class="surface teaching-state" role="status">
      正在核对管理权限…
    </section>
    <section v-else-if="!available || !groups.length" class="surface teaching-state" role="status">
      <ShieldCheck :size="30" aria-hidden="true" />
      <h2>当前暂无可用的管理模块</h2>
      <p>请联系平台管理员确认组织身份或题目指派；也可以进入学员端继续使用。</p>
    </section>
    <template v-else>
      <section class="teaching-scope" aria-labelledby="scope-title">
        <span class="scope-icon"><ShieldCheck :size="26" aria-hidden="true" /></span>
        <div>
          <h2 id="scope-title">{{ access.organization?.name || '平台管理范围' }}</h2>
          <p>{{ scopeSummary }}</p>
        </div>
        <span class="scope-badge">{{ access.can('system') ? '系统管理员' : '按授权开放' }}</span>
      </section>

      <section
        v-for="(group, index) in groups"
        :key="group.title"
        class="teaching-modules"
        :aria-labelledby="`teaching-group-${index}`"
      >
        <h2 :id="`teaching-group-${index}`">{{ group.title }}</h2>
        <div class="module-grid">
          <RouterLink
            v-for="item in group.items"
            :key="item.path"
            :to="item.path"
            class="module-link"
            data-testid="teaching-module"
            :aria-label="`进入${item.label}`"
          >
            <component :is="item.icon" class="module-icon" :size="23" aria-hidden="true" />
            <h3>{{ item.label }}</h3>
            <p>{{ descriptions[item.path] }}</p>
            <span class="module-action"
              >进入工作区 <ArrowRight :size="17" aria-hidden="true"
            /></span>
          </RouterLink>
        </div>
      </section>

      <aside class="teaching-process" aria-labelledby="process-title">
        <h2 id="process-title">测评如何衔接</h2>
        <ol>
          <li>
            <BookOpenCheck :size="20" aria-hidden="true" />
            <div>
              <strong>准备题目</strong>
              <p>教师维护指派内容，管理员审核并发布版本。</p>
            </div>
          </li>
          <li>
            <ClipboardCheck :size="20" aria-hidden="true" />
            <div>
              <strong>学员完成测评</strong>
              <p>学员从已发布测评进入，系统保留作答与过程证据。</p>
            </div>
          </li>
          <li>
            <ShieldCheck :size="20" aria-hidden="true" />
            <div>
              <strong>复核与分析</strong>
              <p>获授权人员核对评分证据，查看测评汇总与能力分布。</p>
            </div>
          </li>
        </ol>
      </aside>
    </template>
  </section>
</template>

<style scoped>
.teaching-page {
  min-width: 0;
  padding-bottom: 24px;
  color: var(--ink-800);
}
.teaching-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 24px;
}
.teaching-kicker {
  color: var(--signal-dark);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
}
.teaching-heading h1 {
  margin: 7px 0 8px;
  font-size: 28px;
  line-height: 1.35;
}
.teaching-heading p:last-child,
.teaching-scope p {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.learner-link {
  flex-shrink: 0;
  font-size: 13px;
}
.teaching-scope {
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 22px 24px;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--mist);
}
.scope-icon {
  display: grid;
  place-items: center;
  flex: 0 0 48px;
  height: 48px;
  border-radius: 14px;
  color: var(--signal-dark);
  background: var(--paper-strong);
}
.teaching-scope > div {
  min-width: 0;
  flex: 1;
}
.teaching-scope h2 {
  margin-bottom: 5px;
  font-size: 18px;
  overflow-wrap: anywhere;
}
.scope-badge {
  flex-shrink: 0;
  padding: 6px 12px;
  border: 1px solid var(--line);
  border-radius: 99px;
  color: var(--signal-dark);
  background: var(--paper-strong);
  font-size: 12px;
  font-weight: 600;
}
.teaching-modules {
  margin-top: 28px;
}
.teaching-modules > h2,
.teaching-process > h2 {
  margin: 0 0 14px;
  font-size: 18px;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.module-link {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  padding: 23px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper-strong);
  transition:
    border-color 160ms ease,
    background-color 160ms ease;
}
.module-link:hover {
  border-color: var(--signal);
  background: var(--mist);
}
.module-icon {
  color: var(--signal-dark);
  margin-bottom: 16px;
}
.module-link h3 {
  font-size: 17px;
  margin-bottom: 8px;
}
.module-link p {
  flex: 1;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.8;
}
.module-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 22px;
  color: var(--signal-dark);
  font-size: 13px;
  font-weight: 600;
}
.teaching-process {
  margin-top: 30px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
}
.teaching-process ol {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  list-style: none;
  padding: 0;
  margin: 0;
}
.teaching-process li {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.teaching-process svg {
  flex-shrink: 0;
  color: var(--signal-dark);
  margin-top: 2px;
}
.teaching-process strong {
  font-size: 14px;
}
.teaching-process p {
  margin-top: 5px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.teaching-state {
  display: grid;
  justify-items: start;
  gap: 14px;
  padding: 32px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.8;
}
.teaching-state h2 {
  font-size: 20px;
  color: var(--ink-800);
}
.teaching-state p {
  overflow-wrap: anywhere;
}
.teaching-page :is(a, button):focus-visible {
  outline: 3px solid var(--signal-dark);
  outline-offset: 4px;
}
@media (max-width: 1100px) {
  .module-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .teaching-scope {
    flex-wrap: wrap;
  }
  .scope-badge {
    margin-left: 66px;
  }
  .teaching-process ol {
    grid-template-columns: 1fr;
    gap: 18px;
  }
}
@media (max-width: 600px) {
  .teaching-heading {
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  .teaching-heading h1 {
    font-size: 25px;
  }
  .module-grid {
    grid-template-columns: 1fr;
  }
  .teaching-scope,
  .module-link,
  .teaching-state {
    padding: 20px;
  }
  .scope-icon {
    display: none;
  }
  .teaching-scope {
    flex-direction: column;
    align-items: flex-start;
  }
  .scope-badge {
    margin-left: 0;
  }
  .teaching-page :is(button, .learner-link) {
    min-height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .module-link {
    transition: none;
  }
}
</style>
