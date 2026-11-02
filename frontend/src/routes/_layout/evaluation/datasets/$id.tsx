import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useRef, useState } from "react"
import { toast } from "sonner"
import { type CasePublic, EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import {
  TableBatchBar,
  TableSelectAll,
  TableSelectRow,
} from "@/components/Common/TableBatchBar"
import { CaseEditDialog } from "@/components/Evaluation/CaseEditDialog"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EVAL_TABLE,
  EvalBreadcrumb,
  EvalPager,
  EvaluationError,
  EvaluationGuard,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import {
  EVAL_DESIGN_TEXT,
  EVAL_KIND_LABEL,
  label,
  R6_EVAL_TEXT as R,
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
  const { user } = useAuth()
  const cache = useQueryClient()
  const { id } = Route.useParams(),
    navigate = useNavigate()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<CasePublic | null>(null)
  const [deleting, setDeleting] = useState(false)
  const indexes = useRef(new Map<string, number>())
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
  for (const row of cases.data?.items ?? [])
    indexes.current.set(row.id, row.case_index)
  // The server decides; this only hides controls the caller cannot use.
  const canEdit =
    !!dataset &&
    (dataset.brand_id === null
      ? !!user?.is_superuser
      : brand.isAdmin && brand.current?.id === dataset.brand_id)
  const goNew = (newId: string) => {
    setEditing(null)
    setDeleting(false)
    setSelected(new Set())
    setPage(1)
    void navigate({ to: "/evaluation/datasets/$id", params: { id: newId } })
  }
  const remove = useMutation({
    mutationFn: async () =>
      (
        await EvaluationService.reviseDataset({
          path: { dataset_id: id },
          body: {
            delete_case_indexes: [...selected]
              .map((caseId) => indexes.current.get(caseId))
              .filter((n): n is number => n !== undefined),
          },
        })
      ).data,
    onSuccess: async (created) => {
      await cache.invalidateQueries({ queryKey: ["evaluation-datasets"] })
      toast.success(R.revised(created.version))
      goNew(created.id)
    },
  })
  const loadAll = async () => {
    const items = (
      await EvaluationService.readCases({
        path: { dataset_id: id },
        query: { page: 1, page_size: 50 },
      })
    ).data.items
    for (const row of items) indexes.current.set(row.id, row.case_index)
    return items.map((row) => row.id)
  }
  const selection = {
    selected,
    onChange: setSelected,
    pageIds: cases.data?.items.map((row) => row.id) ?? [],
  }
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
      <h1 className="break-words text-2xl font-bold">{dataset.name}</h1>
      <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">{T.sample}</h2>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="flex flex-wrap gap-2">
                  <Pill>{label(EVAL_KIND_LABEL, dataset.kind)}</Pill>
                  <Pill>v{dataset.version}</Pill>
                  <Pill>
                    {dataset.case_count} {T.cases}
                  </Pill>
                  <Pill>
                    {dataset.brand_id === null
                      ? T.global
                      : (brand.brands.find((b) => b.id === dataset.brand_id)
                          ?.name ?? EVAL_DESIGN_TEXT.otherBrand)}
                  </Pill>
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-sm break-all">
                <p>
                  {R.groupLabel}：{dataset.group_id}
                </p>
                <p>
                  {R.hashLabel}：{dataset.content_hash}
                </p>
                <p>
                  {R.createdLabel}：{formatTime(dataset.created_at)}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <TableBatchBar
            {...selection}
            total={cases.data?.total ?? 0}
            loadAll={loadAll}
            actions={
              canEdit
                ? [
                    {
                      label: R.delete,
                      destructive: true,
                      onSelect: () => setDeleting(true),
                    },
                  ]
                : []
            }
          />
        </div>
        {!canEdit && (
          <p className="text-xs text-muted-foreground">{R.readOnly}</p>
        )}
        <div className="overflow-x-auto">
          <Table className={`${EVAL_TABLE} min-w-[720px]`}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <TableSelectAll {...selection} />
                </TableHead>
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
                  <TableCell colSpan={6}>
                    <Skeleton className="h-24 w-full" />
                  </TableCell>
                </TableRow>
              ) : cases.isError ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EvaluationError
                      error={cases.error}
                      retry={() => cases.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : !cases.data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={6}>
                    <EmptyState title={T.emptyCases} />
                  </TableCell>
                </TableRow>
              ) : (
                cases.data.items.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <TableSelectRow
                        {...selection}
                        id={c.id}
                        label={`${T.sample} ${c.case_index}`}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
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
                      {c.annotators.join("、")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-link hover:underline"
                        onClick={() => setEditing(c)}
                      >
                        {canEdit ? R.edit : V.viewJson}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {cases.data && !cases.isError && (
          <EvalPager page={page} total={cases.data.total} onPage={setPage} />
        )}
        <div className="flex justify-end pt-2">
          <Button onClick={() => setRun(true)}>{T.newRun}</Button>
        </div>
      </section>
      {editing && (
        <CaseEditDialog
          datasetId={id}
          row={editing}
          readOnly={!canEdit}
          onClose={() => setEditing(null)}
          onSaved={goNew}
        />
      )}
      {deleting && (
        <Dialog
          open
          onOpenChange={(open) =>
            !open && !remove.isPending && setDeleting(false)
          }
        >
          <DialogContent className="border-0">
            <DialogHeader>
              <DialogTitle>{R.deleteTitle(selected.size)}</DialogTitle>
              <DialogDescription>{R.deleteNotice}</DialogDescription>
            </DialogHeader>
            {remove.isError && (
              <ErrorBanner error={parseApiError(remove.error)} />
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={remove.isPending}
                onClick={() => setDeleting(false)}
              >
                {T.cancel}
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {R.confirmDelete}
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
