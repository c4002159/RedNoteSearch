import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { type CasePublic, EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EVAL_TABLE,
  EvalBreadcrumb,
  EvalPager,
  EvaluationError,
  EvaluationGuard,
  JsonBlock,
  retryEval,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import {
  EVAL_DESIGN_TEXT,
  EVAL_KIND_LABEL,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
export const Route = createFileRoute("/_layout/evaluation/datasets/$id")({
  component: () => (
    <EvaluationGuard>
      <DatasetPage />
    </EvaluationGuard>
  ),
  head: () => ({ meta: [{ title: `${T.datasetDetail} - RedNoteSearch` }] }),
})
function DatasetPage() {
  const brand = useBrand()
  const { id } = Route.useParams(),
    navigate = useNavigate()
  const [viewing, setViewing] = useState<CasePublic | null>(null)
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
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <EvalBreadcrumb current={dataset.name} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="break-words text-2xl font-bold">{dataset.name}</h1>
          <p className="text-sm text-muted-foreground">
            {label(EVAL_KIND_LABEL, dataset.kind)} · v{dataset.version} ·{" "}
            {dataset.case_count} {T.cases}
          </p>
        </div>
      </div>

      <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
        <h2 className="font-semibold">{T.metadata}</h2>
        <p className="text-xs text-muted-foreground">{T.immutable}</p>
        <dl className="grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            [V.name, dataset.name],
            [T.kind, label(EVAL_KIND_LABEL, dataset.kind)],
            [T.version, `v${dataset.version}`],
            [T.cases, String(dataset.case_count)],
            [T.group, dataset.group_id],
            [T.hash, dataset.content_hash],
            [T.created, formatTime(dataset.created_at)],
            [
              T.scope,
              dataset.brand_id === null
                ? T.global
                : (brand.brands.find((b) => b.id === dataset.brand_id)?.name ??
                  EVAL_DESIGN_TEXT.otherBrand),
            ],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="[overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          {" "}
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{T.cases}</h2>
            <div className="overflow-x-auto">
              <Table className={`${EVAL_TABLE} min-w-[720px]`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{V.number}</TableHead>
                    <TableHead>{V.inputSummary}</TableHead>
                    <TableHead>{T.expected}</TableHead>
                    <TableHead>{T.annotators}</TableHead>
                    <TableHead className="text-right">{V.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cases.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-24 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : cases.isError ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EvaluationError
                          error={cases.error}
                          retry={() => cases.refetch()}
                        />
                      </TableCell>
                    </TableRow>
                  ) : !cases.data?.items.length ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EmptyState title={T.emptyCases} />
                      </TableCell>
                    </TableRow>
                  ) : (
                    cases.data.items.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          {T.sample} {c.case_index}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal">
                          <p className="line-clamp-2 break-words">
                            {JSON.stringify(c.input)}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-56 whitespace-normal">
                          <p className="line-clamp-2 break-words">
                            {JSON.stringify(c.expected)}
                          </p>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          {c.annotators.join("、") || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-link"
                            onClick={() => setViewing(c)}
                          >
                            {V.viewJson}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {cases.data && !cases.isError && (
              <EvalPager
                page={page}
                total={cases.data.total}
                onPage={setPage}
              />
            )}
          </section>
        </div>
        <aside className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">{V.next}</h2>
          <p className="text-xs leading-6 text-muted-foreground">
            {T.immutable}
          </p>
          <Button className="w-full" onClick={() => setRun(true)}>
            {T.newRun}
          </Button>
          <Button variant="outline" className="w-full" asChild>
            <Link to="/evaluation/datasets">{T.backDatasets}</Link>
          </Button>
        </aside>
      </div>
      {viewing && (
        <Dialog open onOpenChange={(open) => !open && setViewing(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {T.sample} {viewing.case_index}
              </DialogTitle>
              <DialogDescription>{T.immutable}</DialogDescription>
            </DialogHeader>
            <h3 className="text-sm font-semibold">{T.input}</h3>
            <JsonBlock value={viewing.input} />
            <h3 className="text-sm font-semibold">{T.expected}</h3>
            <JsonBlock value={viewing.expected} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewing(null)}>
                {V.close}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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
