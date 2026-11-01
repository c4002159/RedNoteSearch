import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { type DatasetPublic, type EvalKind, EvaluationService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Pill } from "@/components/Common/StatusBadge"
import { CreateDataset } from "@/components/Evaluation/CreateDataset"
import { CreateRun } from "@/components/Evaluation/CreateRun"
import {
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
  EVAL_DESIGN_TEXT,
  EVAL_KIND_LABEL,
  EVAL_LIST_TEXT,
  label,
  EVAL_TEXT as T,
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
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.datasets}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/evaluation/runs">{T.runs}</Link>
          </Button>
          <Button onClick={() => setCreating(true)}>{T.newDataset}</Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={T.kind}
          value={kind}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(e) => setKind(e.target.value as EvalKind | "")}
        >
          <option value="">{T.allKinds}</option>
          {Object.entries(EVAL_KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => setKind("")}>
          {EVAL_LIST_TEXT.clear}
        </Button>
      </div>
      {datasets.isLoading && <Skeleton className="h-48 w-full" />}
      {datasets.isError && (
        <EvaluationError
          error={datasets.error}
          retry={() => datasets.refetch()}
        />
      )}
      {datasets.data &&
        !datasets.isError &&
        (datasets.data.length === 0 ? (
          <EmptyState title={T.emptyDatasets} />
        ) : (
          <div className="min-w-0 rounded-xl border bg-card">
            <Table className="w-full table-fixed">
              <TableHeader>
                <TableRow>
                  {[
                    EVAL_LIST_TEXT.name,
                    T.kind,
                    T.scope,
                    T.version,
                    T.cases,
                    T.created,
                    EVAL_LIST_TEXT.actions,
                  ].map((heading) => (
                    <TableHead key={heading} className="whitespace-normal">
                      {heading}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {datasets.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-normal break-words">
                      <Link
                        className="text-link hover:underline"
                        to="/evaluation/datasets/$id"
                        params={{ id: row.id }}
                      >
                        {row.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <Pill
                        tone={
                          row.kind in kindTone
                            ? kindTone[row.kind as keyof typeof kindTone]
                            : "neutral"
                        }
                      >
                        {label(EVAL_KIND_LABEL, row.kind)}
                      </Pill>
                    </TableCell>
                    <TableCell className="whitespace-normal break-words">
                      {row.brand_id === null
                        ? T.global
                        : (brand.brands.find((b) => b.id === row.brand_id)
                            ?.name ?? EVAL_DESIGN_TEXT.otherBrand)}
                    </TableCell>
                    <TableCell>v{row.version}</TableCell>
                    <TableCell>{row.case_count}</TableCell>
                    <TableCell className="whitespace-normal break-words">
                      {formatTime(row.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" asChild>
                          <Link
                            to="/evaluation/datasets/$id"
                            params={{ id: row.id }}
                          >
                            {EVAL_LIST_TEXT.view}
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setRun(row)}
                        >
                          {T.newRun}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
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
