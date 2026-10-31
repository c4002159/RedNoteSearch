import { AxiosError } from "axios"

export type ApiErrorInfo = {
  status: number | null
  code: string
  message: string
  details: Record<string, unknown>
  requestId: string | null
}

// Reads the unified error envelope (docs/API_CONTRACT.md 1.1) from any thrown value.
export function parseApiError(err: unknown): ApiErrorInfo {
  if (err instanceof AxiosError) {
    const envelope = (err.response?.data as { error?: Record<string, unknown> })
      ?.error
    const details = envelope?.details
    return {
      status: err.response?.status ?? null,
      code:
        typeof envelope?.code === "string"
          ? envelope.code
          : err.response
            ? "UNKNOWN"
            : "NETWORK",
      message:
        typeof envelope?.message === "string"
          ? envelope.message
          : err.response
            ? "请求失败"
            : "网络连接失败，请检查网络后重试",
      details:
        details && typeof details === "object"
          ? (details as Record<string, unknown>)
          : {},
      requestId:
        typeof envelope?.request_id === "string" ? envelope.request_id : null,
    }
  }
  return {
    status: null,
    code: "UNKNOWN",
    message: "出现了意外错误",
    details: {},
    requestId: null,
  }
}

// `details.reasons[]` of a refused action: readable sentences, never code names.
export function reasonsOf(info: ApiErrorInfo): string[] {
  const reasons = info.details.reasons
  return Array.isArray(reasons)
    ? reasons.filter((r): r is string => typeof r === "string")
    : []
}
