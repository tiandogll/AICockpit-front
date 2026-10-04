import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import OrganizationAnalyticsView from '../views/OrganizationAnalyticsView.vue'

const organization = {
  id: 'org-1',
  name: '浙江智造学院',
  slug: 'zhejiang-ai',
  role: 'org_admin',
}
const overview = {
  organization_id: 'org-1',
  organization_name: '浙江智造学院',
  cohort_id: null,
  cohort_name: null,
  measurement_count: 6,
  methodology: 'expert_prior_not_norm',
  generated_at: '2026-08-24T12:00:00Z',
  suppressed: false,
  participant_count: 5,
  minimum_group_size: 5,
  dimensions: [
    {
      code: 'evaluation',
      sample_size: 5,
      levels: { L1: 1, L2: 1, L3: 2, L4: 1 },
      mean_theta: -0.12,
      mean_standard_error: 0.58,
      mean_evidence_count: 4,
    },
  ],
  common_gaps: [{ code: 'evaluation', mean_theta: -0.12, sample_size: 5 }],
}

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('OrganizationAnalyticsView', () => {
  it('leaves loading and retries when the initial organization list fails', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: '组织列表暂不可用' }), { status: 503 }),
      )
      .mockResolvedValueOnce(json([]))
    vi.stubGlobal('fetch', request)
    const wrapper = mount(OrganizationAnalyticsView)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('组织列表暂不可用')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('当前账号没有组织分析权限')
    expect(request).toHaveBeenCalledTimes(2)
    wrapper.unmount()
    vi.unstubAllGlobals()
  })

  it('does not replace the newest cohort with a late response or enable export while loading', async () => {
    let finish!: (response: Response) => void
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) return json([organization])
        if (url.endsWith('/cohorts'))
          return json([
            { id: 'slow', name: '慢班级', kind: 'class' },
            { id: 'fast', name: '快班级', kind: 'class' },
          ])
        if (url.includes('/analytics/overview')) {
          if (url.includes('cohort_id=slow'))
            return new Promise<Response>((resolve) => {
              finish = resolve
            })
          return json({ ...overview, participant_count: url.includes('cohort_id=fast') ? 9 : 5 })
        }
        if (url.includes('/security/status'))
          return json({
            model_tokens_used_today: 0,
            model_daily_token_quota: 250000,
            minimum_group_size: 5,
            retention_days: 90,
            recent_audit_events: 0,
          })
        return json([])
      }),
    )
    const wrapper = mount(OrganizationAnalyticsView)
    await flushPromises()
    await wrapper.get('[data-testid="cohort-select"]').setValue('slow')
    expect(wrapper.get('.scope-console button').attributes('disabled')).toBeDefined()
    await wrapper.get('[data-testid="cohort-select"]').setValue('fast')
    await flushPromises()
    expect(wrapper.text()).toContain('9 名去重参与者')
    finish(json({ ...overview, participant_count: 6 }))
    await flushPromises()
    expect(wrapper.text()).toContain('9 名去重参与者')
    expect(wrapper.text()).not.toContain('6 名去重参与者')
    wrapper.unmount()
    vi.unstubAllGlobals()
  })
  beforeEach(() => {
    sessionStorage.clear()
    sessionStorage.setItem(
      'zhijian-auth-session',
      JSON.stringify({ accessToken: 'access-token', refreshToken: 'refresh-token' }),
    )
    setActivePinia(createPinia())
  })

  it('renders a privacy-qualified six-dimension terrain and governance rail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) return json([organization])
        if (url.endsWith('/organizations/org-1/cohorts')) return json([])
        if (url.includes('/analytics/overview')) return json(overview)
        if (url.includes('/analytics/items')) {
          return json([
            {
              item_id: 'item-quality-1',
              logical_id: 'logical-1',
              version: 1,
              dimension_code: 'evaluation',
              item_type: 'objective',
              difficulty: 0.2,
              response_count: 5,
              participant_count: 5,
              objective_correct_rate: 0.6,
              objective_discrimination: 0.42,
              finalized_count: 0,
              mean_final_score: null,
              human_review_rate: null,
              suppressed: false,
            },
          ])
        }
        if (url.includes('/security/status')) {
          return json({
            organization_id: 'org-1',
            model_tokens_used_today: 25_000,
            model_daily_token_quota: 250_000,
            recent_audit_events: 7,
            retention_days: 90,
            minimum_group_size: 5,
          })
        }
        if (url.includes('/audit-events')) return json([])
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(OrganizationAnalyticsView)
    await flushPromises()

    expect(wrapper.text()).toContain('组织能力')
    expect(wrapper.text()).toContain('5 名去重参与者')
    expect(wrapper.get('[data-testid=terrain-evaluation]').text()).toContain('结果评估')
    expect(wrapper.text()).toContain('隐私门槛 k=5')
    expect(wrapper.text()).toContain('90 天')
    expect(wrapper.text()).toContain('60%')
    vi.unstubAllGlobals()
  })

  it('does not reveal exact participant or response counts below k', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input)
        if (url.endsWith('/organizations')) return json([organization])
        if (url.endsWith('/organizations/org-1/cohorts')) return json([])
        if (url.includes('/analytics/overview')) {
          return json({
            ...overview,
            suppressed: true,
            participant_count: null,
            dimensions: [],
            common_gaps: [],
          })
        }
        if (url.includes('/analytics/items')) {
          return json([
            {
              item_id: 'item-private',
              logical_id: 'logical-private',
              version: 1,
              dimension_code: 'evaluation',
              item_type: 'objective',
              difficulty: 0.2,
              response_count: null,
              participant_count: null,
              objective_correct_rate: null,
              objective_discrimination: null,
              finalized_count: 0,
              mean_final_score: null,
              human_review_rate: null,
              suppressed: true,
            },
          ])
        }
        if (url.includes('/security/status')) {
          return json({
            organization_id: 'org-1',
            model_tokens_used_today: 0,
            model_daily_token_quota: 250_000,
            recent_audit_events: 0,
            retention_days: 90,
            minimum_group_size: 5,
          })
        }
        if (url.includes('/audit-events')) return json([])
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const wrapper = mount(OrganizationAnalyticsView)
    await flushPromises()

    expect(wrapper.text()).toContain('不足5 名去重参与者')
    expect(wrapper.text()).toContain('不足5人')
    expect(wrapper.text()).not.toContain('1人 / 5次')
    vi.unstubAllGlobals()
  })
})
