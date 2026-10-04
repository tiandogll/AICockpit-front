import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPracticalMaterials from '../components/ReviewPracticalMaterials.vue'
import {
  getReviewMaterials,
  downloadReviewArtifact,
  type ReviewMaterials,
} from '../services/reviewApi'

vi.mock('../services/reviewApi', () => ({
  getReviewMaterials: vi.fn<typeof getReviewMaterials>(),
  downloadReviewArtifact: vi.fn<typeof downloadReviewArtifact>(),
}))
const page: ReviewMaterials = {
  events: [
    {
      source_id: 'event:1',
      sequence: 1,
      event_type: 'verification',
      payload: { note: '<script>不可信核验记录</script>' },
      occurred_at: '2026-09-15T01:00:00Z',
    },
  ],
  interactions: [
    {
      source_id: 'interaction:1',
      sequence: 1,
      prompt: '检查计算',
      response: '模型建议',
      model_call_id: 'call-1',
      degraded: true,
      completed_at: '2026-09-15T01:00:00Z',
    },
  ],
  next_event_after: 1,
  next_interaction_after: null,
  artifact: {
    id: 'artifact-1',
    filename: '核验图.png',
    media_type: 'image/png',
    byte_size: 3,
    sha256: 'a'.repeat(64),
  },
}
const revoke = vi.fn<(url: string) => void>()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn<(blob: Blob) => string>(() => 'blob:review-file'),
    revokeObjectURL: revoke,
  })
  vi.mocked(getReviewMaterials).mockResolvedValue(page)
  vi.mocked(downloadReviewArtifact).mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})
afterEach(() => vi.unstubAllGlobals())

describe('ReviewPracticalMaterials', () => {
  it('invalidates an in-flight download when a later page revokes material access', async () => {
    let finish: (value: Blob) => void = () => undefined
    vi.mocked(downloadReviewArtifact).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(ReviewPracticalMaterials, { props: { decisionId: 'decision-1' } })
    await flushPromises()
    await wrapper.get('[data-testid="review-artifact-load"]').trigger('click')
    vi.mocked(getReviewMaterials).mockRejectedValueOnce(new Error('材料已匿名化。'))
    await wrapper.get('[data-testid="review-materials-more"]').trigger('click')
    await flushPromises()
    finish(new Blob(['png'], { type: 'image/png' }))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('材料已匿名化')
    wrapper.unmount()
  })
  it('loads paginated sealed evidence as text, with source identifiers and degradation state', async () => {
    const wrapper = mount(ReviewPracticalMaterials, { props: { decisionId: 'decision-1' } })
    await flushPromises()
    expect(wrapper.text()).toContain('不可信核验记录')
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('interaction:1')
    expect(wrapper.text()).toContain('降级')
    vi.mocked(getReviewMaterials).mockResolvedValueOnce({
      ...page,
      events: [{ ...page.events[0]!, source_id: 'event:2', sequence: 2 }],
      interactions: [],
      next_event_after: null,
    })
    await wrapper.get('[data-testid="review-materials-more"]').trigger('click')
    await flushPromises()
    expect(getReviewMaterials).toHaveBeenLastCalledWith('decision-1', 1, 1)
    expect(wrapper.text()).toContain('event:2')
    expect(wrapper.find('[data-testid="review-materials-more"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('loads an authenticated image only on request and revokes it when leaving the dossier', async () => {
    const wrapper = mount(ReviewPracticalMaterials, { props: { decisionId: 'decision-1' } })
    await flushPromises()
    expect(downloadReviewArtifact).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="review-artifact-load"]').trigger('click')
    await flushPromises()
    expect(downloadReviewArtifact).toHaveBeenCalledWith('decision-1', page.artifact)
    expect(wrapper.get('img').attributes('src')).toBe('blob:review-file')
    expect(wrapper.get('a[download]').attributes('download')).toBe('核验图.png')
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:review-file')
  })

  it('clears old private material on a decision switch and ignores a late response', async () => {
    let finish: (value: ReviewMaterials) => void = () => undefined
    vi.mocked(getReviewMaterials).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(ReviewPracticalMaterials, { props: { decisionId: 'old' } })
    vi.mocked(getReviewMaterials).mockRejectedValueOnce(new Error('材料已匿名化，无法访问。'))
    await wrapper.setProps({ decisionId: 'new' })
    await flushPromises()
    finish(page)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('无法访问')
    expect(wrapper.text()).not.toContain('不可信核验记录')
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not preview non-image artifacts or present failed downloads as available', async () => {
    vi.mocked(getReviewMaterials).mockResolvedValueOnce({
      ...page,
      artifact: { ...page.artifact!, filename: 'result.txt', media_type: 'text/plain' },
    })
    vi.mocked(downloadReviewArtifact).mockRejectedValueOnce(new Error('文件哈希校验失败。'))
    const wrapper = mount(ReviewPracticalMaterials, { props: { decisionId: 'decision-1' } })
    await flushPromises()
    await wrapper.get('[data-testid="review-artifact-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('校验失败')
    expect(wrapper.find('a[download], img').exists()).toBe(false)
    wrapper.unmount()
  })
})
