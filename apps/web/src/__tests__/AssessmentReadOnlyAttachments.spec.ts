import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AssessmentReadOnlyAttachments from '../components/AssessmentReadOnlyAttachments.vue'
import {
  downloadDialogueAttachment,
  getDialogueAttachments,
  type DialogueAttachment,
} from '../services/assessmentWorkspaceApi'

vi.mock('../services/assessmentWorkspaceApi', () => ({
  getDialogueAttachments: vi.fn<typeof getDialogueAttachments>(),
  downloadDialogueAttachment: vi.fn<typeof downloadDialogueAttachment>(),
}))
const file: DialogueAttachment = {
  id: 'a',
  filename: '核验.txt',
  media_type: 'text/plain',
  byte_size: 3,
  sha256: 'a'.repeat(64),
  state: 'ready',
  parse_status: 'text_ready',
  bound_turn_id: 'turn-1',
  created_at: '2026-09-15T00:00:00Z',
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getDialogueAttachments).mockResolvedValue({
    attachments: [
      file,
      { ...file, id: 'b', state: 'failed', filename: '失败.txt' },
      { ...file, id: 'c', bound_turn_id: null, filename: '未提交.txt' },
    ],
  })
  vi.mocked(downloadDialogueAttachment).mockResolvedValue()
})
describe('AssessmentReadOnlyAttachments', () => {
  it('shows only ready private files and distinguishes unsubmitted material', async () => {
    const wrapper = mount(AssessmentReadOnlyAttachments, { props: { sessionId: 's', itemId: 'q' } })
    await flushPromises()
    expect(wrapper.text()).toContain('核验.txt')
    expect(wrapper.text()).not.toContain('失败.txt')
    expect(wrapper.text()).toContain('尚未随回答正式提交')
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.get('[aria-label="下载核验.txt"]').trigger('click')
    expect(downloadDialogueAttachment).toHaveBeenCalledWith('s', 'q', file, expect.any(AbortSignal))
    wrapper.unmount()
  })
  it('ignores old private metadata when the item changes', async () => {
    let finish: (value: { attachments: DialogueAttachment[] }) => void = () => undefined
    vi.mocked(getDialogueAttachments).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(AssessmentReadOnlyAttachments, {
      props: { sessionId: 's', itemId: 'old' },
    })
    vi.mocked(getDialogueAttachments).mockResolvedValueOnce({ attachments: [] })
    await wrapper.setProps({ itemId: 'new' })
    finish({ attachments: [file] })
    await flushPromises()
    expect(wrapper.text()).not.toContain(file.filename)
    expect(wrapper.text()).toContain('没有可读取的附件')
    wrapper.unmount()
  })

  it('aborts a pending authorized download when leaving the item', async () => {
    let finish: () => void = () => undefined
    vi.mocked(downloadDialogueAttachment).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(AssessmentReadOnlyAttachments, { props: { sessionId: 's', itemId: 'q' } })
    await flushPromises()
    await wrapper.get('[aria-label="下载核验.txt"]').trigger('click')
    const signal = vi.mocked(downloadDialogueAttachment).mock.calls[0]?.[3]
    expect(signal?.aborted).toBe(false)
    await wrapper.setProps({ itemId: 'next' })
    expect(signal?.aborted).toBe(true)
    finish()
    await flushPromises()
    wrapper.unmount()
  })
})
