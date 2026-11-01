import { AxiosError } from "axios"
import { SHELL_TEXT } from "@/lib/zh"

function extractErrorMessage(err: Error): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as any
    // Unified error envelope (docs/API_CONTRACT.md 1.1): error.message, error.details, error.request_id
    const envelope = data?.error
    if (envelope && typeof envelope.message === "string") {
      const firstError = envelope.details?.errors?.[0]?.msg
      const text =
        envelope.code === "VALIDATION_ERROR" && typeof firstError === "string"
          ? firstError
          : envelope.message
      return envelope.request_id
        ? `${text}（${SHELL_TEXT.requestId}：${envelope.request_id}）`
        : text
    }
    const errDetail = data?.detail
    if (Array.isArray(errDetail) && errDetail.length > 0) {
      return errDetail[0].msg
    }
    if (typeof errDetail === "string") {
      return errDetail
    }
    return err.message
  }
  return SHELL_TEXT.fallbackError
}

export const handleError = function (this: (msg: string) => void, err: Error) {
  const errorMessage = extractErrorMessage(err)
  this(errorMessage)
}

export const getInitials = (name: string): string => {
  return name
    .split(" ")
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase()
}
