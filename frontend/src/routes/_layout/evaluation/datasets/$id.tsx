import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EvalPager,
  EvaluationError,
  EvaluationGuard,
  JsonBlock,
  retryEval,
} from "@/components/Evaluation/shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { formatTime } from "@/lib/format"
import { EVAL_KIND_LABEL, label, EVAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/evaluation/datasets/$id")({
  component: () => (
    <EvaluationGuard>
      <DatasetPage />
    </EvaluationGuard>
  ),
  head: () => ({ meta: [{ title: `${T.datasetDetail} - RedNoteSearch` }] }),
})
function DatasetPage() {
  const { id } = Route.useParams(),
    navigate = useNavigate()
  const [page, setPage] = useState(1),
    [run, setRun] = useState(false)
  const datasets = useQuery({
    queryKey: ["evaluation-datasets", "all"],
    queryFn: async ({ signal }) =>
      (await EvaluationService.readDatasets({ signal })).data.items,
  })
  const dataset = datasets.data?.find((d) => d.id === id)
  const cases = useQuery({
    queryKey: ["evaluation-cases", id, page],
    queryFn: async ({ signal }) =>
      (
        await EvaluationService.readCases({
          path: { dataset_id: id },
          query: { page, page_size: 20 },
          signal,
        })
      ).data,
    enabled: !!dataset,
    retry: retryEval,
  })
  if (datasets.isLoading) return <Skeleton className="h-48 w-full" />
  if (datasets.isError)
    return (
      <EvaluationError
        error={datasets.error}
        retry={() => datasets.refetch()}
      />
    )
  if (!dataset) return <MissingPage />
  return (
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost">
        <Link to="/evaluation/datasets">{T.backDatasets}</Link>
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="break-words text-2xl font-bold">{dataset.name}</h1>
          <p className="text-sm text-muted-foreground">
            {label(EVAL_KIND_LABEL, dataset.kind)} · v{dataset.version} ·{" "}
            {dataset.case_count} {T.cases}
          </p>
        </div>
        <Button onClick={() => setRun(true)}>{T.newRun}</Button>
      </div>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.metadata}</h2>
        <p className="text-xs text-muted-foreground">{T.immutable}</p>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {[
            [T.group, dataset.group_id],
            [T.hash, dataset.content_hash],
            [T.created, formatTime(dataset.created_at)],
            [T.scope, dataset.brand_id ?? T.global],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="[overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.cases}</h2>
        {cases.isLoading && <Skeleton className="h-32 w-full" />}
        {cases.isError && (
          <EvaluationError error={cases.error} retry={() => cases.refetch()} />
        )}
        {cases.data &&
          !cases.isError &&
          (cases.data.items.length === 0 ? (
            <EmptyState title={T.emptyCases} />
          ) : (
            <ul className="space-y-3">
              {cases.data.items.map((c) => (
                <li key={c.id} className="space-y-2 rounded-lg border p-3">
                  <h3 className="text-sm font-medium">
                    {T.sample} {c.case_index}
                  </h3>
                  <h4 className="text-xs text-muted-foreground">{T.input}</h4>
                  <JsonBlock value={c.input} />
                  <h4 className="text-xs text-muted-foreground">
                    {T.expected}
                  </h4>
                  <JsonBlock value={c.expected} />
                  <p className="text-xs text-muted-foreground">
                    {T.annotators}：{c.annotators.join("、") || "—"}
                  </p>
                </li>
              ))}
            </ul>
          ))}
        {cases.data && !cases.isError && (
          <EvalPager page={page} total={cases.data.total} onPage={setPage} />
        )}
      </section>
      {run && (
        <CreateRun
          dataset={dataset}
          onClose={() => setRun(false)}
          onSaved={(r) => {
            setRun(false)
            void navigate({ to: "/evaluation/runs/$id", params: { id: r.id } })
          }}
        />
      )}
    </div>
  )
}
