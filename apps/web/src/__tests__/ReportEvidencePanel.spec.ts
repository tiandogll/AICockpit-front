import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReportEvidencePanel from '../components/ReportEvidencePanel.vue'
import { getAssessmentReview, getAssessmentWorkspace } from '../services/assessmentWorkspaceApi'
import type {
  AssessmentReview,
  AssessmentWorkspace,
  IssuedAssessmentItem,
} from '../services/assessmentWorkspaceApi'
import type { TrustedReport } from '../services/reportApi'

vi.mock('../services/assessmentWorkspaceApi', () => ({
  getAssessmentReview: vi.fn(),
  getAssessmentWorkspace: vi.fn(),
}))

function report(session = 'session-1'): TrustedReport {
  return {
    id: `report-${session}`,
    session_id: session,
    revision: 1,
    is_complete: true,
    payload: {
      summary: { answered: 1 },
      measurement_status: 'complete',
      dimensions: { foundations: { theta: 0.2, standard_error: 0.7, evidence_count: 1 } },
    },
  }
}

function item(id = 'answer-1', sequence = 1): IssuedAssessmentItem {
  return {
    item_version_id: id,
    sequence,
    item_type: 'objective',
    dimension_code: 'foundations',
    answered_at: '2026-09-28T10:00:00Z',
    flagged: false,
  }
}

function workspace(items = [item()]): AssessmentWorkspace {
  return {
    session: {
      id: 'session-1',
      organization_id: 'org-1',
      blueprint_version_id: 'plan-1',
      mode: 'rapid',
      scenario: 'higher_education',
      status: 'completed',
      blueprint_snapshot: {},
      replayed: false,
    },
    server_now: '2026-09-28T10:00:00Z',
    blueprint_name: '极速测',
    min_items: 1,
    max_items: 1,
    answered_count: items.length,
    dispatched_count: items.length,
    flagged_count: 0,
    current_item: null,
    items,
    type_coverage: [],
    can_complete: false,
    completion_reason: 'completed',
    unmet_dimensions: [],
    unmet_item_types: [],
  }
}

function review(stem = '本人已提交的题目', answer = 'A'): AssessmentReview {
  return {
    item: {
      ...item(),
      session_id: 'session-1',
      difficulty: 0,
      stem,
      configuration: { correct_answer: 'HIDDEN_STANDARD_ANSWER', hidden_rubric: 'HIDDEN_RUBRIC' },
    },
    response: { selected_option: answer },
    draft: null,
    dialogue_turns: [],
    answered_at: '2026-09-28T10:00:00Z',
    read_only: true,
  }
}

function withEvidence(): TrustedReport {
  const value = report()
  value.payload.dimensions!.evaluation = {
    rubric_measurement: {
      completed: 1,
      pending: 0,
      mean_confidence: 0.8,
      mean_score: 3,
      decisions: [
        {
          decision_id: 'decision-1',
          item_type: 'dialogue',
          score: 3,
          confidence: 0.8,
          source: 'human',
          policy_version: 'policy-1',
          tasks: [
            {
              id: 'task-1',
              role: 'scorer',
              model: 'recorded-model',
              prompt_version: 'prompt-1',
              result_hash: 'hash-1',
              evidence: [
                {
                  criterion_code: 'verify',
                  score: 3,
                  confidence: 0.8,
                  quote: '我会核对原始来源',
                  rationale: '有来源核验行为',
                  evidence_hash: 'evidence-1',
                  verified: true,
                },
              ],
            },
          ],
        },
      ],
    },
  }
  return value
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const wrappers: ReturnType<typeof mount>[] = []
function render(props: {
  report: TrustedReport
  objectiveOnly?: boolean
  dimensionCodes?: string[]
}) {
  const wrapper = mount(ReportEvidencePanel, {
    props,
    global: {
      stubs: {
        AssessmentReadOnlyAttachments: true,
        ReportPracticalEvidence: true,
        AssessmentQuestionMedia: true,
      },
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function click(wrapper: ReturnType<typeof render>, label: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
  expect(button, `Missing button: ${label}`).toBeDefined()
  await button!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getAssessmentWorkspace).mockResolvedValue(workspace())
  vi.mocked(getAssessmentReview).mockResolvedValue(review())
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false
    },
  })
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
  Reflect.deleteProperty(HTMLDialogElement.prototype, 'close')
})

