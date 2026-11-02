import { Link } from "@tanstack/react-router"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { Pager } from "@/components/Knowledge/Feedback"
import { parseApiError } from "@/lib/apiError"
import {
  label,
  VIRAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
  VIRAL_REASON_LABEL,
} from "@/lib/zh"
export const VIRAL_CARD = "min-w-0 space-y-4 rounded-xl bg-card p-6 shadow-sm"
export const VIRAL_TABLE =
  "min-w-[860px] text-sm [&_th]:bg-surface-low [&_th]:text-[13px] [&_th]:font-bold [&_th]:text-on-surface-variant [&_tr]:border-border/30"
export function ViralBreadcrumb({
  current,
  sampleId,
}: {
  current: string
  sampleId?: string
}) {
  return (
    <nav
      aria-label={V.breadcrumb}
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
    >
      <span>{V.enhance}</span>
      <span aria-hidden="true">›</span>
      <Link to="/viral-samples" className="text-link hover:underline">
        {T.title}
      </Link>
      {sampleId && (
        <>
          <span aria-hidden="true">›</span>
          <Link
            className="text-link hover:underline"
            to="/viral-samples/$id"
            params={{ id: sampleId }}
          >
            {T.detail}
          </Link>
        </>
      )}
      {current !== T.title && (
        <>
          <span aria-hidden="true">›</span>
          <span className="text-foreground">{current}</span>
        </>
      )}
    </nav>
  )
}
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
  return <Pager page={page} total={total} onPage={onPage} />
}
