<script setup lang="ts">
import { ArrowRight, CheckCircle2, Compass, ScanSearch, ShieldCheck, Sparkles } from '@lucide/vue'
import { DIMENSIONS } from '../domain/capabilities'
import PublicIllustration from '../components/ReferenceArtwork.vue'

const examples = [
  { score: 72, note: '模型边界与基本概念' },
  { score: 84, note: '指令、上下文与任务拆解' },
  { score: 79, note: '跨工具选择与组合' },
  { score: 58, note: '幻觉识别与事实核验' },
  { score: 76, note: '反馈、迭代与整合' },
  { score: 68, note: '隐私、版权与责任' },
]
const dimensions = DIMENSIONS.map((dimension, index) => ({
  ...dimension,
  ...examples[index]!,
  marker: String(index + 1).padStart(2, '0'),
}))

const methods = [
  {
    icon: Compass,
    title: '自适应选题',
    text: '根据实时能力估计，在维度覆盖、题型与难度约束下选择下一题。',
  },
  {
    icon: ScanSearch,
    title: '过程性测评',
    text: '记录提示词迭代、结果核验与工具选择，不只看最终答案。',
  },
  {
    icon: ShieldCheck,
    title: '证据化评分',
    text: '在报告中查看测量说明、回答证据及复核状态。',
  },
]
</script>

