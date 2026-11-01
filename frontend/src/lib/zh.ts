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

export const DOCUMENT_TYPE_LABEL = {
  brand_story: "品牌故事",
  product_spec: "商品规格",
  ingredient: "成分说明",
  award_claim: "获奖宣称",
  compliance_policy: "风险提示制度",
  sample_note: "样稿备注",
} as const
export const INDEX_STATUS_LABEL = {
  ready: "可检索",
  pending: "待建立索引",
  failed: "索引失败",
} as const
export const REVIEW_ACTION_LABEL = {
  submit: "提交待审",
  approve: "审核通过",
  reject: "驳回",
  deactivate: "停用",
  admin_direct_ingest: "管理员直接入库",
} as const
export const KB_TEXT = {
  title: "资料列表与上传",
  reviewTitle: "待审队列与审核",
  detailTitle: "资料详情",
  upload: "上传资料",
  submit: "提交待审",
  description: "只有已入库、可检索的当前版本才会用于新任务的生成和依据核对。",
  queueDescription:
    "待审资料不会用于生成；新版本审核通过前仍使用旧的当前版本。",
  queue: "待审队列",
  selectBrand: "请先在顶栏选择品牌",
  allStatus: "全部状态",
  allTypes: "全部类型",
  clear: "清除筛选",
  documentTitle: "标题",
  type: "资料类型",
  status: "审核状态",
  index: "索引状态",
  version: "版本",
  author: "提交人",
  created: "提交时间",
  relation: "与已有资料",
  action: "操作",
  unknown: "未知用户",
  newDocument: "新资料",
  update: "更新",
  review: "审核",
  approve: "审核通过",
  reject: "驳回",
  deactivate: "停用",
  reindex: "重建索引",
  empty: "还没有资料",
  filteredEmpty: "没有符合条件的资料",
  noPending: "暂无待审资料",
  emptyHint: "可以提交资料，或调整筛选条件。",
  back: "返回资料列表",
  previous: "上一页",
  next: "下一页",
  page: "页",
  total: "共",
  items: "条",
  retry: "重试",
  file: "选择文件",
  fileHint: "PDF、DOCX ≤50 MB；MD、TXT、CSV ≤5 MB。PDF 需要有文字，不做 OCR。",
  titleRequired: "请填写标题",
  titleLimit: "标题不能超过 200 字",
  unsupported: "不支持的文件类型",
  tooLarge: "文件超过该类型的大小限制",
  selectFile: "请选择一个文件",
  processing: "正在处理…",
  longRequest: "同步处理可能需要几分钟，请保持窗口打开；不显示虚构进度。",
  ingestHint: "解析、分块和建立索引全部成功后成为当前版本，并写入审计记录。",
  submitHint: "提交后待审核，通过前不会用于生成。",
  cancelled: "取消",
  close: "关闭",
  uploaded: "资料已保存",
  reviewSaved: "审核已记录",
  deactivated: "资料已停用",
  reindexed: "索引已重建",
  timeoutHint: "未收到结果，请先刷新列表核对是否已保存，再决定是否重试。",
  uploadVersion: "上传新版本",
  submitVersion: "提交新版本（待审）",
  metadata: "元数据",
  filename: "原文件名",
  id: "资料 id",
  group: "版本组",
  current: "当前版本",
  history: "历史版本",
  chunks: "分块预览",
  chunk: "分块",
  noChunks: "暂无分块",
  versions: "版本链",
  reviews: "审核记录",
  noReviews: "暂无审核记录",
  actor: "操作人",
  reason: "原因",
  time: "时间",
  approveDescription:
    "审核通过后建立索引，成功后才可检索；替代旧资料时，旧版本不再是当前版本。请填写审核原因。",
  rejectDescription: "驳回后不会进入检索，请填写驳回理由。",
  deactivateDescription:
    "新任务不会再检索它，已有任务保留引用快照；不会物理删除。请填写停用原因。",
  deactivatedHint:
    "资料已停用，新任务不会检索它；已有任务仍保留当时引用的快照。",
  failedHint: "索引失败，当前不可检索；品牌管理员可以重建索引。",
  pendingHint: "资料尚未建立可用索引，当前不可检索。",
  brandError: "品牌列表加载失败",
  savedError: "操作失败，请查看请求编号",
  detailMissing: "请先切换到该资料所属的品牌。",
} as const
