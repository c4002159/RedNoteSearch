import { Check, ListChecks, Minimize2 } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

export type DockStep = {
  text: string
  state: "done" | "current" | "pending"
}

const STORAGE_KEY = "progress-dock-open"

function readOpen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0"
  } catch {
    return true
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, open ? "1" : "0")
  } catch {
    // per-viewer convenience only; the dock works without storage
  }
}

// A small floating progress panel: opens into a vertical stepper and shrinks back into one round button.
export function ProgressDock({
  steps,
  note,
  busy = false,
}: {
  steps: DockStep[]
  note?: string
  busy?: boolean
}) {
  const [open, setOpen] = useState(readOpen)
  const toggle = (next: boolean) => {
    setOpen(next)
    writeOpen(next)
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="展开生成进度"
        aria-expanded={false}
        aria-controls="progress-dock-panel"
        onClick={() => toggle(true)}
        className="fixed right-4 bottom-4 z-20 flex size-12 items-center justify-center rounded-full border border-border/40 bg-card text-primary shadow-overlay transition-colors hover:bg-accent lg:right-6 lg:bottom-auto lg:top-24"
      >
        <ListChecks className="size-5" />
        {busy && (
          <span className="absolute top-1 right-1 size-2.5 rounded-full bg-primary ring-2 ring-card" />
        )}
      </button>
    )
  }

  return (
    <aside
      id="progress-dock-panel"
      aria-label="生成进度"
      className="fixed right-4 bottom-4 z-20 w-64 rounded-xl border border-border/40 bg-card p-5 shadow-overlay lg:right-6 lg:bottom-auto lg:top-24"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">生成进度</h2>
        <button
          type="button"
          aria-label="收起生成进度"
          aria-expanded={true}
          aria-controls="progress-dock-panel"
          onClick={() => toggle(false)}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <Minimize2 className="size-4" />
        </button>
      </div>
      <ol className="mt-4">
        {steps.map((step, i) => (
          <li key={step.text} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full",
                  step.state === "done" && "bg-primary text-primary-foreground",
                  step.state === "current" &&
                    "border-2 border-primary bg-card ring-4 ring-primary/15",
                  step.state === "pending" && "bg-surface-high",
                )}
              >
                {step.state === "done" ? (
                  <Check className="size-3.5" />
                ) : (
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      step.state === "current" ? "bg-primary" : "bg-outline/50",
                    )}
                  />
                )}
              </span>
              {i < steps.length - 1 && (
                <span
                  className={cn(
                    "h-5 w-0.5",
                    step.state === "done" ? "bg-primary" : "bg-border/60",
                  )}
                />
              )}
            </div>
            <span
              className={cn(
                "flex h-6 items-center text-[13px]",
                step.state === "current"
                  ? "font-semibold text-link"
                  : step.state === "done"
                    ? "font-medium"
                    : "text-muted-foreground",
              )}
            >
              {step.text}
            </span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-4 text-xs text-muted-foreground">{note}</p>}
    </aside>
  )
}
