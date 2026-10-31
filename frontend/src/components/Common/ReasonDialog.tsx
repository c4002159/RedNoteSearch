import { useState } from "react"

import { CharCounter } from "@/components/Common/CharCounter"
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

const REASON_LIMIT = 500

// Confirmation with a required reason (disabling a document or a rule). The reason goes to the audit
// trail only; the API field is optional, the screen asks for it so the trail is useful.
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  fieldLabel = "原因（必填）",
  variant = "destructive",
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
  fieldLabel?: string
  variant?: "default" | "destructive"
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState("")
  const [touched, setTouched] = useState(false)
  const trimmed = reason.trim()
  const tooLong = reason.length > REASON_LIMIT
  const error = touched && !trimmed ? "请填写说明" : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="reason-input" className="text-sm font-medium">
            {fieldLabel}
          </label>
          <Textarea
            id="reason-input"
            value={reason}
            aria-invalid={!!error || tooLong}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          <div className="flex justify-between">
            <span className="text-xs text-destructive">{error}</span>
            <CharCounter value={reason.length} limit={REASON_LIMIT} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            取消
          </Button>
          <LoadingButton
            variant={variant}
            loading={pending}
            disabled={!trimmed || tooLong}
            onClick={() => {
              setTouched(true)
              if (trimmed && !tooLong) onConfirm(trimmed)
            }}
          >
            {confirmLabel}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
