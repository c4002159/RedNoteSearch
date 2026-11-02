import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { SCENE_LABEL } from "@/lib/zh"

const palette = [
  "bg-scene-sky text-tone-info",
  "bg-scene-blue text-tone-soft-blue",
  "bg-scene-mint text-tone-ok",
  "bg-scene-yellow text-tone-note",
  "bg-scene-orange text-tone-warn",
  "bg-scene-pink text-tone-err",
] as const
const builtin = new Map<string, number>([
  ["seeding", 0],
  ["review", 1],
  ["tutorial", 2],
  ["launch", 3],
  ["promotion", 4],
  ["story", 5],
])
// Hash only the immutable key, never the display name or the current list order.
export function typeBadgeColor(typeKey: string) {
  let hash = 0
  for (const char of typeKey)
    hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0
  return palette[builtin.get(typeKey) ?? hash % palette.length]
}
export function TypeBadge({
  typeKey,
  children,
  className,
}: {
  typeKey: string
  children?: ReactNode
  className?: string
}) {
  return (
    <span
      data-type-key={typeKey}
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-medium",
        typeBadgeColor(typeKey),
        className,
      )}
    >
      {children ?? (SCENE_LABEL as Record<string, string>)[typeKey] ?? typeKey}
    </span>
  )
}
