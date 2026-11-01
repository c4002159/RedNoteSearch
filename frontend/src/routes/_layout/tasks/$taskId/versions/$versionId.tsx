import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  type ClaimEvidencePublic,
  type ComplianceCheckPublic,
  ComplianceService,
  EvidenceService,
  type GenerationVersionPublic,
  TasksService,
  VersionsService,
  type XhsPartsExport,
} from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { ReasonDialog } from "@/components/Common/ReasonDialog"
import {
  EvidenceStatusBadge,
  FlowStatusBadge,
  HumanConfirmedBadge,
  Pill,
  SeverityBadge,
  SourceLevelBadge,
} from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { parseApiError } from "@/lib/apiError"
import {
  BODY_LIMIT,
  bodyUnits,
  formatWeight,
  normalizeTag,
  TAG_LIMIT,
  TITLE_LIMIT,
  tagsVisibleUnits,
  titleWeight,
} from "@/lib/count"
import { formatTime } from "@/lib/format"
import { COUNT_LABEL, LAYER_LABEL, label, ORIGIN_LABEL } from "@/lib/zh"

export const Route = createFileRoute(
  "/_layout/tasks/$taskId/versions/$versionId",
)({
  component: ResultPage,
  head: () => ({ meta: [{ title: "结果页 - RedNoteSearch" }] }),
})

const CONFIRMABLE = ["checks_completed", "needs_human_review"]
// 这些状态下后台还在跑，页面要轮询；结论性文案先不显示
const IN_PROGRESS = ["queued", "generating", "checking"]
const POLL_MS = 1500

type Version = GenerationVersionPublic

function useRefreshVersion(taskId: string, versionId: string) {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["version", versionId] }),
      queryClient.invalidateQueries({ queryKey: ["evidence", versionId] }),
      queryClient.invalidateQueries({ queryKey: ["compliance", versionId] }),
      queryClient.invalidateQueries({ queryKey: ["task", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["task-versions", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    ])
  }
}

// ---- copy helpers (FC-14: the text stays visible so it can be copied by hand if the clipboard fails)

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success("已复制")
  } catch {
    toast.error("浏览器不允许自动复制，请在下方文本框里手动复制")
  }
}

function CopyBlock({
  title,
  text,
  rows = 2,
}: {
  title: string
  text: string
  rows?: number
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => copyText(text)}
        >
          复制{title}
        </Button>
      </div>
      <Textarea readOnly value={text} rows={rows} aria-label={title} />
    </div>
  )
}

// ---- editing

