import { useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { BrandError } from "@/components/Brands/Feedback"
import { CharCounter } from "@/components/Common/CharCounter"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
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
  const full = limit !== undefined && value.length >= limit
  // 单行：回车、逗号或离开输入框都会把当前内容变成一个标签。
  const add = () => {
    const text = entry.trim()
    if (text && !full) {
      onChange([...value, text])
      setEntry("")
    }
  }
  const field =
    "min-w-[12rem] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
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
      <div
        className={`flex flex-wrap items-center gap-2 rounded-lg bg-surface-low p-2 focus-within:ring-[3px] focus-within:ring-ring/30 ${disabled ? "opacity-60" : ""}`}
      >
        {value.map((s, i) => (
          <span
            key={`${i}-${s}`}
            className="inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-md border border-primary/25 bg-card px-2 py-1 text-sm font-medium text-primary shadow-sm"
          >
            <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {s}
            </span>
            <button
              type="button"
              disabled={disabled}
              className="shrink-0 leading-5 text-muted-foreground hover:text-destructive"
              aria-label={`${T.remove} ${title} ${i + 1}`}
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              ×
            </button>
          </span>
        ))}
        {multiline ? (
          <div className="flex w-full items-end gap-2">
            <textarea
              id={id}
              rows={2}
              className={field}
              value={entry}
              disabled={disabled || full}
              placeholder={T.listPlaceholder}
              onChange={(e) => setEntry(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !entry.trim() || full}
              onClick={add}
            >
              {T.add}
            </Button>
          </div>
        ) : (
          <input
            id={id}
            className={field}
            value={entry}
            disabled={disabled || full}
            placeholder={T.listPlaceholder}
            onChange={(e) => setEntry(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              // 输入法选字时按回车，不能把拼音当成一项加进去。
              if (e.nativeEvent.isComposing) return
              if (e.key === "Enter" || e.key === "," || e.key === "，") {
                e.preventDefault()
                add()
              } else if (e.key === "Backspace" && !entry && value.length > 0) {
                onChange(value.slice(0, -1))
              }
            }}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{T.listHint}</p>
    </div>
  )
}
