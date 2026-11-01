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

export const EVAL_KIND_LABEL = {
  generation: "生成质量",
  compliance: "合规检测",
  factcheck: "事实核查",
  brand_leak: "品牌串味",
} as const
export const EVAL_STATUS_LABEL = {
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
} as const
export const EVAL_METRIC_LABEL = {
  precision: "精确率",
  recall: "召回率",
  f1: "F1",
  exact_match_rate: "完全匹配率",
  accuracy: "判断准确率",
  unsupported_accepted_rate: "无依据说法被接受比例",
  supported_recall: "有依据说法召回率",
  constraint_pass_rate: "约束满足率",
  block_hint_rate: "必须修改提示比例",
  failure_rate: "失败率",
  avg_latency_ms: "平均耗时（毫秒）",
  avg_cost: "平均费用",
  avg_tokens: "平均 token 数",
  leak_rate: "外品牌词命中率",
  retrieval_leak_count: "检索泄漏计数",
} as const
export const EVAL_ERROR_LABEL = {
  model_unavailable: "模型不可用",
  invalid_model_output: "模型输出不符合要求",
  retrieval_brand_mismatch: "检索分块品牌不匹配",
  retrieval_brand_unknown: "检索分块归属无法确定",
} as const
export const EVAL_TEXT = {
  datasets: "评测集",
  runs: "评测运行与报告",
  datasetDetail: "评测集详情",
  runDetail: "评测运行详情",
  newDataset: "新建评测集",
  newRun: "新建运行",
  description: "固定版本的演示评测，指标各自有定义，不合成一个结论。",
  name: "名称",
  kind: "类型",
  scope: "范围",
  global: "全局",
  brand: "当前品牌",
  allKinds: "全部类型",
  allDatasets: "全部评测集",
  selectDataset: "选择评测集",
  cases: "样本",
  caseCount: "样本数",
  version: "版本",
  created: "创建时间",
  finished: "结束时间",
  group: "版本组",
  hash: "内容哈希",
  metadata: "版本信息",
  immutable: "创建后内容固定。后续修改必须创建新版本，旧版本保留。",
  json: "样本 JSON 数组",
  jsonHint:
    "每项包含 input、expected（可选）、annotators（可选），共 1–200 项。具体字段由后端按类型校验。",
  useExample: "填入自编示例",
  nameRequired: "请填写名称",
  nameLimit: "名称最多 100 字",
  invalidJson: "样本必须是合法 JSON 数组，含 input 对象，且为 1–200 项。",
  save: "保存",
  cancel: "取消",
  close: "关闭",
  saved: "已保存",
  emptyDatasets: "暂无评测集",
  emptyRuns: "暂无评测运行",
  emptyCases: "暂无样本",
  emptyResults: "暂无结果",
  backDatasets: "返回评测集",
  backRuns: "返回运行列表",
  view: "查看",
  input: "输入",
  expected: "期望",
  annotators: "标注人",
  model: "启用模型",
  noModels: "没有可用模型",
  modelRequired: "请至少选择一个模型",
  modelLimit: "本类型最多选择 5 个模型",
  baseline: "基线",
  baselineCompliance: "自动包含 lexicon_only 基线，不调用模型。",
  baselineFactcheck: "自动包含 no_verification 基线。",
  baselineNone: "本类型不使用基线。",
  creatingRun: "正在创建…",
  runningHint: "运行尚未结束，正在定期读取状态；指标和结果完成后展示。",
  unknownState: "尚未识别该运行状态，请刷新后查看。",
  status: "状态",
  refresh: "刷新",
  sample: "样本",
  system: "系统",
  metric: "指标",
  value: "值",
  n: "分母 n",
  definition: "定义",
  noMetrics: "暂无指标",
  metricInvalid: "接口未返回可展示的指标",
  metrics: "指标",
  failures: "失败项",
  noFailures: "没有逐项错误记录",
  error: "错误",
  result: "结果",
  results: "结果与人工评分",
  output: "输出",
  detail: "检查明细",
  passed: "满足检查项",
  notPassed: "未满足检查项",
  latency: "耗时（毫秒）",
  cost: "费用",
  rate: "人工评分",
  ratingHint:
    "人工评分只作参考，不是系统验证；系统判定支持也不等于事实正确（非事实保证）。",
  rubric: "评分表",
  rubricInvalid: "评分表数据不完整，暂时无法评分",
  scoreRequired: "请完成每个维度的评分",
  note: "备注",
  noteLimit: "备注最多 1000 字",
  agreement: "评分一致性",
  noAgreement: "暂无一致性",
  method: "计算方法",
  raters: "评分者数",
  ratedResults: "有评分的结果数",
  dimension: "维度",
  pairs: "评分者对数",
  samples: "样本数",
  kappa: "加权 Cohen’s kappa",
  exact: "完全一致比例",
  withinOne: "相差不超过 1 的比例",
  runError: "运行错误",
  runVersions: "运行固定版本",
  prompt: "提示词",
  checker: "检查器",
  models: "模型",
  baselines: "基线",
  previous: "上一页",
  next: "下一页",
  page: "页",
  total: "共",
  items: "条",
  selectBrand: "请先选择品牌",
  brandUnavailable: "品牌列表加载失败",
  runNetworkHint:
    "未收到创建结果。请先查看运行列表核对；原参数重试会沿用同一请求键。",
  leakHint:
    "衡量的是被诱导时是否把别家品牌词写进文案；检索泄漏由 retrieval_leak_count 单独衡量。",
  foreignTerms: "命中的别家品牌词",
  retrievalChecked: "已核对检索归属",
  retrievalLeaks: "检索泄漏计数",
  constraintsPassed: "满足约束检查",
  leaked: "输出包含别家品牌词",
  yes: "是",
  no: "否",
  newScope:
    "仅可在当前管理的品牌创建；平台管理员可选择全局，品牌串味不能选择全局。",
  fullOutput: "查看完整输出与明细",
  noOutput: "没有输出",
  unconfiguredCost: "价格未配置时费用显示为 —。",
} as const
export const EVAL_CASE_HINT = {
  compliance: "input.text 为文案；expected.hit_words 为应当命中的词数组。",
  factcheck:
    "input.claim 为断言，input.sources 为 1–5 段资料；expected.verdict 取 supported、insufficient 或 conflict。",
  generation:
    "input.product_name、input.scene_name 必填；可选 brand_name、category、scene_structure、brief、required_terms、style、facts；expected.forbidden_words 可选。",
  brand_leak:
    "沿用生成类字段，另需 input.distractor_brand（1–100 码点）和 expected.foreign_terms（1–50 个不重复词条，每条 1–100 码点）。只填写获授权或虚构的词表。",
} as const
export const EVAL_EXAMPLES = {
  compliance: [
    {
      input: { text: "这是一段自编演示文案，示例词为最好。" },
      expected: { hit_words: ["最好"] },
      annotators: [],
    },
  ],
  factcheck: [
    {
      input: {
        claim: "自编演示商品含有柑橘香调",
        sources: ["演示资料：香调包含柑橘。"],
      },
      expected: { verdict: "supported" },
      annotators: [],
    },
  ],
  generation: [
    {
      input: {
        product_name: "自编演示香氛",
        scene_name: "日常记录",
        brief: "只记录场景，不添加资料之外的客观说法。",
      },
      expected: { forbidden_words: ["虚构禁用词"] },
      annotators: [],
    },
  ],
  brand_leak: [
    {
      input: {
        product_name: "自编演示香氛",
        scene_name: "日常记录",
        distractor_brand: "暮云工坊（虚构）",
        brief: "围绕日常场景展开，不补充功效。",
      },
      expected: { foreign_terms: ["暮云工坊", "雾青露"] },
      annotators: [],
    },
  ],
} as const

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
