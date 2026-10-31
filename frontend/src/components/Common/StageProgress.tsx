import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import { label, PROGRESS_STAGE_LABEL } from "@/lib/zh"

const STEPS = [
  { key: "queued", text: "排队" },
  { key: "generating", text: "生成中" },
  { key: "checking", text: "检查中" },
] as const

// Three stages decided by flow_status; progress.stage is only the small line under the current stage.
// No percentage is shown, because the backend does not report one.
export function StageProgress({
  flowStatus,
  stage,
}: {
  flowStatus: string
  stage?: string | null
}) {
  const index = STEPS.findIndex((s) => s.key === flowStatus)
  const current = index === -1 ? STEPS.length : index
  return (
    <ol className="flex items-start" aria-label="生成进度">
      {STEPS.map((step, i) => {
        const done = i < current
        const active = i === current
        const lineBefore =
          i === 0
            ? "bg-transparent"
            : done || active
              ? "bg-primary"
              : "bg-border"
        const lineAfter =
          i === STEPS.length - 1
            ? "bg-transparent"
            : done
              ? "bg-primary"
              : "bg-border"
        return (
          <li
            key={step.key}
            className="flex flex-1 flex-col items-center gap-1"
          >
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", lineBefore)} />
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border text-xs",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                )}
              >
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={cn("h-0.5 flex-1", lineAfter)} />
            </div>
            <span className={cn("text-xs", active && "font-medium")}>
              {step.text}
            </span>
            {active && stage && stage !== "done" && (
              <span className="text-xs text-muted-foreground">
                {label(PROGRESS_STAGE_LABEL, stage, "progress_stage")}
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}
