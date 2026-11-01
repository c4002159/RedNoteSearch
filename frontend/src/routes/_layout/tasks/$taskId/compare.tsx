import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"

import { TasksService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiError } from "@/lib/apiError"
import { type DiffRow, diffLines } from "@/lib/diff"
import { label, ORIGIN_LABEL } from "@/lib/zh"

export const Route = createFileRoute("/_layout/tasks/$taskId/compare")({
  validateSearch: (s: Record<string, unknown>) => ({
    left: typeof s.left === "string" ? s.left : "",
    right: typeof s.right === "string" ? s.right : "",
  }),
  component: ComparePage,
  head: () => ({ meta: [{ title: "版本对比 - RedNoteSearch" }] }),
})

function Rows({ title, rows }: { title: string; rows: DiffRow[] }) {
  return (
    <section className="space-y-2 rounded-xl border bg-card p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">两个版本都为空。</p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map((r, i) => (
          <div key={`${i}-${r.left}-${r.right}`} className="contents">
            <p
              className={`whitespace-pre-wrap break-words rounded px-2 py-1 ${
                r.left === null
                  ? ""
                  : r.same
                    ? ""
                    : "bg-error-container text-on-error-container"
              }`}
            >
              {r.left ?? ""}
            </p>
            <p
              className={`whitespace-pre-wrap break-words rounded px-2 py-1 ${
                r.right === null ? "" : r.same ? "" : "bg-tone-ok"
              }`}
            >
              {r.right ?? ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

const lines = (text: string) => (text ? text.split("\n") : [])

function ComparePage() {
  const { taskId } = Route.useParams()
  const { left, right } = Route.useSearch()
  const versions = useQuery({
    queryKey: ["task-versions", taskId, "compare"],
    queryFn: async () =>
      (await TasksService.readTaskVersions({ path: { task_id: taskId } })).data
        .items,
  })

  const a = versions.data?.find((v) => v.id === left)
  const b = versions.data?.find((v) => v.id === right)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">版本对比</h1>
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to="/tasks/$taskId" params={{ taskId }}>
            返回任务
          </Link>
        </Button>
      </div>
      {versions.isLoading && <Skeleton className="h-48 w-full" />}
      {versions.isError &&
        (parseApiError(versions.error).status === 404 ? (
          <MissingPage />
        ) : (
          <ErrorBanner
            error={parseApiError(versions.error)}
            onRetry={() => versions.refetch()}
          />
        ))}
      {versions.isSuccess && (!a || !b || a.id === b.id) && (
        <EmptyState
          title="请选择两个不同的版本"
          description="回到任务页，在“版本”区域选好左右两个版本再点“对比”。"
        />
      )}
      {a && b && a.id !== b.id && (
        <>
          <div className="grid grid-cols-2 gap-4">
            {[a, b].map((v) => (
              <div key={v.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  第 {v.version_no} 版 ·{" "}
                  {label(ORIGIN_LABEL, v.origin, "origin")}
                </span>
                <FlowStatusBadge status={v.flow_status} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            红色为只在左侧出现的内容，绿色为只在右侧出现的内容。
          </p>
          <Rows
            title="候选标题"
            rows={diffLines(a.title_candidates, b.title_candidates)}
          />
          <Rows title="正文" rows={diffLines(lines(a.body), lines(b.body))} />
          <Rows
            title="话题"
            rows={diffLines(
              a.hashtags.map((t) => `#${t.replace(/^#+/, "")}`),
              b.hashtags.map((t) => `#${t.replace(/^#+/, "")}`),
            )}
          />
          <Rows
            title="封面文字候选"
            rows={diffLines(a.cover_candidates, b.cover_candidates)}
          />
        </>
      )}
    </div>
  )
}
