import { Pencil } from "lucide-react"
import type { ReactNode } from "react"

export function TableName({
  children,
  onClick,
  editable = false,
}: {
  children: ReactNode
  onClick: () => void
  editable?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex max-w-full items-center gap-1 text-left font-medium text-link hover:underline focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="[overflow-wrap:anywhere]">{children}</span>
      {editable && (
        <Pencil
          aria-hidden
          className="size-3 shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
  )
}
