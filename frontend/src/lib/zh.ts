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

export const SCENE_LABEL = {
  seeding: "种草",
  review: "测评",
  tutorial: "教程",
  launch: "上新",
  promotion: "促销",
  story: "故事",
} as const
export const VIRAL_REASON_LABEL = {
  schema_invalid: "分析输出不符合结构要求",
  copied_text: "输出与样本文字连续重复，未保存",
  format_invalid: "结构指引含不支持的格式，未保存",
} as const
export const VIRAL_TEXT = {
  title: "爆款结构分析",
  description:
    "仅提取已获授权样本的结构与写作指引，不承诺传播效果；样本不进入知识库或任务检索。",
  add: "添加样本",
  detail: "样本详情",
  patternDetail: "结构详情",
  text: "样本文本",
  note: "备注",
  source: "来源链接（纯文本）",
  created: "添加时间",
  chars: "字",
  sort: "排序",
  newest: "最新在前",
  oldest: "最早在前",
  excerpt: "样本摘要",
  action: "操作",
  view: "查看",
  back: "返回样本列表",
  backSample: "返回样本详情",
  empty: "还没有样本",
  emptyPatterns: "暂无已分析结构",
  selectBrand: "请先在顶栏选择品牌",
  brandError: "品牌列表加载失败",
  immutable:
    "添加后不能编辑或删除。请仅粘贴已获授权的文本，最多 5000 个 Unicode 码点。",
  required: "请填写样本文本",
  tooLong: "文本超过字段长度限制",
  urlInvalid: "来源必须是合法的 http 或 https 链接",
  cancel: "取消",
  close: "关闭",
  save: "保存样本",
  saved: "样本已添加",
  analysis: "分析结构",
  start: "开始分析",
  analysing: "正在分析…",
  model: "模型",
  noModels: "没有可用模型",
  modelRequired: "请选择可用模型",
  waitHint:
    "同步分析通常需要 20–90 秒，请保持页面打开；不提供取消，也不显示推测进度。",
  waited: "已等待",
  seconds: "秒",
  patterns: "已分析的结构",
  titlePattern: "标题结构",
  hook: "开头类型",
  tone: "语气",
  emoji: "表情用法",
  hashtags: "话题用法",
  paragraphs: "段落结构",
  template: "抽象写作指引",
  versions: "模型与版本",
  prompt: "提示词版本",
  checker: "检查器版本",
  checkFirst:
    "未收到完整分析结果，服务端可能已经保存。请先读取已分析结构核对；没有新结果再重试。",
  check: "读取已分析结构核对",
  checkedEmpty: "已读取，暂未发现新增结构；可以重新发起分析。",
  foundResults: "已读取到新增结构，请先关闭窗口查看结果，避免重复分析。",
  checking: "正在读取…",
  convert: "转为场景模板",
  convertHint:
    "仅品牌管理员可以转换；同品牌、同场景、同名称会创建递增版本，不覆盖已有模板。",
  name: "场景模板名称",
  scene: "场景",
  defaultName: "结构写作指引",
  nameRequired: "请填写名称",
  converted: "场景模板已创建",
  templateVersion: "模板版本",
  previous: "上一页",
  next: "下一页",
  page: "页",
  total: "共",
  items: "条",
} as const
