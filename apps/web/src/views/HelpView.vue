<script setup lang="ts">
import {
  ArrowRight,
  ChevronRight,
  UserRound,
  Users,
  LayoutGrid,
  FileText,
  ChartNoAxesColumnIncreasing,
  Lightbulb,
  Wrench,
  ShieldCheck,
  Save,
  Info,
  Database,
  MessageSquare,
  Settings,
  TriangleAlert,
} from '@lucide/vue'
import { DIMENSIONS, LEVEL_NAMES } from '../domain/capabilities'
import PublicIllustration from '../components/ReferenceArtwork.vue'
const dimensionIcons = [
  Lightbulb,
  FileText,
  Wrench,
  ChartNoAxesColumnIncreasing,
  Users,
  ShieldCheck,
]
const steps = [
  {
    icon: UserRound,
    title: '注册 / 登录',
    text: '学员可自行注册，或使用管理员提供的账号；用户名、邮箱均可登录。',
  },
  { icon: LayoutGrid, title: '选择场景', text: '进入能力测评，选择高校学习或企业办公场景。' },
  { icon: FileText, title: '完成测评', text: '按派发顺序完成客观题、对话与受控实操。' },
  {
    icon: ChartNoAxesColumnIncreasing,
    title: '查看与提升',
    text: '查看报告和逐维证据，再安排训练和正式复测。',
  },
]
const saveRules = [
  '按系统顺序作答，已提交回答不能修改。',
  '保存成功后可刷新恢复；保存失败时请先检查状态。',
  '回答已保存、追问生成失败时，只重试追问，不重复提交。',
  '实操保留任务拆解、AI交互、核验与最终产物记录。',
]
const scoringRules = [
  '客观题按标准答案确定性判分；开放题通过量规、模型证据校验和必要的人工复核形成最终分。',
  '待评分或待复核报告不是最终结论。训练记录不直接提高正式测评分数，能力变化需经可比复测验证。',
  '回答默认不用于模型训练。试测的同意、撤回与删除请通过试测中心及管理员处理。',
]
const support = [
  {
    icon: FileText,
    title: '成长助手可以做什么',
    lines: [
      '可询问测评使用、报告口径和训练下一步。',
      '普通问答统一由 DeepSeek 生成，每条成功回复都标注来源。',
      '不会用本地固定文案冒充模型回答；测评操作规则可直接查看本页。',
    ],
  },
  {
    icon: Database,
    title: '外发内容与费用',
    lines: [
      '点击发送、按 Enter 或选择快捷问题后，本次问题、所选材料的提取文字与必要的本人报告摘要会直接发送给 DeepSeek，不自动读取正式测评作答原文。',
      '选择图片或文档后即上传服务器提取文字，不再弹出二次确认。原文件不留存，提取文字加密临存 1 小时，可检查或主动删除。',
    ],
    warning: '模型调用可能产生费用，失败或中断的请求也可能计费。请勿在问题中输入隐私信息。',
  },
  {
    icon: ShieldCheck,
    title: '正式作答期间',
    lines: [
      '正式作答期间，成长助手暂停问答与材料上传，不提供作答内容。暂存退出后可使用成长助手，继续作答后再次暂停。',
      '实操题内按题目规则允许的受控 AI 交互仍可使用。',
      '成长建议不修改正式测评结果。暂存不清除答案，限时测评仍继续计时。',
    ],
  },
  {
    icon: ChartNoAxesColumnIncreasing,
    title: '报告状态与模型不可用',
    lines: [
      '报告未定稿或受隐私保护时，不将其摘要发送给模型；仍可询问一般学习和平台使用问题。',
      '模型不可用时明确显示失败原因，保留输入供重试，不生成替代回答。',
    ],
  },
  {
    icon: MessageSquare,
    title: '问答记录如何保存',
    lines: [
      '最近 10 次问答仅在当前页面内存中展示，不是持久会话，也不会作为多轮上下文发送给模型。',
      '刷新、离开页面、清空问答或切换账号后清空，不支持恢复。',
    ],
  },
  {
    icon: Settings,
    title: '尚未开放的功能',
    pending: true,
    lines: [
      '训练 AI 反馈、百宝箱智能问答、持久会话和反馈工单仍待接入。成长助手已支持文档文字提取与图片 OCR，非完整视觉理解；材料仅临时保存一小时，可主动删除。',
      '训练预览仅提供形成性练习，不代表专家认证；练习反馈为核验清单提示，并非 AI 判分。',
    ],
  },
]
</script>
<template>
  <div class="help-page">
    <section class="help-intro shell" aria-labelledby="help-title">
      <header class="help-heading">
        <div>
          <span class="eyebrow">AI Measure · 使用指南</span>
          <h1 id="help-title">了解自己的AI能力，<em>找到下一步</em></h1>
          <p>平台通过测评、证据报告和针对性训练，帮助你判断自己是否真正会使用和核验AI。</p>
        </div>
        <div class="guide-art">
          <PublicIllustration kind="guide" /><span>更清晰的方向<br />从了解自己开始</span>
        </div>
      </header>
      <section class="help-card start-card">
        <h2 class="section-title">如何开始</h2>
        <ol class="start-steps">
          <li v-for="(step, i) in steps" :key="step.title">
            <span class="icon-orb"><component :is="step.icon" /></span>
            <div>
              <span class="step-number">0{{ i + 1 }}</span>
              <h3>{{ step.title }}</h3>
              <p>{{ step.text }}</p>
            </div>
            <ChevronRight v-if="i < 3" class="step-arrow" />
          </li>
        </ol>
        <div class="start-bottom">
          <p><Info :size="20" />注册不强制填写邮箱；平台分为学员端和教师管理端，管理功能按账号授权开放。</p>
          <RouterLink class="primary-button" to="/assessment"
            >进入能力测评 <ArrowRight :size="21"
          /></RouterLink>
        </div>
      </section>
      <div class="help-basics">
        <section class="help-card dimension-card">
          <h2 class="section-title">六维能力与四个等级</h2>
          <p class="dimension-description">{{ DIMENSIONS.map((row) => row.name).join('、') }}。</p>
          <div class="dimension-tags">
            <span v-for="(row, i) in DIMENSIONS" :key="row.code"
              ><component :is="dimensionIcons[i]" :size="23" />{{ row.name }}</span
            >
          </div>
          <div class="level-table">
            <div v-for="(name, level) in LEVEL_NAMES" :key="level">
              <strong>{{ level }}</strong
              ><b>{{ name }}</b
              ><span>依据对应维度的能力模型判定</span>
            </div>
          </div>
          <p class="info-strip">
            <Info :size="20" />专项测只覆盖指定维度；没有证据的维度不能当作0分。
          </p>
        </section>
        <section class="help-card rules-card">
          <h2><Save />作答、保存与恢复</h2>
          <ol class="numbered-rules">
            <li v-for="(text, i) in saveRules" :key="text">
              <span>0{{ i + 1 }}</span
              >{{ text }}
            </li>
          </ol>
          <hr />
          <h2><ShieldCheck />评分与数据使用</h2>
          <ol class="numbered-rules">
            <li v-for="(text, i) in scoringRules" :key="text">
              <span>0{{ i + 1 }}</span
              >{{ text }}
            </li>
          </ol>
        </section>
      </div>
      <p class="section-signature">
        —　 AI Measure · 让能力可见，让成长有据　 —<small>2026 数字马力杯 A01</small>
      </p>
    </section>
    <section id="support" class="support-section help-note shell" aria-labelledby="support-title">
      <header class="support-heading">
        <span class="eyebrow">AI Measure · 使用帮助</span>
        <h2 id="support-title">需要进一步<em>帮助？</em></h2>
        <p>了解成长助手的使用边界，让每一次提问更安心。</p>
      </header>
      <div class="contact-strip help-card">
        <p>
          <span class="icon-orb"><Users /></span
          ><strong>联系平台负责人或管理员。</strong>
        </p>
        <p>
          <span class="icon-orb"><ShieldCheck /></span
          >请说明所在页面、操作时间与错误提示；不要提供密码或 API 密钥。
        </p>
      </div>
      <div class="support-grid">
        <section v-for="card in support" :key="card.title" class="help-card support-card">
          <span class="icon-orb"><component :is="card.icon" /></span>
          <div>
            <h3>{{ card.title }}<small v-if="card.pending">待接入</small></h3>
            <ul>
              <li v-for="line in card.lines" :key="line">{{ line }}</li>
            </ul>
            <p v-if="card.warning" class="warning-strip">
              <TriangleAlert :size="30" />{{ card.warning }}
            </p>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
