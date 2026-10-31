// zh-CN labels for every enum the UI shows (FC-05). Unknown values fall back to the raw value
// and are reported once to the console, so a new backend value is visible instead of blank.

const reported = new Set<string>()

export function label(
  map: Readonly<Record<string, string>>,
  key: string | null | undefined,
  group = "enum",
): string {
  if (key === null || key === undefined || key === "") return "—"
  const text = map[key]
  if (text !== undefined) return text
  const id = `${group}:${key}`
  if (!reported.has(id)) {
    reported.add(id)
    console.warn(`Unknown ${group} value: ${key}`)
  }
  return key
}

export const FLOW_STATUS_LABEL = {
  queued: "排队中",
  generating: "生成中",
  checking: "检查中",
  checks_completed: "检查已完成，请查看结果",
  needs_human_review: "需人工复核",
  constraint_failed: "约束未通过",
  edited_pending_recheck: "已编辑待复检",
  ready_to_copy: "可复制（运营已确认）",
} as const

export const PROGRESS_STAGE_LABEL = {
  retrieving: "检索资料",
  generating: "生成中",
  constraint_check: "约束检查",
  evidence: "核对依据",
  compliance: "风险提示",
  rewriting: "改写中",
  done: "完成",
} as const

export const EVIDENCE_STATUS_LABEL = {
  system_supported: "系统判定支持",
  evidence_missing: "未找到证据",
  needs_human_review: "需人工复核",
} as const

export const SOURCE_LEVEL_LABEL = {
  approved_kb: "已审核知识库",
  task_material: "任务内资料（未审核）",
} as const

export const DOCUMENT_STATUS_LABEL = {
  pending_review: "待审核",
  approved: "已入库",
  rejected: "已驳回",
  deactivated: "已停用",
} as const

export const SEVERITY_LABEL = {
  block: "必须修改",
  warn: "建议关注",
} as const

export const LAYER_LABEL = {
  lexicon: "词表",
  context: "语境",
  efficacy_basis: "功效依据",
} as const

export const ROLE_LABEL = {
  admin: "品牌管理员",
  editor: "编辑者",
} as const

export const ORIGIN_LABEL = {
  generated: "系统生成",
  edited: "人工编辑",
  rewritten: "改写",
} as const

export const LENGTH_LABEL = {
  short: "偏短",
  medium: "适中",
  long: "偏长",
} as const
export const PERSON_LABEL = {
  first: "第一人称",
  second: "第二人称",
  third: "第三人称",
} as const
export const EMOJI_LABEL = {
  low: "很少",
  medium: "适量",
  high: "较多",
} as const

export const BRAND_CATEGORY_LABEL = {
  perfume: "香水",
  skincare: "护肤",
  makeup: "彩妆",
  home_fragrance: "家居香氛",
  other: "其他",
} as const

export const REJECT_CODE_LABEL: Record<string, string> = {
  status_not_confirmable: "当前状态不允许确认",
  checks_not_run: "检查还没有针对这份文字运行",
  constraints_failed: "约束检查没有通过",
  open_block_risks: "还有“必须修改”的风险提示没有处理",
  rejected_claims: "有断言被判为不成立",
  unconfirmed_claims: "有断言还没有人工判断",
  not_latest_version: "只有最新版本可以确认",
}
