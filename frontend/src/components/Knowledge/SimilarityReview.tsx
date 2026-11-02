import { useState } from "react"
import { z } from "zod"
import type { ReviewCreate, SimilarDocument } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { R6_KNOWLEDGE_UI_TEXT as T } from "@/lib/zh"

const conflictSchema = z.object({
  token: z.string().min(1),
  items: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        similarity: z.number().nullable().optional(),
        reasons: z.array(z.enum(["title_match", "content_near"])).optional(),
      }),
    )
    .max(10),
})
export type SimilarityConflict = z.infer<typeof conflictSchema>
export function readSimilarityConflict(
  error: unknown,
): SimilarityConflict | null {
  const info = parseApiError(error)
  if (info.status !== 409 || info.code !== "KB_SIMILAR_CONTENT") return null
  const parsed = conflictSchema.safeParse(info.details)
  return parsed.success ? parsed.data : null
}

export function SimilarItems({ items }: { items: SimilarDocument[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="min-w-0 space-y-1 rounded-lg border p-3 text-sm [overflow-wrap:anywhere]"
        >
          <p className="font-medium">{item.title}</p>
          {item.similarity != null && (
            <p className="tabular-nums text-muted-foreground">
              {T.similarity}：{item.similarity}
            </p>
          )}
          <p className="text-muted-foreground">
            {item.reasons
              ?.map((reason) =>
                reason === "title_match" ? T.titleMatch : T.contentNear,
              )
              .join("、")}
          </p>
        </li>
      ))}
    </ul>
  )
}

export function SimilarityReview({
  title,
  conflict,
  pending,
  error,
  onSubmit,
}: {
  title: string
  conflict: SimilarityConflict
  pending: boolean
  error: unknown
  onSubmit: (body: ReviewCreate) => void
}) {
  const [decision, setDecision] = useState<"coexist" | "new_wins" | "cancel">(
    "coexist",
  )
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [reason, setReason] = useState("")
  const [validation, setValidation] = useState("")
  const confirm =
    decision === "cancel"
      ? T.confirmCancel
      : decision === "new_wins"
        ? T.confirmNewWins
        : T.confirmCoexist
  return (
    <Dialog open>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.similarTitle}</DialogTitle>
          <DialogDescription>
            {T.newDocument}：{title}
          </DialogDescription>
        </DialogHeader>
        <SimilarItems items={conflict.items} />
        <fieldset disabled={pending} className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {(["coexist", "new_wins", "cancel"] as const).map((value) => (
              <label key={value} className="flex items-center gap-2">
                <input
                  type="radio"
                  className="accent-primary focus-visible:ring-2 focus-visible:ring-ring"
                  name="similar-decision"
                  value={value}
                  checked={decision === value}
                  onChange={() => {
                    setDecision(value)
                    setValidation("")
                  }}
                />
                {value === "coexist"
                  ? T.coexist
                  : value === "new_wins"
                    ? T.newWins
                    : T.cancelReview}
              </label>
            ))}
          </div>
          {decision === "new_wins" && (
            <div className="space-y-2">
              <p className="text-sm">{T.chooseRelated}</p>
              {conflict.items.map((item) => (
                <label
                  key={item.id}
                  htmlFor={`similar-${item.id}`}
                  className="flex items-start gap-2 text-sm [overflow-wrap:anywhere]"
                >
                  <Checkbox
                    id={`similar-${item.id}`}
                    checked={selected.has(item.id)}
                    onCheckedChange={(checked) =>
                      setSelected((previous) => {
                        const next = new Set(previous)
                        if (checked === true) next.add(item.id)
                        else next.delete(item.id)
                        return next
                      })
                    }
                  />
                  {item.title}
                </label>
              ))}
            </div>
          )}
          {decision === "cancel" && (
            <p className="text-sm text-muted-foreground">{T.cancelHint}</p>
          )}
          <label htmlFor="similar-reason" className="text-sm">
            {T.reviewReason}
          </label>
          <Textarea
            id="similar-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </fieldset>
        {validation && (
          <p role="alert" className="text-sm text-destructive">
            {validation}
          </p>
        )}
        {!!error && !readSimilarityConflict(error) && (
          <BrandError
            error={error}
            message={
              parseApiError(error).status === 503
                ? T.ingestUnavailable
                : undefined
            }
          />
        )}
        <DialogFooter>
          <LoadingButton
            loading={pending}
            onClick={() => {
              if (!reason.trim() || codePointCount(reason.trim()) > 500)
                return setValidation(T.reasonError)
              if (
                decision === "new_wins" &&
                (!selected.size || selected.size > 10)
              )
                return setValidation(T.selectedRequired)
              setValidation("")
              onSubmit(
                decision === "cancel"
                  ? {
                      action: "cancel",
                      reason: reason.trim(),
                    }
                  : {
                      action: "approve",
                      reason: reason.trim(),
                      similar_decision: decision,
                      related_document_ids:
                        decision === "new_wins" ? [...selected] : [],
                      similarity_token: conflict.token,
                    },
              )
            }}
          >
            {confirm}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
