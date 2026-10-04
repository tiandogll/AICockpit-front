import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ContentTrialView from '../views/ContentTrialView.vue'
import * as api from '../services/contentTrialApi'
import { ApiError } from '../services/apiClient'
import type { TrialDetail } from '../services/contentTrialApi'

const state = vi.hoisted(() => ({
  auth: null as unknown as { user: { id: string }; isAuthenticated: boolean },
  access: null as unknown as {
    ready: boolean
    error: string
    organizationId: string
    organizations: { id: string; name: string; role: string; capabilities: string[] }[]
    globalCapabilities: string[]
  },
  route: null as unknown as { params: { trialId?: string } },
}))
vi.mock('../stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../stores/access', () => ({ useAccessStore: () => state.access }))
vi.mock('vue-router', () => ({
  useRoute: () => state.route,
  onBeforeRouteLeave: vi.fn(),
  onBeforeRouteUpdate: vi.fn(),
}))
vi.mock('../services/contentTrialApi', () => ({
  listContentTrials: vi.fn(),
  getContentTrial: vi.fn(),
  consentContentTrial: vi.fn(),
  saveContentTrialDraft: vi.fn(),
  submitContentTrial: vi.fn(),
  withdrawContentTrial: vi.fn(),
}))
const fixture = (changes: Partial<TrialDetail> = {}): TrialDetail => ({
  id: 'trial-1',
  packet_id: 'packet-1',
  organization_id: 'org-1',
  code: 'A01-R1-test',
  dimension: 'evaluation',
  item_type: 'objective',
  status: 'in_progress',
  revision: 2,
  created_at: '2026-09-20T00:00:00Z',
  expires_at: '2026-12-19T00:00:00Z',
  consented_at: '2026-09-20T00:00:00Z',
  submitted_at: null,
  withdrawn_at: null,
  purpose: 'content_quality_trial',
  notice: '仅用于题质试答',
  can_edit: true,
  blocked_reason: null,
  question: {
    stem: '请判断下面哪一种核验方式更合适？',
    options: ['核查原始来源', '只看摘要', '只看标题', '不做核查'],
    followups: [],
    attribution: '获许可改编署名',
  },
  response: { selected_index: 1 },
  feedback: '已有反馈',
  ...changes,
})
const wrappers: VueWrapper[] = []
function render() {
  const wrapper = mount(ContentTrialView, {
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  wrappers.push(wrapper)
  return wrapper
}
beforeEach(() => {
  vi.resetAllMocks()
  state.auth = reactive({ user: { id: 'learner-1' }, isAuthenticated: true })
  state.access = reactive({
    ready: true,
    error: '',
    organizationId: 'org-1',
    organizations: [{ id: 'org-1', name: '试答组织', role: 'learner', capabilities: [] }],
    globalCapabilities: [],
  })
  state.route = reactive({ params: { trialId: 'trial-1' } })
  vi.mocked(api.getContentTrial).mockResolvedValue(fixture())
  vi.mocked(api.listContentTrials).mockResolvedValue({
    items: [fixture()],
    total: 1,
    limit: 20,
    offset: 0,
  })
  vi.stubGlobal('crypto', { randomUUID: () => 'stable-test-key' })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('learner content-quality trial', () => {
  it('checks expiry at the action boundary even before a suspended timer or focus event runs', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    vi.mocked(api.getContentTrial).mockResolvedValue(
      fixture({ expires_at: new Date(Date.now() + 1000).toISOString() }),
    )
    const wrapper = render()
    await flushPromises()
    vi.setSystemTime(Date.now() + 2000)
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(api.saveContentTrialDraft).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.find('[data-testid=trial-option-0]').exists()).toBe(false)
  })
  it('treats an expired withdrawal receipt as a closed result rather than a false failure', async () => {
    vi.mocked(api.withdrawContentTrial).mockResolvedValue(
      fixture({
        status: 'expired',
        can_edit: false,
        response: null,
        feedback: null,
        question: null,
      }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-prepare-withdraw]').trigger('click')
    await wrapper.get('[data-testid=trial-confirm-withdraw]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('任务已到期')
    expect(wrapper.text()).not.toContain('原文清除尚未确认')
    expect(wrapper.text()).not.toContain('已有反馈')
  })
  it('erases loaded answers, editor fields, pending payload and confirmation at the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const expires_at = new Date(Date.now() + 1000).toISOString()
    vi.mocked(api.getContentTrial).mockResolvedValue(fixture({ expires_at }))
    vi.mocked(api.submitContentTrial).mockRejectedValue(new Error('网络中断'))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-prepare-submit]').trigger('click')
    await wrapper.get('[data-testid=trial-confirm-submit]').trigger('click')
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      detail: TrialDetail
      fields: { selected_index: number | null }
      feedback: string
      saved: string
      pending: { body: { response: unknown; feedback: string } } | null
    }
    const capturedIntent = vm.pending!
    expect(capturedIntent.body.feedback).toBe('已有反馈')
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.text()).not.toContain('已有反馈')
    expect(wrapper.find('[data-testid=trial-option-0]').exists()).toBe(false)
    expect(wrapper.find('[data-testid=trial-retry-write]').exists()).toBe(false)
    expect(vm.detail).toMatchObject({
      question: null,
      response: null,
      feedback: null,
      status: 'expired',
      can_edit: false,
    })
    expect(vm.fields.selected_index).toBeNull()
    expect(vm.feedback).toBe('')
    expect(vm.saved).toBe('')
    expect(vm.pending).toBeNull()
    expect(capturedIntent.body.feedback).toBe('')
    expect(capturedIntent.body.response).toEqual({ selected_index: null })
  })
  it('redacts an already expired late detail instead of restoring its original text', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    let resolve!: (value: TrialDetail) => void
    const expires_at = new Date(Date.now() + 1000).toISOString()
    vi.mocked(api.getContentTrial).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = render()
    await flushPromises()
    vi.setSystemTime(Date.now() + 2000)
    resolve(fixture({ expires_at, status: 'submitted', can_edit: false }))
    await flushPromises()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.text()).not.toContain('已有反馈')
    const vm = wrapper.vm as unknown as { detail: TrialDetail; feedback: string }
    expect(vm.detail.response).toBeNull()
    expect(vm.feedback).toBe('')
  })
  it('checks suspended deadlines on focus and ignores in-flight writes from before expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date('2026-09-20T00:00:00Z'))
    const expires_at = new Date(Date.now() + 1000).toISOString()
    let resolve!: (value: TrialDetail) => void
    vi.mocked(api.getContentTrial).mockResolvedValue(fixture({ expires_at }))
    vi.mocked(api.saveContentTrialDraft).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    vi.setSystemTime(Date.now() + 2000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    resolve(fixture({ expires_at, revision: 3 }))
    await flushPromises()
    expect(wrapper.text()).toContain('已到期')
    expect(wrapper.text()).not.toContain('草稿已保存')
    expect(wrapper.text()).not.toContain('已有反馈')
  })
  it('renders a failed list as an error, not an empty successful assignment list', async () => {
    state.route.params = {}
    vi.mocked(api.listContentTrials).mockRejectedValue(new Error('任务列表暂时不可用'))
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('任务列表暂时不可用')
    expect(wrapper.text()).not.toContain('目前没有指定给你的题质试答')
  })
  it('collects initial dialogue and exactly two fixed followups with no AI interaction', async () => {
    const dialogue = fixture({
      item_type: 'dialogue',
      response: { answers: ['已有初答', '', ''] },
      question: {
        stem: '合成对话题面',
        options: [],
        followups: ['固定问题甲', '固定问题乙'],
        attribution: null,
      },
    })
    vi.mocked(api.getContentTrial).mockResolvedValue(dialogue)
    vi.mocked(api.saveContentTrialDraft).mockResolvedValue(dialogue)
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('固定问题甲')
    expect(wrapper.text()).toContain('固定问题乙')
    expect(wrapper.findAll('[data-testid^=trial-dialogue-]')).toHaveLength(3)
    await wrapper.get('[data-testid=trial-dialogue-1]').setValue('回答甲')
    await wrapper.get('[data-testid=trial-dialogue-2]').setValue('回答乙')
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(api.saveContentTrialDraft).toHaveBeenCalledWith(
      'trial-1',
      expect.objectContaining({ response: { answers: ['已有初答', '回答甲', '回答乙'] } }),
      expect.any(String),
    )
  })
  it('collects practical text in four sections without uploads or code execution', async () => {
    const practical = fixture({
      item_type: 'practical',
      response: { plan: '', artifact: '', verification: '', reflection: '' },
      question: { stem: '合成实操任务', options: [], followups: [], attribution: null },
    })
    vi.mocked(api.getContentTrial).mockResolvedValue(practical)
    vi.mocked(api.saveContentTrialDraft).mockResolvedValue(practical)
    const wrapper = render()
    await flushPromises()
    for (const key of ['plan', 'artifact', 'verification', 'reflection'])
      await wrapper.get(`[data-testid=trial-practical-${key}]`).setValue(`${key} 合成文本`)
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(api.saveContentTrialDraft).toHaveBeenCalledWith(
      'trial-1',
      expect.objectContaining({
        response: {
          plan: 'plan 合成文本',
          artifact: 'artifact 合成文本',
          verification: 'verification 合成文本',
          reflection: 'reflection 合成文本',
        },
      }),
      expect.any(String),
    )
    expect(wrapper.find('input[type=file]').exists()).toBe(false)
  })
  it('fails closed on incomplete reviewed dialogue questions', async () => {
    vi.mocked(api.getContentTrial).mockResolvedValue(
      fixture({
        item_type: 'dialogue',
        response: { answers: ['', '', ''] },
        question: {
          stem: '不完整的题面',
          options: [],
          followups: ['只有一个追问'],
          attribution: null,
        },
      }),
    )
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('题面或固定追问不完整')
    expect(wrapper.find('[data-testid=trial-save]').exists()).toBe(false)
    expect(api.submitContentTrial).not.toHaveBeenCalled()
  })
  it('requires explicit consent and does not reveal a question before confirmation', async () => {
    vi.mocked(api.getContentTrial).mockResolvedValue(
      fixture({
        status: 'assigned',
        consented_at: null,
        can_edit: false,
        question: null,
        response: null,
      }),
    )
    vi.mocked(api.consentContentTrial).mockResolvedValue(fixture())
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).toContain('90 天')
    expect(wrapper.text()).toContain('不计入正式成绩')
    expect(wrapper.text()).not.toContain('核查原始来源')
    expect((wrapper.get('[data-testid=trial-consent]').element as HTMLButtonElement).disabled).toBe(
      true,
    )
    await wrapper.get('[data-testid=trial-consent-check]').setValue(true)
    await wrapper.get('[data-testid=trial-consent]').trigger('click')
    await flushPromises()
    expect(api.consentContentTrial).toHaveBeenCalledWith('trial-1', expect.any(String))
    expect(wrapper.text()).toContain('获许可改编署名')
  })
  it('restores draft, saves with CAS, and only submits after explicit confirmation', async () => {
    vi.mocked(api.saveContentTrialDraft).mockResolvedValue(
      fixture({ revision: 3, response: { selected_index: 0 } }),
    )
    vi.mocked(api.submitContentTrial).mockResolvedValue(
      fixture({
        status: 'submitted',
        can_edit: false,
        revision: 4,
        submitted_at: '2026-09-20T01:00:00Z',
      }),
    )
    const wrapper = render()
    await flushPromises()
    expect((wrapper.get('[data-testid=trial-option-1]').element as HTMLInputElement).checked).toBe(
      true,
    )
    await wrapper.get('[data-testid=trial-option-0]').setValue(true)
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(api.saveContentTrialDraft).toHaveBeenCalledWith(
      'trial-1',
      { expected_revision: 2, response: { selected_index: 0 }, feedback: '已有反馈' },
      expect.any(String),
    )
    expect(api.submitContentTrial).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=trial-prepare-submit]').trigger('click')
    expect(api.submitContentTrial).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=trial-confirm-submit]').trigger('click')
    await flushPromises()
    expect(api.submitContentTrial).toHaveBeenCalledWith(
      'trial-1',
      expect.objectContaining({ expected_revision: 3 }),
      expect.any(String),
    )
    expect(wrapper.text()).toContain('已提交')
    expect(wrapper.find('[data-testid=trial-save]').exists()).toBe(false)
  })
  it('keeps a stable submit intent after a lost response and prevents editing its payload', async () => {
    vi.mocked(api.submitContentTrial)
      .mockRejectedValueOnce(new Error('网络中断'))
      .mockResolvedValueOnce(fixture({ status: 'submitted', can_edit: false }))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-prepare-submit]').trigger('click')
    await wrapper.get('[data-testid=trial-confirm-submit]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('提交成功')
    expect((wrapper.get('[data-testid=trial-option-0]').element as HTMLInputElement).disabled).toBe(
      true,
    )
    await wrapper.get('[data-testid=trial-retry-write]').trigger('click')
    await flushPromises()
    expect(vi.mocked(api.submitContentTrial).mock.calls[0]).toEqual(
      vi.mocked(api.submitContentTrial).mock.calls[1],
    )
  })
  it('does not overwrite a newer draft after a CAS conflict', async () => {
    vi.mocked(api.saveContentTrialDraft).mockRejectedValue(new ApiError('草稿版本冲突', 409))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('未覆盖')
    expect(wrapper.find('[data-testid=trial-retry-write]').exists()).toBe(false)
    expect(api.saveContentTrialDraft).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid=trial-reload]').exists()).toBe(true)
  })
  it('requires withdrawal confirmation and removes local original text after success', async () => {
    vi.mocked(api.withdrawContentTrial).mockResolvedValue(
      fixture({
        status: 'withdrawn',
        question: null,
        response: null,
        feedback: null,
        can_edit: false,
      }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-prepare-withdraw]').trigger('click')
    expect(api.withdrawContentTrial).not.toHaveBeenCalled()
    await wrapper.get('[data-testid=trial-confirm-withdraw]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('已撤回')
    expect(wrapper.text()).not.toContain('已有反馈')
    expect(wrapper.text()).not.toContain('核查原始来源')
  })
  it('clears private state and ignores delayed detail after authentication changes', async () => {
    let resolve!: (value: TrialDetail) => void
    vi.mocked(api.getContentTrial).mockReturnValue(
      new Promise((done) => {
        resolve = done
      }),
    )
    const wrapper = render()
    await flushPromises()
    state.auth.isAuthenticated = false
    resolve(fixture())
    await flushPromises()
    expect(wrapper.text()).not.toContain('核查原始来源')
    expect(wrapper.text()).not.toContain('已有反馈')
  })
  it('clears inputs immediately after a permission error', async () => {
    vi.mocked(api.saveContentTrialDraft).mockRejectedValue(new ApiError('资格已撤销', 403))
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-save]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('资格已撤销')
    expect(wrapper.find('[data-testid=trial-option-0]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('已有反馈')
  })
  it('reports the real closed state when an idempotent submit retry returns a withdrawn task', async () => {
    vi.mocked(api.submitContentTrial).mockResolvedValue(
      fixture({ status: 'withdrawn', can_edit: false, blocked_reason: '已主动撤回' }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-prepare-submit]').trigger('click')
    await wrapper.get('[data-testid=trial-confirm-submit]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('服务器当前状态：已撤回')
    expect(wrapper.text()).not.toContain('草稿已保存')
    expect(wrapper.text()).not.toContain('已有任务仍可主动撤回')
    expect(wrapper.text()).not.toContain('已有反馈')
  })
  it('does not promise continued answering when consent retry returns an expired task', async () => {
    vi.mocked(api.getContentTrial).mockResolvedValue(
      fixture({
        status: 'assigned',
        consented_at: null,
        can_edit: false,
        question: null,
        response: null,
      }),
    )
    vi.mocked(api.consentContentTrial).mockResolvedValue(
      fixture({ status: 'expired', can_edit: false }),
    )
    const wrapper = render()
    await flushPromises()
    await wrapper.get('[data-testid=trial-consent-check]').setValue(true)
    await wrapper.get('[data-testid=trial-consent]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('服务器当前状态：已到期')
    expect(wrapper.text()).not.toContain('请自行作答')
  })
})