<template>
  <section class="hero shell">
    <div class="hero-copy">
      <span class="eyebrow">AI Measure · AI能力测评与成长平台</span>
      <h1 class="display-title" data-testid="hero-title">
        测出你与AI<br /><em>真正协作的能力</em>
      </h1>
      <p class="hero-lead">
        一次有证据的AI能力数字体检。系统通过客观题、对话和真实任务，定位六维能力，给出可信画像与下一步成长路径。
      </p>
      <div class="hero-actions">
        <RouterLink
          class="primary-button"
          data-testid="start-standard"
          to="/assessment?mode=standard"
        >
          开始标准测评 <ArrowRight :size="18" />
        </RouterLink>
        <a class="secondary-button" href="#method">查看测评方法</a>
      </div>
      <div class="proof-row" aria-label="产品特点">
        <span><CheckCircle2 :size="16" /> 六维能力模型</span>
        <span><CheckCircle2 :size="16" /> 自适应按证据选题</span>
        <span><CheckCircle2 :size="16" /> 评分证据可追溯</span>
      </div>
      <div class="hero-radar">
        <PublicIllustration kind="radar" /><span class="radar-caption"
          >MEASURE<br />LEARN<br />GROW<br />—</span
        >
      </div>
    </div>

    <div class="atlas-card" aria-label="六维AI能力示例画像">
      <div class="atlas-header">
        <div>
          <span class="status-dot"></span>
          示例能力坐标 · 非个人测评结果
        </div>
        <strong>L3 · 协同解决</strong>
      </div>
      <div class="dimension-list">
        <article
          v-for="item in dimensions"
          :key="item.code"
          class="dimension-row"
          :class="{ 'is-focus': item.code === 'evaluation' }"
        >
          <span class="dimension-code">{{ item.marker }}</span>
          <div class="dimension-copy">
            <div>
              <strong>{{ item.name }}</strong
              ><small>{{ item.note }}</small>
            </div>
            <div class="meter"><i :style="{ width: `${item.score}%` }"></i></div>
          </div>
          <b>{{ item.score }}</b>
        </article>
      </div>
      <div class="atlas-footer">
        <Sparkles :size="18" />
        <p>
          <strong>示例建议</strong>：工具使用熟练，但事实核验行为不足，建议优先训练结果评估能力。
        </p>
      </div>
    </div>
    <p class="hero-signature">—　 AI Measure · 让能力可见，让成长有据　 —</p>
  </section>

  <section id="method" class="signal-band">
    <div class="shell signal-grid">
      <div><strong>6</strong><span>核心能力维度</span></div>
      <div>
        <strong>3</strong><span>互补题型<small>客观 · 对话 · 实操</small></span>
      </div>
      <div><strong>版本化</strong><span>题目与测评蓝图</span></div>
      <div><strong>可复核</strong><span>保留评分依据</span></div>
    </div>
  </section>

  <section class="method shell">
    <div class="section-heading">
      <div>
        <span class="eyebrow">Method, not guesswork</span>
        <h2>能力不是自评出来的，<br /><em>是被行为证明的。</em></h2>
      </div>
      <p>AI Measure 同时关注“你知道什么”与“你如何使用、如何质疑、如何改进”。</p>
    </div>
    <div class="method-grid">
      <article v-for="(item, index) in methods" :key="item.title" class="method-card surface">
        <PublicIllustration
          :kind="index === 0 ? 'adaptive' : index === 1 ? 'process' : 'evidence'"
        />
        <span>0{{ index + 1 }}</span>
        <h3>{{ item.title }}</h3>
        <p>{{ item.text }}</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 52px;
  padding-top: 54px;
  padding-bottom: 54px;
  color: var(--text);
}
.display-title {
  margin-top: 18px;
  color: var(--text);
  font-family: inherit;
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.03em;
}
.display-title em {
  font-style: normal;
  color: var(--signal-dark);
}
.display-title em::after {
  display: none;
}
.hero-lead {
  max-width: 560px;
  margin-top: 22px;
  font-size: 15px;
  line-height: 1.95;
  color: var(--muted);
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 26px;
}
.proof-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 24px;
  color: var(--muted);
  font-size: 12px;
}
.proof-row span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.proof-row svg {
  color: var(--signal-dark);
}
.atlas-card {
  padding: 25px;
  border: 1px solid var(--line);
  border-radius: 18px;
  background: var(--paper-strong);
  box-shadow: var(--shadow);
}
.atlas-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 12px;
}
.atlas-header > div {
  display: flex;
  align-items: center;
  gap: 8px;
}
.atlas-header strong {
  color: var(--signal-dark);
  font-size: 12px;
}
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--signal-dark);
  flex: none;
}
.dimension-list {
  padding: 10px 0;
}
.dimension-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 28px;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
}
.dimension-code {
  font-size: 12px;
  color: var(--muted);
}
.dimension-copy > div:first-child {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.dimension-copy strong {
  font-size: 14px;
  font-weight: 600;
}
.dimension-copy small {
  font-size: 12px;
  color: var(--muted);
}
.dimension-row b {
  font-size: 14px;
  font-weight: 650;
  color: var(--signal-dark);
  text-align: right;
}
.meter {
  height: 5px;
  margin-top: 8px;
  border-radius: 99px;
  background: var(--mist);
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--signal-dark);
}
.atlas-footer {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 15px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--mist);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.9;
}
.atlas-footer svg {
  flex: none;
  color: var(--signal-dark);
  margin-top: 3px;
}
.atlas-footer strong {
  color: var(--text);
}
.signal-band {
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  background: var(--mist);
}
.signal-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  min-height: 105px;
  align-items: center;
}
.signal-grid > div {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 15px 20px;
  border-right: 1px solid var(--line);
}
.signal-grid > div:last-child {
  border-right: 0;
}
.signal-grid strong {
  font-size: 25px;
  color: var(--signal-dark);
  font-weight: 700;
}
.signal-grid span {
  font-size: 12px;
  color: var(--muted);
}
.method {
  padding-top: 54px;
  padding-bottom: 64px;
}
.section-heading {
  display: grid;
  grid-template-columns: 1.1fr 1fr;
  align-items: end;
  gap: 45px;
}
.section-heading h2 {
  margin-top: 13px;
  color: var(--text);
  font-size: 28px;
  font-weight: 700;
  line-height: 1.45;
  letter-spacing: -0.035em;
}
.section-heading > p {
  color: var(--muted);
  font-size: 14px;
  line-height: 1.9;
}
.method-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
  margin-top: 28px;
}
.method-card {
  position: relative;
  padding: 25px;
  background: var(--paper-strong);
}
.method-card > svg {
  color: var(--signal-dark);
}
.method-card > span {
  position: absolute;
  top: 25px;
  right: 25px;
  color: var(--muted);
  font-size: 12px;
}
.method-card h3 {
  margin-top: 25px;
  color: var(--text);
  font-size: 20px;
  font-weight: 650;
}
.method-card p {
  margin-top: 12px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--muted);
}
@media (max-width: 1000px) {
  .hero {
    gap: 30px;
  }
  .dimension-copy > div:first-child {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
  .signal-grid > div {
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .section-heading {
    gap: 25px;
  }
}
@media (max-width: 740px) {
  .hero {
    grid-template-columns: 1fr;
    gap: 28px;
    padding-top: 32px;
    padding-bottom: 32px;
  }
  .atlas-card {
    max-width: 600px;
  }
  .dimension-copy > div:first-child {
    align-items: baseline;
    flex-direction: row;
  }
  .signal-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-top: 12px;
    padding-bottom: 12px;
  }
  .signal-grid > div:nth-child(2) {
    border-right: 0;
  }
  .section-heading {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .method-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .method {
    padding-top: 36px;
    padding-bottom: 42px;
  }
  .method-card {
    padding: 24px;
  }
  .method-card h3 {
    margin-top: 19px;
  }
}
@media (max-width: 450px) {
  .display-title,
  .section-heading h2 {
    font-size: 26px;
  }
  .atlas-card {
    padding: 18px;
  }
  .dimension-copy > div:first-child {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
  }
  .hero-actions {
    flex-direction: column;
    align-items: stretch;
  }
  .hero-actions a {
    justify-content: center;
  }
  .proof-row {
    gap: 10px;
  }
  .dimension-row {
    grid-template-columns: 20px minmax(0, 1fr) 27px;
    gap: 8px;
  }
}
</style>
<style scoped>
.hero {
  position: relative;
  grid-template-columns: minmax(0, 0.98fr) minmax(0, 1.02fr);
  gap: 38px;
  align-items: start;
  min-height: 895px;
  padding-top: 54px;
  padding-bottom: 80px;
}
.hero-copy {
  padding-top: 26px;
  position: relative;
}
.hero-copy::before {
  content: '';
  position: absolute;
  inset: 70px 15px 120px -50px;
  border: 1px dashed #a6e6f7;
  border-radius: 50%;
  pointer-events: none;
  z-index: -1;
  transform: rotate(-25deg);
}
.display-title {
  font-size: clamp(46px, 4.55vw, 74px);
  line-height: 1.25;
  letter-spacing: -2.5px;
  font-weight: 800;
  margin: 31px 0 19px;
  color: var(--public-ink);
}
.display-title em,
.section-heading em {
  font-style: normal;
  color: #007b96;
}
.hero-lead {
  max-width: 630px;
  color: var(--public-copy);
  font-size: 20px;
  line-height: 1.75;
  margin-top: 0;
}
.hero-actions {
  gap: 18px;
  margin-top: 30px;
}
.hero-actions a {
  font-size: 21px;
  min-height: 62px;
  padding-inline: 32px;
}
.proof-row {
  gap: 25px;
  margin-top: 28px;
  color: var(--public-copy);
  font-size: 16px;
}
.proof-row span {
  gap: 10px;
}
.proof-row svg {
  color: #007b96;
  width: 25px;
  height: 25px;
  flex: none;
}
.hero-radar {
  width: 355px;
  margin: 19px 0 0 105px;
  position: relative;
}
.radar-caption {
  position: absolute;
  left: -150px;
  bottom: 25px;
  font-size: 12px;
  line-height: 1.8;
  letter-spacing: 1px;
  color: #4ba9cd;
}
.hero-signature {
  position: absolute;
  bottom: 29px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 15px;
  color: #5a84aa;
}
.atlas-card {
  background: #ffffffee;
  border: 1px solid #c8eaf6;
  border-radius: 20px;
  padding: 25px 29px 23px;
  box-shadow: 0 12px 36px #64c9e31c;
}
.atlas-header {
  flex-wrap: nowrap;
  gap: 12px;
  border-bottom: 1px solid #d7edf4;
  padding-bottom: 19px;
  color: var(--public-copy);
  font-size: 16px;
}
.atlas-header > div {
  gap: 12px;
}
.status-dot {
  width: 9px;
  height: 9px;
  background: #0083a2;
}
.atlas-header strong {
  font-size: 17px;
  color: #0083a2;
  background: #e7f8fb;
  border-radius: 30px;
  padding: 8px 18px;
  white-space: nowrap;
}
.dimension-list {
  padding: 10px 0 20px;
}
.dimension-row {
  grid-template-columns: 36px minmax(0, 1fr) 42px;
  gap: 15px;
  min-height: 81px;
  padding: 12px 0;
}
.dimension-code {
  font-size: 17px;
  color: #567993;
}
.dimension-copy > div:first-child {
  gap: 12px;
}
.dimension-copy strong {
  font-size: 19px;
  color: var(--public-ink);
  white-space: nowrap;
}
.dimension-copy small {
  font-size: 16px;
  color: var(--public-copy);
}
.dimension-row b {
  font-size: 21px;
  color: #0087a2;
}
.meter {
  height: 7px;
  background: #e9f3f6;
  margin-top: 11px;
}
.meter i {
  background: #008ba6;
}
.is-focus {
  background: #fff8eb;
  border-radius: 14px;
  margin-inline: -12px;
  padding-inline: 12px;
}
.is-focus b {
  color: #b47a10;
}
.is-focus .meter i {
  background: #e5ab35;
}
.atlas-footer {
  gap: 15px;
  align-items: center;
  border: 1px solid #d1edf5;
  border-radius: 13px;
  background: #e7f5f8;
  padding: 20px 17px;
  color: var(--public-copy);
  font-size: 16px;
  line-height: 1.8;
}
.atlas-footer svg {
  color: #0089a6;
  width: 28px;
  height: 28px;
}
.atlas-footer strong {
  color: #0b4058;
}
.signal-band {
  border-block: 1px solid #ceeaf4;
  background: #e9f8fb70;
}
.signal-grid {
  min-height: 111px;
}
.signal-grid > div {
  gap: 20px;
  align-items: center;
  border-right: 1px solid #cde6ef;
  padding: 9px 15px;
  min-height: 73px;
}
.signal-grid strong {
  font-size: 35px;
  color: #006f8a;
  white-space: nowrap;
}
.signal-grid > div:nth-child(-n + 2) strong {
  font-size: 48px;
}
.signal-grid span {
  font-size: 16px;
  color: var(--public-copy);
}
.signal-grid small {
  display: block;
  margin-top: 5px;
}
.method {
  padding: 43px 20px 60px;
}
.section-heading {
  grid-template-columns: 1fr 1fr;
  gap: 50px;
}
.section-heading h2 {
  font-size: 48px;
  letter-spacing: -1px;
  line-height: 1.35;
  margin-top: 23px;
  color: var(--public-ink);
}
.section-heading p {
  font-size: 18px;
  line-height: 1.8;
  color: var(--public-copy);
  padding-bottom: 9px;
}
.method-grid {
  gap: 18px;
  margin-top: 32px;
}
.method-card {
  border: 1px solid #d0edf7;
  background: #ffffffd9;
  border-radius: 18px;
  padding: 20px 28px 27px;
  box-shadow: none;
}
.method-card > span {
  top: 25px;
  left: 28px;
  right: auto;
  color: var(--public-copy);
  font-size: 17px;
}
.method-card :deep(svg) {
  height: 255px;
  margin: 6px 0 10px;
}
.method-card h3 {
  font-size: 26px;
  margin: 0 0 9px;
  color: var(--public-ink);
}
.method-card p {
  font-size: 18px;
  line-height: 1.6;
  color: var(--public-copy);
  margin: 0;
}
@media (max-width: 1200px) {
  .hero {
    gap: 25px;
    min-height: auto;
  }
  .proof-row {
    gap: 12px;
  }
  .hero-lead {
    font-size: 18px;
  }
  .dimension-copy small {
    font-size: 13px;
  }
  .atlas-card {
    padding: 22px;
  }
  .atlas-header {
    font-size: 13px;
  }
  .hero-actions a {
    font-size: 17px;
    padding-inline: 20px;
  }
  .hero-radar {
    margin-left: 65px;
  }
  .radar-caption {
    left: -65px;
  }
  .section-heading h2 {
    font-size: 38px;
  }
  .method-card {
    padding: 18px;
  }
  .method-card p {
    font-size: 16px;
  }
}
@media (max-width: 959px) {
  .hero {
    grid-template-columns: 1fr;
    padding-top: 30px;
    padding-bottom: 70px;
  }
  .hero-copy {
    padding-top: 0;
  }
  .hero-radar {
    width: 280px;
    margin: 20px auto;
  }
  .atlas-card {
    max-width: 700px;
    width: 100%;
    margin: auto;
  }
  .display-title {
    font-size: 56px;
  }
  .section-heading {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .method-grid {
    grid-template-columns: 1fr;
  }
  .method-card :deep(svg) {
    height: 220px;
  }
  .signal-grid {
    grid-template-columns: 1fr 1fr;
  }
  .signal-grid > div:nth-child(2) {
    border: 0;
  }
  .method {
    padding-inline: 0;
  }
  .method-card h3 {
    font-size: 24px;
  }
}
@media (max-width: 560px) {
  .display-title {
    font-size: 38px;
    letter-spacing: -1px;
  }
  .hero-lead {
    font-size: 16px;
  }
  .hero-actions {
    gap: 10px;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .hero-actions a {
    font-size: 16px;
    min-height: 49px;
    padding-inline: 16px;
  }
  .proof-row {
    font-size: 13px;
  }
  .hero-radar {
    width: 260px;
  }
  .radar-caption {
    display: none;
  }
  .atlas-card {
    padding: 18px 14px;
  }
  .atlas-header {
    gap: 8px;
    flex-wrap: wrap;
  }
  .atlas-header strong {
    font-size: 14px;
  }
  .dimension-row {
    grid-template-columns: 24px minmax(0, 1fr) 28px;
    gap: 8px;
  }
  .dimension-copy > div:first-child {
    flex-direction: column;
    gap: 4px;
  }
  .dimension-copy strong {
    font-size: 16px;
  }
  .dimension-row b {
    font-size: 18px;
  }
  .atlas-footer {
    font-size: 14px;
    padding: 14px 10px;
  }
  .hero-signature {
    font-size: 11px;
  }
  .signal-grid > div {
    flex-direction: column;
    gap: 5px;
    text-align: center;
  }
  .signal-grid strong,
  .signal-grid > div:nth-child(-n + 2) strong {
    font-size: 28px;
  }
  .signal-grid span {
    font-size: 13px;
  }
  .section-heading h2 {
    font-size: 29px;
  }
  .section-heading p {
    font-size: 16px;
  }
}
</style>