<style scoped>
.help-page {
  color: var(--public-ink);
}
.help-intro.shell,
.support-section.shell {
  width: calc(100% - 12%);
  max-width: 1340px;
}
.help-heading {
  position: relative;
  padding: 23px 65px 26px;
  min-height: 168px;
}
.help-heading h1 {
  font-size: 46px;
  line-height: 1.3;
  letter-spacing: -1px;
  margin: 12px 0;
}
.help-page em {
  font-style: normal;
  color: #0083a1;
}
.help-heading p,
.support-heading p {
  font-size: 17px;
  color: var(--public-copy);
  margin-top: 12px;
}
.guide-art {
  position: absolute;
  right: 5px;
  top: -15px;
  width: 290px;
  pointer-events: none;
  z-index: -1;
  opacity: 0.7;
}
.guide-art :deep(svg) {
  height: 180px;
}
.guide-art > span {
  position: absolute;
  right: 0;
  bottom: 5px;
  font-size: 14px;
  color: #5185a9;
}
.help-card {
  border: 1px solid #ccebf7;
  background: #ffffffdf;
  border-radius: 13px;
  padding: 19px 29px;
}
.help-page h2 {
  font-size: 22px;
  line-height: 1.5;
}
.section-title {
  display: flex;
  gap: 13px;
  align-items: center;
}
.section-title::before {
  content: '';
  width: 4px;
  height: 23px;
  background: #0086a3;
  border-radius: 4px;
}
.start-steps {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 26px;
  margin: 18px 10px 20px;
}
.start-steps li {
  display: flex;
  position: relative;
  gap: 20px;
  padding-right: 18px;
}
.icon-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(120deg, #e7f8fc, #ddf7fc);
  color: #0086a8;
}
.icon-orb svg {
  width: 34px;
  height: 34px;
  stroke-width: 1.8;
}
.step-number {
  font-size: 19px;
  color: #678db0;
  font-weight: 700;
}
.start-steps h3 {
  font-size: 18px;
  margin-bottom: 7px;
}
.start-steps p {
  font-size: 14px;
  line-height: 1.6;
  color: var(--public-copy);
}
.step-arrow {
  position: absolute;
  right: -16px;
  top: 21px;
  color: #6bcee5;
  stroke-width: 1.5;
}
.start-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid #d4e7f2;
  padding-top: 12px;
}
.start-bottom p {
  display: flex;
  gap: 12px;
  align-items: center;
  font-size: 14px;
  color: var(--public-copy);
}
.start-bottom p svg {
  flex: none;
}
.start-bottom a {
  white-space: nowrap;
  font-size: 16px;
}
.help-basics {
  display: grid;
  grid-template-columns: 0.94fr 1.06fr;
  gap: 17px;
  margin-top: 14px;
}
.dimension-description {
  font-size: 14px;
  color: var(--public-copy);
  margin: 6px 0 13px 12px;
}
.dimension-tags {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px 16px;
}
.dimension-tags > span {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: #f0fafc;
  border-radius: 30px;
  padding: 7px 4px;
  font-size: 14px;
}
.dimension-tags svg {
  color: #0096b9;
}
.level-table {
  display: grid;
  gap: 7px;
  margin-top: 15px;
}
.level-table > div {
  display: grid;
  grid-template-columns: 72px 1fr 1.6fr;
  align-items: center;
  border: 1px solid #dceef8;
  border-radius: 9px;
  overflow: hidden;
  min-height: 35px;
  font-size: 13px;
}
.level-table strong {
  height: 100%;
  display: grid;
  place-items: center;
  background: #e2f6fc;
  font-size: 18px;
  color: #008aa8;
}
.level-table b {
  padding-left: 18px;
}
.level-table span {
  color: var(--public-copy);
  padding-right: 8px;
}
.info-strip {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 15px;
  background: #e8f7fb;
  border: 1px solid #c9eaf6;
  border-radius: 9px;
  padding: 10px 14px;
  color: #007e9c;
  font-size: 13px;
}
.info-strip svg {
  flex: none;
}
.rules-card h2 {
  display: flex;
  align-items: center;
  gap: 17px;
}
.rules-card h2 svg {
  color: #0086a3;
  width: 28px;
  height: 28px;
}
.numbered-rules {
  padding: 0;
  list-style: none;
  margin-top: 10px;
  display: grid;
  gap: 7px;
}
.numbered-rules li {
  display: flex;
  align-items: flex-start;
  gap: 17px;
  color: var(--public-copy);
  font-size: 14px;
  line-height: 1.7;
}
.numbered-rules li > span {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  flex: none;
  background: #e5f8fd;
  color: #0084a3;
  border-radius: 50%;
  font-size: 13px;
}
.rules-card hr {
  border: 0;
  border-top: 1px solid #d4e7f2;
  margin: 18px 0;
}
.section-signature {
  text-align: center;
  color: #6488ab;
  font-size: 13px;
  margin: 23px 0 30px;
}
.section-signature small {
  display: block;
  margin-top: 3px;
}
.support-section {
  padding: 22px 0 36px;
}
.support-heading {
  padding: 0 65px 22px;
  position: relative;
}
.support-heading h2 {
  font-size: 49px;
  letter-spacing: -1px;
  line-height: 1.4;
  margin-top: 10px;
}
.support-heading p {
  font-size: 20px;
  margin-top: 0;
}
.contact-strip {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 30px;
  padding: 14px 30px;
}
.contact-strip p {
  display: flex;
  align-items: center;
  gap: 25px;
  font-size: 16px;
  color: var(--public-copy);
}
.contact-strip p:first-child {
  border-right: 1px solid #c3e8f6;
  color: #153e62;
}
.contact-strip strong {
  font-size: 18px;
}
.support-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-top: 16px;
}
.support-card {
  display: flex;
  gap: 22px;
  padding: 18px 23px;
  min-height: 178px;
}
.support-card > div {
  min-width: 0;
}
.support-card h3 {
  font-size: 23px;
  line-height: 1.5;
  margin: 4px 0 11px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}
