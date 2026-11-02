import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { ComplianceService, type RuleBatchItem } from "@/client"
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
import { R6_RULE_TEXT as R } from "@/lib/zh"

// One request for the whole batch; the server answers per rule, so a failed rule stays selected and can be retried.
export function RuleBatchDialog({
  ids,
  enabled,
  brandId,
  names,
  onApplied,
  onClose,
}: {
  ids: string[]
  enabled: boolean
  brandId: string | null
  names: Record<string, string>
  onApplied: (successIds: string[]) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const [failed, setFailed] = useState<RuleBatchItem[]>([])
  const [done, setDone] = useState(0)
  const targets = failed.length ? failed.map((item) => item.id) : ids
  const run = useMutation({
    mutationFn: async () => {
      const body = { ids: targets, enabled, reason: reason.trim() }
      return (
        brandId
          ? await ComplianceService.batchBrandRuleState({
              path: { brand_id: brandId },
              body,
            })
          : await ComplianceService.batchGlobalRuleState({ body })
      ).data
    },
    onSuccess: (result) => {
      const ok = result.items.filter((item) => item.success)
      setDone((count) => count + ok.length)
      setFailed(result.items.filter((item) => !item.success))
      onApplied(ok.map((item) => item.id))
    },
  })
  const finished = done > 0 && failed.length === 0 && !run.isPending
  return (
    <Dialog open onOpenChange={(open) => !open && !run.isPending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{enabled ? R.batchRestore : R.batchDelete}</DialogTitle>
          <DialogDescription>
            {R.batchNotice(targets.length, enabled)}
          </DialogDescription>
        </DialogHeader>
        {!finished && (
          <div className="space-y-1">
            <label htmlFor="rule-batch-reason" className="text-sm font-medium">
              {R.reason}
            </label>
            <Input
              id="rule-batch-reason"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        )}
        {run.isError && <ErrorBanner error={parseApiError(run.error)} />}
        {done > 0 && (
          <p role="status" className="text-sm">
            {R.batchDone(done)}
          </p>
        )}
        {failed.length > 0 && (
          <ul className="space-y-1 text-sm text-destructive" role="alert">
            {failed.map((item) => (
              <li key={item.id}>
                {names[item.id] ?? item.id}：
                {item.message || item.error_code || R.batchFailed}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={run.isPending} onClick={onClose}>
            {finished ? R.close : R.cancel}
          </Button>
          {!finished && (
            <Button
              variant={enabled ? "default" : "destructive"}
              disabled={run.isPending || !reason.trim() || !targets.length}
              onClick={() => run.mutate()}
            >
              {failed.length ? R.retryFailed : R.confirm}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
