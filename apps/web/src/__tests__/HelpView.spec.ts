import { mount, RouterLinkStub, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import HelpView from '../views/HelpView.vue'

const wrappers: VueWrapper[] = []

function helpNotice() {
  const wrapper = mount(HelpView, {
    global: { stubs: { RouterLink: RouterLinkStub } },
  })
  wrappers.push(wrapper)
  return wrapper.get('.help-note').text()
}

afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('HelpView growth assistant guidance', () => {
  it('describes model-only chat without a local fallback or a checkbox requirement', () => {
    const notice = helpNotice()

    expect(notice).toContain('普通问答统一由 DeepSeek 生成')
    expect(notice).toContain('不会用本地固定文案冒充模型回答')
    expect(notice).not.toContain('发送前需勾选同意')
    expect(notice).not.toContain('问题不会发送给外部模型')
    expect(notice).not.toContain('目前提供本地规则引导')
  })

  it('explains direct sending and upload with their data scope and possible costs', () => {
    const notice = helpNotice()

    expect(notice).toContain('点击发送、按 Enter 或选择快捷问题后')
    expect(notice).toContain('选择图片或文档后即上传服务器提取文字')
    expect(notice).not.toContain('确认发送后')
    expect(notice).toContain(
      '本次问题、所选材料的提取文字与必要的本人报告摘要会直接发送给 DeepSeek',
    )
    expect(notice).toContain('不自动读取正式测评作答原文')
    expect(notice).toContain('模型调用可能产生费用')
    expect(notice).toContain('失败或中断的请求也可能计费')
    expect(notice).toContain('请勿在问题中输入隐私信息')
  })

  it('distinguishes active answering from saved sessions and excludes protected reports', () => {
    const notice = helpNotice()

    expect(notice).toContain('正式作答期间')
    expect(notice).toContain('成长助手暂停问答与材料上传')
    expect(notice).toContain('暂存退出后可使用成长助手')
    expect(notice).toContain('实操题内按题目规则允许的受控 AI 交互仍可使用')
    expect(notice).toContain('报告未定稿或受隐私保护时，不将其摘要发送给模型')
    expect(notice).toContain('模型不可用时明确显示失败原因')
    expect(notice).toContain('成长建议不修改正式测评结果')
  })

  it('describes ten in-memory display turns without promising persistent model context', () => {
    const notice = helpNotice()

    expect(notice).toContain('最近 10 次问答仅在当前页面内存中展示')
    expect(notice).toContain('不是持久会话，也不会作为多轮上下文发送给模型')
    expect(notice).toContain('刷新、离开页面、清空问答或切换账号后清空')
    expect(notice).toContain('不支持恢复')
  })

  it('does not present training attachments, feedback or preview practice as completed capabilities', () => {
    const notice = helpNotice()

    expect(notice).toContain('成长助手已支持文档文字提取与图片 OCR，非完整视觉理解')
    expect(notice).toContain('百宝箱智能问答、持久会话和反馈工单仍待接入')
    expect(notice).toContain('训练预览仅提供形成性练习，不代表专家认证')
    expect(notice).toContain('练习反馈为核验清单提示，并非 AI 判分')
  })
})
