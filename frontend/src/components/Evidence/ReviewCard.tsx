import type { ReactNode } from "react"
import { HumanConfirmedBadge, Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { R8_FLOW_TEXT as T } from "@/lib/zh"

export type ReviewFilter = "all" | "pending" | "done"
export function ReviewFilters({
  value,
  onChange,
  done,
}: {
  value: ReviewFilter
  onChange: (value: ReviewFilter) => void
  done: number
}) {
  return (
    <fieldset aria-label={T.filter} className="flex flex-wrap gap-2">
      {(["all", "pending", ...(done ? ["done" as const] : [])] as const).map(
        (key) => (
          <Button
            key={key}
            size="sm"
            variant={value === key ? "secondary" : "ghost"}
            aria-pressed={value === key}
            onClick={() => onChange(key)}
          >
            {T.filters[key]}
          </Button>
        ),
      )}
    </fieldset>
  )
}

export function ReviewCard({
  id,
  title,
  pending,
  queued,
  kind,
  decision,
  children,
}: {
  id: string
  title: string
  pending: boolean
  queued: boolean
  kind: "evidence" | "risk"
  decision?: boolean | null
  children: ReactNode
}) {
  const state = queued ? "queued" : pending ? "pending" : "done"
  const header = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {title}
      </span>
      {decision != null && (
        <Pill tone="gray">{decision ? T.accepted : T.rejected}</Pill>
      )}
      {decision != null && <HumanConfirmedBadge />}
      {queued ? (
        <Pill tone="info">{T.queued}</Pill>
      ) : pending ? (
        <Pill tone="warn">
          {kind === "evidence" ? T.evidencePending : T.riskPending}
        </Pill>
      ) : (
        decision == null && <Pill tone="gray">{T.done}</Pill>
      )}
    </div>
  )
  return (
    <li
      id={id}
      tabIndex={-1}
      data-review-pending={pending}
      data-review-state={state}
      className={cn(
        "min-w-0 scroll-mt-24 rounded-lg border p-3 outline-none focus:ring-2 focus:ring-ring",
        state === "pending" && "border-l-4 border-l-tone-warn bg-card",
        state === "queued" && "border-l-4 border-l-tone-info bg-tone-info-bg",
        state === "done" && "bg-surface-low text-muted-foreground",
      )}
    >
      {!pending ? (
        <details key={String(decision)}>
          <summary className="flex cursor-pointer list-none items-center gap-2">
            {header}
            <span className="text-xs">{T.expand}</span>
          </summary>
          <div className="mt-3 space-y-2">{children}</div>
        </details>
      ) : (
        <>
          {header}
          <div className="mt-3 space-y-2">{children}</div>
        </>
      )}
    </li>
  )
}
