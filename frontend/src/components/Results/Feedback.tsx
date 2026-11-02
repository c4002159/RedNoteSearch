import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { parseApiError } from "@/lib/apiError"
import { RESULTS_TEXT as T } from "@/lib/zh"

export function resultError(error: unknown) {
  const info = parseApiError(error)
  return {
    ...info,
    message: /[\u3400-\u9fff]/u.test(info.message) ? info.message : T.failed,
    details: {},
  }
}

export function ResultsError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const info = resultError(error)
  if (info.status === 403) return <ForbiddenPage requestId={info.requestId} />
  if (info.status === 404) return <MissingPage requestId={info.requestId} />
  return <ErrorBanner error={info} onRetry={retry} />
}

export function reading(value: number, approximate = false) {
  const number =
    value >= 10000
      ? `${Number((value / 10000).toFixed(1))}${T.tenThousand}`
      : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })
  return `${approximate ? T.approximately : ""}${number}`
}
