import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EVAL_TABLE,
  EvalPager,
  EvalStatus,
  EvaluationError,
  EvaluationGuard,
  running,
} from "@/components/Evaluation/shared"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatTime } from "@/lib/format"
import {
  EVAL_KIND_LABEL,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
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
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
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
      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={() => {
            setDataset("")
            setPage(1)
          }}
        >
          {V.clear}
        </Button>
      </div>
      {datasets.isError && (
        <EvaluationError
          error={datasets.error}
          retry={() => datasets.refetch()}
        />
      )}
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table className={EVAL_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead aria-label={T.datasets} className="w-[30%]">
                  <HeaderFilter
                    title={T.datasets}
                    value={dataset}
                    onChange={(value) => {
                      setDataset(value)
                      setPage(1)
                    }}
                    options={(datasets.data ?? []).map((d) => ({
                      value: d.id,
                      label: d.name,
                    }))}
                  />
                </TableHead>
                <TableHead>{T.kind}</TableHead>
                <TableHead>{T.models}</TableHead>
                <TableHead>{V.status}</TableHead>
                <TableHead>{T.created}</TableHead>
                <TableHead className="text-right">{V.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.isLoading ? (
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-12 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : runs.isError ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EvaluationError
                      error={runs.error}
                      retry={() => runs.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : !runs.data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState title={T.emptyRuns} />
                  </TableCell>
                </TableRow>
              ) : (
                runs.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-normal font-medium">
                      <Link
                        className="text-link hover:underline"
                        to="/evaluation/runs/$id"
                        params={{ id: r.id }}
                      >
                        {datasets.data?.find((d) => d.id === r.dataset_id)
                          ?.name ?? T.datasets}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        v{r.versions.dataset_version} · {r.sample_count}{" "}
                        {T.cases}
                      </p>
                    </TableCell>
                    <TableCell>{label(EVAL_KIND_LABEL, r.kind)}</TableCell>
                    <TableCell className="max-w-56 whitespace-normal break-words">
                      {r.versions.models.join("、") || "—"}
                    </TableCell>
                    <TableCell>
                      <EvalStatus status={r.status} />
                      {running(r.status) && (
                        <div
                          className="mt-2 h-1.5 w-20 animate-pulse rounded-full bg-surface"
                          aria-hidden="true"
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      {formatTime(r.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        asChild
                        className="text-link"
                      >
                        <Link to="/evaluation/runs/$id" params={{ id: r.id }}>
                          {V.view}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {runs.data && !runs.isError && (
          <EvalPager page={page} total={runs.data.total} onPage={setPage} />
        )}
      </div>
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
