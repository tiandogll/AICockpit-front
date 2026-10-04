<script setup lang="ts">
import { useId } from 'vue'
const artId = useId()
defineProps<{ kind: 'radar' | 'adaptive' | 'process' | 'evidence' | 'guide' }>()
const labels = ['基础认知', '提示词工程', '工具使用', '结果评估', '人机协同', '伦理合规']
function polygon(radius: number) {
  return Array.from(
    { length: 6 },
    (_, i) =>
      `${180 + Math.sin((i * Math.PI) / 3) * radius},${145 - Math.cos((i * Math.PI) / 3) * radius}`,
  ).join(' ')
}
</script>
<template>
  <svg
    class="public-illustration"
    :viewBox="kind === 'radar' || kind === 'guide' ? '0 0 360 290' : '0 25 360 240'"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="`${artId}-paper`" x1="0" y1="0" x2=".7" y2="1">
        <stop stop-color="#fff" />
        <stop offset=".7" stop-color="#f0fcff" />
        <stop offset="1" stop-color="#afeaf7" />
      </linearGradient>
      <linearGradient :id="`${artId}-metal`" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="#fff" />
        <stop offset=".5" stop-color="#b7eaf7" />
        <stop offset=".72" stop-color="#fff" />
        <stop offset="1" stop-color="#68cbe6" />
      </linearGradient>
      <radialGradient :id="`${artId}-glow`">
        <stop stop-color="#a6e7f4" stop-opacity=".5" />
        <stop offset="1" stop-color="#e9faff" stop-opacity="0" />
      </radialGradient>
    </defs>
    <g v-if="kind === 'radar' || kind === 'evidence'" fill="none" stroke="#b1e8f5" stroke-width="1">
      <circle cx="180" cy="145" r="124" stroke-dasharray="2 4" />
      <circle cx="180" cy="145" r="106" opacity=".6" />
    </g>
    <g v-if="kind === 'radar'">
      <polygon
        v-for="r in [22, 44, 66, 88, 110]"
        :key="r"
        :points="polygon(r)"
        fill="none"
        stroke="#9bddee"
        stroke-width=".8"
      />
      <path d="M180 35V255 M85 90L275 200 M85 200L275 90" fill="none" stroke="#b5e9f4" />
      <polygon
        points="180,75 247,106 266,195 180,238 99,192 112,106"
        fill="#b5ecf5"
        fill-opacity=".48"
        stroke="#32b4ce"
      />
      <g v-for="(label, i) in labels" :key="label">
        <circle
          :cx="180 + Math.sin((i * Math.PI) / 3) * 110"
          :cy="145 - Math.cos((i * Math.PI) / 3) * 110"
          r="4"
          fill="#20afcb"
          stroke="white"
        />
        <text
          :x="180 + Math.sin((i * Math.PI) / 3) * 144"
          :y="150 - Math.cos((i * Math.PI) / 3) * 132"
          text-anchor="middle"
        >
          {{ label }}
        </text>
      </g>
    </g>
    <g v-else-if="kind === 'adaptive'" fill="none">
      <path
        d="M40 50V225H285 M40 190H280 M40 155H280 M40 120H280 M40 85H280 M80 60V225 M120 60V225 M160 60V225 M200 60V225 M240 60V225"
        stroke="#daf1f8"
      />
      <path d="M40 48V225H285 M36 54L40 48L44 54 M278 221L285 225L278 229" stroke="#6fd3e8" />
      <path
        d="M40 217L67 195L100 180L137 164L179 135L231 107Q270 141 332 102"
        stroke="#2fb7d0"
        stroke-dasharray="4 4"
      />
      <g fill="#21aec8" stroke="white">
        <circle cx="67" cy="195" r="5" />
        <circle cx="100" cy="180" r="5" />
        <circle cx="137" cy="164" r="5" />
        <circle cx="231" cy="107" r="7" />
      </g>
      <circle cx="179" cy="135" r="5" stroke="#008daf" stroke-width="2" fill="white" />
      <circle cx="231" cy="107" r="15" stroke="#e9edb3" />
      <rect x="207" y="51" width="88" height="29" rx="6" fill="#e7f7fb" />
      <text x="219" y="71">下一个题目</text>
      <rect x="220" y="144" width="133" height="80" rx="13" fill="#eaf8fb" />
      <text x="236" y="174">▥ 能力更新</text>
      <text x="236" y="204">☷ 约束选题</text>
      <text x="0" y="134" font-size="11">能力估计</text>
      <text x="155" y="247">题目难度</text>
    </g>
    <g v-else-if="kind === 'process'" fill="none" stroke="#00a0c3">
      <path
        d="M9 105C18 12 116 46 126 123C140 189 233 195 251 117C263 39 348 55 357 113"
        stroke="#9adff0"
        stroke-width=".7"
        stroke-dasharray="2 3"
      />
      <g fill="#4ecce6" stroke="white">
        <circle cx="58" cy="65" r="3" />
        <circle cx="237" cy="70" r="3" />
        <circle cx="304" cy="66" r="3" />
      </g>
      <g v-for="x in [55, 180, 305]" :key="x">
        <circle :cx="x" cy="127" r="49" stroke="#b6e9f4" />
        <circle :cx="x" cy="127" r="40" stroke="#8addf0" />
        <circle :cx="x" cy="127" r="32" fill="#edfaff" />
      </g>
      <path
        d="M44 114H59L66 121V141H44Z M59 114V122H66 M49 127H60 M49 133H60 M115 127H137L130 121 M137 127L130 133 M237 127H260L253 121 M260 127L253 133 M291 128L301 138L321 116"
        stroke-width="2.5"
      />
      <circle cx="180" cy="127" r="13" stroke-width="3" />
      <path
        d="M180 108V114 M180 140V147 M160 127H166 M194 127H200 M166 113L171 118 M190 136L195 141 M166 141L171 136 M190 118L195 113"
        stroke-width="3"
      />
      <text x="55" y="190" text-anchor="middle">提示词迭代</text>
      <text x="180" y="190" text-anchor="middle">核验</text>
      <text x="305" y="190" text-anchor="middle">改进</text>
      <rect x="8" y="213" width="344" height="48" rx="13" stroke="none" fill="#edf8fb" />
      <text x="45" y="243">▤ 提示词迭代</text>
      <path d="M180 226V249" stroke="#afe0ef" />
      <text x="220" y="243">⚒ 实操记录</text>
    </g>
    <g v-else-if="kind === 'evidence'" fill="none" stroke="#2ab7d5">
      <rect x="60" y="58" width="135" height="172" rx="6" fill="#effbff" />
      <path d="M80 82H131 M80 96H165" stroke="#9de5f2" stroke-width="5" stroke-linecap="round" />
      <g v-for="y in [120, 152, 184]" :key="y">
        <rect x="80" :y="y" width="15" height="15" rx="2" />
        <path :d="`M83 ${y + 7}L87 ${y + 11}L96 ${y + 1}`" stroke-width="2" />
        <path :d="`M105 ${y + 4}H164 M105 ${y + 14}H147`" stroke="#b0e9f4" stroke-width="4" />
      </g>
      <path d="M195 100L264 85V182H219" stroke-dasharray="3 4" />
      <circle
        cx="186"
        cy="157"
        r="27"
        fill="#d6f5fc"
        fill-opacity=".8"
        stroke="#008ba9"
        stroke-width="5"
      />
      <path d="M205 179L229 204" stroke="#008ba9" stroke-width="9" stroke-linecap="round" />
      <rect x="250" y="66" width="107" height="38" rx="10" fill="#ecf8fb" stroke="none" />
      <text x="260" y="90">▤ 证据引用</text>
      <rect x="250" y="166" width="107" height="38" rx="10" fill="#ecf8fb" stroke="none" />
      <text x="260" y="190">♙ 人工复核</text>
    </g>
    <g v-else fill="none" stroke="#83d7ee">
      <ellipse cx="184" cy="218" rx="164" ry="60" :fill="`url(#${artId}-glow)`" stroke="none" />
      <g transform="translate(-1 10) rotate(20 235 90)">
        <ellipse cx="240" cy="92" rx="56" ry="60" fill="#bdeef9" opacity=".5" stroke="none" />
        <circle cx="235" cy="87" r="57" :fill="`url(#${artId}-metal)`" stroke-width="1.4" />
        <circle cx="235" cy="87" r="51" fill="#f3fcff" stroke-width="1.5" />
        <circle cx="235" cy="87" r="45" stroke="#b4e8f5" />
        <path
          v-for="angle in [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]"
          :key="angle"
          d="M235 45V49"
          :transform="`rotate(${angle} 235 87)`"
          stroke-width="1.2"
        />
        <path
          d="M207 58L231 79L260 116L239 93Z M208 113L228 86L263 59L241 90Z"
          fill="#c5f0fa"
          stroke-width=".6"
        />
        <path d="M235 36L246 83L235 133L224 89Z" fill="#a4e7f6" />
        <path d="M198 87L232 77L272 87L238 98Z" fill="#d7f6ff" />
        <path d="M235 41L235 87L246 83Z" fill="#34b6d3" />
        <circle cx="235" cy="19" r="9" :fill="`url(#${artId}-metal)`" />
        <circle cx="235" cy="19" r="5" fill="#f0fcff" />
        <path d="M232 25V32 M238 25V32" stroke-width="2" />
      </g>
      <path
        d="M37 179Q93 139 168 193Q224 155 288 183L254 240Q205 224 168 249Q101 218 37 223Z"
        :fill="`url(#${artId}-paper)`"
        stroke-width="2"
      />
      <path
        d="M42 169Q99 132 168 185Q213 153 280 177L251 225Q205 209 168 239Q106 207 42 213Z"
        :fill="`url(#${artId}-paper)`"
      />
      <path
        d="M42 169Q117 167 166 199Q149 152 85 137Q128 127 168 185Q151 123 109 118Q151 117 172 185"
        :fill="`url(#${artId}-paper)`"
        stroke="#afe7f4"
      />
      <path
        d="M48 215Q106 213 168 242Q207 215 253 229 M48 219Q106 217 168 247Q207 220 253 234"
        stroke="#a5e0ef"
        stroke-width=".8"
      />
      <path
        d="M168 185V239 M56 180Q106 157 153 192 M56 191Q106 170 153 204 M56 203Q106 184 153 218 M181 190Q220 172 264 182 M181 203Q218 184 257 194 M181 217Q214 197 251 207"
      />
    </g>
  </svg>
</template>
<style scoped>
.public-illustration {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}
.public-illustration text {
  font:
    13px 'Microsoft YaHei',
    sans-serif;
  fill: #487894;
  stroke: none;
}
</style>
