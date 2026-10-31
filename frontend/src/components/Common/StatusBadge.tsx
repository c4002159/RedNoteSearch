import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import {
  DOCUMENT_STATUS_LABEL,
  EVIDENCE_STATUS_LABEL,
  FLOW_STATUS_LABEL,
  label,
  SEVERITY_LABEL,
  SOURCE_LEVEL_LABEL,
} from "@/lib/zh"

const badge = cva(
  "inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-tone-neutral-bg text-tone-neutral",
        info: "bg-tone-info-bg text-tone-info",
        gray: "bg-tone-gray-bg text-tone-gray",
        softBlue: "bg-tone-soft-blue-bg text-tone-soft-blue",
        warn: "bg-tone-warn-bg text-tone-warn",
        err: "bg-tone-err-bg text-tone-err",
        ok: "bg-tone-ok-bg text-tone-ok",
        note: "bg-tone-note-bg text-tone-note",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
)

type Tone = NonNullable<VariantProps<typeof badge>["tone"]>

export function Pill({
  tone,
  className,
  children,
}: {
  tone?: Tone
  className?: string
  children: React.ReactNode
}) {
  return <span className={cn(badge({ tone }), className)}>{children}</span>
}

const FLOW_TONE: Record<string, Tone> = {
  queued: "neutral",
  generating: "info",
  checking: "info",
  checks_completed: "gray",
  needs_human_review: "warn",
  edited_pending_recheck: "warn",
  constraint_failed: "err",
  ready_to_copy: "ok",
}

// Task and version states (technical doc table 4-4). "Checks completed" is never green and never says "passed".
export function FlowStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={FLOW_TONE[status] ?? "neutral"}>
      {label(FLOW_STATUS_LABEL, status, "flow_status")}
    </Pill>
  )
}

const EVIDENCE_TONE: Record<string, Tone> = {
  system_supported: "softBlue",
  evidence_missing: "warn",
  needs_human_review: "warn",
}

export function EvidenceStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={EVIDENCE_TONE[status] ?? "neutral"}>
      {label(EVIDENCE_STATUS_LABEL, status, "evidence_status")}
    </Pill>
  )
}

export function HumanConfirmedBadge() {
  return <Pill tone="gray">人工确认（非系统验证）</Pill>
}

export function SourceLevelBadge({ level }: { level: string }) {
  return (
    <Pill tone={level === "task_material" ? "warn" : "gray"}>
      {label(SOURCE_LEVEL_LABEL, level, "source_level")}
    </Pill>
  )
}

const DOC_TONE: Record<string, Tone> = {
  pending_review: "warn",
  approved: "ok",
  rejected: "err",
  deactivated: "gray",
}

export function DocumentStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={DOC_TONE[status] ?? "neutral"}>
      {label(DOCUMENT_STATUS_LABEL, status, "document_status")}
    </Pill>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Pill tone={severity === "block" ? "err" : "note"}>
      {label(SEVERITY_LABEL, severity, "severity")}
    </Pill>
  )
}
