export const DIMENSIONS = [
  { code: 'foundations', name: '基础认知', color: '#6552A1' },
  { code: 'prompting', name: '提示词工程', color: '#168ABD' },
  { code: 'tool_use', name: '工具使用', color: '#5578B2' },
  { code: 'evaluation', name: '结果评估', color: '#B77717' },
  { code: 'collaboration', name: '人机协同', color: '#137F91' },
  { code: 'ethics', name: '伦理合规', color: '#6B8298' },
] as const
export const LEVEL_NAMES: Record<string, string> = {
  L1: '认知入门',
  L2: '规范使用',
  L3: '协同解决',
  L4: '设计治理',
}
export const MODE_NAMES: Record<string, string> = {
  rapid: '极速测',
  standard: '标准测',
  specialized: '专项测',
  fixed: '验证固定卷',
}
export const SCENARIO_NAMES: Record<string, string> = {
  general: '通用场景',
  higher_education: '高校学习',
  enterprise: '企业办公',
}
export const MEASURE_UI_ENABLED = import.meta.env.VITE_MEASURE_UI !== 'false'
// Presentation-only rollback: server drafts, evidence and deadlines remain enforced.
export const ASSESSMENT_REFERENCE_UI_ENABLED =
  import.meta.env.VITE_ASSESSMENT_REFERENCE_UI !== 'false'
