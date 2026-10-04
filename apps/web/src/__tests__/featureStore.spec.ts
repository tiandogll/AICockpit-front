import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFeatureStore } from '../stores/features'
import { useAuthStore } from '../stores/auth'

const available = {
  training_enabled: true,
  training_content_status: 'formative_preview',
  growth_guide_mode: 'local_guidance',
  attachments_enabled: false,
}
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
describe('runtime feature availability', () => {
  it('reads the active answering restriction independently of saved unfinished sessions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({ ...available, assessment_in_progress: true }))
        .mockResolvedValueOnce(json({ ...available, assessment_in_progress: false })),
    )
    const features = useFeatureStore()
    await features.load()
    expect(features.assessmentInProgress).toBe(true)
    await features.load(true)
    expect(features.assessmentInProgress).toBe(false)
  })
  it('accepts DeepSeek availability without disabling training and resets it on logout', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ ...available, growth_guide_mode: 'deepseek' })),
    )
    const features = useFeatureStore()
    await features.load()
    expect(features.growthGuideMode).toBe('deepseek')
    expect(features.trainingEnabled).toBe(true)
    useAuthStore().accessToken = ''
    expect(features.growthGuideMode).toBe('local_guidance')
  })
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'a', refreshToken: 'r' }),
    )
    setActivePinia(createPinia())
    useAuthStore().user = { id: 'u', email: null, display_name: '学员', is_active: true }
  })
  afterEach(() => vi.unstubAllGlobals())
  it('fails closed while unknown and uses the server rather than build flags', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json(available))
    vi.stubGlobal('fetch', request)
    const features = useFeatureStore()
    expect(features.trainingEnabled).toBe(false)
    await features.load()
    expect(request.mock.calls[0]?.[0]).toContain('/workspace/features')
    expect(features.trainingEnabled).toBe(true)
    expect(features.ready).toBe(true)
  })
  it('clears enabled state on a failed refresh and supports explicit retry', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(available))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ...available, training_enabled: false }))
    vi.stubGlobal('fetch', request)
    const features = useFeatureStore()
    await features.load()
    await features.load(true)
    expect(features.trainingEnabled).toBe(false)
    expect(features.error).toBeTruthy()
    await features.load(true)
    expect(features.error).toBe('')
    expect(features.ready).toBe(true)
    expect(features.trainingEnabled).toBe(false)
  })
  it('rejects malformed capabilities instead of treating a string as true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(json({ ...available, training_enabled: 'true' })),
    )
    const features = useFeatureStore()
    await features.load()
    expect(features.trainingEnabled).toBe(false)
    expect(features.ready).toBe(false)
    expect(features.error).toBeTruthy()
  })
  it('deduplicates even forced reads and reloads after an identity change without accepting stale data', async () => {
    const resolvers: ((response: Response) => void)[] = []
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((done) => {
          resolvers.push(done)
        }),
    )
    vi.stubGlobal('fetch', request)
    const features = useFeatureStore()
    const first = features.load()
    const second = features.load(true)
    expect(request).toHaveBeenCalledTimes(1)
    useAuthStore().user = { id: 'other', email: null, display_name: '另一位', is_active: true }
    expect(request).toHaveBeenCalledTimes(2)
    resolvers[0]!(json({ ...available, growth_guide_mode: 'deepseek', attachments_enabled: true }))
    await Promise.all([first, second])
    expect(features.trainingEnabled).toBe(false)
    expect(features.ready).toBe(false)
    expect(features.loading).toBe(true)
    expect(features.growthGuideMode).toBe('local_guidance')
    resolvers[1]!(json(available))
    await flushPromises()
    expect(features.ready).toBe(true)
    expect(features.growthGuideMode).toBe('local_guidance')
    expect(features.attachmentsEnabled).toBe(false)
  })
  it('waits for hydrated identity, then loads capabilities for a restored or newly logged-in account', async () => {
    const auth = useAuthStore()
    auth.user = null
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        json({ ...available, growth_guide_mode: 'deepseek', attachments_enabled: true }),
      )
    vi.stubGlobal('fetch', request)
    const features = useFeatureStore()
    await features.load()
    expect(request).not.toHaveBeenCalled()
    expect(features.ready).toBe(false)
    auth.user = { id: 'hydrated', email: null, display_name: '学员', is_active: true }
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(1)
    expect(features.ready).toBe(true)
    expect(features.growthGuideMode).toBe('deepseek')
    expect(features.attachmentsEnabled).toBe(true)
  })
  it('preserves the verified provider during refresh but fails closed for enabled actions', async () => {
    let resolveRefresh!: (response: Response) => void
    const deepseek = { ...available, growth_guide_mode: 'deepseek', attachments_enabled: true }
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(deepseek))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          }),
      )
      .mockResolvedValueOnce(json(deepseek))
    vi.stubGlobal('fetch', request)
    const features = useFeatureStore()
    await features.load()
    const refresh = features.load(true)
    expect(features.growthGuideMode).toBe('deepseek')
    expect(features.ready).toBe(false)
    expect(features.trainingEnabled).toBe(false)
    expect(features.attachmentsEnabled).toBe(false)
    resolveRefresh(json({}, 503))
    await refresh
    expect(features.error).toBeTruthy()
    expect(features.growthGuideMode).toBe('deepseek')
    expect(features.ready).toBe(false)
    expect(features.trainingEnabled).toBe(false)
    expect(features.attachmentsEnabled).toBe(false)
    await features.load(true)
    expect(features.ready).toBe(true)
    expect(features.attachmentsEnabled).toBe(true)
  })
  it('does not let a late response revive feature access after logout', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        () =>
          new Promise((done) => {
            resolve = done
          }),
      ),
    )
    const features = useFeatureStore()
    const flight = features.load()
    useAuthStore().accessToken = ''
    resolve(json({ ...available, growth_guide_mode: 'deepseek', attachments_enabled: true }))
    await flight
    expect(features.ready).toBe(false)
    expect(features.loading).toBe(false)
    expect(features.growthGuideMode).toBe('local_guidance')
    expect(features.attachmentsEnabled).toBe(false)
  })
})
