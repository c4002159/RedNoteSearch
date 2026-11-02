import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import {
  BadgeCheck,
  BookHeart,
  BookOpen,
  Leaf,
  type LucideIcon,
  Paperclip,
  Sparkles,
  Tag,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  KnowledgeService,
  type ProductPublic,
  ProductsService,
  type ScenarioPublic,
  type StyleParams,
  TasksService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { type DockStep, ProgressDock } from "@/components/Common/ProgressDock"
import { StageProgress } from "@/components/Common/StageProgress"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useBrand } from "@/hooks/useBrand"
import { type ApiErrorInfo, parseApiError } from "@/lib/apiError"
import { cn } from "@/lib/utils"
import {
  EMOJI_LABEL,
  LENGTH_LABEL,
  label,
  PERSON_LABEL,
  SCENARIO_TEXT,
  TASK_ERROR_LABEL,
} from "@/lib/zh"

export const Route = createFileRoute("/_layout/generate")({
  validateSearch: (search: Record<string, unknown>) => ({
    task: typeof search.task === "string" ? search.task : undefined,
    ...(typeof search.scenario === "string"
      ? { scenario: search.scenario }
      : {}),
  }),
  component: GeneratePage,
  head: () => ({ meta: [{ title: "生成工作台 - RedNoteSearch" }] }),
})

const MAX_MATERIALS = 5
const MAX_MATERIAL_CHARS = 50000
const MAX_BRIEF = 2000
const MAX_TERMS = 20
const ACCEPT = ".pdf,.docx,.md,.txt,.csv"

function Field({
  title,
  hint,
  section,
  children,
}: {
  title: string
  hint?: string
  section?: boolean
  children: React.ReactNode
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children
    <label className="block space-y-1.5 text-sm">
      <span
        className={cn(
          section
            ? "block text-base font-semibold"
            : "block text-xs font-medium text-muted-foreground",
        )}
      >
        {title}
      </span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  )
}

const selectClass =
  "h-10 w-full rounded-lg border border-transparent bg-surface-low px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"

const SCENE_LOOK: Record<string, { icon: LucideIcon; bg: string; fg: string }> =
  {
    seeding: { icon: Leaf, bg: "bg-scene-sky", fg: "text-tone-info" },
    review: {
      icon: BadgeCheck,
      bg: "bg-scene-blue",
      fg: "text-tone-soft-blue",
    },
    tutorial: { icon: BookOpen, bg: "bg-scene-mint", fg: "text-tone-ok" },
    launch: { icon: Sparkles, bg: "bg-scene-yellow", fg: "text-tone-note" },
    promotion: { icon: Tag, bg: "bg-scene-orange", fg: "text-tone-warn" },
    story: { icon: BookHeart, bg: "bg-scene-pink", fg: "text-tone-err" },
  }

