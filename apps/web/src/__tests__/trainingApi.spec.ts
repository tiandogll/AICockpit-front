import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createTrainingPlan,
  getTrainingPlans,
  startTrainingRetest,
  submitTrainingTask,
  trainingUnavailableReason,
} from '../services/trainingApi'
import { useAccessStore } from '../stores/access'

describe('training API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'token', refreshToken: 'refresh' }),
    )
    setActivePinia(createPinia())
  })
  afterEach(() => vi.unstubAllGlobals())
  it('starts a server-bound retest without accepting client assessment configuration', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"plan":{},"replayed":false}'))
    vi.stubGlobal('fetch', request)
    await startTrainingRetest('plan/1', 'stable-retest-attempt')
    expect(String(request.mock.calls[0]![0])).toContain('/training/plan%2F1/retest/start')
    expect(request.mock.calls[0]![1]?.method).toBe('POST')
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({})
    expect(new Headers(request.mock.calls[0]![1]?.headers).get('Idempotency-Key')).toBe(
      'stable-retest-attempt',
    )
  })
  it('does not promise a comparable retest for a legacy platform baseline', () => {
    expect(trainingUnavailableReason('legacy_platform_baseline')).toContain('重新建立可比基线')
  })
  it('lists owned historical plans across preserved memberships on one platform', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"items":[],"total":0,"limit":20,"offset":0}'))
    vi.stubGlobal('fetch', request)
    useAccessStore().singlePlatform = true
    await getTrainingPlans('platform', 20, 0, 'legacy-report')
    const query = new URL(String(request.mock.calls[0]![0])).searchParams
    expect(query.has('organization_id')).toBe(false)
    expect(query.get('source_report_id')).toBe('legacy-report')
  })
  it('sends report ID, explicit revision and caller-owned stable idempotency key', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"plan":{},"replayed":false}', { status: 201 }))
    vi.stubGlobal('fetch', request)
    await createTrainingPlan(
      { organization_id: 'org-1', source_report_id: 'report-1', expected_report_revision: 2 },
      'stable-key-123',
    )
    expect(JSON.parse(String(request.mock.calls[0]![1]?.body))).toEqual({
      organization_id: 'org-1',
      source_report_id: 'report-1',
      expected_report_revision: 2,
    })
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get('Idempotency-Key')).toBe(
      'stable-key-123',
    )
  })
  it('keeps application verification separate and preserves conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"detail":"已完成的任务不可修改"}', { status: 409 })),
    )
    await expect(
      submitTrainingTask(
        'plan-1',
        'task-1',
        { application: '应用记录', verification: '核验记录' },
        'stable-key-456',
      ),
    ).rejects.toThrow('已完成的任务不可修改')
  })

  it('resolves the latest plan for a report independently of the visible list page', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"items":[],"total":0,"limit":1,"offset":0}', { status: 200 }),
      )
    vi.stubGlobal('fetch', request)
    await getTrainingPlans('org-1', 1, 0, 'report-specific')
    const query = new URL(String(request.mock.calls[0]![0])).searchParams
    expect(query.get('source_report_id')).toBe('report-specific')
    expect(query.get('limit')).toBe('1')
    expect(query.get('offset')).toBe('0')
  })

  it('explains unavailable personal training scope without hiding a 404 as an empty plan', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"detail":"Training record not found"}', { status: 404 })),
    )
    await expect(getTrainingPlans('managed-but-not-member')).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining('本人所属组织'),
    })
  })

  it.each([
    ['No sufficiently evidenced low dimensions for training', '当前报告尚无至少 2 项证据'],
    ['Source report revision changed; review it before generating', '来源报告已更新'],
    ['Pinned blueprint must still be published to create training', '来源题卷已停用'],
    ['Retest must be a new compatible completed assessment with a final report', '复测必须'],
    ['Finish or end the existing assessment before starting this training retest', '先在测评中心'],
    ['Retest unavailable: pinned_blueprint_not_in_catalog', '移出当前测评目录'],
    ['Retest unavailable: pinned_blueprint_snapshot_changed', '方案配置已改变'],
    ['Link the bound training retest; another assessment cannot replace it', '已有专属复测'],
  ])(
    'translates actionable training conflicts without hiding status: %s',
    async (detail, expected) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 409 })),
      )
      const result = createTrainingPlan(
        { organization_id: 'org-1', source_report_id: 'r', expected_report_revision: 1 },
        'training-test-key',
      )
      await expect(result).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining(expected),
      })
    },
  )
})
