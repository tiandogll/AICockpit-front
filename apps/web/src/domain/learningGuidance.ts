import { DIMENSIONS } from './capabilities'

// Authored study prompts, not a diagnosis, model answer or scored training record.
export const LEARNING_GUIDANCE = [
  {
    code: 'foundations',
    title: '分清事实与模型推断',
    summary: '给 AI 输出里的事实找依据，把无法确认的信息留作待核验。',
    example: '找一段日常学习摘要，分别标出材料中已有的事实、模型给出的建议和没有出处的推断。',
    steps: [
      '选一份可公开使用的原始材料，保留原文。',
      '逐条对照摘要，为事实注明原文位置。',
      '把没有依据的内容标为待确认，写出找谁或到哪里核实。',
    ],
    check: '每个事实都有出处；找不到依据的内容没有被当成确定结论。',
  },
  {
    code: 'prompting',
    title: '把要求写成验收条件',
    summary: '明确输入范围、输出格式与缺失信息规则，再用小样例检查。',
    example: '用三份公开课程简介整理比较表，先写清需要哪些字段，以及没有提供的信息怎样标注。',
    steps: [
      '说明目的、读者和允许使用的材料。',
      '约定输出字段、格式及“未提供”的处理方式。',
      '先试一份材料，对照原文检查，再只修改不符合要求的约束。',
    ],
    check: '能说明哪一项约束解决了哪一个具体问题，而不只是让提示变长。',
  },
  {
    code: 'tool_use',
    title: '用小样本核验工具输出',
    summary: '先决定任务需要检索、计算还是整理，再验证工具能否正确处理。',
    example: '用一份虚构报名表测试统计流程，主动放入一条重复记录和一个空值。',
    steps: [
      '记录工具、输入格式与统计口径。',
      '手工核算小样本，检查重复项、空值和单位。',
      '保留公式或操作步骤，确认结果一致后再扩大处理范围。',
    ],
    check: '别人能按记录复算出相同结果，并知道异常数据如何处理。',
  },
  {
    code: 'evaluation',
    title: '建立来源核验清单',
    summary: '检查原始出处、发布时间和统计口径，不以多个网页重复出现作为证明。',
    example: '选择一个公开数字，找到原始发布页面，再比较两处转述是否使用了相同范围和时间。',
    steps: [
      '区分原始材料与二手转述，记录链接和日期。',
      '核对单位、样本、时间范围及适用条件。',
      '写明已确认、仍有分歧和不能判断的部分。',
    ],
    check: '结论有可追溯来源，分歧有解释，不确定性被明确保留。',
  },
  {
    code: 'collaboration',
    title: '保留一次完整迭代记录',
    summary: '由人确定目标与验收标准，让 AI 协助草拟，再根据具体问题改进。',
    example: '用不含隐私的材料起草一份活动安排，记录初稿、发现的问题以及修改后的结果。',
    steps: [
      '划清哪些步骤交给 AI，哪些决定由自己负责。',
      '按验收标准指出一个具体偏差，给出可执行反馈。',
      '比较修改前后结果，记录仍需人工处理的内容。',
    ],
    check: '能解释为什么接受或拒绝某个建议，而不只是复制最终输出。',
  },
  {
    code: 'ethics',
    title: '先检查数据与使用边界',
    summary: '发送材料前检查个人信息、使用权限和是否有必要外发。',
    example: '用一份虚构名单练习去掉姓名、电话等无关字段，只保留完成统计所需的信息。',
    steps: [
      '列出任务必需字段，删除无关个人信息。',
      '确认材料许可、接收方和保存范围。',
      '检查结果中是否重新暴露了身份，记录删除或保留的理由。',
    ],
    check: '能够说明使用了什么数据、为什么需要，以及如何控制暴露范围。',
  },
].map((item) => ({
  ...item,
  name: DIMENSIONS.find((dimension) => dimension.code === item.code)!.name,
}))

export function hasTrainingTarget(
  dimensions: Array<{ index: number | null; evidence_count: number }>,
) {
  return dimensions.some(
    (row) =>
      typeof row.index === 'number' &&
      Number.isFinite(row.index) &&
      row.index >= 0 &&
      row.index < 50 &&
      row.evidence_count >= 2,
  )
}

export function hasTrainingEvidence(
  dimensions: Array<{ index: number | null; evidence_count: number }>,
) {
  return dimensions.some(
    (row) =>
      typeof row.index === 'number' &&
      Number.isFinite(row.index) &&
      row.index >= 0 &&
      row.index <= 100 &&
      row.evidence_count >= 2,
  )
}
