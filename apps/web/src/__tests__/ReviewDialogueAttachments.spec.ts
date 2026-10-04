import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewDialogueAttachments from '../components/ReviewDialogueAttachments.vue'
import {
  downloadReviewDialogueAttachment,
  getReviewDialogueAttachments,
  type ReviewDialogueAttachment,
} from '../services/reviewApi'

vi.mock('../services/reviewApi', () => ({
  getReviewDialogueAttachments: vi.fn<typeof getReviewDialogueAttachments>(),
  downloadReviewDialogueAttachment: vi.fn<typeof downloadReviewDialogueAttachment>(),
}))
const attachment: ReviewDialogueAttachment = {
  id: 'file-1',
  filename: '核验截图.png',
  media_type: 'image/png',
  byte_size: 3,
  sha256: 'a'.repeat(64),
  parse_status: 'manual_review',
  state: 'ready',
  bound_turn_id: 'turn-1',
  created_at: '2026-09-15T01:00:00Z',
}
const revoke = vi.fn<(url: string) => void>()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn<(blob: Blob) => string>(() => 'blob:dialogue-file'),
    revokeObjectURL: revoke,
  })
  vi.mocked(getReviewDialogueAttachments).mockResolvedValue({ attachments: [attachment] })
  vi.mocked(downloadReviewDialogueAttachment).mockResolvedValue(
    new Blob(['png'], { type: 'image/png' }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('ReviewDialogueAttachments', () => {
  it('loads private metadata on demand and calls out unread image evidence', async () => {
    const wrapper = mount(ReviewDialogueAttachments, { props: { decisionId: 'decision-1' } })
    expect(getReviewDialogueAttachments).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="dialogue-materials-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('需人工查看')
    expect(wrapper.text()).toContain('turn-1')
    expect(wrapper.text()).toContain(attachment.sha256)
    expect(downloadReviewDialogueAttachment).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="dialogue-file-load"]').trigger('click')
    await flushPromises()
    expect(downloadReviewDialogueAttachment).toHaveBeenCalledWith('decision-1', attachment)
    expect(wrapper.get('img').attributes('src')).toBe('blob:dialogue-file')
    expect(wrapper.get('a[download]').attributes('download')).toBe(attachment.filename)
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:dialogue-file')
  })

  it('invalidates a pending download and clears private metadata on a decision switch', async () => {
    let finish: (value: Blob) => void = () => undefined
    vi.mocked(downloadReviewDialogueAttachment).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(ReviewDialogueAttachments, { props: { decisionId: 'decision-1' } })
    await wrapper.get('[data-testid="dialogue-materials-load"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dialogue-file-load"]').trigger('click')
    await wrapper.setProps({ decisionId: 'decision-2' })
    finish(new Blob(['png'], { type: 'image/png' }))
    await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain(attachment.filename)
    wrapper.unmount()
  })

  it('clears preview and loaded filenames when access is revoked on refresh', async () => {
    const wrapper = mount(ReviewDialogueAttachments, { props: { decisionId: 'decision-1' } })
    await wrapper.get('[data-testid="dialogue-materials-load"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dialogue-file-load"]').trigger('click')
    await flushPromises()
    vi.mocked(getReviewDialogueAttachments).mockRejectedValueOnce(new Error('材料已匿名化。'))
    await wrapper.get('[data-testid="dialogue-materials-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('材料已匿名化')
    expect(wrapper.text()).not.toContain(attachment.filename)
    expect(wrapper.find('img,a[download]').exists()).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:dialogue-file')
    wrapper.unmount()
  })

  it('does not make failed or mismatched bytes available for preview', async () => {
    vi.mocked(downloadReviewDialogueAttachment).mockRejectedValueOnce(new Error('封存哈希不一致。'))
    const wrapper = mount(ReviewDialogueAttachments, { props: { decisionId: 'decision-1' } })
    await wrapper.get('[data-testid="dialogue-materials-load"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="dialogue-file-load"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('封存哈希不一致')
    expect(wrapper.find('img,a[download]').exists()).toBe(false)
    wrapper.unmount()
  })
})
