import { BrandError } from "@/components/Brands/Feedback"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { parseApiError } from "@/lib/apiError"
import { INDEX_STATUS_LABEL, label, KB_TEXT as T } from "@/lib/zh"

export function KnowledgeError({
  error,
  retry,
}: {
  error: unknown
  retry?: () => void
}) {
  const info = parseApiError(error)
  return info.status === 404 ? (
    <MissingPage requestId={info.requestId} />
  ) : (
    <BrandError error={error} retry={retry} />
  )
}
export function IndexBadge({
  status,
  documentStatus,
}: {
  status: string
  documentStatus: string
}) {
  return documentStatus !== "approved" ? (
    <span>—</span>
  ) : (
    <Pill
      tone={status === "failed" ? "err" : status === "ready" ? "info" : "gray"}
    >
      {label(INDEX_STATUS_LABEL, status, "index_status")}
    </Pill>
  )
}
export function Pager({
  page,
  total,
  size = 20,
  onPage,
}: {
  page: number
  total: number
  size?: number
  onPage: (page: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <span className="text-muted-foreground">
        {page} / {pages} {T.page}，{T.total} {total} {T.items}
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
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {T.next}
      </Button>
    </div>
  )
}
