import { useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { EVAL_STATUS_LABEL, label, EVAL_TEXT as T } from "@/lib/zh"
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
      tone={status === "failed" ? "err" : running(status) ? "info" : "gray"}
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
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-muted-foreground">
        {page} / {Math.max(1, Math.ceil(total / 20))} {T.page}，{T.total}{" "}
        {total} {T.items}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {T.previous}
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= Math.ceil(total / 20)}
        onClick={() => onPage(page + 1)}
      >
        {T.next}
      </Button>
    </div>
  )
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
