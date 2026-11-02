import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { Pager } from "@/components/Knowledge/Feedback"
import { Skeleton } from "@/components/ui/skeleton"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import {
  EVAL_STATUS_LABEL,
  label,
  EVAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"

export const EVAL_CARD = "min-w-0 rounded-xl bg-card p-6 shadow-sm"
export const EVAL_TABLE =
  "min-w-[780px] text-sm [&_th]:bg-surface-low [&_th]:text-[13px] [&_th]:font-bold [&_th]:text-on-surface-variant [&_tr]:border-border/30"
export function EvalBreadcrumb({
  current,
  runs = false,
}: {
  current: string
  runs?: boolean
}) {
  return (
    <nav
      aria-label={V.breadcrumb}
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{V.quality}</span>
      <span aria-hidden="true">›</span>
      <Link
        className="text-link hover:underline"
        to={runs ? "/evaluation/runs" : "/evaluation/datasets"}
      >
        {runs ? T.runs : T.datasets}
      </Link>
      <span aria-hidden="true">›</span>
      <span className="text-foreground">{current}</span>
    </nav>
  )
}
export function EvaluationError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const info = parseApiError(error),
    errors = info.details.errors
  return info.status === 404 ? (
    <MissingPage requestId={info.requestId} />
  ) : (
    <div className="space-y-3">
      <ErrorBanner error={info} onRetry={retry} />
      {info.status === 403 && <ForbiddenPage requestId={info.requestId} />}{" "}
      {Array.isArray(errors) && (
        <ul className="space-y-1 text-sm [overflow-wrap:anywhere]">
          {errors.map((e, i) => (
            <li key={i}>
              {Array.isArray(e.loc) ? e.loc.join(" / ") : "—"}：
              {String(e.msg ?? "—")}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
export function EvaluationGuard({ children }: { children: ReactNode }) {
  const brand = useBrand(),
    cache = useQueryClient()
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <EvaluationError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current || !brand.isAdmin) return <ForbiddenPage />
  return children
}
export const running = (status: string) =>
  ["queued", "running"].includes(status)
export const terminal = (status: string) =>
  ["completed", "failed"].includes(status)
export function EvalStatus({ status }: { status: string }) {
  return (
    <Pill
      className="whitespace-nowrap"
      tone={
        status === "failed"
          ? "err"
          : status === "completed"
            ? "ok"
            : running(status)
              ? "info"
              : "gray"
      }
    >
      {label(EVAL_STATUS_LABEL, status, "eval_status")}
    </Pill>
  )
}
export function EvalPager({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (p: number) => void
}) {
  return <Pager page={page} total={total} onPage={onPage} />
}
export function display(value: unknown): string {
  if (value === null || value === undefined) return "—"
  return typeof value === "number"
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: 6 })
    : typeof value === "string"
      ? value
      : JSON.stringify(value)
}
export function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-xs [overflow-wrap:anywhere]">
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
export const retryEval = (count: number, error: unknown) =>
  count < 2 && ![401, 403, 404, 422].includes(parseApiError(error).status ?? 0)
