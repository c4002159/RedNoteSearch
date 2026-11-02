import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { type ClaimEvidencePublic, EvidenceService } from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { Button } from "@/components/ui/button"
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
import {
  PAGE_ERROR_TEXT,
  EVIDENCE_BATCH_REVIEW_TEXT as R,
  EVIDENCE_BATCH_TEXT as T,
} from "@/lib/zh"

type Decision = { ids: string[]; confirmed: boolean }
export function EvidenceBatchActions({
  versionId,
  items,
  selectedIds,
  enabled,
  onSaved,
  onClear,
}: {
  versionId: string
  items: ClaimEvidencePublic[]
  selectedIds: string[]
  enabled: boolean
  onSaved: () => Promise<void>
  onClear: () => void
}) {
  const [action, setAction] = useState<Decision | null>(null)
  const [note, setNote] = useState("")
  const mutation = useMutation({
    mutationFn: async (values: Decision & { note?: string }) =>
      (
        await EvidenceService.confirmVersionEvidence({
          path: { version_id: versionId },
          body: {
            items: values.ids.map((evidence_id) => ({
              evidence_id,
              human_confirmed: values.confirmed,
              ...(values.confirmed ? { note: values.note } : {}),
            })),
          },
        })
      ).data,
    onSuccess: async () => {
      setAction(null)
      onClear()
      await onSaved()
    },
  })
  if (!enabled || items.length === 0) return null
  const needsDecision = items.filter(
    (item) => item.status !== "system_supported",
  )
  const error = mutation.isError ? parseApiError(mutation.error) : null
  const start = (confirmed: boolean) => {
    mutation.reset()
    setNote("")
    setAction({
      confirmed,
      ids: confirmed ? [...selectedIds] : needsDecision.map((item) => item.id),
    })
  }
  const valid =
    !!action &&
    action.ids.length > 0 &&
    action.ids.length <= 100 &&
    (!action.confirmed || (!!note.trim() && codePointCount(note) <= 500))
  return (
    <>
      <div className="space-y-2 rounded-xl bg-surface-low p-3">
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={
              mutation.isPending ||
              needsDecision.length === 0 ||
              needsDecision.length > 100
            }
            onClick={() => start(false)}
          >
            {T.reject}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={
              mutation.isPending ||
              selectedIds.length === 0 ||
              selectedIds.length > 100
            }
            onClick={() => start(true)}
          >
            {T.accept}
          </Button>
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {T.selection(selectedIds.length)} {T.manual} {R.scope}
        </p>
        {items.length > 100 && (
          <p className="text-xs text-tone-warn">{T.limit}</p>
        )}
      </div>
      {action && (
        <Dialog
          open
          onOpenChange={(open) =>
            !open && !mutation.isPending && setAction(null)
          }
        >
          <DialogContent
            className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-xl"
            showCloseButton={!mutation.isPending}
            onEscapeKeyDown={(event) =>
              mutation.isPending && event.preventDefault()
            }
            onInteractOutside={(event) =>
              mutation.isPending && event.preventDefault()
            }
          >
            <DialogHeader>
              <DialogTitle>
                {action.confirmed ? T.acceptTitle : R.rejectTitle}
              </DialogTitle>
              <DialogDescription>
                {action.confirmed ? T.acceptHint : R.rejectHint} {T.manual}
              </DialogDescription>
            </DialogHeader>
            <ol className="list-decimal space-y-2 rounded-xl bg-surface-low py-4 pr-4 pl-9 text-sm">
              {items
                .filter((item) => action.ids.includes(item.id))
                .map((item) => (
                  <li key={item.id} className="[overflow-wrap:anywhere]">
                    {item.claim_text}
                  </li>
                ))}
            </ol>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                if (valid)
                  mutation.mutate({
                    ...action,
                    ...(action.confirmed ? { note: note.trim() } : {}),
                  })
              }}
            >
              {action.confirmed && (
                <div className="space-y-2">
                  <label
                    htmlFor="batch-evidence-note"
                    className="text-sm font-medium"
                  >
                    {T.note}
                  </label>
                  <Textarea
                    id="batch-evidence-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    disabled={mutation.isPending}
                  />
                  <CharCounter value={codePointCount(note)} limit={500} />
                </div>
              )}
              {error && (
                <ErrorBanner
                  error={{
                    ...error,
                    message: /[\u3400-\u9fff]/.test(error.message)
                      ? error.message
                      : (PAGE_ERROR_TEXT.status[error.status ?? 0] ??
                        PAGE_ERROR_TEXT.failed),
                  }}
                />
              )}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={mutation.isPending}
                  onClick={() => setAction(null)}
                >
                  {T.cancel}
                </Button>
                <LoadingButton
                  type="submit"
                  variant={action.confirmed ? "default" : "destructive"}
                  loading={mutation.isPending}
                  disabled={!valid}
                >
                  {action.confirmed ? T.confirmAccept : T.confirmReject}
                </LoadingButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