describe('ReportEvidencePanel contextual views', () => {
  it('opens real submitted answers for an objective report, without a zero-evidence tab', async () => {
    const wrapper = render({ report: report(), objectiveOnly: true })
    expect(wrapper.get('[role="status"]').text()).toContain('正在读取')
    await flushPromises()
    expect(getAssessmentWorkspace).toHaveBeenCalledWith('session-1')
    expect(wrapper.text()).not.toContain('关键证据 0')
    expect(wrapper.get('.answers-table').text()).toContain('第 1 题')
    expect(wrapper.text()).toContain('已提交 · 只读')
    await click(wrapper, '评分过程')
    expect(wrapper.text()).toContain('测量说明：客观题能力估计')
    expect(wrapper.text()).not.toContain('开放题')
  })

  it('shows a retry action when the answer directory fails, then displays the result', async () => {
    vi.mocked(getAssessmentWorkspace).mockRejectedValueOnce(new Error('连接暂时中断'))
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('连接暂时中断')
    expect(wrapper.find('.answers-table').exists()).toBe(false)
    await click(wrapper, '重新读取回答')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('查看原回答')
  })

  it('preserves genuine open evidence even if objectiveOnly was incorrectly supplied', async () => {
    const wrapper = render({ report: withEvidence(), objectiveOnly: true })
    expect(wrapper.text()).toContain('关键证据 1')
    expect(wrapper.text()).toContain('我会核对原始来源')
    expect(getAssessmentWorkspace).not.toHaveBeenCalled()
    await click(wrapper, '查看证据')
    expect(wrapper.get('dialog').text()).toContain('评分引用与依据')
    await click(wrapper, '进入全部回答')
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false)
    expect(wrapper.text()).toContain('查看原回答')
  })

  it('uses an honest empty state without a blank table when retained answers are unavailable', async () => {
    vi.mocked(getAssessmentWorkspace).mockResolvedValue(workspace([]))
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    expect(wrapper.text()).toContain('没有可读取的已提交回答')
    expect(wrapper.find('.answers-table').exists()).toBe(false)
    expect(wrapper.find('.pagination').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('关键证据 0')
  })

  it('defaults to answers while clearly explaining pending open-question scores', async () => {
    const pending = report()
    pending.is_complete = false
    pending.payload.measurement_status = 'needs_review'
    pending.payload.summary!.needs_review = 1
    const wrapper = render({ report: pending, objectiveOnly: true })
    await flushPromises()
    expect(wrapper.get('.scoring-note').text()).toContain('待处理不代表零分')
    expect(wrapper.find('.answers-table').exists()).toBe(true)
    await click(wrapper, '评分过程')
    expect(wrapper.text()).toContain('开放题仍在评分或复核中')
  })

  it('keeps a completed decision without quotes available in scoring process', async () => {
    const value = withEvidence()
    value.payload.dimensions!.evaluation!.rubric_measurement!.decisions[0]!.tasks = []
    const wrapper = render({ report: value, objectiveOnly: true })
    await flushPromises()
    expect(wrapper.find('.answers-table').exists()).toBe(true)
    await click(wrapper, '评分过程')
    expect(wrapper.text()).toContain('decision-1')
    expect(wrapper.text()).toContain('结果评估 · 3 / 4')
  })

  it('limits process dimensions to declared scope plus additional real evidence', async () => {
    const value = withEvidence()
    const wrapper = render({ report: value, dimensionCodes: ['prompting'] })
    await click(wrapper, '评分过程')
    const rows = wrapper.findAll('.process-ledger tbody tr')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.get('th').text())).toEqual(['基础认知', '提示词工程', '结果评估'])
    expect(wrapper.get('.process-ledger').text()).not.toContain('工具使用')
  })

  it('reads only submitted entries and paginates without returning hidden item configuration', async () => {
    vi.mocked(getAssessmentWorkspace).mockResolvedValue(
      workspace([
        ...Array.from({ length: 7 }, (_, i) => item(`answer-${i + 1}`, i + 1)),
        { ...item('unanswered', 8), answered_at: null },
      ]),
    )
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    expect(wrapper.findAll('.answers-table tbody tr')).toHaveLength(6)
    await click(wrapper, '下一页')
    expect(wrapper.findAll('.answers-table tbody tr')).toHaveLength(1)
    expect(wrapper.get('.answers-table').text()).toContain('第 7 题')
    expect(wrapper.get('.answers-table').text()).not.toContain('第 8 题')
    await click(wrapper, '查看原回答')
    expect(getAssessmentReview).toHaveBeenCalledWith('session-1', 'answer-7')
    expect(wrapper.get('dialog h4').text()).toBe('选择的选项')
    expect(wrapper.get('dialog pre').text()).toBe('A')
    expect(wrapper.get('dialog').text()).not.toContain('HIDDEN_STANDARD_ANSWER')
    expect(wrapper.get('dialog').text()).not.toContain('HIDDEN_RUBRIC')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('ignores a late answer directory response after switching reports', async () => {
    const oldRequest = deferred<AssessmentWorkspace>()
    vi.mocked(getAssessmentWorkspace)
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(workspace([item('new-answer', 9)]))
    const wrapper = render({ report: report(), objectiveOnly: true })
    await wrapper.setProps({ report: report('session-2') })
    await flushPromises()
    expect(wrapper.get('.answers-table').text()).toContain('第 9 题')
    oldRequest.resolve(workspace([item('old-answer', 3)]))
    await flushPromises()
    expect(wrapper.get('.answers-table').text()).not.toContain('第 3 题')
    expect(wrapper.get('.answers-table').text()).toContain('第 9 题')
  })

  it('closes old review and ignores its late response after switching reports', async () => {
    const oldRequest = deferred<AssessmentReview>()
    vi.mocked(getAssessmentReview).mockReturnValueOnce(oldRequest.promise)
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    await click(wrapper, '查看原回答')
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true)
    await wrapper.setProps({ report: report('session-2') })
    oldRequest.resolve(review('OLD_PRIVATE_STEM', 'OLD_PRIVATE_RESPONSE'))
    await flushPromises()
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false)
    expect(wrapper.html()).not.toContain('OLD_PRIVATE')
  })

  it('ignores a late review after closing the dialog and supports retrying a failure', async () => {
    const oldRequest = deferred<AssessmentReview>()
    vi.mocked(getAssessmentReview)
      .mockReturnValueOnce(oldRequest.promise)
      .mockRejectedValueOnce(new Error('原文暂不可用'))
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    await click(wrapper, '查看原回答')
    await wrapper.get('[aria-label="关闭证据详情"]').trigger('click')
    oldRequest.resolve(review('CLOSED_PRIVATE_STEM'))
    await flushPromises()
    expect(wrapper.html()).not.toContain('CLOSED_PRIVATE')
    await click(wrapper, '查看原回答')
    expect(wrapper.get('dialog [role="alert"]').text()).toContain('原文暂不可用')
    await click(wrapper, '重试原回答')
    expect(wrapper.get('dialog').text()).toContain('本人已提交的题目')
  })

  it('resets old review and directory on a newer revision of the same report', async () => {
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    await click(wrapper, '查看原回答')
    await wrapper.setProps({ report: { ...report(), revision: 2 } })
    await flushPromises()
    expect(getAssessmentWorkspace).toHaveBeenCalledTimes(2)
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(false)
    expect(wrapper.get('dialog').text()).not.toContain('本人已提交的题目')
  })

  it('keeps the selected view and original answer open on an unchanged report refresh', async () => {
    const wrapper = render({ report: report(), objectiveOnly: true })
    await flushPromises()
    await click(wrapper, '查看原回答')
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true)
    await wrapper.setProps({ report: report() })
    await flushPromises()
    expect(getAssessmentWorkspace).toHaveBeenCalledTimes(1)
    expect(wrapper.get<HTMLDialogElement>('dialog').element.open).toBe(true)
    expect(wrapper.get('dialog').text()).toContain('本人已提交的题目')
    await click(wrapper, '评分过程')
    await wrapper.setProps({ report: report() })
    await flushPromises()
    expect(wrapper.find('.process-ledger').exists()).toBe(true)
    expect(getAssessmentWorkspace).toHaveBeenCalledTimes(1)
  })
})
