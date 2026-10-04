<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { X } from '@lucide/vue'
import GrowthAssistantEntry from './GrowthAssistantEntry.vue'
import robotUrl from '../assets/growth-robot-user.png'
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useRoute } from 'vue-router'
import { useFeatureStore } from '../stores/features'

defineProps<{ name: string }>()
const access = useAccessStore()
const auth = useAuthStore()
const route = useRoute()
const features = useFeatureStore()
const position = ref({ x: 0, y: 0 })
const viewportWidth = ref(window.innerWidth)
const manuallyPositioned = ref(false)
const mobileHeaderDock = computed(
  () =>
    viewportWidth.value <= 600 &&
    /^(?:\/assessment\/[^/?#]+|\/(?:reports?|training|pilot-lab)(?:[/?#]|$))/.test(route.fullPath),
)
const displayPosition = computed(() =>
  mobileHeaderDock.value && !manuallyPositioned.value
    ? { x: viewportWidth.value - 56, y: 8 }
    : position.value,
)
const initialized = ref(false)
let drag: { x: number; y: number; left: number; top: number; moved: boolean } | null = null
let suppressClick = false
function clampPosition() {
  // Minimized windows and full-page capture can briefly report a zero viewport.
  if (innerWidth <= 0 || innerHeight <= 0) return
  const width = group.value?.offsetWidth || (mobileHeaderDock.value ? 48 : 140)
  const height = group.value?.offsetHeight || (mobileHeaderDock.value ? 48 : 170)
  position.value = {
    x: Math.max(8, Math.min(innerWidth - width - 8, position.value.x)),
    y: Math.max(8, Math.min(innerHeight - height - 8, position.value.y)),
  }
}
function dragStart(event: PointerEvent) {
  if (event.button !== 0) return
  drag = {
    x: event.clientX,
    y: event.clientY,
    left: displayPosition.value.x,
    top: displayPosition.value.y,
    moved: false,
  }
  launcher.value?.setPointerCapture(event.pointerId)
}
function dragMove(event: PointerEvent) {
  if (!drag) return
  const dx = event.clientX - drag.x,
    dy = event.clientY - drag.y
  if (Math.hypot(dx, dy) > 6) drag.moved = true
  if (!drag.moved) return
  manuallyPositioned.value = true
  position.value = { x: drag.left + dx, y: drag.top + dy }
  clampPosition()
}
function dragEnd() {
  if (!drag) return
  suppressClick = Boolean(drag?.moved)
  drag = null
}
function clickLauncher() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  void open()
}
function moveByKey(event: KeyboardEvent) {
  const movement: Record<string, [number, number]> = {
    ArrowLeft: [-24, 0],
    ArrowRight: [24, 0],
    ArrowUp: [0, -24],
    ArrowDown: [0, 24],
  }
  const delta = movement[event.key]
  if (!delta) return
  event.preventDefault()
  position.value = { x: displayPosition.value.x + delta[0], y: displayPosition.value.y + delta[1] }
  manuallyPositioned.value = true
  clampPosition()
}
function resize() {
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return
  viewportWidth.value = window.innerWidth
  void nextTick(clampPosition)
}
watch(mobileHeaderDock, () => {
  manuallyPositioned.value = false
  void nextTick(clampPosition)
})
const dialog = ref<HTMLDialogElement>()
const launcher = ref<HTMLButtonElement>()
const group = ref<HTMLElement>()
const opened = ref(false)
let previousOverflow = ''
let returnFocus: HTMLElement | null = null
let opening = false
let contextGeneration = 0
async function open() {
  if (!dialog.value || opened.value || opening || !auth.isAuthenticated || !auth.user?.id) return
  const actor = auth.user.id,
    path = route.fullPath,
    ticket = contextGeneration
  opening = true
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  void features.load(true)
  try {
    // Loading scope during /auth/me changes RouterView's key and interrupts login.
    // Resolve it only on explicit use, before showing a drawer that scope changes close.
    if (!access.ready) await access.load()
    await nextTick()
    if (
      ticket !== contextGeneration ||
      actor !== auth.user?.id ||
      !auth.isAuthenticated ||
      path !== route.fullPath ||
      !dialog.value
    )
      return
    previousOverflow = document.body.style.overflow
    dialog.value.showModal()
    document.body.style.overflow = 'hidden'
    opened.value = true
  } finally {
    opening = false
  }
}
function finishClose() {
  if (!opened.value) return
  opened.value = false
  document.body.style.overflow = previousOverflow
  if (returnFocus?.isConnected && returnFocus !== document.body) returnFocus.focus()
  else launcher.value?.focus()
}
function close() {
  if (!opened.value) return
  dialog.value?.close()
  finishClose()
}
defineExpose({ open })
watch(() => access.organizationId, close)
watch(
  () => [route.fullPath, auth.user?.id, auth.isAuthenticated],
  () => {
    contextGeneration += 1
    close()
  },
  { flush: 'sync' },
)
watch(
  () => [auth.isAuthenticated, auth.user?.id] as const,
  ([authenticated, actor]) => {
    if (!authenticated || !actor) return
    void features.load()
  },
  { immediate: true },
)
onMounted(() => {
  position.value = { x: innerWidth - 156, y: innerHeight - 240 }
  clampPosition()
  initialized.value = true
  window.addEventListener('resize', resize)
})
onBeforeUnmount(() => {
  contextGeneration += 1
  window.removeEventListener('resize', resize)
  if (opened.value) document.body.style.overflow = previousOverflow
})
</script>

<template>
  <div
    ref="group"
    class="workspace-assistant"
    :class="{ 'is-left': displayPosition.x < 310, 'mobile-header-dock': mobileHeaderDock }"
    :style="{
      left: `${displayPosition.x}px`,
      top: `${displayPosition.y}px`,
      visibility: initialized ? 'visible' : 'hidden',
    }"
  >
    <button
      ref="launcher"
      class="assistant-launcher"
      aria-label="打开成长助手问答"
      aria-haspopup="dialog"
      :aria-expanded="opened"
      aria-controls="workspace-assistant-dialog"
      title="点击问答；拖动移动位置；方向键微调"
      @pointerdown="dragStart"
      @pointermove="dragMove"
      @pointerup="dragEnd"
      @pointercancel="dragEnd"
      @lostpointercapture="dragEnd"
      @keydown="moveByKey"
      @click="clickLauncher"
    >
      <span class="assistant-float">
        <span class="assistant-bubble">
          <span class="assistant-greeting">你好，{{ name }}</span>
          <strong>今天需要我帮你做点什么吗？</strong>
          <span class="assistant-invitation">点击机器人，和我聊聊</span>
        </span>
        <span class="assistant-robot" data-testid="assistant-image-slot"
          ><img :src="robotUrl" alt="" width="140" height="140"
        /></span>
      </span>
    </button>
    <Teleport to="body">
      <dialog
        id="workspace-assistant-dialog"
        ref="dialog"
        class="assistant-dialog"
        aria-labelledby="assistant-dialog-title"
        @cancel.prevent="close"
        @close="finishClose"
        @click="$event.target === dialog && close()"
      >
        <div class="assistant-dialog-surface">
          <header class="assistant-dialog-header">
            <img :src="robotUrl" alt="" width="48" height="48" />
            <div>
              <h2 id="assistant-dialog-title">成长助手</h2>
              <p>测评使用 · 报告解读 · 训练建议</p>
            </div>
            <button autofocus aria-label="关闭成长助手问答" @click="close"><X :size="22" /></button>
          </header>
          <div class="assistant-dialog-body"><GrowthAssistantEntry embedded /></div>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.workspace-assistant {
  position: fixed;
  z-index: 90;
  min-width: 0;
  width: 140px;
  align-self: center;
}
.assistant-launcher {
  touch-action: none;
  user-select: none;
  display: block;
  width: 100%;
  border: 0;
  padding: 8px 0;
  background: none;
  text-align: center;
  cursor: pointer;
  color: #208c9c;
  border-radius: 20px;
}
.assistant-float {
  display: flex;
  align-items: center;
  animation: assistant-float 4.8s ease-in-out infinite;
}
.assistant-bubble {
  position: absolute;
  right: 140px;
  width: 260px;
  bottom: 25px;
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 9px;
  padding: 17px 18px;
  border: 1px solid #d7ebef;
  border-radius: 22px;
  background: #ffffffd9;
  box-shadow: 0 12px 28px #267f9210;
  text-wrap: balance;
}
.assistant-bubble::after {
  content: '';
  position: absolute;
  right: -7px;
  bottom: 32px;
  width: 14px;
  height: 14px;
  transform: rotate(45deg);
  background: #fff;
  border-top: 1px solid #d7ebef;
  border-right: 1px solid #d7ebef;
  border-radius: 0 4px 0 0;
}
.is-left .assistant-bubble {
  right: auto;
  left: 140px;
}
.is-left .assistant-bubble::after {
  right: auto;
  left: -7px;
  transform: rotate(225deg);
}
.assistant-launcher:not(:hover):not(:focus-visible) .assistant-bubble {
  opacity: 0;
  pointer-events: none;
}
.assistant-bubble {
  transition: opacity 180ms ease-out;
}
.assistant-robot img {
  pointer-events: none;
  -webkit-user-drag: none;
}
.assistant-greeting {
  font-size: clamp(17px, 1.4vw, 23px);
  color: #47aabd;
}
.assistant-bubble strong {
  font-size: clamp(18px, 1.55vw, 26px);
  line-height: 1.45;
}
.assistant-invitation {
  font-size: 12px;
  color: #557b85;
}
.assistant-robot {
  width: 132px;
  flex-shrink: 0;
  filter: drop-shadow(0 12px 9px #727ed426);
}
.assistant-robot img {
  display: block;
  width: 100%;
  height: auto;
  transform: rotate(-3deg);
  transition: transform 180ms ease-out;
}
.assistant-launcher:hover .assistant-robot img {
  transform: rotate(3deg) scale(1.04);
}
.assistant-launcher:focus-visible {
  outline: 3px solid #137f91;
  outline-offset: 4px;
}
@keyframes assistant-float {
  0%,
  100% {
    transform: translateY(3px);
  }
  50% {
    transform: translateY(-5px);
  }
}
.assistant-dialog {
  position: fixed;
  inset: 0;
  margin: 0 0 0 auto;
  width: min(1120px, 94vw);
  max-width: none;
  max-height: 100dvh;
  height: 100dvh;
  padding: 0;
  border: 1px solid #c5e1e7;
  border-radius: 24px 0 0 24px;
  background: #f5fafc;
  color: #183b46;
  box-shadow: 0 26px 80px #183b4640;
}
.assistant-dialog[open] {
  animation: assistant-open 220ms ease-out;
}
.assistant-dialog::backdrop {
  background: #12374555;
  backdrop-filter: blur(3px);
}
.assistant-dialog-surface {
  display: flex;
  flex-direction: column;
  max-height: 100dvh;
  height: 100%;
}
.assistant-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 28px;
  border-bottom: 1px solid #dcecf0;
  background: #ecf8fb;
  flex-shrink: 0;
}
.assistant-dialog-header h2 {
  margin: 0;
  font-size: 24px;
}
.assistant-dialog-header p {
  margin: 3px 0 0;
  font-size: 14px;
  color: #5d727a;
}
.assistant-dialog-header button {
  margin-left: auto;
  width: 44px;
  height: 44px;
  padding: 8px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 10px;
  background: #fff;
  color: #137f91;
  cursor: pointer;
}
.assistant-dialog-body {
  flex: 1;
  min-height: 0;
  padding: 10px 24px 20px;
  overflow: hidden;
  overscroll-behavior: contain;
}
@keyframes assistant-open {
  from {
    opacity: 0;
    transform: translateX(48px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
@media (max-width: 600px) {
  .workspace-assistant {
    width: 96px;
  }
  .assistant-bubble {
    display: none;
  }
  .assistant-robot {
    width: 90px;
  }
  .workspace-assistant.mobile-header-dock {
    width: 48px;
  }
  .mobile-header-dock .assistant-launcher {
    padding: 0;
    min-height: 48px;
  }
  .mobile-header-dock .assistant-robot {
    width: 48px;
  }
  .assistant-bubble {
    padding: 12px;
    gap: 5px;
  }
  .assistant-greeting {
    font-size: 16px;
  }
  .assistant-bubble strong {
    font-size: 17px;
  }
  .assistant-dialog {
    width: 100vw;
    max-height: 100dvh;
    border-radius: 0;
  }
  .assistant-dialog-surface {
    max-height: 100dvh;
  }
  .assistant-dialog-body {
    padding: 4px 10px max(10px, env(safe-area-inset-bottom));
  }
  .assistant-dialog-header {
    padding: 12px 16px;
  }
  .assistant-dialog-header h2 {
    font-size: 21px;
  }
  .assistant-dialog-header p {
    font-size: 13px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-float,
  .assistant-dialog[open] {
    animation: none;
  }
  .assistant-robot img {
    transition: none;
  }
}
</style>
