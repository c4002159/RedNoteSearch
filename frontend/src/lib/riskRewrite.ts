import type { ComplianceCheckPublic, RewriteRequest } from "@/client"
import type { ChangeItem } from "@/hooks/useChangeList"
import { codePointCount } from "@/lib/count"
import { R7_CHANGELIST_TEXT as C, RESULT_REWRITE_TEXT as T } from "@/lib/zh"

type Risk = Pick<ComplianceCheckPublic, "field" | "matched_text" | "suggestion">

export function riskRewriteTarget(
  field: string,
): RewriteRequest["target"] | null {
  if (/^titles?$/.test(field) || /^title\.\d+$/.test(field)) return "titles"
  if (field === "body") return "body"
  if (field === "cover" || /^cover\.\d+$/.test(field)) return "cover"
  if (field === "hashtags") return "hashtags"
  return null
}

export function canRewriteRisk(item: Risk): boolean {
  return (
    !!riskRewriteTarget(item.field) &&
    !!item.suggestion.trim() &&
    codePointCount(T.instruction(item.matched_text, "")) < 500
  )
}

// Preserve every recommendation and repeat matched-text context in each part.
export function riskRewriteSteps(items: Risk[]): RewriteRequest[] {
  if (items.some((item) => !canRewriteRisk(item))) return []
  const groups = new Map<RewriteRequest["target"], string[]>()
  for (const item of items) {
    const target = riskRewriteTarget(item.field)!
    const prefix = T.instruction(item.matched_text, "")
    const capacity = 500 - codePointCount(prefix)
    const suggestion = Array.from(item.suggestion)
    const instructions = groups.get(target) ?? []
    for (let offset = 0; offset < suggestion.length; offset += capacity) {
      instructions.push(
        prefix + suggestion.slice(offset, offset + capacity).join(""),
      )
    }
    groups.set(target, instructions)
  }
  const steps: RewriteRequest[] = []
  for (const [target, instructions] of groups) {
    let instruction = ""
    for (const next of instructions) {
      if (instruction && codePointCount(`${instruction}\n${next}`) > 500) {
        steps.push({ target, instruction })
        instruction = ""
      }
      instruction = instruction ? `${instruction}\n${next}` : next
    }
    if (instruction) steps.push({ target, instruction })
  }
  return steps
}

// Keep the existing risk packing/context rules, then enforce one request per target.
// Never truncate a recommendation to make a combined instruction fit.
export function changeListSteps(
  items: ChangeItem[],
  note: string,
): {
  steps: RewriteRequest[]
  error: string | null
} {
  const groups = new Map<RewriteRequest["target"], string[]>()
  const append = (target: RewriteRequest["target"], instruction: string) => {
    groups.set(target, [...(groups.get(target) ?? []), instruction])
  }
  const risks = items
    .filter((item) => item.source === "risk")
    .map((item) => ({
      field: item.target,
      matched_text: item.matched_text ?? "",
      suggestion: item.suggestion ?? "",
    }))
  for (const step of riskRewriteSteps(risks))
    append(step.target, step.instruction ?? "")
  for (const item of items.filter((item) => item.source !== "risk"))
    append(item.target, item.instruction ?? "")
  if (!groups.size && note.trim()) groups.set("body", [])
  const steps: RewriteRequest[] = []
  if (codePointCount(note.trim()) > 500) return { steps, error: C.noteTooLong }
  for (const [target, instructions] of groups) {
    const instruction = [...instructions, ...(note.trim() ? [note.trim()] : [])]
      .filter(Boolean)
      .join("\n")
    if (codePointCount(instruction) > 500)
      return { steps: [], error: C.tooLong(C.parts[target]) }
    steps.push({ target, ...(instruction ? { instruction } : {}) })
  }
  return { steps, error: null }
}
