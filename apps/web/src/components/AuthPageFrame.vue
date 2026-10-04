<script setup lang="ts">
import { ShieldCheck } from '@lucide/vue'
import { DIMENSIONS } from '../domain/capabilities'
import LoginAbilityIllustration from './LoginAbilityIllustration.vue'
withDefaults(defineProps<{ registering?: boolean; staff?: boolean }>(), {
  registering: false,
  staff: false,
})
</script>

<template>
  <section class="auth-page shell" :class="{ 'compact-login': !registering }">
    <div
      class="calibration-board"
      :aria-label="staff ? '教师管理工作范围' : '六维AI能力测量范围'"
    >
      <template v-if="!registering">
        <p class="login-intro">每一次探索，都让能力更清晰</p>
        <h1>看见你的 AI 能力<br /><em>找到成长的下一步</em></h1>
        <p>从测评到训练，让每一次进步都有据可循。</p>
        <LoginAbilityIllustration />
      </template>
      <template v-else>
        <span class="eyebrow">AI Measure</span>
        <h1>建立你的<br /><em>能力坐标系</em></h1>
        <p>
          {{
            staff
              ? '统一管理学员、题库与评分复核。学员学习记录与管理工作边界清晰，测评与报告保持可追溯。'
              : registering
                ? '从一次测评开始，了解你的六维能力，形成有依据的成长路径。注册后进入学员工作台，记录按账号权限保护。'
                : '每一次选择、追问与核验都会成为能力证据。登录后从上次停止的位置继续。'
          }}
        </p>
        <ol>
          <li v-for="dimension in DIMENSIONS" :key="dimension.code">
            <i :style="{ background: dimension.color }"></i><strong>{{ dimension.name }}</strong>
          </li>
        </ol>
      </template>
      <div v-if="registering" class="privacy-note">
        <ShieldCheck :size="17" /> 回答默认不用于模型训练
      </div>
    </div>
    <div class="auth-card surface">
      <slot />
    </div>
    <div v-if="!registering" class="login-privacy">
      <ShieldCheck :size="20" />回答默认不用于模型训练
    </div>
  </section>
</template>

