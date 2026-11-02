import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { EvaluationService, type ResultPublic, type RunPublic } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Pill } from "@/components/Common/StatusBadge"
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
  EVAL_ERROR_LABEL,
  EVAL_METRIC_LABEL,
  evaluationSystemLabel,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
import { RatingDialog, useRubric } from "./RatingDialog"
import {
  display,
  EVAL_TABLE,
  EvalPager,
  EvaluationError,
  JsonBlock,
  retryEval,
  terminal,
} from "./shared"

const leakMetrics = new Set([
  "leak_rate",
  "retrieval_leak_count",
  "constraint_pass_rate",
  "failure_rate",
])
export function Metrics({ run }: { run: RunPublic }) {
  return (
    <section className="min-w-0 space-y-4">
      <h2 className="text-base font-semibold">{T.metrics}</h2>
      <p className="text-xs text-muted-foreground">{V.metricsOnly}</p>
      {run.kind === "brand_leak" && (
        <p className="text-sm text-muted-foreground">{T.leakHint}</p>
      )}
      {Object.keys(run.metrics).length === 0 ? (
        <EmptyState title={T.noMetrics} />
      ) : (
        Object.entries(run.metrics).map(([system, value]) => {
          const rows = (Array.isArray(value) ? value : [])
            .filter(
              (item): item is Record<string, unknown> =>
                item !== null &&
                typeof item === "object" &&
                typeof item.name === "string",
            )
            .filter(
              (m) =>
                run.kind !== "brand_leak" || leakMetrics.has(String(m.name)),
            )
          return (
            <div key={system} className="space-y-2">
              <h3 className="mb-4 flex items-center gap-2 break-all text-base font-semibold before:size-2 before:shrink-0 before:rounded-full before:bg-primary">
                {evaluationSystemLabel(system)}
              </h3>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {T.metricInvalid}
                </p>
              ) : (
                <dl className="grid gap-3 lg:grid-cols-3">
                  {rows.map((m, i) => (
                    <div
                      key={`${m.name}-${i}`}
                      className="space-y-3 rounded-xl bg-card p-6 text-sm shadow-sm"
                    >
                      <dt className="font-medium">
                        {label(
                          EVAL_METRIC_LABEL,
                          String(m.name),
                          "eval_metric",
                        )}
                      </dt>
                      <dd className="text-3xl font-semibold tabular-nums text-link">
                        {display(m.value)}
                      </dd>
                      <dd className="text-xs text-muted-foreground">
                        {T.n}：{display(m.n)}
                      </dd>
                      <dd className="whitespace-pre-wrap text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {T.definition}：{display(m.definition)}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
export function Results({ run }: { run: RunPublic }) {
  const [viewing, setViewing] = useState<ResultPublic | null>(null)
  const [page, setPage] = useState(1),
    [rating, setRating] = useState<string | null>(null)
  const cache = useQueryClient()
  const results = useQuery({
    queryKey: ["evaluation-results", run.id, page],
    queryFn: async ({ signal }) =>
      (
        await EvaluationService.readResults({
          path: { run_id: run.id },
          query: { page, page_size: 20 },
          signal,
        })
      ).data,
    enabled: terminal(run.status),
    retry: retryEval,
  })
  if (!terminal(run.status)) return null
  return (
    <section className="min-w-0 space-y-3 rounded-xl bg-card p-6 shadow-sm">
      <h2 className="font-semibold">{T.results}</h2>
      <p className="text-xs text-muted-foreground">
        {T.ratingHint} {T.unconfiguredCost}
      </p>
      <p className="rounded-lg bg-surface-low p-3 text-xs text-link">
        {V.manual}
      </p>
      <div className="overflow-x-auto">
        <Table className={`${EVAL_TABLE} min-w-[980px]`}>
          <TableHeader>
            <TableRow>
              {[
                V.number,
                T.models,
                V.outputSummary,
                T.passed,
                T.runError,
                T.latency,
                T.cost,
                V.actions,
              ].map((name) => (
                <TableHead key={name}>{name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.isLoading ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            ) : results.isError ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EvaluationError
                    error={results.error}
                    retry={() => results.refetch()}
                  />
                </TableCell>
              </TableRow>
            ) : !results.data?.items.length ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState title={T.emptyResults} />
                </TableCell>
              </TableRow>
            ) : (
              results.data.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.case_index}</TableCell>
                  <TableCell className="max-w-48 whitespace-normal break-words">
                    {evaluationSystemLabel(r.system)}
                  </TableCell>
                  <TableCell className="max-w-72 whitespace-normal">
                    <p className="line-clamp-2 break-words">
                      {r.error && Object.keys(r.output).length === 0
                        ? T.noOutput
                        : typeof r.output.body === "string"
                          ? r.output.body
                          : JSON.stringify(r.output)}
                    </p>
                  </TableCell>
                  <TableCell>
                    {r.passed === null ? (
                      "—"
                    ) : (
                      <Pill
                        className="whitespace-nowrap"
                        tone={r.passed ? "ok" : "warn"}
                      >
                        {r.passed ? T.passed : T.notPassed}
                      </Pill>
                    )}
                  </TableCell>
                  <TableCell className="max-w-48 whitespace-normal">
                    {r.error
                      ? label(EVAL_ERROR_LABEL, r.error, "eval_error")
                      : "—"}
                  </TableCell>
                  <TableCell>{display(r.latency_ms)}</TableCell>
                  <TableCell>{display(r.cost)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-link"
                        onClick={() => setViewing(r)}
                      >
                        {V.view}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-link"
                        onClick={() => setRating(r.id)}
                      >
                        {T.rate}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {run.kind === "brand_leak" && results.data && (
        <section className="space-y-3 rounded-lg bg-surface-low p-4">
          <h3 className="text-sm font-semibold">{V.leakDiagnostic}</h3>
          <p className="text-xs text-muted-foreground">{T.leakHint}</p>
          <div className="overflow-x-auto">
            <Table className={EVAL_TABLE}>
              <TableHeader>
                <TableRow>
                  {[
                    V.number,
                    T.foreignTerms,
                    T.retrievalLeaks,
                    T.retrievalChecked,
                    T.constraintsPassed,
                    T.leaked,
                  ].map((name) => (
                    <TableHead key={name}>{name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.case_index}</TableCell>
                    {[
                      Array.isArray(r.detail.foreign_terms_matched)
                        ? r.detail.foreign_terms_matched.join("、") || "—"
                        : "—",
                      r.detail.retrieval_leak_count,
                      r.detail.retrieval_checked,
                      r.detail.constraints_passed,
                      r.detail.leaked,
                    ].map((value, i) => (
                      <TableCell key={i} className="whitespace-normal">
                        {typeof value === "boolean"
                          ? value
                            ? T.yes
                            : T.no
                          : display(value)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
      {viewing && (
        <Dialog open onOpenChange={(open) => !open && setViewing(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>
                {V.resultDetail} · {viewing.case_index}
              </DialogTitle>
              <DialogDescription>
                {evaluationSystemLabel(viewing.system)}
              </DialogDescription>
            </DialogHeader>
            <h3 className="text-sm font-semibold">{T.output}</h3>
            <JsonBlock value={viewing.output} />
            <h3 className="text-sm font-semibold">{T.detail}</h3>
            <JsonBlock value={viewing.detail} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewing(null)}>
                {V.close}
              </Button>
              <Button
                onClick={() => {
                  setRating(viewing.id)
                  setViewing(null)
                }}
              >
                {T.rate}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {results.data && !results.isError && (
        <EvalPager page={page} total={results.data.total} onPage={setPage} />
      )}
      {rating && (
        <RatingDialog
          runId={run.id}
          resultId={rating}
          onClose={() => setRating(null)}
          onSaved={() => {
            setRating(null)
            toast.success(T.saved)
            void cache.invalidateQueries({
              queryKey: ["evaluation-agreement", run.id],
            })
            void cache.invalidateQueries({
              queryKey: ["evaluation-run", run.id],
            })
          }}
        />
      )}
    </section>
  )
}
export function Agreement({ run }: { run: RunPublic }) {
  const query = useQuery({
    queryKey: ["evaluation-agreement", run.id],
    queryFn: async ({ signal }) =>
      (
        await EvaluationService.readAgreement({
          path: { run_id: run.id },
          signal,
        })
      ).data,
    enabled: terminal(run.status),
    retry: retryEval,
  })
  const rubric = useRubric()
  if (!terminal(run.status)) return null
  return (
    <section className="min-w-0 space-y-3 rounded-xl bg-card p-6 shadow-sm">
      <h2 className="text-base font-semibold">{T.agreement}</h2>
      <p className="text-xs text-muted-foreground">{V.agreementHint}</p>
      {query.isLoading && <Skeleton className="h-24 w-full" />}
      {query.isError && (
        <EvaluationError error={query.error} retry={() => query.refetch()} />
      )}
      {query.isSuccess && !query.data && <EmptyState title={T.noAgreement} />}
      {query.data && (
        <>
          <p className="text-xs text-muted-foreground">
            {T.method}：{query.data.method}
          </p>
          <p className="text-sm">
            {T.raters}：{query.data.raters} · {T.ratedResults}：
            {query.data.rated_results}
          </p>
          {query.data.dimensions.length === 0 ? (
            <EmptyState title={T.noAgreement} />
          ) : (
            <dl className="grid gap-3 lg:grid-cols-2">
              {query.data.dimensions.map((d) => (
                <div
                  key={d.dimension}
                  className="space-y-2 rounded-xl bg-surface-low p-5 text-sm"
                >
                  <dt className="font-medium">
                    {rubric.data?.dimensions.find((x) => x.key === d.dimension)
                      ?.name ?? d.dimension}
                  </dt>
                  <dd>
                    {T.pairs}：{d.rater_pairs} · {T.samples}：{d.samples}
                  </dd>
                  <dd>
                    {T.kappa}：
                    {d.weighted_kappa === null
                      ? T.noAgreement
                      : display(d.weighted_kappa)}
                  </dd>
                  <dd>
                    {T.exact}：
                    {d.exact_agreement === null
                      ? T.noAgreement
                      : display(d.exact_agreement)}
                  </dd>
                  <dd>
                    {T.withinOne}：
                    {d.within_one === null
                      ? T.noAgreement
                      : display(d.within_one)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </section>
  )
}