.support-card h3 small {
  font-size: 14px;
  font-weight: 400;
  color: #50708f;
  border-radius: 20px;
  padding: 3px 17px;
  background: #e9f0f7;
}
.support-card ul {
  padding-left: 22px;
  display: grid;
  gap: 4px;
  color: #506b91;
  font-size: 16px;
  line-height: 1.65;
}
.support-card li::marker {
  color: #12add0;
}
.warning-strip {
  display: flex;
  align-items: center;
  gap: 15px;
  background: #fff7e6;
  border: 1px solid #ffe7b3;
  border-radius: 10px;
  color: #985711;
  font-size: 14px;
  line-height: 1.6;
  padding: 11px 15px;
  margin-top: 11px;
}
.warning-strip svg {
  color: #e99a21;
  flex: none;
}
@media (min-width: 1400px) {
  .help-intro {
    min-height: 930px;
  }
  .help-basics > .help-card {
    min-height: 423px;
  }
  .support-grid > .support-card:nth-child(-n + 2) {
    min-height: 216px;
  }
  .support-section {
    min-height: 880px;
  }
}
@media (max-width: 1200px) {
  .help-heading,
  .support-heading {
    padding-left: 20px;
    padding-right: 20px;
  }
  .help-heading h1 {
    font-size: 38px;
  }
  .guide-art {
    opacity: 0.28;
  }
  .start-steps {
    gap: 18px;
    margin-inline: 0;
  }
  .start-steps li {
    gap: 10px;
    flex-direction: column;
  }
  .step-arrow {
    right: 0;
  }
  .help-card {
    padding: 20px;
  }
  .support-card {
    gap: 15px;
  }
  .support-card h3 {
    font-size: 20px;
  }
  .level-table > div {
    grid-template-columns: 50px 1fr;
  }
  .level-table span {
    grid-column: 2;
    padding-left: 18px;
    padding-bottom: 5px;
  }
  .contact-strip strong {
    font-size: 16px;
  }
  .support-card ul {
    font-size: 14px;
  }
}
@media (max-width: 800px) {
  .help-intro.shell,
  .support-section.shell {
    width: calc(100% - 36px);
  }
  .help-heading,
  .support-heading {
    padding: 25px 0;
  }
  .help-heading h1,
  .support-heading h2 {
    font-size: 32px;
  }
  .help-heading p,
  .support-heading p {
    font-size: 16px;
  }
  .guide-art {
    display: none;
  }
  .start-steps {
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  .start-steps li {
    flex-direction: row;
    padding: 0;
  }
  .step-arrow {
    display: none;
  }
  .start-bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
  }
  .help-basics,
  .support-grid,
  .contact-strip {
    grid-template-columns: 1fr;
  }
  .contact-strip p:first-child {
    border-right: 0;
    border-bottom: 1px solid #c3e8f6;
    padding-bottom: 16px;
  }
  .contact-strip {
    gap: 16px;
  }
  .support-card {
    min-height: auto;
  }
  .dimension-tags {
    gap: 9px;
  }
  .dimension-tags > span {
    font-size: 12px;
    gap: 6px;
  }
  .level-table > div {
    grid-template-columns: 60px 1fr 1.6fr;
  }
  .level-table span {
    grid-column: auto;
    padding: 0 8px;
  }
  .section-signature {
    font-size: 11px;
  }
  .support-section {
    padding-top: 0;
  }
}
@media (max-width: 460px) {
  .help-heading h1 {
    font-size: 29px;
  }
  .start-steps {
    grid-template-columns: 1fr;
  }
  .icon-orb {
    width: 50px;
    height: 50px;
  }
  .icon-orb svg {
    width: 28px;
    height: 28px;
  }
  .start-steps li {
    gap: 17px;
  }
  .dimension-tags {
    grid-template-columns: 1fr 1fr;
  }
  .level-table > div {
    grid-template-columns: 48px 1fr;
  }
  .level-table span {
    grid-column: 2;
    padding: 0 12px 5px 18px;
  }
  .support-card {
    gap: 12px;
    padding: 17px 14px;
  }
  .support-card h3 {
    font-size: 19px;
  }
  .contact-strip p {
    gap: 14px;
    font-size: 14px;
  }
  .help-page h2 {
    font-size: 20px;
  }
  .support-heading h2 {
    font-size: 32px;
  }
  .warning-strip {
    padding: 10px;
    gap: 10px;
  }
}
</style>