<style scoped>
.auth-page {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, 0.8fr);
  align-items: center;
  gap: 70px;
  max-width: 1040px;
  min-height: calc(100vh - 150px);
  padding-top: 48px;
  padding-bottom: 60px;
  color: var(--text);
}
.calibration-board {
  padding: 30px;
  border-radius: 22px;
  background: var(--mist);
}
.calibration-board h1 {
  margin-top: 18px;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.035em;
}
.calibration-board h1 em {
  color: var(--signal-dark);
  font-style: normal;
}
.calibration-board > p {
  margin-top: 18px;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.9;
}
.calibration-board ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  list-style: none;
  margin-top: 26px;
  padding: 0;
}
.calibration-board li {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 48px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper-strong);
}
.calibration-board li strong {
  font-size: 13px;
  font-weight: 600;
}
.calibration-board li i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: none;
}
.privacy-note {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 24px;
  color: var(--signal-dark);
  font-size: 12px;
}
.auth-card {
  min-width: 0;
  padding: 30px;
  background: var(--paper-strong);
  border: 1px solid var(--line);
  border-radius: 18px;
  box-shadow: var(--shadow);
}
.compact-login .calibration-board {
  background: transparent;
  padding: 6px 0 0;
}
.compact-login .calibration-board h1 {
  font-size: clamp(38px, 4.05vw, 64px);
  line-height: 1.32;
  color: #052e40;
  margin-top: 14px;
  font-weight: 800;
}
.compact-login .calibration-board > p {
  font-size: clamp(16px, 1.4vw, 22px);
  color: #52758a;
  margin-top: 16px;
}
.compact-login .calibration-board > .login-intro {
  font-size: 20px;
  letter-spacing: 2px;
  margin-top: 0;
}
.login-privacy {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 14px;
  color: #64879a;
  font-size: 14px;
}
.compact-login .auth-card {
  padding: 36px 38px;
  min-height: 724px;
  border-radius: 24px;
  background: #ffffffed;
  box-shadow: 0 16px 50px #137f9110;
}
.compact-login .auth-card :deep(h2) {
  font-size: 32px;
  margin-top: 0;
  color: #082e40;
}
.compact-login .auth-card :deep(form > p) {
  font-size: 20px;
  line-height: 1.5;
  margin-top: 4px;
}
.compact-login .auth-card :deep(label) {
  margin-top: 28px;
  margin-bottom: 6px;
  font-size: 17px;
}
.compact-login .auth-card :deep(input) {
  min-height: 54px;
  font-size: 17px;
  border-radius: 10px;
  padding: 13px 20px;
}
.compact-login .auth-card :deep(button[type='submit']) {
  margin-top: 26px;
  min-height: 60px;
  font-size: 20px;
  border-radius: 12px;
}
.compact-login .auth-card :deep(form > .auth-switch) {
  margin-top: 24px;
  font-size: 18px;
}
@media (max-width: 680px) {
  .compact-login .calibration-board {
    display: none;
  }
  .compact-login .auth-card {
    padding: 24px;
    min-height: 0;
  }
  .compact-login .auth-card :deep(h2) {
    font-size: 28px;
  }
  .compact-login .auth-card :deep(form > p),
  .compact-login .auth-card :deep(form > .auth-switch) {
    font-size: 15px;
  }
  .compact-login .auth-card :deep(button[type='submit']) {
    font-size: 17px;
  }
}
.auth-card :deep(h2) {
  margin-top: 12px;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.025em;
}
.auth-card :deep(form > p) {
  margin-top: 8px;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
.auth-card :deep(label) {
  display: block;
  margin-top: 22px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
}
.auth-card :deep(input) {
  width: 100%;
  min-height: 46px;
  padding: 11px 13px;
  border: 1px solid var(--line);
  border-radius: 8px;
  color: var(--text);
  background: var(--paper-strong);
  font-size: 15px;
}
.auth-card :deep(input:focus) {
  border-color: var(--signal-dark);
  outline: 2px solid var(--nav-bg);
  outline-offset: 2px;
}
.auth-card :deep(input:disabled) {
  background: var(--paper);
}
.auth-card :deep(button[type='submit']) {
  width: 100%;
  justify-content: center;
  margin-top: 26px;
  min-height: 46px;
}
.auth-card :deep(button:disabled) {
  opacity: 0.6;
  cursor: default;
}
.auth-card :deep(.form-help) {
  display: block;
  margin-top: 7px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
.auth-card :deep(.auth-note) {
  display: block;
  margin-top: 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
  text-align: center;
}
.auth-card :deep(.auth-switch) {
  text-align: center;
  margin-top: 20px;
  font-size: 14px;
}
.auth-card :deep(.auth-switch a) {
  color: var(--signal-dark);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.auth-card :deep([role='alert']),
.auth-card :deep([role='status']) {
  margin-top: 18px;
  padding: 12px 14px;
  border-left: 3px solid #b34736;
  border-radius: 7px;
  color: #8f3427;
  background: #fff3ed;
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.auth-card :deep([role='status']) {
  border-color: var(--signal-dark);
  color: var(--signal-dark);
  background: var(--mist);
}
@media (max-width: 900px) {
  .auth-page {
    gap: 32px;
    grid-template-columns: minmax(0, 1fr) minmax(300px, 1fr);
  }
  .calibration-board {
    padding: 24px;
  }
  .calibration-board ol {
    grid-template-columns: 1fr;
  }
  .auth-card {
    padding: 27px 24px;
  }
}
@media (max-width: 680px) {
  .auth-page {
    grid-template-columns: 1fr;
    gap: 24px;
    padding-top: 28px;
    padding-bottom: 40px;
  }
  .calibration-board {
    padding: 24px;
  }
  .calibration-board h1,
  .auth-card :deep(h2) {
    font-size: 26px;
  }
  .calibration-board ol {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .calibration-board li {
    padding: 10px;
  }
  .auth-card {
    padding: 27px 22px;
    order: -1;
  }
}
</style>
