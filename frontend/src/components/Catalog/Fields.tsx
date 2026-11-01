import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { BrandError } from "@/components/Brands/Feedback"
import { CharCounter } from "@/components/Common/CharCounter"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useBrand } from "@/hooks/useBrand"
import { CATALOG_TEXT as T } from "@/lib/zh"
export function CatalogGuard({ children }: { children: ReactNode }) {
  const brand = useBrand(),
    cache = useQueryClient()
  if (brand.isLoading) return <Skeleton className="h-40 w-full" />
  if (brand.isError)
    return (
      <BrandError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  return <div key={brand.current.id}>{children}</div>
}
export function ListField({
  id,
  title,
  value,
  onChange,
  limit,
  disabled = false,
  multiline = false,
}: {
  id: string
  title: string
  value: string[]
  onChange: (v: string[]) => void
  limit?: number
  disabled?: boolean
  multiline?: boolean
}) {
  const [entry, setEntry] = useState("")
  const add = () => {
    if (entry.trim() && (limit === undefined || value.length < limit)) {
      onChange([...value, entry.trim()])
      setEntry("")
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {title}
        </label>
        {limit !== undefined && (
          <CharCounter value={value.length} limit={limit} />
        )}
      </div>
      <ul className="flex flex-wrap gap-2">
        {value.map((s, i) => (
          <li
            key={i}
            className="flex min-w-0 max-w-full items-start gap-2 rounded-md bg-surface px-2 py-1 text-sm"
          >
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {s}
            </span>
            <button
              type="button"
              disabled={disabled}
              className="shrink-0 text-muted-foreground hover:text-destructive"
              aria-label={`${T.remove} ${title} ${i + 1}`}
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        {multiline ? (
          <Textarea
            id={id}
            value={entry}
            disabled={disabled}
            onChange={(e) => setEntry(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            value={entry}
            disabled={disabled}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                add()
              }
            }}
          />
        )}
        <Button
          type="button"
          variant="outline"
          disabled={
            disabled ||
            !entry.trim() ||
            (limit !== undefined && value.length >= limit)
          }
          onClick={add}
        >
          {T.add}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{T.listHint}</p>
    </div>
  )
}
