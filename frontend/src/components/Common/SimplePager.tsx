import { Button } from "@/components/ui/button"
import { TABLE_TEXT as T } from "@/lib/zh"

export function SimplePager({
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
  const pages = Math.ceil(total / size)
  if (pages <= 1) return null
  const start = Math.max(1, Math.min(page - 2, pages - 4))
  return (
    <nav
      aria-label={T.pagination}
      className="flex flex-wrap items-center justify-end gap-2 py-4"
    >
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {T.previous}
      </Button>
      {Array.from({ length: Math.min(5, pages) }, (_, i) => start + i).map(
        (number) => (
          <Button
            key={number}
            size="sm"
            variant={number === page ? "default" : "ghost"}
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPage(number)}
          >
            {number}
          </Button>
        ),
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {T.next}
      </Button>
    </nav>
  )
}
