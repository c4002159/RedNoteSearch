import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EvalPager,
  EvalStatus,
  EvaluationError,
  EvaluationGuard,
  running,
} from "@/components/Evaluation/shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import { EVAL_KIND_LABEL, label, EVAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/evaluation/runs/")({
  component: () => (
    <EvaluationGuard>
      <RunsPage />
    </EvaluationGuard>
  ),
  head: () => ({ meta: [{ title: `${T.runs} - RedNoteSearch` }] }),
})
function RunsPage() {
  const navigate = useNavigate(),
    cache = useQueryClient()
  const [dataset, setDataset] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false)
  const datasets = useQuery({
    queryKey: ["evaluation-datasets", "all"],
    queryFn: async () => (await EvaluationService.readDatasets()).data.items,
  })
  const runs = useQuery({
    queryKey: ["evaluation-runs", dataset, page],
    queryFn: async ({ signal }) =>
      (
        await EvaluationService.readRuns({
          query: { dataset_id: dataset || undefined, page, page_size: 20 },
          signal,
        })
      ).data,
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => running(r.status)) ? 2000 : false,
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.runs}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/evaluation/datasets">{T.datasets}</Link>
          </Button>
          <Button onClick={() => setCreating(true)}>{T.newRun}</Button>
        </div>
      </div>
      <select
        aria-label={T.selectDataset}
        className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm"
        value={dataset}
        onChange={(e) => {
          setDataset(e.target.value)
          setPage(1)
        }}
      >
        <option value="">{T.allDatasets}</option>
        {datasets.data?.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name} · v{d.version}
          </option>
        ))}
      </select>
      {datasets.isError && (
        <EvaluationError
          error={datasets.error}
          retry={() => datasets.refetch()}
        />
      )}
      {runs.isLoading && <Skeleton className="h-48 w-full" />}
      {runs.isError && (
        <EvaluationError error={runs.error} retry={() => runs.refetch()} />
      )}
      {runs.data &&
        !runs.isError &&
        (runs.data.items.length === 0 ? (
          <EmptyState title={T.emptyRuns} />
        ) : (
          <ul className="space-y-3">
            {runs.data.items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    to="/evaluation/runs/$id"
                    params={{ id: r.id }}
                    className="break-words font-medium text-link hover:underline"
                  >
                    {datasets.data?.find((d) => d.id === r.dataset_id)?.name ??
                      r.dataset_id}{" "}
                    · v{r.versions.dataset_version}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {label(EVAL_KIND_LABEL, r.kind)} · {r.sample_count}{" "}
                    {T.cases} · {formatTime(r.created_at)}
                  </p>
                </div>
                <EvalStatus status={r.status} />
              </li>
            ))}
          </ul>
        ))}
      {runs.data && !runs.isError && (
        <EvalPager page={page} total={runs.data.total} onPage={setPage} />
      )}
      {creating && (
        <CreateRun
          onClose={() => setCreating(false)}
          onSaved={(r) => {
            setCreating(false)
            void cache.invalidateQueries({ queryKey: ["evaluation-runs"] })
            void navigate({ to: "/evaluation/runs/$id", params: { id: r.id } })
          }}
        />
      )}
    </div>
  )
}
