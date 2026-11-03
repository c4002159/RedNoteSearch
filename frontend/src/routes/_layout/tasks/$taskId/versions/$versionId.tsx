import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  type ClaimEvidencePublic,
  type ComplianceCheckPublic,
  ComplianceService,
  EvidenceService,
  type GenerationVersionPublic,
  type RewriteRequest,
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
import { EvidenceBatchActions } from "@/components/Evidence/BatchActions"
import {
  ChangeList,
  draftFields,
  manualTargets,
} from "@/components/Generation/ChangeList"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  type ChangeDraft,
  type ChangeItem,
  emptyChangeList,
  saveChangeList,
  useChangeList,
} from "@/hooks/useChangeList"
import { parseApiError } from "@/lib/apiError"
import {
  BODY_LIMIT,
  bodyUnits,
  codePointCount,
  formatWeight,
  normalizeTag,
  TAG_LIMIT,
  TITLE_LIMIT,
  tagsVisibleUnits,
  titleWeight,
} from "@/lib/count"
import { formatTime } from "@/lib/format"
import {
  canRewriteRisk,
  changeListSteps,
  riskRewriteTarget,
} from "@/lib/riskRewrite"
import { cn } from "@/lib/utils"
import {
  R7_CHANGELIST_TEXT as CL,
  COUNT_LABEL,
  EVIDENCE_BATCH_TEXT as EB,
  LAYER_LABEL,
  label,
  ORIGIN_LABEL,
  PAGE_ERROR_TEXT,
  RISK_REWRITE_REVIEW_TEXT as RR,
  RESULT_REWRITE_TEXT as RW,
  SCENARIO_TEXT,
} from "@/lib/zh"

export const Route = createFileRoute(
  "/_layout/tasks/$taskId/versions/$versionId",
)({
  component: ResultRoute,
  head: () => ({ meta: [{ title: "结果页 - RedNoteSearch" }] }),
})

const CARD = "rounded-xl border border-border/40 bg-card p-6 shadow-sm"
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
  onChange,
}: {
  version: Version
  onCancel: () => void
  onSaved: () => void
  onChange: (draft: ChangeDraft) => void
}) {
  const [titles, setTitles] = useState(version.title_candidates)
  const [body, setBody] = useState(version.body)
  const [tags, setTags] = useState(version.hashtags.join(" "))
  const [covers, setCovers] = useState(version.cover_candidates.join("\n"))
  const tagList = tags
    .split(/[\s,，]+/)
    .map(normalizeTag)
    .filter(Boolean)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  useEffect(() => {
    changeRef.current({
      title_candidates: titles.map((t) => t.trim()).filter(Boolean),
      body,
      hashtags: tags
        .split(/[\s,，]+/)
        .map(normalizeTag)
        .filter(Boolean),
      cover_candidates: covers
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean),
    })
  }, [titles, body, tags, covers])
  const total = bodyUnits(body) + tagsVisibleUnits(tagList)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSaved()
      }}
    >
      <p className="text-sm text-muted-foreground">{CL.editHint}</p>
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
      <div className="flex gap-3">
        <Button type="submit">{CL.editSave}</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
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

