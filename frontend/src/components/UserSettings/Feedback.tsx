import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { parseApiError } from "@/lib/apiError"
export function SettingsError({
  error,
  retry,
  message,
}: {
  error: unknown
  retry?: () => void
  message?: string
}) {
  const info = parseApiError(error)
  return (
    <div className="space-y-3">
      <ErrorBanner
        error={message ? { ...info, message } : info}
        onRetry={retry}
      />
      {info.status === 403 && <ForbiddenPage requestId={info.requestId} />}
    </div>
  )
}
