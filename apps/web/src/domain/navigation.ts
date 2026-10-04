import {
  BarChart3,
  BookOpen,
  CheckCheck,
  ClipboardCheck,
  FlaskConical,
  HelpCircle,
  History,
  House,
  Settings,
  ShieldCheck,
  Users,
} from '@lucide/vue'
import { STAFF_CAPABILITIES } from './loginPortal'

export function isStaffPath(path: string, can: (capability: string) => boolean) {
  return (
    [
      '/teaching',
      '/analytics',
      '/members',
      '/item-bank',
      '/authoring',
      '/reviews',
      '/cat-lab',
      '/system',
      '/workbench',
    ].some((entry) => path === entry || path.startsWith(entry + '/')) ||
    (path === '/pilot-lab' && (can('pilots_manage') || can('system')))
  )
}

export function navigationGroups(
  can: (capability: string) => boolean,
  singlePlatform = false,
  portal: 'all' | 'learner' | 'staff' = 'all',
) {
  const groups = [
    {
      title: singlePlatform ? '学员中心' : '个人空间',
      items: [
        { path: '/workspace', label: '工作台', icon: House },
        { path: '/assessment', label: '能力测评', icon: ClipboardCheck },
        { path: '/reports', label: '能力报告', icon: BarChart3 },
        { path: '/training', label: '训练计划', icon: BookOpen },
        { path: '/history', label: '历史记录', icon: History },
      ],
    },
    {
      title: portal === 'staff' ? '教师管理端' : '管理中心',
      items: [
        ...(portal === 'staff' && STAFF_CAPABILITIES.some(can)
          ? [{ path: '/teaching', label: '管理工作台', icon: House, capability: '' }]
          : []),
        {
          path: '/analytics',
          label: singlePlatform ? '学员分析' : '组织分析',
          icon: BarChart3,
          capability: 'analytics',
        },
        {
          path: '/members',
          label: singlePlatform ? '学员管理' : '成员与班级',
          icon: Users,
          capability: 'members',
        },
        { path: '/item-bank', label: '题库与量规', icon: BookOpen, capability: 'content' },
        { path: '/authoring', label: '我的出题任务', icon: BookOpen, capability: 'content_author' },
        { path: '/reviews', label: '评分复核', icon: CheckCheck, capability: 'reviews' },
      ].filter(
        (item) =>
          (!item.capability || can(item.capability)) &&
          !(singlePlatform && item.path === '/authoring'),
      ),
    },
    {
      title: '验证与治理',
      items: [
        {
          path: '/pilot-lab',
          label: '真实试测',
          icon: FlaskConical,
          allowed: can('pilot_participate') || can('pilots_manage') || can('system'),
        },
        { path: '/cat-lab', label: 'CAT 实验室', icon: FlaskConical, allowed: can('cat') },
        {
          path: '/system',
          label: '模型与数据安全',
          icon: ShieldCheck,
          allowed: can('system') || can('governance'),
        },
        { path: '/workbench', label: '开发验收工作台', icon: Settings, allowed: can('system') },
      ].filter((item) => item.allowed),
    },
  ]
  if (portal === 'learner') {
    return [
      { ...groups[0]!, title: '学员端' },
      {
        title: '试测参与',
        items: can('pilot_participate')
          ? groups[2]!.items.filter((item) => item.path === '/pilot-lab')
          : [],
      },
    ].filter((group) => group.items.length)
  }
  if (portal === 'staff') {
    return groups
      .slice(1)
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) => item.path !== '/pilot-lab' || can('pilots_manage') || can('system'),
        ),
      }))
      .filter((group) => group.items.length)
  }
  return groups.filter((group) => group.items.length)
}
export const helpLink = { path: '/help', label: '问题与帮助', icon: HelpCircle }