function ConstraintPanel({
  version,
  bare = false,
}: {
  version: Version
  bare?: boolean
}) {
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
    <section
      className={cn("space-y-2", !bare && "rounded-xl border bg-card p-4")}
    >
      <div className="flex items-center gap-2">
        {!bare && <h2 className="text-base font-semibold">字数与格式检查</h2>}
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
  versionId,
  onSaved,
  items,
  editable,
  busyText,
  onDecide,
  bare = false,
}: {
  versionId: string
  onSaved: () => Promise<void>
  items: ClaimEvidencePublic[]
  editable: boolean
  busyText: string | null
  onDecide: (item: ClaimEvidencePublic, ok: boolean) => void
  bare?: boolean
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectedIds = items
    .filter((item) => selected.has(item.id))
    .map((item) => item.id)
  return (
    <section
      className={cn("space-y-3", !bare && "rounded-xl border bg-card p-4")}
    >
      {!bare && (
        <h2 className="text-base font-semibold">事实依据（{items.length}）</h2>
      )}
      <p className="text-xs text-muted-foreground">
        “系统判定支持”只表示资料与断言匹配，不是事实保证。没有系统依据的断言需要你逐条判断。
      </p>
      <EvidenceBatchActions
        versionId={versionId}
        items={items}
        selectedIds={selectedIds}
        enabled={editable && !busyText}
        onSaved={onSaved}
        onClear={() => setSelected(new Set())}
      />
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
              <div className="flex items-start gap-3">
                {editable && !busyText && (
                  <Checkbox
                    className="mt-1"
                    aria-label={EB.select(e.claim_text)}
                    checked={selected.has(e.id)}
                    disabled={!selected.has(e.id) && selectedIds.length >= 100}
                    onCheckedChange={(checked) =>
                      setSelected((previous) => {
                        const next = new Set(
                          [...previous].filter((id) =>
                            items.some((item) => item.id === id),
                          ),
                        )
                        if (checked === true) next.add(e.id)
                        else next.delete(e.id)
                        return next
                      })
                    }
                  />
                )}
                <p className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
                  {e.claim_text}
                </p>
              </div>
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
  onManual,
  onRewrite,
  rewriting,
  bare = false,
}: {
  items: ComplianceCheckPublic[]
  editable: boolean
  busyText: string | null
  onManual: () => void
  onResolve: (item: ComplianceCheckPublic) => void
  onRewrite: (items: ComplianceCheckPublic[]) => void
  rewriting: boolean
  bare?: boolean
}) {
  const pendingRisks = items.filter((item) => !item.resolved)
  const missingSuggestion = pendingRisks.some((item) => !item.suggestion.trim())
  const needsManual = pendingRisks.some((item) => !canRewriteRisk(item))
  return (
    <section
      className={cn("space-y-3", !bare && "rounded-xl border bg-card p-4")}
    >
      {!bare && (
        <h2 className="text-base font-semibold">风险提示（{items.length}）</h2>
      )}
      <p className="text-xs text-muted-foreground">
        这些是基于规则的提示，不是合规结论，不能替代人工和法务判断。
      </p>
      {editable && !busyText && items.length > 0 && (
        <div className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            disabled={rewriting || pendingRisks.length === 0 || needsManual}
            onClick={() => onRewrite(pendingRisks)}
          >
            {CL.riskAll}
          </Button>
          <p className="text-xs leading-6 text-muted-foreground">
            {CL.riskHint}
          </p>
          {needsManual && (
            <p className="text-xs text-tone-warn">{RR.manualHint}</p>
          )}
          {missingSuggestion && (
            <p className="text-xs text-tone-warn">{RW.noSuggestion}</p>
          )}
        </div>
      )}
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
            <div className="flex flex-wrap gap-2">
              {!c.resolved && editable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onResolve(c)}
                  disabled={rewriting}
                >
                  标记为已处理
                </Button>
              )}
              {editable && !busyText && canRewriteRisk(c) && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rewriting || !c.suggestion.trim()}
                  onClick={() => onRewrite([c])}
                >
                  {RW.risk}
                </Button>
              )}
              {editable && !busyText && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={rewriting}
                  onClick={onManual}
                >
                  {CL.manual}
                </Button>
              )}
              {editable && !busyText && !canRewriteRisk(c) && (
                <span className="text-xs text-tone-warn">{RR.manual}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ---- rewrite

function RewriteBar({
  onRewrite,
  pending,
  target,
}: {
  onRewrite: (body: RewriteRequest) => void
  pending: boolean
  target: RewriteRequest["target"]
}) {
  const [instruction, setInstruction] = useState("")
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-semibold">
        {CL.parts[target]} · {CL.request}
      </h2>
      <label className="sr-only" htmlFor={`request-${target}`}>
        {CL.requestLabel(CL.parts[target])}
      </label>
      <Textarea
        id={`request-${target}`}
        value={instruction}
        placeholder={CL.requestPlaceholder}
        disabled={pending}
        rows={2}
        onChange={(e) => setInstruction(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <CharCounter value={codePointCount(instruction)} limit={500} />
        <Button
          variant="outline"
          size="sm"
          disabled={
            pending ||
            !instruction.trim() ||
            codePointCount(instruction.trim()) > 500
          }
          aria-label={CL.addPart(CL.parts[target])}
          onClick={() => {
            onRewrite({ target, instruction: instruction.trim() })
            setInstruction("")
          }}
        >
          {CL.add}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{CL.requestHint}</p>
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

function ResultRoute() {
  const { versionId } = Route.useParams()
  return <ResultPage key={versionId} />
}
function asDraft(v: Version): ChangeDraft {
  return {
    title_candidates: v.title_candidates,
    body: v.body,
    hashtags: v.hashtags,
    cover_candidates: v.cover_candidates,
  }
}
function ResultPage() {
  const { taskId, versionId } = Route.useParams()
  const navigate = useNavigate()
  const refresh = useRefreshVersion(taskId, versionId)
  const list = useChangeList(versionId)
  const applyingRef = useRef(false)
  const editSnapshot = useRef<ChangeDraft | null>(null)
  const [editing, setEditing] = useState(false)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [titleIndex, setTitleIndex] = useState<number | null>(null)
  const [coverIndex, setCoverIndex] = useState<number | null>(null)
  const [tab, setTab] = useState("evidence")

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

  const rewriteProgress = list.state.progress ?? { total: 0, completed: [] }
  const rewrite = useMutation({
    mutationFn: async () => {
      applyingRef.current = true
      const plan = changeListSteps(list.state.items, list.state.note)
      if (plan.error) throw new Error(plan.error)
      let remaining = {
        ...list.state,
        failure: null as typeof list.state.failure,
      }
      const completed = [...(remaining.progress?.completed ?? [])]
      const total = completed.length + plan.steps.length
      let currentId = versionId
      let last: Version | undefined
      const checkpoint = (next: typeof remaining) => {
        remaining = next
        list.update(() => next)
        if (last) saveChangeList(last.id, next)
      }
      checkpoint({
        ...remaining,
        progress: { total, completed: [...completed] },
      })
      try {
        if (remaining.draft) {
          last = (
            await VersionsService.editVersion({
              path: { version_id: currentId },
              body: remaining.draft,
            })
          ).data
          currentId = last.id
          checkpoint({ ...remaining, draft: null })
        }
        for (const body of plan.steps) {
          const previousId = currentId
          last = (
            await VersionsService.rewritePart({
              path: { version_id: currentId },
              body,
              timeout: 180_000,
            })
          ).data
          currentId = last.id
          completed.push(body.target)
          checkpoint({
            ...remaining,
            items: remaining.items.filter(
              (item) => item.target !== body.target,
            ),
            progress: { total, completed: [...completed] },
          })
          if (previousId !== versionId)
            saveChangeList(previousId, emptyChangeList())
        }
        if (last && !plan.steps.length)
          await VersionsService.recheckVersion({
            path: { version_id: last.id },
          })
        list.clear()
        if (last) {
          saveChangeList(last.id, emptyChangeList())
          await goTo(last)
        }
      } catch (error) {
        const info = parseApiError(error)
        const failure = {
          status: info.status,
          requestId: info.requestId,
          message: /[\u3400-\u9fff]/.test(info.message)
            ? info.message
            : (PAGE_ERROR_TEXT.status[info.status ?? 0] ?? CL.failed),
        }
        checkpoint({ ...remaining, failure })
        if (last) {
          list.clear()
          await goTo(last)
        }
        if (!last) applyingRef.current = false
        throw error
      }
    },
  })
  const partialRewrite =
    !!list.state.progress?.completed.length && !!list.state.failure
  const rewriteBusy = rewrite.isPending
  useEffect(() => {
    if (
      applyingRef.current ||
      !evidence.data ||
      !version.data ||
      task.data?.latest_version_id !== versionId
    )
      return
    const v = version.data
    const changes: ChangeItem[] = []
    for (const claim of evidence.data.filter(
      (item) => item.human_confirmed === false,
    )) {
      const targets: RewriteRequest["target"][] = []
      if (v.title_candidates.some((text) => text.includes(claim.claim_text)))
        targets.push("titles")
      if (v.body.includes(claim.claim_text)) targets.push("body")
      if (v.cover_candidates.some((text) => text.includes(claim.claim_text)))
        targets.push("cover")
      if (v.hashtags.some((text) => text.includes(claim.claim_text)))
        targets.push("hashtags")
      for (const target of targets.length ? targets : ["body" as const])
        changes.push({
          id: `evidence:${claim.id}:${target}`,
          sourceId: claim.id,
          source: "evidence",
          target,
          instruction: CL.rejected(claim.claim_text),
        })
    }
    list.syncEvidence(changes)
  }, [
    evidence.data,
    version.data,
    task.data?.latest_version_id,
    versionId,
    list.syncEvidence,
  ])

  const recheck = useMutation({
    mutationFn: async () =>
      (
        await VersionsService.recheckVersion({
          path: { version_id: versionId },
        })
      ).data,
    onSuccess: async () => {
      list.update((value) => ({ ...value, failure: null, progress: null }))
      await refresh()
    },
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
    onSuccess: async (_, input) => {
      list.update((value) => ({
        ...value,
        items: value.items.filter(
          (item) => item.source !== "risk" || item.sourceId !== input.id,
        ),
      }))
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
  const rewriteError = list.state.failure
    ? { ...list.state.failure, code: "REWRITE_FAILED", details: {} }
    : null
  const original = asDraft(v)
  const content = editable ? { ...v, ...list.state.draft } : v
  const manual = manualTargets(original, list.state.draft)
  const hasChanges = !!(
    list.state.items.length ||
    manual.length ||
    list.state.note.trim()
  )
  const plan = changeListSteps(list.state.items, list.state.note)
  const stageDraft = (draft: ChangeDraft | null) =>
    list.update((value) => ({
      ...value,
      draft: draft && manualTargets(original, draft).length ? draft : null,
    }))
  const beginEdit = () => {
    editSnapshot.current = list.state.draft
    setEditing(true)
  }
  const request = (body: RewriteRequest) => {
    list.add([
      {
        id: `request:${body.target}`,
        source: "request",
        target: body.target,
        instruction: body.instruction,
      },
    ])
    toast.success(CL.added)
  }
  const pendingRisks = (compliance.data?.items ?? []).filter(
    (item) =>
      !item.resolved &&
      !list.state.items.some((change) => change.sourceId === item.id) &&
      !manual.some((target) => target === riskRewriteTarget(item.field)),
  )

  return (
    <div className="space-y-6">
      <nav
        aria-label="位置"
        className="flex items-center gap-1.5 text-sm text-muted-foreground"
      >
        <Link to="/tasks" className="hover:text-foreground">
          任务与版本历史
        </Link>
        <ChevronRight className="size-4" />
        <span className="font-semibold text-foreground">
          版本 {v.version_no}
        </span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          第 {v.version_no} 版 · {label(ORIGIN_LABEL, v.origin, "origin")}
        </h1>
        <FlowStatusBadge status={v.flow_status} />
        {!isLatest && task.isSuccess && <Pill tone="gray">历史版本</Pill>}
        {task.data?.scenario_name && (
          <Pill tone="softBlue">
            {SCENARIO_TEXT.adopted}
            {task.data.scenario_name}
            {task.data.scenario_version
              ? ` v${task.data.scenario_version}`
              : ""}
          </Pill>
        )}
        <div className="ml-auto flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/tasks/$taskId" params={{ taskId }}>
              返回任务
            </Link>
          </Button>
        </div>
      </div>
      {rewrite.isPending && (
        <p role="status" className="rounded-lg bg-surface-low p-3 text-sm">
          {RW.pending}
          {rewriteProgress.total > 1 && (
            <span className="ml-2">
              {RR.progress(
                Math.min(
                  rewriteProgress.completed.length + 1,
                  rewriteProgress.total,
                ),
                rewriteProgress.total,
              )}
            </span>
          )}
        </p>
      )}
      {partialRewrite && (
        <p role="status" className="rounded-lg bg-surface-low p-3 text-sm">
          {CL.continuation(
            rewriteProgress.completed
              .map((target) => CL.parts[target])
              .join("、"),
            rewriteProgress.completed.length,
            rewriteProgress.total,
          )}
        </p>
      )}
      {rewriteError && (
        <ErrorBanner
          error={{
            ...rewriteError,
            message: /[\u3400-\u9fff]/.test(rewriteError.message)
              ? rewriteError.message
              : (PAGE_ERROR_TEXT.status[rewriteError.status ?? 0] ??
                PAGE_ERROR_TEXT.failed),
          }}
        />
      )}
      <p className="text-xs text-muted-foreground">
        创建于 {formatTime(v.created_at)}
        {v.model ? ` · 模型 ${v.model}` : ""}
        {v.confirmed_at ? ` · 确认于 ${formatTime(v.confirmed_at)}` : ""}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          {editing && editable && !inProgress ? (
            <section className={CARD}>
              <EditForm
                version={content}
                onChange={stageDraft}
                onCancel={() => {
                  stageDraft(editSnapshot.current)
                  setEditing(false)
                }}
                onSaved={() => {
                  setEditing(false)
                  toast.success(CL.editStored)
                }}
              />
            </section>
          ) : (
            <>
              <section className={CARD}>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-lg font-semibold">标题候选</h2>
                  <span className="text-xs text-muted-foreground">
                    字数以系统检查结果为准
                  </span>
                </div>
                <ul className="mt-4 space-y-3">
                  {content.title_candidates.map((t, i) => (
                    <li key={`${i}-${t}`}>
                      <label
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                          chosen === i
                            ? "border-primary bg-accent"
                            : "border-border/60 hover:bg-surface-low",
                        )}
                      >
                        <input
                          type="radio"
                          name="title"
                          className="size-4 accent-primary"
                          checked={chosen === i}
                          disabled={!editable}
                          onChange={() => setTitleIndex(i)}
                        />
                        <span className="min-w-0 flex-1">{t}</span>
                        <CharCounter
                          value={titleWeight(t)}
                          limit={TITLE_LIMIT}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              </section>

              <section className={CARD}>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-semibold">正文内容</h2>
                  <CharCounter
                    value={
                      bodyUnits(content.body) +
                      tagsVisibleUnits(content.hashtags)
                    }
                    limit={BODY_LIMIT}
                    suffix="（含话题）"
                  />
                  {editable && (
                    <Button
                      className="ml-auto"
                      variant="outline"
                      size="sm"
                      disabled={rewriteBusy}
                      onClick={beginEdit}
                    >
                      编辑
                    </Button>
                  )}
                </div>
                <p className="mt-4 whitespace-pre-wrap rounded-xl bg-surface-low p-5 text-sm leading-7">
                  {content.body}
                </p>
              </section>

              <section className={CARD}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">推荐标签</h2>
                  {editable && !inProgress && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rewriteBusy}
                      onClick={() => request({ target: "hashtags" })}
                    >
                      {RW.tags}
                    </Button>
                  )}
                  <span className="text-xs text-muted-foreground">
                    已选 {content.hashtags.length} / 10
                  </span>
                </div>
                {content.hashtags.length === 0 && (
                  <p className="mt-4 text-sm text-muted-foreground">
                    {RW.emptyTags}
                  </p>
                )}
                <ul className="mt-4 flex flex-wrap gap-2">
                  {content.hashtags.map((t) => (
                    <li
                      key={t}
                      className="rounded-full bg-surface-low px-3.5 py-1.5 text-sm font-medium"
                    >
                      #{normalizeTag(t)}
                    </li>
                  ))}
                </ul>
              </section>

              {content.cover_candidates.length > 0 && (
                <section className={CARD}>
                  <div className="flex items-baseline gap-3">
                    <h2 className="text-lg font-semibold">封面文案候选</h2>
                    <span className="text-xs text-muted-foreground">
                      封面文案不并入复制文本
                    </span>
                  </div>
                  <ul className="mt-4 space-y-3">
                    {content.cover_candidates.map((c, i) => {
                      const on = (coverIndex ?? v.selected_cover_index) === i
                      return (
                        <li key={`${i}-${c}`}>
                          <label
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                              on
                                ? "border-primary bg-accent"
                                : "border-border/60 hover:bg-surface-low",
                            )}
                          >
                            <input
                              type="radio"
                              name="cover"
                              className="size-4 accent-primary"
                              checked={on}
                              disabled={!editable}
                              onChange={() => setCoverIndex(i)}
                            />
                            {c}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )}
            </>
          )}

          {editable && !editing && !inProgress && (
            <div className="grid gap-3 sm:grid-cols-2">
              {(["titles", "body", "cover", "hashtags"] as const).map(
                (target) => (
                  <RewriteBar
                    key={target}
                    target={target}
                    pending={rewriteBusy}
                    onRewrite={request}
                  />
                ),
              )}
            </div>
          )}
          {ready && <ExportPanel versionId={v.id} />}
        </div>

        <div className="space-y-6">
          <section className={cn(CARD, "space-y-3 p-5")}>
            <h2 className="text-base font-semibold">下一步</h2>
            {editable && (
              <>
                <ChangeList
                  state={list.state}
                  original={original}
                  pending={rewriteBusy}
                  onRemove={list.remove}
                  onRemoveManual={(target) => {
                    setEditing(false)
                    if (list.state.draft)
                      stageDraft({
                        ...list.state.draft,
                        [draftFields[target]]: original[draftFields[target]],
                      })
                  }}
                  onNote={(note) =>
                    list.update((value) => ({ ...value, note }))
                  }
                />
                {!inProgress && (
                  <p className="text-xs text-muted-foreground">
                    {CL.undecided(pendingRisks.length, undecided.length)}
                  </p>
                )}
                {plan.error && (
                  <p role="alert" className="text-sm text-tone-err">
                    {plan.error}
                  </p>
                )}
                {hasChanges && (
                  <LoadingButton
                    loading={rewriteBusy}
                    disabled={
                      inProgress ||
                      !!plan.error ||
                      evidence.isLoading ||
                      compliance.isLoading ||
                      evidence.isError ||
                      compliance.isError
                    }
                    onClick={() => {
                      setEditing(false)
                      rewrite.mutate()
                    }}
                  >
                    {partialRewrite ? CL.retry : CL.apply}
                  </LoadingButton>
                )}
                {!hasChanges && v.flow_status === "edited_pending_recheck" && (
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
                {!hasChanges && !inProgress && blockers.length === 0 && (
                  <>
                    <LoadingButton
                      loading={confirm.isPending}
                      disabled={
                        evidence.isLoading ||
                        compliance.isLoading ||
                        evidence.isError ||
                        compliance.isError
                      }
                      onClick={() => confirm.mutate(chosen)}
                    >
                      确认可复制
                    </LoadingButton>
                    <p className="text-xs text-muted-foreground">
                      “可复制”只表示运营确认了这份文字，不代表合规或事实保证。
                    </p>
                  </>
                )}
                {!inProgress && blockers.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-muted-foreground">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {confirmError && <ErrorBanner error={confirmError} />}
              </>
            )}
            {inProgress && <p className="text-sm">{busyText}</p>}
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

          <section className={cn(CARD, "overflow-hidden p-0")}>
            <Tabs value={tab} onValueChange={setTab} className="gap-0">
              <TabsList className="h-12 w-full justify-start gap-6 rounded-none border-b border-border/40 bg-transparent px-5 py-0">
                {[
                  {
                    id: "constraints",
                    text: "约束",
                    dot: "bg-primary",
                    n: null,
                  },
                  {
                    id: "evidence",
                    text: "证据",
                    dot: "bg-tone-ok",
                    n: items.length,
                  },
                  {
                    id: "risk",
                    text: "风险",
                    dot: "bg-tone-warn",
                    n: compliance.data?.items.length ?? null,
                  },
                ].map((x) => (
                  <TabsTrigger
                    key={x.id}
                    value={x.id}
                    className="h-full flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
                  >
                    <span className={cn("size-2 rounded-full", x.dot)} />
                    {x.text}
                    {x.n !== null && x.n > 0 && (
                      <span className="rounded-full bg-surface-low px-1.5 text-xs">
                        {x.n}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="constraints" className="p-5">
                {(v.constraint_checks as { passed?: boolean }).passed ===
                undefined ? (
                  <p className="text-sm text-muted-foreground">
                    {busyText ?? "还没有字数与格式检查结果。"}
                  </p>
                ) : (
                  <ConstraintPanel version={v} bare />
                )}
              </TabsContent>
              <TabsContent value="evidence" className="p-5">
                {evidence.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : evidence.isError ? (
                  <ErrorBanner
                    error={parseApiError(evidence.error)}
                    onRetry={() => evidence.refetch()}
                  />
                ) : (
                  <EvidencePanel
                    key={versionId}
                    versionId={versionId}
                    onSaved={refresh}
                    bare
                    items={items}
                    editable={editable && !rewriteBusy}
                    busyText={busyText}
                    onDecide={(item, ok) =>
                      setDialog({ kind: "evidence", item, ok })
                    }
                  />
                )}
              </TabsContent>
              <TabsContent value="risk" className="p-5">
                {compliance.isLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : compliance.isError ? (
                  <ErrorBanner
                    error={parseApiError(compliance.error)}
                    onRetry={() => compliance.refetch()}
                  />
                ) : (
                  <RiskPanel
                    bare
                    items={compliance.data?.items ?? []}
                    editable={editable}
                    busyText={busyText}
                    onManual={beginEdit}
                    onResolve={(item) => setDialog({ kind: "risk", item })}
                    rewriting={rewriteBusy}
                    onRewrite={(risks) => {
                      list.add(
                        risks.filter(canRewriteRisk).map((risk) => ({
                          id: `risk:${risk.id}`,
                          sourceId: risk.id,
                          source: "risk",
                          target: riskRewriteTarget(risk.field)!,
                          matched_text: risk.matched_text,
                          suggestion: risk.suggestion,
                        })),
                      )
                      toast.success(CL.added)
                    }}
                  />
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>

      {dialog?.kind === "evidence" &&
        editable &&
        !rewriteBusy &&
        !inProgress && (
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
      {dialog?.kind === "risk" && editable && !rewriteBusy && !inProgress && (
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
