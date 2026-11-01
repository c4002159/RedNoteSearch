import { BrandError } from "@/components/Brands/Feedback"
import { MissingPage } from "@/components/Common/ForbiddenPage"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { parseApiError } from "@/lib/apiError"
import {
  INDEX_STATUS_LABEL,
  label,
  KB_TEXT as T,
  T5_VISUAL_TEXT as V,
} from "@/lib/zh"

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
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-card p-6 text-sm shadow-sm">
      <span>
        {V.total} {total} {V.records}
      </span>
      <span className="rounded-lg bg-surface-low px-3 py-1.5 text-muted-foreground">
        {V.perPage} {size} {V.items}
      </span>
      <span className="ml-auto text-muted-foreground">
        {page} / {pages} {V.page}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {T.previous}
      </Button>
      {Array.from(
        { length: Math.min(5, pages) },
        (_, i) => Math.max(1, Math.min(page - 2, pages - 4)) + i,
      ).map((number) => (
        <Button
          key={number}
          size="sm"
          variant={page === number ? "default" : "ghost"}
          aria-current={page === number ? "page" : undefined}
          onClick={() => onPage(number)}
        >
          {number}
        </Button>
      ))}
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
