import { cn } from "@/lib/utils"

// "value / limit" with the red state when over the limit. The counting rule is chosen by the caller
// (title weight, body units, tag count); the server result stays authoritative (FC-14).
export function CharCounter({
  value,
  limit,
  suffix,
  className,
}: {
  value: number
  limit: number
  suffix?: string
  className?: string
}) {
  const shown = Number.isInteger(value) ? String(value) : value.toFixed(1)
  return (
    <span
      className={cn(
        "text-xs tabular-nums text-muted-foreground",
        value > limit && "font-medium text-destructive",
        className,
      )}
      aria-live="polite"
    >
      {shown} / {limit}
      {suffix}
    </span>
  )
}
