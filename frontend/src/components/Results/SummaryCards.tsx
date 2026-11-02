import type { ResultsSummary } from "@/client"
import { Pill } from "@/components/Common/StatusBadge"
import { RESULTS_TEXT as T } from "@/lib/zh"
import { reading } from "./Feedback"

export function SummaryCards({ data }: { data: ResultsSummary }) {
  return (
    <>
      <section aria-label={T.dashboard} className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-6 rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-semibold">{T.total}</h2>
          <p className="text-4xl font-semibold text-primary">
            {data.total_copies}
            <span className="ml-2 text-sm text-muted-foreground">
              {T.copies}
            </span>
          </p>
          <div className="flex items-center justify-between rounded-xl bg-surface-low p-4">
            <span>{T.pending}</span>
            <Pill tone="warn">{data.pending_count}</Pill>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {T.pendingHint}
          </p>
        </div>
        <div className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-semibold">{T.mostUsed}</h2>
          {data.most_used.length === 0 && (
            <p className="py-6 text-sm text-muted-foreground">{T.noUsage}</p>
          )}
          {data.most_used.map((item) => (
            <div
              key={`${item.scene}:${item.scenario_name}`}
              className="space-y-2"
            >
              <div className="flex justify-between gap-3 text-sm">
                <span className="min-w-0 break-words">
                  {item.scenario_name}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {item.count} {T.copies}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-low">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${data.total_copies ? Math.min(100, (item.count / data.total_copies) * 100) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
          <h2 className="font-semibold">{T.hottest}</h2>
          {!data.hottest.enough_data ? (
            <div className="rounded-xl bg-surface-low p-5">
              <p className="mb-2 font-medium">{T.insufficient}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {T.minimum(
                  data.hottest.notes_with_metrics,
                  data.hottest.min_notes,
                )}
              </p>
            </div>
          ) : (
            data.hottest.items.map((item, index) => (
              <div
                key={`${item.scene}:${item.scenario_name}`}
                className="flex items-start gap-3 rounded-lg bg-surface-low p-3"
              >
                <span className="text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-medium">
                    {item.scenario_name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {T.average}{" "}
                    {reading(item.average_engagement, item.approximate)} ·{" "}
                    {item.note_count} {T.copies}
                  </p>
                  {item.approximate && (
                    <Pill tone="gray">{T.containsApproximate}</Pill>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
      <p className="text-xs text-muted-foreground">{T.disclaimer}</p>
    </>
  )
}