function SceneCards({
  scenarios,
  value,
  onChange,
}: {
  scenarios: ScenarioPublic[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="场景"
      className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
    >
      {scenarios.map((s) => {
        const look = SCENE_LOOK[s.scene] ?? SCENE_LOOK.seeding
        const Icon = look.icon
        const on = s.id === value
        return (
          <label key={s.id} className="cursor-pointer">
            <input
              type="radio"
              name="scene"
              className="peer sr-only"
              checked={on}
              onChange={() => onChange(s.id)}
            />
            <span
              className={cn(
                "flex items-center gap-2.5 rounded-xl border p-2.5 text-left transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                on
                  ? "border-primary bg-accent shadow-[0_2px_8px_rgba(37,99,235,0.12)]"
                  : "border-border/60 bg-card hover:bg-surface-low",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  look.bg,
                  look.fg,
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">
                  {s.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {s.source_pattern_id && (
                    <span
                      className="mr-1 rounded bg-tone-soft-blue-bg px-1 text-tone-soft-blue"
                      title={`${SCENARIO_TEXT.fromViralTitle}${s.source_pattern_title ?? ""}`}
                    >
                      {SCENARIO_TEXT.fromViral}
                    </span>
                  )}
                  模板版本 v{s.template_version}
                </span>
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

function TermsInput({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const terms = splitTerms(value)
  const [draft, setDraft] = useState("")
  const add = () => {
    const fresh = splitTerms(draft).filter((t) => !terms.includes(t))
    if (fresh.length > 0) onChange([...terms, ...fresh].join("，"))
    setDraft("")
  }
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-transparent bg-surface-low px-2 py-1.5">
      {terms.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[13px] font-medium text-link"
        >
          {t}
          <button
            type="button"
            aria-label={`移除 ${t}`}
            onClick={() => onChange(terms.filter((x) => x !== t).join("，"))}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        aria-label="添加必须包含的词"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === "，") {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        placeholder="+ 添加词"
        className="min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-outline"
      />
    </div>
  )
}

const PROGRESS_PREVIEW = [
  "检索资料",
  "生成",
  "约束检查",
  "事实证据",
  "风险提示",
  "完成",
]

// 文件资料上传失败时，说明是哪份、为什么、任务现在是什么状态
function uploadFailureMessage(
  fileName: string,
  err: unknown,
  skipped: number,
): string {
  const info = parseApiError(err)
  const reason =
    info.code === "MATERIAL_TOO_LONG"
      ? "内容超过 50000 字"
      : info.code === "FILE_TOO_LARGE"
        ? "文件太大"
        : info.code === "UNSUPPORTED_FILE_TYPE"
          ? "文件类型不支持"
          : info.code === "PARSE_FAILED"
            ? "没有读到可用的文字"
            : info.message
  const rest = skipped > 0 ? `，后面的 ${skipped} 份也没有上传` : ""
  return `任务已创建，但「${fileName}」${reason}，这份资料没有加入${rest}，也没有自动开始生成。可以缩短或换一份文件，到任务页重新上传后再生成。`
}

function splitTerms(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function NewTaskForm() {
  const { current } = useBrand()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const brandId = current?.id ?? ""

  const products = useQuery({
    queryKey: ["products", brandId, "active"],
    queryFn: async () =>
      (
        await ProductsService.readProducts({
          path: { brand_id: brandId },
          query: { status: "active", page_size: 100 },
        })
      ).data.items,
    enabled: !!brandId,
  })
  // 只用来决定是否显示提示：有已入库、当前版本、已建好索引的资料才可能被检索到
  const approvedDocs = useQuery({
    queryKey: ["knowledge-approved", brandId],
    queryFn: async () =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: { status: "approved", page_size: 100 },
        })
      ).data.items,
    enabled: !!brandId,
  })
  const noRetrievableDocs =
    approvedDocs.isSuccess &&
    !approvedDocs.data.some((d) => d.is_current && d.index_status === "ready")
  const scenarios = useQuery({
    queryKey: ["scenarios"],
    queryFn: async () => (await TasksService.readScenarios()).data.items,
  })
  const presets = useQuery({
    queryKey: ["style-presets", brandId],
    queryFn: async () =>
      (await TasksService.readStylePresets({ path: { brand_id: brandId } }))
        .data.items,
    enabled: !!brandId,
  })

  const [productId, setProductId] = useState("")
  const preselected = Route.useSearch().scenario
  const [scenarioId, setScenarioId] = useState(preselected ?? "")
  const [brief, setBrief] = useState("")
  const [terms, setTerms] = useState("")
  const [pasted, setPasted] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [style, setStyle] = useState<StyleParams>({
    length: "medium",
    person: "first",
    emoji_density: "medium",
    hashtag_count: 5,
  })
  const [error, setError] = useState<ApiErrorInfo | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const brandScenarios = (scenarios.data ?? []).filter(
    (s: ScenarioPublic) => s.brand_id === null || s.brand_id === brandId,
  )
  const materialCount = files.length + (pasted.trim() ? 1 : 0)

  const submit = useMutation({
    mutationFn: async (start: boolean) => {
      const created = (
        await TasksService.createTask({
          body: {
            brand_id: brandId,
            product_id: productId,
            scenario_id: scenarioId,
            style,
            brief,
            required_terms: splitTerms(terms),
            task_materials: pasted.trim()
              ? [{ filename: "粘贴资料", text: pasted }]
              : [],
          },
        })
      ).data
      let uploadError: unknown = null
      let uploadFailure = ""
      for (const [index, file] of files.entries()) {
        try {
          await TasksService.uploadTaskMaterial({
            path: { task_id: created.id },
            body: { file },
          })
        } catch (e) {
          uploadError = e
          uploadFailure = uploadFailureMessage(
            file.name,
            e,
            files.length - index - 1,
          )
          break
        }
      }
      if (start && !uploadError) {
        await TasksService.generateTask({
          path: { task_id: created.id },
          headers: { "idempotency-key": crypto.randomUUID() },
        })
      }
      return { id: created.id, uploadError, uploadFailure }
    },
    onSuccess: async ({ id, uploadError, uploadFailure }) => {
      await queryClient.invalidateQueries({ queryKey: ["tasks"] })
      if (uploadError) {
        toast.error(uploadFailure, { duration: 12000 })
      }
      void navigate({ to: "/generate", search: { task: id } })
    },
    onError: (e) => setError(parseApiError(e)),
  })

  if (!current) {
    return (
      <EmptyState
        title="请先选择品牌"
        description="在顶栏选择一个品牌，或到“品牌与切换”页创建。"
      />
    )
  }

  const briefLength = [...brief].length
  const termCount = splitTerms(terms).length
  const pastedLength = [...pasted].length
  const ready =
    !!productId &&
    !!scenarioId &&
    materialCount <= MAX_MATERIALS &&
    pastedLength <= MAX_MATERIAL_CHARS &&
    briefLength <= MAX_BRIEF &&
    termCount <= MAX_TERMS
  const go = (start: boolean) => {
    setError(null)
    submit.mutate(start)
  }

  return (
    <form
      className="w-full"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) go(true)
      }}
    >
      <div className="flex flex-col gap-6">
        <section className="space-y-6 rounded-xl border border-border/40 bg-card p-6 shadow-sm">
          <Field title="选择推广商品" section>
            {products.isLoading ? (
              <Skeleton className="h-11 w-full" />
            ) : (
              <select
                className={cn(selectClass, "h-11")}
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                required
              >
                <option value="">请选择商品</option>
                {(products.data ?? []).map((p: ProductPublic) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {(products.isError || scenarios.isError) && (
            <ErrorBanner
              error={parseApiError(products.error ?? scenarios.error)}
              onRetry={() => {
                void products.refetch()
                void scenarios.refetch()
              }}
            />
          )}
          {products.isSuccess && products.data.length === 0 && (
            <EmptyState
              title="这个品牌还没有商品"
              description="请先让品牌管理员添加商品，再回来创建任务。"
            />
          )}
          {noRetrievableDocs && (
            <p
              role="status"
              className="rounded-lg bg-tone-warn-bg px-3 py-2 text-sm text-tone-warn"
            >
              这个品牌还没有已审核的资料，生成的内容可能没有事实依据；请先到知识库上传并审核资料。
            </p>
          )}

          <div className="space-y-1.5">
            <span className="block text-base font-semibold">创作场景</span>
            {scenarios.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <SceneCards
                scenarios={brandScenarios}
                value={scenarioId}
                onChange={setScenarioId}
              />
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-base font-semibold">文案风格（选填）</span>
              {(presets.data ?? []).length > 0 && (
                <select
                  className="h-8 rounded-lg border border-transparent bg-surface-low px-2 text-sm"
                  defaultValue=""
                  aria-label="套用风格预设"
                  onChange={(e) => {
                    const p = presets.data?.find((x) => x.id === e.target.value)
                    if (p) setStyle({ ...style, ...p.params })
                  }}
                >
                  <option value="">套用风格预设</option>
                  {presets.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field title="语气">
                <Input
                  value={style.tone ?? ""}
                  onChange={(e) =>
                    setStyle({ ...style, tone: e.target.value || null })
                  }
                  placeholder="如：亲切、克制"
                />
              </Field>
              <Field title="篇幅">
                <select
                  className={selectClass}
                  value={style.length}
                  onChange={(e) =>
                    setStyle({
                      ...style,
                      length: e.target.value as StyleParams["length"],
                    })
                  }
                >
                  {Object.entries(LENGTH_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="人称">
                <select
                  className={selectClass}
                  value={style.person}
                  onChange={(e) =>
                    setStyle({
                      ...style,
                      person: e.target.value as StyleParams["person"],
                    })
                  }
                >
                  {Object.entries(PERSON_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="表情密度">
                <select
                  className={selectClass}
                  value={style.emoji_density}
                  onChange={(e) =>
                    setStyle({
                      ...style,
                      emoji_density: e.target
                        .value as StyleParams["emoji_density"],
                    })
                  }
                >
                  {Object.entries(EMOJI_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="block space-y-1.5 text-sm">
              <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                话题数量（0 到 10）
                <span className="text-link">{style.hashtag_count ?? 0}</span>
              </span>
              <input
                type="range"
                min={0}
                max={10}
                value={style.hashtag_count ?? 0}
                onChange={(e) =>
                  setStyle({ ...style, hashtag_count: Number(e.target.value) })
                }
                className="w-full accent-primary"
              />
            </label>
          </div>

          <Field
            title="创作要求（选填）"
            section
            hint={
              briefLength > MAX_BRIEF
                ? `已超过 ${MAX_BRIEF} 字（${briefLength} / ${MAX_BRIEF}），请缩短后再提交。`
                : `写下这篇笔记想表达的重点、读者与限制。${briefLength} / ${MAX_BRIEF}`
            }
          >
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              rows={4}
            />
          </Field>

          <div className="space-y-1.5">
            <span className="block text-base font-semibold">必须包含的词</span>
            <TermsInput value={terms} onChange={setTerms} />
            <span className="block text-xs text-muted-foreground">
              {termCount > MAX_TERMS
                ? `最多 ${MAX_TERMS} 个词（现在 ${termCount} 个），请删减后再提交。`
                : `输入后按回车或逗号添加，最多 ${MAX_TERMS} 个。${termCount} / ${MAX_TERMS}`}
            </span>
          </div>

          <div className="space-y-3">
            <div>
              <h2 className="text-base font-semibold">本次任务资料（可选）</h2>
              <p className="text-xs text-muted-foreground">
                任务资料只用于这一个任务，未经过知识库审核，生成结果里会标注为“任务内资料（未审核）”。
                最多 {MAX_MATERIALS} 份（含粘贴的文本），每份不超过 50000
                字；支持 PDF、DOCX、MD、TXT、CSV。
              </p>
            </div>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={4}
              placeholder="直接粘贴一段资料文字"
              aria-label="粘贴资料文字"
            />
            <ul className="space-y-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-2 rounded-lg bg-surface-low px-3 py-1.5 text-sm"
                >
                  <Paperclip className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button
                    type="button"
                    aria-label={`移除 ${f.name}`}
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                setFiles([...files, ...Array.from(e.target.files ?? [])])
                e.target.value = ""
              }}
            />
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInput.current?.click()}
              >
                选择文件
              </Button>
              <span className="text-xs text-muted-foreground">
                已添加 {materialCount} / {MAX_MATERIALS} 份
              </span>
            </div>
            {pastedLength > MAX_MATERIAL_CHARS && (
              <p role="alert" className="text-sm text-destructive">
                粘贴的资料已超过 {MAX_MATERIAL_CHARS} 字（{pastedLength}
                ），请缩短后再提交。
              </p>
            )}
            {materialCount > MAX_MATERIALS && (
              <p role="alert" className="text-sm text-destructive">
                资料最多 {MAX_MATERIALS} 份，请移除多余的。
              </p>
            )}
          </div>
        </section>

        {error && (
          <ErrorBanner
            error={
              error.code === "MODEL_UNAVAILABLE"
                ? {
                    ...error,
                    message:
                      "模型暂时不可用，请稍后重试。任务没有丢，可以再提交一次。",
                  }
                : error
            }
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={!ready || submit.isPending}
            onClick={() => go(false)}
          >
            仅创建，稍后添加资料
          </Button>
          <LoadingButton
            type="submit"
            loading={submit.isPending}
            disabled={!ready}
          >
            创建并开始生成
          </LoadingButton>
        </div>
      </div>

      <ProgressDock
        steps={PROGRESS_PREVIEW.map((text) => ({
          text,
          state: "pending" as const,
        }))}
        note="创建任务后，这里会显示进度。"
      />
    </form>
  )
}

function MaterialsPanel({
  taskId,
  editable,
}: {
  taskId: string
  editable: boolean
}) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const list = useQuery({
    queryKey: ["task-materials", taskId],
    queryFn: async () =>
      (await TasksService.readTaskMaterials({ path: { task_id: taskId } }))
        .data,
  })
  const upload = useMutation({
    mutationFn: async (file: File) =>
      (
        await TasksService.uploadTaskMaterial({
          path: { task_id: taskId },
          body: { file },
        })
      ).data,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task-materials", taskId] }),
  })

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">任务资料</h2>
      {list.isLoading && <Skeleton className="h-10 w-full" />}
      {list.isError && (
        <ErrorBanner
          error={parseApiError(list.error)}
          onRetry={() => list.refetch()}
        />
      )}
      {list.data && list.data.items.length === 0 && (
        <p className="text-sm text-muted-foreground">这个任务没有附带资料。</p>
      )}
      <ul className="space-y-1">
        {list.data?.items.map((m) => (
          <li
            key={m.id}
            className="rounded-md bg-surface-low px-3 py-2 text-sm"
          >
            <p className="font-medium">
              {m.filename}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                {m.char_count} 字
              </span>
            </p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {m.excerpt}
            </p>
          </li>
        ))}
      </ul>
      {upload.isError && <ErrorBanner error={parseApiError(upload.error)} />}
      {editable && (
        <div>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload.mutate(f)
              e.target.value = ""
            }}
          />
          <LoadingButton
            type="button"
            variant="outline"
            size="sm"
            loading={upload.isPending}
            onClick={() => input.current?.click()}
          >
            添加资料文件
          </LoadingButton>
          {upload.isPending && (
            <p className="mt-1 text-xs text-muted-foreground">
              大文件需要解析与建立索引，可能要几分钟，请不要关闭页面。
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const RUNNING = ["generating", "checking"]

function TaskRun({ taskId }: { taskId: string }) {
  const queryClient = useQueryClient()
  const [since] = useState(() => Date.now())
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () =>
      (await TasksService.readTask({ path: { task_id: taskId } })).data,
    // 3 s at first, 10 s once it has run longer than 5 minutes.
    refetchInterval: (q) =>
      q.state.data && RUNNING.includes(q.state.data.flow_status)
        ? Date.now() - since > 5 * 60_000
          ? 10_000
          : 3_000
        : false,
  })
  const generate = useMutation({
    mutationFn: async () =>
      TasksService.generateTask({
        path: { task_id: taskId },
        headers: { "idempotency-key": crypto.randomUUID() },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
  })

  useEffect(() => {
    if (task.data && !RUNNING.includes(task.data.flow_status)) {
      void queryClient.invalidateQueries({ queryKey: ["tasks"] })
    }
  }, [task.data, queryClient])

  if (task.isLoading) return <Skeleton className="h-48 w-full" />
  if (task.isError) {
    const err = parseApiError(task.error)
    if (err.status === 404) return <MissingPage />
    return <ErrorBanner error={err} onRetry={() => task.refetch()} />
  }
  const t = task.data
  if (!t) return null
  const stage = typeof t.progress?.stage === "string" ? t.progress.stage : null
  const running = RUNNING.includes(t.flow_status)
  const stageIndex = ["queued", "generating", "checking"].indexOf(t.flow_status)
  const dockSteps: DockStep[] = [
    ...["排队", "生成中", "检查中"].map(
      (text, i): DockStep => ({
        text,
        state: running
          ? i < stageIndex
            ? "done"
            : i === stageIndex
              ? "current"
              : "pending"
          : "done",
      }),
    ),
    { text: "完成", state: running ? "pending" : "done" },
  ]
  const canStart =
    t.flow_status === "queued" || t.flow_status === "constraint_failed"

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">
            {t.product_name ?? "任务"} · {t.scenario_name ?? ""}
          </h2>
          <FlowStatusBadge status={t.flow_status} />
        </div>
        <StageProgress flowStatus={t.flow_status} stage={stage} />
        {running && (
          <p className="text-sm text-muted-foreground">
            正在处理，你可以离开这个页面，稍后在“任务与版本历史”里查看。
          </p>
        )}
        {t.last_error && (
          <p role="alert" className="text-sm text-destructive">
            {label(TASK_ERROR_LABEL, t.last_error, "task_error")}
          </p>
        )}
        {generate.isError && (
          <ErrorBanner error={parseApiError(generate.error)} />
        )}
        <div className="flex flex-wrap gap-3">
          {canStart && (
            <LoadingButton
              loading={generate.isPending}
              onClick={() => generate.mutate()}
            >
              {t.flow_status === "queued" ? "开始生成" : "重新生成"}
            </LoadingButton>
          )}
          {t.latest_version_id && !running && t.flow_status !== "queued" && (
            <Button asChild>
              <Link
                to="/tasks/$taskId/versions/$versionId"
                params={{ taskId: t.id, versionId: t.latest_version_id }}
              >
                查看结果
              </Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link to="/tasks/$taskId" params={{ taskId: t.id }}>
              任务详情
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/generate" search={{ task: undefined }}>
              新建任务
            </Link>
          </Button>
        </div>
      </section>
      <MaterialsPanel taskId={t.id} editable={t.flow_status === "queued"} />
      <ProgressDock steps={dockSteps} busy={running} />
    </div>
  )
}

function GeneratePage() {
  const { task } = Route.useSearch()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">生成工作台</h1>
        <p className="text-sm text-muted-foreground">
          选择商品和场景，系统基于已审核的品牌资料生成文案，并逐条检查约束、事实依据和风险提示。
        </p>
      </div>
      {task ? <TaskRun taskId={task} /> : <NewTaskForm />}
    </div>
  )
}
