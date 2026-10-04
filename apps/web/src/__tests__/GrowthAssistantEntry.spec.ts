import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GrowthAssistantEntry from '../components/GrowthAssistantEntry.vue'
vi.mock('vue-router', async (original) => ({
  ...(await original<typeof import('vue-router')>()),
  useRoute: () => ({ fullPath: '/workspace' }),
}))
import { useAccessStore } from '../stores/access'
import { useAuthStore } from '../stores/auth'
import { useFeatureStore } from '../stores/features'

const sessionId = '2e59576f-0b97-4138-8fd8-c3d01bac1e10'
const reply = {
  mode: 'deepseek',
  scope: 'personal_growth',
  paragraphs: ['先查看报告中的证据，再安排形成性训练。'],
  actions: [{ label: '查看训练计划', path: '/training' }],
  source: { report_id: sessionId, session_id: sessionId, revision: 2, status: 'complete' },
  generation: {
    requested_provider: 'deepseek',
    status: 'succeeded',
    model: 'deepseek-flash',
    error_code: null,
    usage: null,
  },
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const wrappers: VueWrapper[] = []

function renderGuide() {
  const wrapper = mount(GrowthAssistantEntry, {
    global: {
      stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function ask(wrapper: VueWrapper, question = '下一步怎么训练？') {
  await wrapper.get('textarea').setValue(question)
  await wrapper.get('form').trigger('submit')
  await flushPromises()
}

describe('GrowthAssistantEntry', () => {
  it('omits only the repeated API footer while preserving the answer, attribution and usage instructions', async () => {
    const footer =
      '以上为 DeepSeek 生成的学习建议，不是专家评分，不修改正式测评结果。 材料分析仅基于提取文字，图片OCR可能有误，不代表完整视觉理解。'
    const substantiveAdvice = '图片 OCR 可能识别错误，建议对照原图核验关键数字。'
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          ...reply,
          paragraphs: [...reply.paragraphs, substantiveAdvice, footer],
        }),
      ),
    )
    const wrapper = renderGuide()
    await ask(wrapper)
    const turn = wrapper.get('[data-testid="guide-turn"]')
    expect(turn.text()).toContain(reply.paragraphs[0])
    expect(turn.text()).toContain(substantiveAdvice)
    expect(turn.text()).not.toContain('以上为 DeepSeek 生成的学习建议')
    expect(turn.text()).not.toContain('不代表完整视觉理解')
    expect(turn.text()).toContain('DeepSeek 生成')
    await wrapper.get('button[aria-controls="guide-instructions"]').trigger('click')
    expect(wrapper.get('.guide-instructions').text()).toContain('建议不改变正式成绩')
  })
  it('blocks from the current-answering flag before any question, then enables after pause refresh', async () => {
    const capabilities = {
      training_enabled: false,
      training_content_status: 'formative_preview',
      growth_guide_mode: 'deepseek',
      attachments_enabled: true,
    }
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ ...capabilities, assessment_in_progress: true }))
        .mockResolvedValueOnce(json({ ...capabilities, assessment_in_progress: false })),
    )
    await useFeatureStore().load(true)
    const wrapper = renderGuide()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.text()).toContain('请先在测评页暂存退出')
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeDefined()
    await ask(wrapper, '你好')
    expect(fetch).toHaveBeenCalledTimes(1)
    await useFeatureStore().load(true)
    await flushPromises()
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeUndefined()
  })
  it('shows server assessment errors as state without adding a local response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          json(
            { detail: { code: 'assessment_active', message: '正在正式作答，请先暂存退出。' } },
            409,
          ),
        ),
    )
    const wrapper = renderGuide()
    await ask(wrapper, '你好')
    expect(wrapper.text()).toContain('请先暂存退出')
    expect(wrapper.findAll('[data-testid="guide-turn"]')).toHaveLength(0)
    expect(wrapper.find('.guide-generation').exists()).toBe(false)
    expect(wrapper.get('[aria-label="发送问题"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="上传图片"]').attributes('disabled')).toBeDefined()
  })
  it('does not offer local answers if the server has not enabled DeepSeek', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          training_enabled: false,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'local_guidance',
          attachments_enabled: true,
        }),
      ),
    )
    await useFeatureStore().load(true)
    const request = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.text()).toContain('不会改用固定文字回答')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.get('[aria-label="上传图片"]').attributes('disabled')).toBeDefined()
    await ask(wrapper, '你好')
    expect(request).not.toHaveBeenCalled()
  })
  it('uses the project logo in the welcome area', async () => {
    const wrapper = renderGuide()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.find('.welcome-symbol .brand-mark image').exists()).toBe(true)
    expect(wrapper.get('.conversation-welcome').text()).toContain('今天，想了解什么？')
  })
  it('opens the file picker directly and sends only server material IDs with the question', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          training_enabled: false,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'deepseek',
          attachments_enabled: true,
        }),
      ),
    )
    await useFeatureStore().load(true)
    const material = {
      id: 'material-one',
      name: 'notes.txt',
      text: '来源核验',
      method: 'text',
      truncated: false,
      sha256: 'abc',
      expires_in_seconds: 3600,
    }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(material))
      .mockResolvedValueOnce(json(reply))
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    const input = wrapper.findAll('input[type="file"]')[1]!
    const openPicker = vi.spyOn(input.element as HTMLInputElement, 'click')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    await wrapper.get('[aria-label="上传文档"]').trigger('click')
    expect(openPicker).toHaveBeenCalledTimes(1)
    expect(request).not.toHaveBeenCalled()
    expect(wrapper.find('.action-confirmation').exists()).toBe(false)
    Object.defineProperty(input.element, 'files', {
      value: [new File(['来源核验'], 'notes.txt', { type: 'text/plain' })],
    })
    await input.trigger('change')
    await flushPromises()
    expect(wrapper.text()).toContain('notes.txt')
    await ask(wrapper, '请分析材料')
    expect(request).toHaveBeenCalledTimes(2)
    const body = JSON.parse(String(request.mock.calls[1]![1]!.body))
    expect(body.attachment_ids).toEqual(['material-one'])
    expect(body).not.toHaveProperty('text')
  })
  it('sends directly, keeps model attribution without usage UI, and retains the failed retry key', async () => {
    const features = useFeatureStore()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          training_enabled: true,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'deepseek',
          attachments_enabled: false,
        }),
      ),
    )
    await features.load(true)
    const generated = {
      ...reply,
      mode: 'deepseek',
      generation: {
        requested_provider: 'deepseek',
        status: 'succeeded',
        model: 'deepseek-flash',
        error_code: null,
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    }
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('连接中断'))
      .mockResolvedValueOnce(json(generated))
      .mockResolvedValueOnce(json(generated))
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    await ask(wrapper, '怎么识别幻觉？')
    expect(request).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="guide-conversation"]').exists()).toBe(true)
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('发送给 DeepSeek 前，请确认')
    expect(wrapper.find('.action-confirmation').exists()).toBe(false)
    expect(wrapper.text()).toContain('DeepSeek')
    await wrapper.get('[data-testid="retry-guide"]').trigger('click')
    await flushPromises()
    const keys = request.mock.calls.map((call) =>
      new Headers(call[1]!.headers).get('Idempotency-Key'),
    )
    expect(keys[0]).toBeTruthy()
    expect(keys[1]).toBe(keys[0])
    expect(wrapper.text()).toContain('DeepSeek 生成')
    expect(wrapper.text()).not.toContain('30 tokens')
    expect(wrapper.text()).not.toContain('查看本次用量')
    expect(wrapper.find('.response-details').exists()).toBe(false)
    useAccessStore().organizationId = 'org-2'
    await flushPromises()
    await ask(wrapper, '另一个组织的问题')
    expect(wrapper.find('.action-confirmation').exists()).toBe(false)
    expect(request).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(request.mock.calls[2]![1]?.body)).organization_id).toBe('org-2')
  })

  it('does not label a local fallback as a model success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          ...reply,
          mode: 'local_guidance',
          generation: {
            requested_provider: 'deepseek',
            status: 'fallback',
            model: null,
            error_code: 'timeout',
            usage: null,
          },
        }),
      ),
    )
    const wrapper = renderGuide()
    await ask(wrapper)
    expect(wrapper.text()).toContain('DeepSeek 请求超时')
    expect(wrapper.find('[data-testid="guide-turn"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(reply.paragraphs[0])
    expect(wrapper.text()).not.toContain('DeepSeek 生成')
  })
  it.each([
    ['assessment_active', '请先在测评页暂存退出'],
    ['report_pending', '报告尚未定稿'],
    [null, 'DeepSeek 本次未返回有效回答'],
  ])(
    'uses the server restriction reason %s rather than guessing from scope',
    async (code, label) => {
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>().mockResolvedValue(
          json({
            ...reply,
            mode: 'local_guidance',
            scope: 'rules_only',
            source: null,
            generation: {
              requested_provider: 'deepseek',
              status: 'restricted',
              model: null,
              usage: null,
              error_code: code,
            },
          }),
        ),
      )
      const wrapper = renderGuide()
      await ask(wrapper, '你好')
      expect(wrapper.text()).toContain(label)
      expect(wrapper.text()).not.toContain('DeepSeek 生成')
      if (code === 'report_pending')
        expect(wrapper.text()).not.toContain('正式测评期间仅提供规则帮助')
    },
  )
  it('sends on Enter but not during IME composition or Shift+Enter, and clears drafts on account change', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(reply))
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    await wrapper.get('textarea').setValue('请帮我理解报告')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(request).not.toHaveBeenCalled()
    expect(wrapper.get('textarea').element.value).toBe('请帮我理解报告')
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.action-confirmation').exists()).toBe(false)
    await wrapper.get('textarea').setValue('不应发送给另一个账号的问题')
    useAuthStore().user = { ...useAuthStore().user!, id: 'actor-2' }
    await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('')
    await wrapper.get('form').trigger('submit')
    expect(
      request.mock.calls.filter(([url]) => String(url).endsWith('/workspace/guide')),
    ).toHaveLength(1)
  })
  beforeEach(async () => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'actor-1', email: null, display_name: '学员', is_active: true }
    const access = useAccessStore()
    access.organizationId = 'org-1'
    access.ready = true
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          training_enabled: false,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'deepseek',
          attachments_enabled: false,
        }),
      ),
    )
    await useFeatureStore().load()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async () => json(reply)),
    )
  })
  afterEach(() => {
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('never presents missing configuration as local guidance or sends while features are unknown', async () => {
    useFeatureStore().clear()
    const wrapper = renderGuide()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.text()).toContain('正在连接助手与上传服务')
    expect(wrapper.text()).not.toContain('本地规则模式')
    expect(wrapper.text()).not.toContain('本地引导 · 非大模型')
    expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
    await ask(wrapper, '你好')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('offers connection retry after a feature failure instead of silently falling back', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ detail: '服务重启中' }, 503))
      .mockResolvedValueOnce(
        json({
          training_enabled: false,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'deepseek',
          attachments_enabled: true,
        }),
      )
      .mockResolvedValueOnce(json(reply))
    vi.stubGlobal('fetch', request)
    await useFeatureStore().load(true)
    const wrapper = renderGuide()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.text()).toContain('服务配置加载失败，未调用模型')
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeDefined()
    await ask(wrapper, '你好')
    expect(request).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="retry-guide-features"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="guide-provider"]').text()).toContain('DeepSeek')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeUndefined()
    await ask(wrapper, '你好')
    expect(JSON.parse(String(request.mock.calls[2]![1]?.body)).provider).toBe('deepseek')
  })

  it('explains the assessment restriction instead of leaving an unexplained disabled upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          training_enabled: false,
          training_content_status: 'formative_preview',
          growth_guide_mode: 'deepseek',
          attachments_enabled: true,
        }),
      ),
    )
    await useFeatureStore().load(true)
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          ...reply,
          mode: 'local_guidance',
          source: null,
          generation: {
            requested_provider: 'deepseek',
            status: 'restricted',
            model: null,
            usage: null,
            error_code: 'assessment_active',
          },
        }),
      ),
    )
    const wrapper = renderGuide()
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeUndefined()
    await ask(wrapper, '你好')
    expect(wrapper.text()).toContain('正在正式作答')
    expect(wrapper.get('.assessment-notice a').attributes('href')).toBe('/assessment')
    expect(wrapper.get('[aria-label="上传文档"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="上传文档"]').attributes('title')).toContain('暂存退出当前测评')
  })

  it('retains a compact model-only composer and unavailable attachments', () => {
    const wrapper = renderGuide()
    expect(wrapper.get('section').attributes('aria-label')).toBe('成长助手')
    expect(wrapper.text()).toContain('DeepSeek · 大模型回答')
    expect(wrapper.find('select').exists()).toBe(false)
    expect(wrapper.get('textarea').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('textarea').attributes('maxlength')).toBe('200')
    expect(wrapper.get('[aria-label="发送问题"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="guide-conversation"]').exists()).toBe(false)
    for (const label of ['上传图片', '上传文档']) {
      expect(wrapper.get(`[aria-label="${label}"]`).attributes('disabled')).toBeDefined()
    }
  })

  it('submits a question, displays plain-text advice with report revision, and collapses it', async () => {
    const wrapper = renderGuide()
    await ask(wrapper)
    expect(wrapper.get('[data-testid="guide-conversation"]').text()).toContain(reply.paragraphs[0])
    expect(wrapper.get('[data-testid="guide-source"]').attributes('href')).toBe(
      `/reports/${sessionId}`,
    )
    expect(wrapper.get('[data-testid="guide-source"]').text()).toContain('修订 2')
    await wrapper.get('[aria-controls="guide-instructions"]').trigger('click')
    expect(wrapper.text()).toContain('仅保留本页最近 10 次问答')
    expect(wrapper.get('#guide-instructions').text()).toContain('选择文件后即上传服务器提取文字')
    expect(wrapper.get('#guide-instructions').text()).toContain('所选材料的提取文字')
    expect(wrapper.get('#guide-instructions').text()).toContain('失败或中断也可能产生费用')
    expect(wrapper.get('#guide-instructions').text()).not.toContain('会先确认数据用途')
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.find('[data-testid="guide-conversation"]').exists()).toBe(false)
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    expect(wrapper.text()).toContain(reply.paragraphs[0])
  })

  it('offers quick questions and prevents blank, overlong and duplicate in-flight submissions', async () => {
    let finish!: (value: Response) => void
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    await ask(wrapper, '   ')
    await ask(wrapper, '问'.repeat(201))
    expect(request).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
    await wrapper.get('[data-testid="guide-quick-question"]').trigger('click')
    expect(request).toHaveBeenCalledTimes(1)
    expect(wrapper.get('.guide-state[role="status"]').text()).toContain('DeepSeek 正在生成回答')
    await wrapper.get('form').trigger('submit')
    expect(request).toHaveBeenCalledTimes(1)
    finish(json(reply))
    await flushPromises()
  })

  it('preserves a failed question, retries the same question, and clears in-memory history', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ detail: '引导暂不可用' }, 503))
      .mockResolvedValueOnce(json(reply))
    vi.stubGlobal('fetch', request)
    const wrapper = renderGuide()
    await ask(wrapper, '报告是什么意思？')
    expect(wrapper.get('textarea').element.value).toBe('报告是什么意思？')
    expect(wrapper.get('[role="alert"]').text()).toContain('引导暂不可用')
    await wrapper.get('[data-testid="retry-guide"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual(
      JSON.parse(String(request.mock.calls[1]![1]?.body)),
    )
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await wrapper.get('[data-testid="clear-guide"]').trigger('click')
    expect(wrapper.find('[data-testid="guide-turn"]').exists()).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('')
  })

  it.each(['organization', 'actor', 'not-ready', 'access-error', 'logout'])(
    'clears all content immediately and discards late replies after %s changes',
    async (change) => {
      const wrapper = renderGuide()
      await ask(wrapper, '先前的私人问题')
      let finish!: (value: Response) => void
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockImplementation(() => new Promise((resolve) => (finish = resolve))),
      )
      await ask(wrapper, '尚未返回的私人问题')
      const access = useAccessStore()
      if (change === 'organization') access.organizationId = 'org-2'
      if (change === 'actor') useAuthStore().user = { ...useAuthStore().user!, id: 'actor-2' }
      if (change === 'not-ready') access.ready = false
      if (change === 'access-error') access.error = '权限不可用'
      if (change === 'logout') useAuthStore().accessToken = ''
      await flushPromises()
      expect(wrapper.get('textarea').element.value).toBe('')
      expect(wrapper.text()).not.toContain('私人问题')
      expect(wrapper.find('[data-testid="guide-turn"]').exists()).toBe(false)
      finish(json({ ...reply, paragraphs: ['旧组织的私人回复'] }))
      await flushPromises()
      expect(wrapper.text()).not.toContain('私人回复')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    },
  )

  it('ignores late failures after clear and unmount', async () => {
    let fail!: (reason: Error) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(() => new Promise((_, reject) => (fail = reject))),
    )
    const wrapper = renderGuide()
    await ask(wrapper)
    await wrapper.get('[data-testid="clear-guide"]').trigger('click')
    fail(new Error('旧错误不应回填'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧错误')
    await ask(wrapper)
    wrapper.unmount()
    fail(new Error('已离开的页面'))
    await flushPromises()
  })

  it('keeps at most ten turns without persistent storage and escapes untrusted content', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = renderGuide()
    for (let index = 0; index < 11; index++) await ask(wrapper, `问题 ${index}`)
    expect(wrapper.findAll('[data-testid="guide-turn"]')).toHaveLength(10)
    expect(wrapper.text()).not.toContain('问题 0')
    expect(storage).not.toHaveBeenCalled()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          ...reply,
          paragraphs: ['<img src=x onerror=alert(1)>'],
          actions: [{ label: '恶意链接', path: '//evil.test' }],
        }),
      ),
    )
    await ask(wrapper, '<script>alert(1)</script>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('a[href="//evil.test"]').exists()).toBe(false)
  })

  it('does not imply an existing report when personal guidance has no report source', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(json({ ...reply, source: null })),
    )
    const wrapper = renderGuide()
    await ask(wrapper)
    expect(wrapper.text()).toContain(reply.paragraphs[0])
    expect(wrapper.text()).not.toContain('基于本人报告')
    expect(wrapper.find('[data-testid="guide-source"]').exists()).toBe(false)
  })

  it.each(['not-ready', 'no-organization', 'logged-out'])(
    'keeps the guide unavailable with %s access',
    async (reason) => {
      if (reason === 'not-ready') useAccessStore().ready = false
      if (reason === 'no-organization') useAccessStore().organizationId = ''
      if (reason === 'logged-out') useAuthStore().accessToken = ''
      const wrapper = renderGuide()
      expect(wrapper.get('textarea').attributes('disabled')).toBeDefined()
      await wrapper.get('[data-testid="toggle-guide"]').trigger('click')
      await wrapper.get('[data-testid="guide-quick-question"]').trigger('click')
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})
