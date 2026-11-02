import { useState } from "react"
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
import { Input } from "@/components/ui/input"
import { parseApiError } from "@/lib/apiError"
import { PAGE_ERROR_TEXT, TABLE_TEXT as T } from "@/lib/zh"

// One request at a time: partial failures stay selected; retries never repeat successful writes.
export function TableBatchDialog({
  ids,
  title,
  execute,
  onApplied,
  onClose,
  reasonRequired = false,
}: {
  ids: string[]
  title: string
  execute: (id: string, reason: string) => Promise<unknown>
  onApplied: (successIds: string[]) => void
  onClose: () => void
  reasonRequired?: boolean
}) {
  const [pending, setPending] = useState(false)
  const [reason, setReason] = useState("")
  const [results, setResults] = useState<{ id: string; error?: unknown }[]>([])
  const targets = results.length
    ? results.filter((item) => item.error).map((item) => item.id)
    : ids
  const run = async () => {
    setPending(true)
    const success: string[] = []
    const next = results.filter((item) => !item.error)
    for (const id of targets) {
      try {
        await execute(id, reason.trim())
        success.push(id)
        next.push({ id })
      } catch (error) {
        next.push({ id, error })
      }
      setResults([...next])
    }
    onApplied(success)
    setPending(false)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        showCloseButton={!pending}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onInteractOutside={(e) => pending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{T.confirm(ids.length)}</DialogDescription>
        </DialogHeader>
        {reasonRequired && (
          <div className="space-y-2">
            <label htmlFor="batch-reason">{T.reason}</label>
            <Input
              id="batch-reason"
              disabled={pending}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        <ul className="space-y-3 text-sm">
          {results.map((item) => {
            const info = item.error ? parseApiError(item.error) : null
            return (
              <li key={item.id} className="break-all">
                <p className="text-xs text-muted-foreground">{item.id}</p>
                {info ? (
                  <ErrorBanner
                    error={{
                      ...info,
                      message:
                        PAGE_ERROR_TEXT.status[info.status ?? 0] ??
                        PAGE_ERROR_TEXT.failed,
                    }}
                  />
                ) : (
                  <span>{T.success}</span>
                )}
              </li>
            )
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {T.close}
          </Button>
          <Button
            variant="destructive"
            disabled={
              pending || !targets.length || (reasonRequired && !reason.trim())
            }
            onClick={() => void run()}
          >
            {pending
              ? T.processing
              : results.length
                ? T.retryFailed
                : T.confirmAction}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
