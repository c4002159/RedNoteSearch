import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { EvaluationService } from "@/client"
import { Agreement, Metrics, Results } from "@/components/Evaluation/RunReport"
import {
  EvalStatus,
  EvaluationError,
  EvaluationGuard,
  JsonBlock,
  retryEval,
  running,
  terminal,
} from "@/components/Evaluation/shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import { EVAL_KIND_LABEL, label, EVAL_TEXT as T } from "@/lib/zh"
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
  const query = useQuery({
    queryKey: ["evaluation-run", id],
    queryFn: async ({ signal }) =>
      (await EvaluationService.readRun({ path: { run_id: id }, signal })).data,
    refetchInterval: (q) =>
      q.state.data && running(q.state.data.status) ? 2000 : false,
    retry: retryEval,
  })
  if (query.isLoading) return <Skeleton className="h-48 w-full" />
  if (query.isError)
    return <EvaluationError error={query.error} retry={() => query.refetch()} />
  if (!query.data) return null
  const run = query.data
  return (
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost">
        <Link to="/evaluation/runs">{T.backRuns}</Link>
      </Button>
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
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.runVersions}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            [T.datasets, run.dataset_id],
            [T.version, `v${run.versions.dataset_version}`],
            [T.prompt, run.versions.prompt_version ?? "—"],
            [T.checker, run.versions.checker_version ?? "—"],
            [T.rubric, run.versions.rubric_version ?? "—"],
            [T.models, run.versions.models.join("、") || "—"],
            [T.baselines, run.versions.baselines.join("、") || "—"],
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
        </p>
      ) : !terminal(run.status) ? (
        <p role="status" className="text-sm">
          {T.unknownState}
        </p>
      ) : (
        <>
          <Metrics run={run} />
          <section className="space-y-3 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">{T.failures}</h2>
            {run.error && (
              <p role="alert" className="text-sm text-destructive">
                {T.runError}：{run.error}
              </p>
            )}
            {run.failures.length > 0 ? (
              <JsonBlock value={run.failures} />
            ) : (
              <p className="text-sm text-muted-foreground">{T.noFailures}</p>
            )}
          </section>
          <Results run={run} />
          <Agreement run={run} />
        </>
      )}
    </div>
  )
}
