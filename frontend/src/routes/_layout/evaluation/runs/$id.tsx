import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { EvaluationService } from "@/client"
import { Agreement, Metrics, Results } from "@/components/Evaluation/RunReport"
import {
  EvalBreadcrumb,
  EvalStatus,
  EvaluationError,
  EvaluationGuard,
  JsonBlock,
  retryEval,
  running,
  terminal,
} from "@/components/Evaluation/shared"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import {
  EVAL_KIND_LABEL,
  evaluationSystemLabel,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
export const Route = createFileRoute("/_layout/evaluation/runs/$id")({
  component: () => (
    <EvaluationGuard>
      <RunPage />
    </EvaluationGuard>
  ),
  head: () => ({ meta: [{ title: `${T.runDetail} - RedNoteSearch` }] }),
})
function RunPage() {
  const { id } = Route.useParams()
  const [showFailures, setShowFailures] = useState(false)
  const query = useQuery({
    queryKey: ["evaluation-run", id],
    queryFn: async ({ signal }) =>
      (await EvaluationService.readRun({ path: { run_id: id }, signal })).data,
    refetchInterval: (q) =>
      q.state.data && running(q.state.data.status) ? 2000 : false,
    retry: retryEval,
  })
  const datasets = useQuery({
    queryKey: ["evaluation-datasets", "all"],
    queryFn: async ({ signal }) =>
      (await EvaluationService.readDatasets({ signal })).data.items,
    enabled: !!query.data,
  })
  if (query.isLoading) return <Skeleton className="h-48 w-full" />
  if (query.isError)
    return <EvaluationError error={query.error} retry={() => query.refetch()} />
  if (!query.data) return null
  const run = query.data
  return (
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <EvalBreadcrumb current={T.runDetail} runs />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.runDetail}</h1>
          <p className="text-sm text-muted-foreground">
            {label(EVAL_KIND_LABEL, run.kind)} · {run.sample_count} {T.cases} ·{" "}
            {formatTime(run.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EvalStatus status={run.status} />
          <Button variant="outline" onClick={() => query.refetch()}>
            {T.refresh}
          </Button>
        </div>
      </div>
      <section className="min-w-0 space-y-3 rounded-xl bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{T.runVersions}</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-muted-foreground">{T.datasets}</dt>
            <dd>
              <Link
                className="text-link hover:underline"
                to="/evaluation/datasets/$id"
                params={{ id: run.dataset_id }}
              >
                {datasets.data?.find((d) => d.id === run.dataset_id)?.name ??
                  T.datasets}
              </Link>
            </dd>
          </div>
          {[
            [T.version, `v${run.versions.dataset_version}`],
            [T.prompt, run.versions.prompt_version ?? "—"],
            [T.checker, run.versions.checker_version ?? "—"],
            [T.rubric, run.versions.rubric_version ?? "—"],
            [T.models, run.versions.models.join("、") || "—"],
            [
              T.baselines,
              run.versions.baselines.map(evaluationSystemLabel).join("、") ||
                "—",
            ],
            [T.finished, formatTime(run.finished_at)],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="[overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      {running(run.status) ? (
        <p role="status" className="rounded-lg bg-surface p-4 text-sm">
          {T.runningHint}
          <span className="mt-3 block h-2 animate-pulse rounded-full bg-primary/20" />
          <span className="mt-2 block text-xs text-muted-foreground">
            {V.noProgress}
          </span>
        </p>
      ) : !terminal(run.status) ? (
        <p role="status" className="text-sm">
          {T.unknownState}
        </p>
      ) : (
        <>
          <Metrics run={run} />
          <section className="min-w-0 space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{T.failures}</h2>
            {run.error && (
              <p role="alert" className="text-sm text-destructive">
                {T.runError}：{run.error}
              </p>
            )}
            {run.failures.length > 0 ? (
              <Button
                variant="ghost"
                className="text-link"
                onClick={() => setShowFailures(true)}
              >
                {V.view} · {run.failures.length}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">{T.noFailures}</p>
            )}
          </section>
          <div className="grid grid-cols-1 items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Results run={run} />
            <Agreement run={run} />
          </div>
        </>
      )}
      {showFailures && (
        <Dialog open onOpenChange={setShowFailures}>
          <DialogContent className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>{T.failures}</DialogTitle>
              <DialogDescription>{V.metricsOnly}</DialogDescription>
            </DialogHeader>
            <JsonBlock value={run.failures} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowFailures(false)}>
                {V.close}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
