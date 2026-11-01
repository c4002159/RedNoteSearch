import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"

import { TasksService } from "@/client"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { StageProgress } from "@/components/Common/StageProgress"
import { FlowStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import { label, ORIGIN_LABEL, TASK_ERROR_LABEL } from "@/lib/zh"

export const Route = createFileRoute("/_layout/tasks/$taskId/")({
  component: TaskDetail,
  head: () => ({ meta: [{ title: "任务详情 - RedNoteSearch" }] }),
})

const RUNNING = ["generating", "checking"]

function TaskDetail() {
  const { taskId } = Route.useParams()
  const [since] = useState(() => Date.now())
  const task = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () =>
      (await TasksService.readTask({ path: { task_id: taskId } })).data,
    refetchInterval: (q) =>
      q.state.data && RUNNING.includes(q.state.data.flow_status)
        ? Date.now() - since > 5 * 60_000
          ? 10_000
          : 3_000
        : false,
  })
  const versions = useQuery({
    queryKey: ["task-versions", taskId, task.data?.latest_version_id ?? null],
    queryFn: async () =>
      (await TasksService.readTaskVersions({ path: { task_id: taskId } })).data,
  })
  const [left, setLeft] = useState("")
  const [right, setRight] = useState("")

  if (task.isLoading) return <Skeleton className="h-48 w-full" />
  if (task.isError) {
    const err = parseApiError(task.error)
    return err.status === 404 ? (
      <MissingPage />
    ) : (
      <ErrorBanner error={err} onRetry={() => task.refetch()} />
    )
  }
  const t = task.data
  if (!t) return null
  const stage = typeof t.progress?.stage === "string" ? t.progress.stage : null
  const items = versions.data?.items ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t.product_name ?? "任务"} · {t.scenario_name ?? ""}
        </h1>
        <FlowStatusBadge status={t.flow_status} />
        <Button asChild variant="outline" size="sm" className="ml-auto">
          <Link to="/tasks">返回列表</Link>
        </Button>
      </div>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <StageProgress flowStatus={t.flow_status} stage={stage} />
        {t.last_error && (
          <p role="alert" className="text-sm text-destructive">
            {label(TASK_ERROR_LABEL, t.last_error, "task_error")}
          </p>
        )}
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">创建时间</dt>
            <dd>{formatTime(t.created_at)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">必须包含的词</dt>
            <dd>
              {t.required_terms.length ? t.required_terms.join("、") : "—"}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-muted-foreground">创作要求</dt>
            <dd className="whitespace-pre-wrap">{t.brief || "—"}</dd>
          </div>
        </dl>
        {(t.flow_status === "queued" ||
          t.flow_status === "constraint_failed") && (
          <Button asChild>
            <Link to="/generate" search={{ task: t.id }}>
              {t.flow_status === "queued" ? "去开始生成" : "去重新生成"}
            </Link>
          </Button>
        )}
      </section>

      <section className="space-y-3 rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">版本（{items.length}）</h2>
          {items.length >= 2 && (
            <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
              <select
                aria-label="左侧版本"
                className="h-8 rounded-md border border-input bg-background px-2"
                value={left}
                onChange={(e) => setLeft(e.target.value)}
              >
                <option value="">选择左侧版本</option>
                {items.map((v) => (
                  <option key={v.id} value={v.id}>
                    第 {v.version_no} 版
                  </option>
                ))}
              </select>
              <select
                aria-label="右侧版本"
                className="h-8 rounded-md border border-input bg-background px-2"
                value={right}
                onChange={(e) => setRight(e.target.value)}
              >
                <option value="">选择右侧版本</option>
                {items.map((v) => (
                  <option key={v.id} value={v.id}>
                    第 {v.version_no} 版
                  </option>
                ))}
              </select>
              {left && right && left !== right ? (
                <Button asChild size="sm">
                  <Link
                    to="/tasks/$taskId/compare"
                    params={{ taskId: t.id }}
                    search={{ left, right }}
                  >
                    对比
                  </Link>
                </Button>
              ) : (
                <Button size="sm" disabled>
                  对比
                </Button>
              )}
            </div>
          )}
        </div>
        {versions.isLoading && <Skeleton className="h-16 w-full" />}
        {versions.isError && (
          <ErrorBanner
            error={parseApiError(versions.error)}
            onRetry={() => versions.refetch()}
          />
        )}
        {versions.isSuccess && items.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有生成版本。</p>
        )}
        <ul className="space-y-2">
          {items.map((v) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  第 {v.version_no} 版 ·{" "}
                  {label(ORIGIN_LABEL, v.origin, "origin")}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {v.title_candidates[0] ?? "（无标题）"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatTime(v.created_at)}
                </p>
              </div>
              <FlowStatusBadge status={v.flow_status} />
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/tasks/$taskId/versions/$versionId"
                  params={{ taskId: t.id, versionId: v.id }}
                >
                  打开
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
