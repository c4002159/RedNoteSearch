import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import {
  EvaluationService,
  type ViralPatternPublic,
  ViralService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
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
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiError } from "@/lib/apiError"
import { VIRAL_TEXT as T } from "@/lib/zh"
import { ViralError } from "./Feedback"

export function AnalyzeSample({
  sampleId,
  beforeIds,
  beforeTotal,
  onClose,
  onSaved,
  onChecked,
}: {
  sampleId: string
  beforeIds: string[]
  beforeTotal: number
  onClose: () => void
  onSaved: (r: ViralPatternPublic) => void
  onChecked: () => void
}) {
  const [model, setModel] = useState("")
  const [started, setStarted] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [mustCheck, setMustCheck] = useState(false)
  const [found, setFound] = useState(false)
  const [checked, setChecked] = useState(false)
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await EvaluationService.readModels()).data.items,
  })
  const available = models.data?.filter((m) => m.enabled) ?? []
  const selected = model || available[0]?.id || ""
  const check = useMutation({
    mutationFn: async () =>
      (
        await ViralService.readPatterns({
          path: { sample_id: sampleId },
          query: { page: 1, page_size: 20 },
        })
      ).data,
    onSuccess: (data) => {
      const added =
        data.total > beforeTotal ||
        data.items.some((r) => !beforeIds.includes(r.id))
      setFound(added)
      setMustCheck(added)
      setChecked(true)
      onChecked()
    },
  })
  const mutation = useMutation({
    mutationFn: async () => {
      setStarted(Date.now())
      setElapsed(0)
      setChecked(false)
      return (
        await ViralService.analyzeSample({
          path: { sample_id: sampleId },
          body: { model_id: selected },
          timeout: 180_000,
        })
      ).data
    },
    onSuccess: onSaved,
    onError: (error) => {
      const info = parseApiError(error)
      setMustCheck(info.status === null || info.status >= 500)
    },
  })
  const pending = mutation.isPending
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    )
    return () => clearInterval(timer)
  }, [pending, started])
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !pending && !check.isPending && onClose()}
    >
      <DialogContent
        showCloseButton={!pending && !check.isPending}
        onEscapeKeyDown={(e) =>
          (pending || check.isPending) && e.preventDefault()
        }
        onInteractOutside={(e) =>
          (pending || check.isPending) && e.preventDefault()
        }
      >
        <DialogHeader>
          <DialogTitle>{T.analysis}</DialogTitle>
          <DialogDescription>{T.waitHint}</DialogDescription>
        </DialogHeader>
        {models.isLoading && <Skeleton className="h-10 w-full" />}
        {models.isError && (
          <ViralError error={models.error} retry={() => models.refetch()} />
        )}
        {models.data && available.length === 0 && (
          <EmptyState title={T.noModels} />
        )}
        {available.length > 0 && (
          <div className="space-y-1">
            <label htmlFor="analysis-model" className="text-sm font-medium">
              {T.model}
            </label>
            <select
              id="analysis-model"
              className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-3 text-sm"
              value={selected}
              disabled={pending || check.isPending}
              onChange={(e) => setModel(e.target.value)}
            >
              {available.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.model_name}
                </option>
              ))}
            </select>
          </div>
        )}
        {pending && (
          <p role="status" className="rounded-lg bg-surface p-3 text-sm">
            {T.analysing} {T.waited} {elapsed} {T.seconds}
          </p>
        )}
        {mutation.isError && <ViralError error={mutation.error} />}
        {check.isError && <ViralError error={check.error} />}
        {(mustCheck || checked) && (
          <div className="space-y-2 rounded-lg bg-tone-warn-bg p-3 text-sm text-tone-warn">
            <p>
              {found ? T.foundResults : checked ? T.checkedEmpty : T.checkFirst}
            </p>
            {!found && (
              <LoadingButton
                variant="outline"
                loading={check.isPending}
                onClick={() => check.mutate()}
              >
                {T.check}
              </LoadingButton>
            )}
          </div>
        )}
        <DialogFooter>
          {!pending && (
            <Button
              variant="outline"
              disabled={check.isPending}
              onClick={onClose}
            >
              {T.close}
            </Button>
          )}
          <LoadingButton
            loading={pending}
            disabled={!selected || mustCheck || found || check.isPending}
            onClick={() => mutation.mutate()}
          >
            {pending ? T.analysing : T.start}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
