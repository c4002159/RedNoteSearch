import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { Button } from "@/components/ui/button"
import { parseApiError } from "@/lib/apiError"
import { label, VIRAL_TEXT as T, VIRAL_REASON_LABEL } from "@/lib/zh"
export function ViralError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const info = parseApiError(error),
    reason = info.details.reason
  return info.status === 404 ? (
    <MissingPage requestId={info.requestId} />
  ) : (
    <div className="space-y-3">
      <ErrorBanner error={info} onRetry={retry} />
      {typeof reason === "string" && (
        <p className="text-sm text-muted-foreground">
          {label(VIRAL_REASON_LABEL, reason, "viral_reason")}
        </p>
      )}
      {info.status === 403 && <ForbiddenPage requestId={info.requestId} />}
    </div>
  )
}
export function ViralPager({
  page,
  total,
  onPage,
}: {
  page: number
  total: number
  onPage: (p: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / 20))
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-muted-foreground">
        {page} / {pages} {T.page}，{T.total} {total} {T.items}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {T.previous}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {T.next}
      </Button>
    </div>
  )
}
