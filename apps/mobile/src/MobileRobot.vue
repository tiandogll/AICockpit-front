<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import robotUrl from '../../web/src/assets/growth-robot-user.png'

const props = defineProps<{ boundary: HTMLElement | null }>()
const emit = defineEmits<{ open: [] }>()
const SIZE = 54, STORAGE_KEY = 'ai-measure-mobile-robot-position-v1'
const x = ref(0), y = ref(0), ready = ref(false), pressed = ref(false)
const moving = ref(false), positionHint = ref(false)
let observer: ResizeObserver | undefined
let hintTimer: ReturnType<typeof setTimeout> | undefined
let suppressUntil = 0
let point: { id: number; startX: number; startY: number; originX: number; originY: number } | null = null
let proportion: { x: number; y: number } | null = null
const style = computed(() => ({ transform: `translate3d(${x.value}px, ${y.value}px, 0)` }))

function limits() {
  const frame = props.boundary
  const width = frame?.clientWidth ?? window.innerWidth
  const height = frame?.clientHeight ?? window.innerHeight
  const header = frame?.querySelector<HTMLElement>('.mini-header')?.offsetHeight ?? 56
  const tabs = frame?.querySelector<HTMLElement>('.bottom-tabs')?.offsetHeight ?? 65
  return { left: 6, right: Math.max(6, width - SIZE - 6), top: header + 6, bottom: Math.max(header + 6, height - tabs - SIZE - 8) }
}
function place(left: number, top: number) {
  const bounds = limits()
  x.value = Math.max(bounds.left, Math.min(bounds.right, left))
  y.value = Math.max(bounds.top, Math.min(bounds.bottom, top))
}
function remember() {
  const bounds = limits()
  proportion = {
    x: (x.value - bounds.left) / Math.max(1, bounds.right - bounds.left),
    y: (y.value - bounds.top) / Math.max(1, bounds.bottom - bounds.top),
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(proportion)) } catch { /* Private browsing may deny storage. */ }
}
function restore() {
  const bounds = limits()
  if (proportion) place(bounds.left + proportion.x * (bounds.right - bounds.left), bounds.top + proportion.y * (bounds.bottom - bounds.top))
  else place(bounds.right, bounds.bottom - 20)
  ready.value = true
}
function start(event: PointerEvent) {
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
  // A fresh tap after dropping the robot is intentional, not the drag's click.
  suppressUntil = 0
  point = { id: event.pointerId, startX: event.clientX, startY: event.clientY, originX: x.value, originY: y.value }
  pressed.value = true
  moving.value = false
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!point || point.id !== event.pointerId) return
  const dx = event.clientX - point.startX, dy = event.clientY - point.startY
  if (!moving.value && Math.hypot(dx, dy) < 7) return
  moving.value = true
  place(point.originX + dx, point.originY + dy)
}
function finish(event: PointerEvent, cancelled = false) {
  if (!point || point.id !== event.pointerId) return
  if (cancelled) place(point.originX, point.originY)
  if (moving.value || cancelled) suppressUntil = performance.now() + 350
  if (moving.value && !cancelled) remember()
  point = null
  pressed.value = false
  moving.value = false
  const target = event.currentTarget as HTMLElement
  if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
}
function open(event: MouseEvent) {
  // Pointer dragging must not accidentally open chat. Keyboard activation works
  // regardless of the previous pointer gesture.
  if (event.detail > 0 && performance.now() < suppressUntil) return
  emit('open')
}
function keyboard(event: KeyboardEvent) {
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const direction = directions[event.key]
  if (!direction) return
  event.preventDefault()
  const step = event.shiftKey ? 32 : 16
  place(x.value + direction[0] * step, y.value + direction[1] * step)
  remember()
  positionHint.value = true
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { positionHint.value = false }, 1300)
}
watch(() => props.boundary, async (frame) => {
  observer?.disconnect()
  await nextTick()
  if (!frame) return
  restore()
  observer = new ResizeObserver(restore)
  observer.observe(frame)
}, { immediate: true })
onMounted(() => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (saved && [saved.x, saved.y].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)) proportion = { x: saved.x, y: saved.y }
  } catch { /* An invalid saved position should never block the assistant. */ }
  restore()
})
onBeforeUnmount(() => { observer?.disconnect(); clearTimeout(hintTimer) })
</script>

<template>
  <button
    v-show="ready" class="mobile-floating-robot" :class="{ 'is-pressed': pressed, 'is-moving': moving }"
    :style="style" aria-label="打开成长助手" aria-describedby="mobile-robot-help" data-testid="mobile-robot"
    @pointerdown="start" @pointermove="move" @pointerup="finish($event)"
    @pointercancel="finish($event, true)" @lostpointercapture="point && finish($event, true)"
    @click="open" @keydown="keyboard"
  >
    <img :src="robotUrl" alt="" draggable="false" />
    <span v-if="moving || positionHint" class="robot-position-hint" aria-hidden="true">随你移动</span>
  </button>
  <span id="mobile-robot-help" class="mobile-robot-description">点击打开成长助手，拖动可以调整位置；键盘方向键也可以移动。</span>
</template>

<style scoped>
.mobile-floating-robot {
  position: absolute; left: 0; top: 0; width: 54px; height: 54px;
  padding: 0; border: 0; border-radius: 0; background: transparent;
  box-shadow: none; z-index: 20; cursor: grab; touch-action: none;
  user-select: none; -webkit-user-select: none; transition: transform 180ms ease-out;
}
.mobile-floating-robot img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; filter: drop-shadow(0 5px 7px #424cb529); transition: transform 180ms ease-out; }
.mobile-floating-robot:focus-visible { outline: 2px solid #087f82; outline-offset: 3px; border-radius: 18px; }
.mobile-floating-robot.is-pressed { transition: none; cursor: grabbing; }
.mobile-floating-robot.is-moving { will-change: transform; }
.mobile-floating-robot.is-pressed img { transform: scale(1.08) rotate(-4deg); }
.robot-position-hint { position: absolute; left: 50%; top: -19px; transform: translateX(-50%); padding: 3px 8px; border-radius: 8px; white-space: nowrap; font-size: 10px; color: #087f82; background: #e5f4eff2; pointer-events: none; }
.mobile-robot-description { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (prefers-reduced-motion: reduce) { .mobile-floating-robot, .mobile-floating-robot img { transition: none; } .mobile-floating-robot.is-pressed img { transform: none; } }
</style>