function EditForm({
  version,
  onCancel,
  onSaved,
}: {
  version: Version
  onCancel: () => void
  onSaved: (v: Version) => void
}) {
  const [titles, setTitles] = useState(version.title_candidates)
  const [body, setBody] = useState(version.body)
  const [tags, setTags] = useState(version.hashtags.join(" "))
  const [covers, setCovers] = useState(version.cover_candidates.join("\n"))
  const tagList = tags
    .split(/[\s,，]+/)
    .map(normalizeTag)
    .filter(Boolean)
  const save = useMutation({
    mutationFn: async () =>
      (
        await VersionsService.editVersion({
          path: { version_id: version.id },
          body: {
            title_candidates: titles.map((t) => t.trim()).filter(Boolean),
            body,
            hashtags: tagList,
            cover_candidates: covers
              .split("\n")
              .map((c) => c.trim())
              .filter(Boolean),
          },
        })
      ).data,
    onSuccess: onSaved,
  })
  const total = bodyUnits(body) + tagsVisibleUnits(tagList)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <p className="text-sm text-muted-foreground">
        保存会生成一个新版本，原版本保留；新版本需要重新检查。
      </p>
      {titles.map((t, i) => (
        <div key={`${i}-title`} className="space-y-1">
          <label className="text-sm font-medium" htmlFor={`title-${i}`}>
            候选标题 {i + 1}
          </label>
          <Input
            id={`title-${i}`}
            value={t}
            onChange={(e) =>
              setTitles(titles.map((x, j) => (j === i ? e.target.value : x)))
            }
          />
          <CharCounter value={titleWeight(t)} limit={TITLE_LIMIT} />
        </div>
      ))}
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="edit-body">
          正文
        </label>
        <Textarea
          id="edit-body"
          rows={12}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex gap-4">
          <CharCounter value={total} limit={BODY_LIMIT} suffix="（含话题）" />
        </div>
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="edit-tags">
          话题（空格分隔，不用写 #）
        </label>
        <Input
          id="edit-tags"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
        />
        <CharCounter value={tagList.length} limit={TAG_LIMIT} suffix=" 个" />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="edit-covers">
          封面文字候选（每行一条）
        </label>
        <Textarea
          id="edit-covers"
          rows={3}
          value={covers}
          onChange={(e) => setCovers(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        字数以服务器检查结果为准。
      </p>
      {save.isError && <ErrorBanner error={parseApiError(save.error)} />}
      <div className="flex gap-3">
        <LoadingButton type="submit" loading={save.isPending}>
          保存为新版本
        </LoadingButton>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={save.isPending}
        >
          取消
        </Button>
      </div>
    </form>
  )
}

// ---- constraint report

type Issue = { field?: string; code?: string; message?: string }
type ConstraintReport = {
  passed?: boolean
  titles?: { index: number; text: string; weight: number; issues: Issue[] }[]
  note?: { counts?: Record<string, number>; issues?: Issue[] }
}

function ConstraintPanel({ version }: { version: Version }) {
  const report = version.constraint_checks as ConstraintReport
  if (report.passed === undefined) return null
  const issues = [
    ...(report.titles ?? []).flatMap((t) =>
      t.issues.map((i) => `标题「${t.text}」：${i.message ?? ""}`),
    ),
    ...(report.note?.issues ?? []).map((i) => i.message ?? ""),
  ]
  const counts = report.note?.counts ?? {}
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold">字数与格式检查</h2>
        <Pill tone={report.passed ? "neutral" : "err"}>
          {report.passed ? "符合字数与格式要求" : "有未满足的要求"}
        </Pill>
      </div>
      {issues.length > 0 && (
        <ul className="list-disc pl-5 text-sm">
          {issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {Object.keys(counts).length > 0 && (
        <p className="text-xs text-muted-foreground">
          计数：
          {Object.entries(counts)
            .map(([k, v]) => `${label(COUNT_LABEL, k, "count")} ${v}`)
            .join("，")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        这只表示字数与格式，不代表内容事实或合规。
      </p>
    </section>
  )
}

// ---- evidence

function EvidencePanel({
  items,
  editable,
  busyText,
  onDecide,
}: {
  items: ClaimEvidencePublic[]
  editable: boolean
  busyText: string | null
  onDecide: (item: ClaimEvidencePublic, ok: boolean) => void
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">事实依据（{items.length}）</h2>
      <p className="text-xs text-muted-foreground">
        “系统判定支持”只表示资料与断言匹配，不是事实保证。没有系统依据的断言需要你逐条判断。
      </p>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {busyText ?? "没有需要核对的断言。"}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((e) => {
          const needs = e.status !== "system_supported"
          return (
            <li key={e.id} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">{e.claim_text}</p>
              <div className="flex flex-wrap items-center gap-2">
                <EvidenceStatusBadge status={e.status} />
                {e.source_level && <SourceLevelBadge level={e.source_level} />}
                {e.human_confirmed !== null && e.human_confirmed && (
                  <HumanConfirmedBadge />
                )}
                {e.human_confirmed === false && (
                  <Pill tone="err">人工判定：不成立</Pill>
                )}
              </div>
              {e.source_title && (
                <p className="text-xs text-muted-foreground">
                  来源：{e.source_title}
                  {e.document_version ? `（第 ${e.document_version} 版）` : ""}
                </p>
              )}
              {e.quote && (
                <blockquote className="border-l-2 pl-2 text-xs text-muted-foreground">
                  {e.quote}
                </blockquote>
              )}
              {e.rationale && (
                <p className="text-xs text-muted-foreground">{e.rationale}</p>
              )}
              {e.confirm_note && (
                <p className="text-xs">备注：{e.confirm_note}</p>
              )}
              {needs && editable && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide(e, true)}
                  >
                    {e.human_confirmed === true ? "重新判断：成立" : "成立"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onDecide(e, false)}
                  >
                    不成立
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---- risks

function RiskPanel({
  items,
  editable,
  busyText,
  onResolve,
}: {
  items: ComplianceCheckPublic[]
  editable: boolean
  busyText: string | null
  onResolve: (item: ComplianceCheckPublic) => void
}) {
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">风险提示（{items.length}）</h2>
      <p className="text-xs text-muted-foreground">
        这些是基于规则的提示，不是合规结论，不能替代人工和法务判断。
      </p>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {busyText ?? "没有发现需要提示的内容。"}
        </p>
      )}
      <ul className="space-y-3">
        {items.map((c) => (
          <li key={c.id} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={c.severity} />
              <Pill tone="neutral">{label(LAYER_LABEL, c.layer, "layer")}</Pill>
              {c.resolved && <Pill tone="gray">已处理</Pill>}
            </div>
            <p className="text-sm">
              命中：
              <mark className="rounded bg-tone-warn px-1">
                {c.matched_text}
              </mark>
            </p>
            {c.suggestion && <p className="text-sm">建议：{c.suggestion}</p>}
            <p className="text-xs text-muted-foreground">
              依据：{c.source_name}
              {c.source_clause ? ` ${c.source_clause}` : ""}
              {c.region_scope ? ` · ${c.region_scope}` : ""}
            </p>
            {c.resolved_note && (
              <p className="text-xs">处理说明：{c.resolved_note}</p>
            )}
            {!c.resolved && editable && (
              <Button size="sm" variant="outline" onClick={() => onResolve(c)}>
                标记为已处理
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- rewrite

const REWRITE_TARGETS = [
  { value: "titles", text: "标题" },
  { value: "opening", text: "开头" },
  { value: "body", text: "正文" },
  { value: "cover", text: "封面文字" },
] as const

function RewriteBar({
  versionId,
  onDone,
}: {
  versionId: string
  onDone: (v: Version) => void
}) {
  const [target, setTarget] =
    useState<(typeof REWRITE_TARGETS)[number]["value"]>("titles")
  const [instruction, setInstruction] = useState("")
  const rewrite = useMutation({
    mutationFn: async () =>
      (
        await VersionsService.rewritePart({
          path: { version_id: versionId },
          body: { target, instruction: instruction.trim() || undefined },
        })
      ).data,
    onSuccess: onDone,
  })
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">局部重写</h2>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="重写部分"
          className="h-10 rounded-lg border border-transparent bg-surface-low px-3 text-sm"
          value={target}
          onChange={(e) => setTarget(e.target.value as typeof target)}
        >
          {REWRITE_TARGETS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.text}
            </option>
          ))}
        </select>
        <Input
          className="min-w-48 flex-1"
          aria-label="重写要求"
          placeholder="可选：想要怎么改"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <LoadingButton
          variant="outline"
          loading={rewrite.isPending}
          onClick={() => rewrite.mutate()}
        >
          重写
        </LoadingButton>
      </div>
      <p className="text-xs text-muted-foreground">
        重写会生成新版本，原版本保留。
      </p>
      {rewrite.isError && <ErrorBanner error={parseApiError(rewrite.error)} />}
    </section>
  )
}

// ---- export

function ExportPanel({ versionId }: { versionId: string }) {
  const parts = useQuery({
    queryKey: ["export", versionId, "xhs_parts"],
    queryFn: async () =>
      (
        await VersionsService.exportVersion({
          path: { version_id: versionId },
          query: { format: "xhs_parts" },
        })
      ).data as XhsPartsExport,
  })
  const md = useQuery({
    queryKey: ["export", versionId, "markdown"],
    queryFn: async () =>
      (
        await VersionsService.exportVersion({
          path: { version_id: versionId },
          query: { format: "markdown" },
        })
      ).data as { content: string },
  })
  return (
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">复制到小红书</h2>
      <p className="text-xs text-muted-foreground">
        标题、正文、话题分开复制。粘贴到发布页后，请在发布页确认字数与话题。
      </p>
      {parts.isLoading && <Skeleton className="h-24 w-full" />}
      {parts.isError && (
        <ErrorBanner
          error={parseApiError(parts.error)}
          onRetry={() => parts.refetch()}
        />
      )}
      {parts.data && (
        <>
          <CopyBlock title="标题" text={parts.data.title} />
          <CopyBlock title="正文" text={parts.data.body} rows={8} />
          <CopyBlock
            title="话题"
            text={parts.data.tags.map((t) => `#${t}`).join(" ")}
          />
          <p className="text-xs text-muted-foreground">
            标题 {formatWeight(parts.data.counts.title_weight)} / {TITLE_LIMIT}
            ，正文 {parts.data.counts.body_units} / {BODY_LIMIT}，话题{" "}
            {parts.data.counts.tags_count} 个。 其中系统判定支持{" "}
            {parts.data.verification.system_supported}{" "}
            条，人工确认（非系统验证） {parts.data.verification.human_confirmed}{" "}
            条。
          </p>
        </>
      )}
      {md.data && (
        <CopyBlock title="Markdown 全文" text={md.data.content} rows={6} />
      )}
    </section>
  )
}

// ---- page

type Dialog =
  | { kind: "evidence"; item: ClaimEvidencePublic; ok: boolean }
  | { kind: "risk"; item: ComplianceCheckPublic }
  | null

function ResultPage() {
  const { taskId, versionId } = Route.useParams()
  const navigate = useNavigate()
  const refresh = useRefreshVersion(taskId, versionId)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [titleIndex, setTitleIndex] = useState<number | null>(null)
  const [coverIndex, setCoverIndex] = useState<number | null>(null)

  const version = useQuery({
    queryKey: ["version", versionId],
    queryFn: async () =>
      (await TasksService.readVersion({ path: { version_id: versionId } }))
        .data,
    // 重新检查在后台进行：进行中时轮询，完成后再刷新事实依据与风险提示
    refetchInterval: (query) =>
      IN_PROGRESS.includes(query.state.data?.flow_status ?? "")
        ? POLL_MS
        : false,
  })
  const flowStatus = version.data?.flow_status
  const inProgress = IN_PROGRESS.includes(flowStatus ?? "")
  const busyText = !inProgress
    ? null
    : flowStatus === "checking"
      ? "正在重新检查…"
      : "正在生成，完成后会自动显示…"
  const previousStatus = useRef(flowStatus)
  useEffect(() => {
    if (
      IN_PROGRESS.includes(previousStatus.current ?? "") &&
      !IN_PROGRESS.includes(flowStatus ?? "")
    )
      void refresh()
    previousStatus.current = flowStatus
  }, [flowStatus, refresh])
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () =>
      (await TasksService.readTask({ path: { task_id: taskId } })).data,
  })
  const evidence = useQuery({
    queryKey: ["evidence", versionId],
    queryFn: async () =>
      (
        await EvidenceService.readVersionEvidence({
          path: { version_id: versionId },
        })
      ).data.items,
    refetchInterval: inProgress ? POLL_MS : false,
  })
  const compliance = useQuery({
    queryKey: ["compliance", versionId],
    queryFn: async () =>
      (
        await ComplianceService.readVersionCompliance({
          path: { version_id: versionId },
        })
      ).data,
    refetchInterval: inProgress ? POLL_MS : false,
  })

  const goTo = async (v: Version) => {
    await refresh()
    setEditing(false)
    void navigate({
      to: "/tasks/$taskId/versions/$versionId",
      params: { taskId, versionId: v.id },
    })
  }

  const recheck = useMutation({
    mutationFn: async () =>
      (
        await VersionsService.recheckVersion({
          path: { version_id: versionId },
        })
      ).data,
    onSuccess: refresh,
  })
  const confirm = useMutation({
    mutationFn: async (idx: number) =>
      (
        await VersionsService.confirmVersion({
          path: { version_id: versionId },
          body: { selected_title_index: idx, selected_cover_index: coverIndex },
        })
      ).data,
    onSuccess: async () => {
      toast.success("已确认可复制")
      await refresh()
    },
  })
  const decide = useMutation({
    mutationFn: async (a: { id: string; ok: boolean; note: string }) =>
      EvidenceService.confirmEvidence({
        path: { evidence_id: a.id },
        body: { human_confirmed: a.ok, note: a.note },
      }),
    onSuccess: async () => {
      setDialog(null)
      await refresh()
    },
  })
  const resolve = useMutation({
    mutationFn: async (a: { id: string; note: string }) =>
      ComplianceService.resolveCheck({
        path: { check_id: a.id },
        body: { note: a.note },
      }),
    onSuccess: async () => {
      setDialog(null)
      await refresh()
    },
  })

  if (version.isLoading) return <Skeleton className="h-64 w-full" />
  if (version.isError) {
    const err = parseApiError(version.error)
    return err.status === 404 ? (
      <MissingPage />
    ) : (
      <ErrorBanner error={err} onRetry={() => version.refetch()} />
    )
  }
  const v = version.data
  if (!v) return null

  const isLatest = task.data?.latest_version_id === v.id
  const ready = v.flow_status === "ready_to_copy"
  const editable = isLatest && !ready
  const chosen = titleIndex ?? v.selected_title_index ?? 0
  const items = evidence.data ?? []
  const undecided = items.filter(
    (e) => e.status !== "system_supported" && e.human_confirmed === null,
  )
  const rejected = items.filter((e) => e.human_confirmed === false)
  const openBlocks = compliance.data?.unresolved_block ?? 0
  const blockers: string[] = []
  if (!inProgress && !CONFIRMABLE.includes(v.flow_status))
    blockers.push(
      v.flow_status === "edited_pending_recheck"
        ? "文字已编辑，请先重新检查"
        : "当前状态还不能确认",
    )
  if (!inProgress && openBlocks > 0)
    blockers.push(`还有 ${openBlocks} 条“必须修改”的风险提示未处理`)
  if (!inProgress && undecided.length > 0)
    blockers.push(`还有 ${undecided.length} 条断言没有人工判断`)
  if (!inProgress && rejected.length > 0)
    blockers.push(`有 ${rejected.length} 条断言被判为不成立`)
  if (!isLatest) blockers.push("只有最新版本可以确认")
  const confirmError = confirm.isError ? parseApiError(confirm.error) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          第 {v.version_no} 版 · {label(ORIGIN_LABEL, v.origin, "origin")}
        </h1>
        <FlowStatusBadge status={v.flow_status} />
        {!isLatest && task.isSuccess && <Pill tone="gray">历史版本</Pill>}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/tasks/$taskId" params={{ taskId }}>
              返回任务
            </Link>
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        创建于 {formatTime(v.created_at)}
        {v.model ? ` · 模型 ${v.model}` : ""}
        {v.confirmed_at ? ` · 确认于 ${formatTime(v.confirmed_at)}` : ""}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border bg-card p-4">
            {editing ? (
              <EditForm
                version={v}
                onCancel={() => setEditing(false)}
                onSaved={goTo}
              />
            ) : (
              <>
                <div className="space-y-2">
                  <h2 className="text-base font-semibold">候选标题</h2>
                  <ul className="space-y-1">
                    {v.title_candidates.map((t, i) => (
                      <li key={`${i}-${t}`}>
                        <label className="flex items-start gap-2 rounded-md p-2 hover:bg-surface-low">
                          <input
                            type="radio"
                            name="title"
                            className="mt-1"
                            checked={chosen === i}
                            disabled={!editable}
                            onChange={() => setTitleIndex(i)}
                          />
                          <span className="min-w-0 flex-1 text-sm">{t}</span>
                          <CharCounter
                            value={titleWeight(t)}
                            limit={TITLE_LIMIT}
                          />
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
                {v.cover_candidates.length > 0 && (
                  <div className="space-y-2">
                    <h2 className="text-base font-semibold">封面文字候选</h2>
                    <ul className="space-y-1">
                      {v.cover_candidates.map((c, i) => (
                        <li key={`${i}-${c}`}>
                          <label className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-surface-low">
                            <input
                              type="radio"
                              name="cover"
                              checked={
                                (coverIndex ?? v.selected_cover_index) === i
                              }
                              disabled={!editable}
                              onChange={() => setCoverIndex(i)}
                            />
                            {c}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h2 className="text-base font-semibold">正文</h2>
                    <CharCounter
                      value={bodyUnits(v.body) + tagsVisibleUnits(v.hashtags)}
                      limit={BODY_LIMIT}
                      suffix="（含话题）"
                    />
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {v.body}
                  </p>
                </div>
                {v.hashtags.length > 0 && (
                  <p className="text-sm text-link">
                    {v.hashtags.map((t) => `#${normalizeTag(t)}`).join(" ")}
                  </p>
                )}
                {editable && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    编辑
                  </Button>
                )}
              </>
            )}
          </section>

          {editable && !editing && (
            <RewriteBar versionId={v.id} onDone={goTo} />
          )}
          {ready && <ExportPanel versionId={v.id} />}
        </div>

        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="text-base font-semibold">下一步</h2>
            {v.flow_status === "edited_pending_recheck" && isLatest && (
              <>
                <p className="text-sm">
                  文字已编辑，需要重新检查字数、事实依据和风险提示。
                </p>
                <LoadingButton
                  loading={recheck.isPending}
                  onClick={() => recheck.mutate()}
                >
                  重新检查
                </LoadingButton>
                {recheck.isError && (
                  <ErrorBanner error={parseApiError(recheck.error)} />
                )}
              </>
            )}
            {inProgress && (
              <>
                <p className="text-sm">{busyText}</p>
                <Button disabled>确认可复制</Button>
              </>
            )}
            {editable &&
              !inProgress &&
              v.flow_status !== "edited_pending_recheck" && (
                <>
                  {blockers.length > 0 && (
                    <ul className="list-disc pl-5 text-sm text-muted-foreground">
                      {blockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                  <LoadingButton
                    loading={confirm.isPending}
                    disabled={blockers.length > 0}
                    onClick={() => confirm.mutate(chosen)}
                  >
                    确认可复制
                  </LoadingButton>
                  <p className="text-xs text-muted-foreground">
                    “可复制”只表示运营确认了这份文字，不代表合规或事实保证。
                  </p>
                  {confirmError && <ErrorBanner error={confirmError} />}
                </>
              )}
            {ready && <p className="text-sm">运营已确认，可在左侧下方复制。</p>}
            {!editable &&
              !ready &&
              v.flow_status !== "edited_pending_recheck" &&
              !isLatest && (
                <p className="text-sm text-muted-foreground">
                  这是历史版本，只能查看。
                </p>
              )}
          </section>

          <ConstraintPanel version={v} />
          {evidence.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : evidence.isError ? (
            <ErrorBanner
              error={parseApiError(evidence.error)}
              onRetry={() => evidence.refetch()}
            />
          ) : (
            <EvidencePanel
              items={items}
              editable={editable}
              busyText={busyText}
              onDecide={(item, ok) => setDialog({ kind: "evidence", item, ok })}
            />
          )}
          {compliance.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : compliance.isError ? (
            <ErrorBanner
              error={parseApiError(compliance.error)}
              onRetry={() => compliance.refetch()}
            />
          ) : (
            <RiskPanel
              items={compliance.data?.items ?? []}
              editable={editable}
              busyText={busyText}
              onResolve={(item) => setDialog({ kind: "risk", item })}
            />
          )}
        </div>
      </div>

      {dialog?.kind === "evidence" && (
        <ReasonDialog
          key={dialog.item.id + String(dialog.ok)}
          open
          variant="default"
          fieldLabel="判断依据（必填）"
          title={dialog.ok ? "这条断言成立" : "这条断言不成立"}
          description={`断言：${dialog.item.claim_text}。你的判断会被记录为“人工确认（非系统验证）”。`}
          confirmLabel={dialog.ok ? "确认成立" : "确认不成立"}
          pending={decide.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={(note) =>
            decide.mutate({ id: dialog.item.id, ok: dialog.ok, note })
          }
        />
      )}
      {dialog?.kind === "risk" && (
        <ReasonDialog
          key={dialog.item.id}
          open
          variant="default"
          fieldLabel="处理说明（必填）"
          title="标记风险提示为已处理"
          description={`命中：${dialog.item.matched_text}。请说明你是怎么处理的。`}
          confirmLabel="标记为已处理"
          pending={resolve.isPending}
          onCancel={() => setDialog(null)}
          onConfirm={(note) => resolve.mutate({ id: dialog.item.id, note })}
        />
      )}
      {(decide.isError || resolve.isError) && (
        <ErrorBanner error={parseApiError(decide.error ?? resolve.error)} />
      )}
    </div>
  )
}
