import type { ComplianceCheckPublic } from "@/client"
import { codePointCount } from "@/lib/count"
import { RESULT_REWRITE_TEXT as T } from "@/lib/zh"

export function riskRewriteInstruction(
  items: Pick<ComplianceCheckPublic, "matched_text" | "suggestion">[],
): string {
  const instruction = items
    .map((item) => T.instruction(item.matched_text, item.suggestion))
    .join("\n")
  return codePointCount(instruction) > 500
    ? Array.from(instruction).slice(0, 500).join("")
    : instruction
}
