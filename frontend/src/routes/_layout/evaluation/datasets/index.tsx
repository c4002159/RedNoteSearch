import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { type DatasetPublic, type EvalKind, EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import { Pill } from "@/components/Common/StatusBadge"
import { CreateDataset } from "@/components/Evaluation/CreateDataset"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
  EVAL_TABLE,
  EvalPager,
  EvaluationError,
  EvaluationGuard,
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
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import {
  EVAL_CASE_COUNT_LABEL,
  EVAL_DATASETS_DESCRIPTION,
  EVAL_DESIGN_TEXT,
  EVAL_KIND_LABEL,
  EVAL_LIST_TEXT,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
export const Route = createFileRoute("/_layout/evaluation/datasets/")({
  component: () => (
    <EvaluationGuard>
      <DatasetsPage />
    </EvaluationGuard>
  ),
  head: () => ({ meta: [{ title: `${T.datasets} - RedNoteSearch` }] }),
})
const kindTone = {
  generation: "softBlue",
  compliance: "warn",
  factcheck: "info",
  brand_leak: "note",
} as const
function DatasetsPage() {
  const brand = useBrand(),
    cache = useQueryClient(),
    navigate = useNavigate()
  const [scope, setScope] = useState("")
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<EvalKind | "">(""),
    [creating, setCreating] = useState(false),
    [run, setRun] = useState<DatasetPublic | null>(null)
  const datasets = useQuery({
    queryKey: ["evaluation-datasets", kind || "all"],
    queryFn: async ({ signal }) =>
      (
        await EvaluationService.readDatasets({
          query: { kind: kind || undefined },
          signal,
        })
      ).data.items,
  })
  const items = (datasets.data ?? []).filter(
    (row) =>
      !scope ||
      (scope === "global" ? row.brand_id === null : row.brand_id === scope),
  )
  return (
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.datasets}</h1>
          <p className="text-sm text-muted-foreground">
            {EVAL_DATASETS_DESCRIPTION}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/evaluation/runs">{T.runs}</Link>
          </Button>
          <Button onClick={() => setCreating(true)}>{T.newDataset}</Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          onClick={() => {
            setKind("")
            setScope("")
            setPage(1)
          }}
        >
          {V.clear}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table className={EVAL_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[28%]">{EVAL_LIST_TEXT.name}</TableHead>
                <TableHead aria-label={T.kind}>
                  <HeaderFilter
                    title={T.kind}
                    value={kind}
                    onChange={(value) => {
                      setKind(value as EvalKind | "")
                      setPage(1)
                    }}
                    options={Object.entries(EVAL_KIND_LABEL).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </TableHead>
                <TableHead>{T.version}</TableHead>
                <TableHead>{EVAL_CASE_COUNT_LABEL}</TableHead>
                <TableHead aria-label={T.scope}>
                  <HeaderFilter
                    title={T.scope}
                    value={scope}
                    onChange={(value) => {
                      setScope(value)
                      setPage(1)
                    }}
                    options={[
                      { value: "global", label: T.global },
                      ...brand.brands.map((b) => ({
                        value: b.id,
                        label: b.name,
                      })),
                    ]}
                  />
                </TableHead>
                <TableHead>{T.created}</TableHead>
                <TableHead className="text-right">{V.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {datasets.isLoading ? (
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={7}>
                      <Skeleton className="h-12 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : datasets.isError ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EvaluationError
                      error={datasets.error}
                      retry={() => datasets.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState title={T.emptyDatasets} />
                  </TableCell>
                </TableRow>
              ) : (
                items.slice((page - 1) * 20, page * 20).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal font-medium">
                      <Link
                        className="text-link hover:underline"
                        to="/evaluation/datasets/$id"
                        params={{ id: row.id }}
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Pill
                        className="whitespace-nowrap"
                        tone={
                          row.kind in kindTone
                            ? kindTone[row.kind as keyof typeof kindTone]
                            : "neutral"
                        }
                      >
                        {label(EVAL_KIND_LABEL, row.kind)}
                      </Pill>
                    </TableCell>
                    <TableCell>v{row.version}</TableCell>
                    <TableCell>{row.case_count}</TableCell>
                    <TableCell className="whitespace-normal">
                      {row.brand_id === null
                        ? T.global
                        : (brand.brands.find((b) => b.id === row.brand_id)
                            ?.name ?? EVAL_DESIGN_TEXT.otherBrand)}
                    </TableCell>
                    <TableCell className="whitespace-normal text-xs text-muted-foreground">
                      {formatTime(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-link"
                          asChild
                        >
                          <Link
                            to="/evaluation/datasets/$id"
                            params={{ id: row.id }}
                          >
                            {EVAL_LIST_TEXT.view}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-link"
                          onClick={() => setRun(row)}
                        >
                          {T.newRun}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {!datasets.isError && !datasets.isLoading && (
          <EvalPager page={page} total={items.length} onPage={setPage} />
        )}
      </div>
      {creating && (
        <CreateDataset
          onClose={() => setCreating(false)}
          onSaved={(row) => {
            setCreating(false)
            void cache.invalidateQueries({ queryKey: ["evaluation-datasets"] })
            void navigate({
              to: "/evaluation/datasets/$id",
              params: { id: row.id },
            })
          }}
        />
      )}
      {run && (
        <CreateRun
          dataset={run}
          onClose={() => setRun(null)}
          onSaved={(r) => {
            setRun(null)
            void cache.invalidateQueries({ queryKey: ["evaluation-runs"] })
            void navigate({ to: "/evaluation/runs/$id", params: { id: r.id } })
          }}
        />
      )}
    </div>
  )
}
