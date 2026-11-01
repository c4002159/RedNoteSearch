import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { EvaluationService, type RunPublic } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  EVAL_ERROR_LABEL,
  EVAL_METRIC_LABEL,
  label,
  EVAL_TEXT as T,
} from "@/lib/zh"
import { RatingDialog, useRubric } from "./RatingDialog"
import {
  display,
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
    <section className="space-y-4 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{T.metrics}</h2>
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
              <h3 className="break-all text-sm font-medium">{system}</h3>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {T.metricInvalid}
                </p>
              ) : (
                <dl className="grid gap-3 lg:grid-cols-2">
                  {rows.map((m, i) => (
                    <div
                      key={`${m.name}-${i}`}
                      className="space-y-1 rounded-lg border p-3 text-sm"
                    >
                      <dt className="font-medium">
                        {label(
                          EVAL_METRIC_LABEL,
                          String(m.name),
                          "eval_metric",
                        )}
                      </dt>
                      <dd className="text-lg tabular-nums">
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
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{T.results}</h2>
      <p className="text-xs text-muted-foreground">
        {T.ratingHint} {T.unconfiguredCost}
      </p>
      {results.isLoading && <Skeleton className="h-32 w-full" />}
      {results.isError && (
        <EvaluationError
          error={results.error}
          retry={() => results.refetch()}
        />
      )}
      {results.data &&
        !results.isError &&
        (results.data.items.length === 0 ? (
          <EmptyState title={T.emptyResults} />
        ) : (
          <ul className="space-y-3">
            {results.data.items.map((r) => (
              <li key={r.id} className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h3 className="break-all text-sm font-medium">
                      {T.sample} {r.case_index} · {r.system}
                    </h3>
                    {r.error ? (
                      <Pill tone="err">
                        {label(EVAL_ERROR_LABEL, r.error, "eval_error")}
                      </Pill>
                    ) : r.passed === null ? (
                      <Pill>—</Pill>
                    ) : (
                      <Pill tone={r.passed ? "info" : "warn"}>
                        {r.passed ? T.passed : T.notPassed}
                      </Pill>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {T.latency}：{display(r.latency_ms)} · {T.cost}：
                      {display(r.cost)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRating(r.id)}
                  >
                    {T.rate}
                  </Button>
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                  {r.error && Object.keys(r.output).length === 0
                    ? T.noOutput
                    : typeof r.output.body === "string"
                      ? r.output.body
                      : JSON.stringify(r.output)}
                </p>
                {run.kind === "brand_leak" && (
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      [
                        T.foreignTerms,
                        Array.isArray(r.detail.foreign_terms_matched)
                          ? r.detail.foreign_terms_matched.join("、") || "—"
                          : "—",
                      ],
                      [
                        T.retrievalLeaks,
                        display(r.detail.retrieval_leak_count),
                      ],
                      [T.retrievalChecked, r.detail.retrieval_checked],
                      [T.constraintsPassed, r.detail.constraints_passed],
                      [T.leaked, r.detail.leaked],
                    ].map(([name, value]) => (
                      <div key={String(name)} className="min-w-0">
                        <dt className="text-muted-foreground">
                          {String(name)}
                        </dt>
                        <dd className="[overflow-wrap:anywhere]">
                          {typeof value === "boolean"
                            ? value
                              ? T.yes
                              : T.no
                            : display(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <details className="space-y-2 text-sm">
                  <summary className="cursor-pointer text-link">
                    {T.fullOutput}
                  </summary>
                  <h4>{T.output}</h4>
                  <JsonBlock value={r.output} />
                  <h4>{T.detail}</h4>
                  <JsonBlock value={r.detail} />
                </details>
              </li>
            ))}
          </ul>
        ))}
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
    <section className="space-y-3 rounded-xl border bg-card p-4">
      <h2 className="font-semibold">{T.agreement}</h2>
      {query.isLoading && <Skeleton className="h-24 w-full" />}
      {query.isError && (
        <EvaluationError error={query.error} retry={() => query.refetch()} />
      )}
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
                  className="space-y-1 rounded-lg border p-3 text-sm"
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
