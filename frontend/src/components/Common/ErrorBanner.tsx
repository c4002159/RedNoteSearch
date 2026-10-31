import { CircleAlert, RotateCw } from "lucide-react"

import { RequestId } from "@/components/Common/RequestId"
import { Button } from "@/components/ui/button"
import { type ApiErrorInfo, reasonsOf } from "@/lib/apiError"

// Error strip for a failed request: readable message, request number, optional retry (FC-07).
export function ErrorBanner({
  error,
  title,
  onRetry,
}: {
  error: ApiErrorInfo
  title?: string
  onRetry?: () => void
}) {
  const reasons = reasonsOf(error)
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-lg border border-tone-err/30 bg-error-container p-3 text-on-error-container"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">{title ?? error.message}</p>
        {title && <p className="text-sm">{error.message}</p>}
        {reasons.length > 0 && (
          <ul className="list-disc pl-4 text-sm">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        <RequestId id={error.requestId} />
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RotateCw /> 重试
        </Button>
      )}
    </div>
  )
}
