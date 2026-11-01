import {
  BarChart3,
  BookUser,
  Building2,
  ClipboardCheck,
  FlaskConical,
  History,
  Library,
  type LucideIcon,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react"

export type NavItem = {
  title: string
  path: string
  icon: LucideIcon
  // member: any member of the current brand; admin: brand admin only; all: every signed-in user;
  // platform: platform administrators only (is_superuser).
  access: "member" | "admin" | "all" | "platform"
}

export type NavGroup = { title: string; items: NavItem[] }

// Only pages that exist are listed (FC-10: no placeholder links). New pages are added here when they
// land; the order and groups follow technical doc table 4-3.
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "创作",
    items: [
      {
        title: "生成工作台",
        path: "/generate",
        icon: Sparkles,
        access: "member",
      },
      {
        title: "任务与版本历史",
        path: "/tasks",
        icon: History,
        access: "member",
      },
    ],
  },
  {
    title: "品牌与商品",
    items: [
      { title: "品牌与切换", path: "/brands", icon: Building2, access: "all" },
      { title: "商品管理", path: "/products", icon: Package, access: "member" },
      {
        title: "品牌档案",
        path: "/voice-profile",
        icon: BookUser,
        access: "member",
      },
    ],
  },
  {
    title: "知识库",
    items: [
      {
        title: "资料列表与上传",
        path: "/knowledge",
        icon: Library,
        access: "member",
      },
      {
        title: "待审队列",
        path: "/knowledge/review",
        icon: ClipboardCheck,
        access: "admin",
      },
    ],
  },
  {
    title: "质量与评测",
    items: [
      {
        title: "评测集",
        path: "/evaluation/datasets",
        icon: FlaskConical,
        access: "admin",
      },
      {
        title: "评测运行与报告",
        path: "/evaluation/runs",
        icon: BarChart3,
        access: "admin",
      },
      {
        title: "风险提示规则",
        path: "/compliance/rules",
        icon: ShieldCheck,
        access: "all",
      },
    ],
  },
  {
    title: "系统",
    items: [
      { title: "用户设置", path: "/settings", icon: Settings, access: "all" },
      { title: "用户管理", path: "/admin", icon: Users, access: "platform" },
    ],
  },
  {
    title: "增强",
    items: [
      {
        title: "爆款结构分析",
        path: "/viral-samples",
        icon: TrendingUp,
        access: "member",
      },
    ],
  },
]

export function visibleGroups(options: {
  isMember: boolean
  isAdmin: boolean
  isPlatform: boolean
}): NavGroup[] {
  const allowed = (item: NavItem) =>
    item.access === "all" ||
    (item.access === "member" && options.isMember) ||
    (item.access === "admin" && options.isAdmin) ||
    (item.access === "platform" && options.isPlatform)
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter(allowed),
  })).filter((g) => g.items.length > 0)
}
