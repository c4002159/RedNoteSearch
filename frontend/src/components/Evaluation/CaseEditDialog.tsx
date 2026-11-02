import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { type CasePublic, EvaluationService } from "@/client"
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
import { Textarea } from "@/components/ui/textarea"
import { parseApiError } from "@/lib/apiError"
import { R6_EVAL_TEXT as R, EVAL_TEXT as T } from "@/lib/zh"

type Json = { [key: string]: unknown }

function parseObject(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Json)
      : null
  } catch {
    return null
  }
}

// Saving never edits the stored version: the server answers with a new dataset version.
export function CaseEditDialog({
  datasetId,
  row,
  readOnly,
  onClose,
  onSaved,
}: {
  datasetId: string
  row: CasePublic
  readOnly: boolean
  onClose: () => void
  onSaved: (newId: string) => void
}) {
  const cache = useQueryClient()
  const [input, setInput] = useState(JSON.stringify(row.input, null, 2))
  const [expected, setExpected] = useState(
    JSON.stringify(row.expected ?? {}, null, 2),
  )
  const [invalid, setInvalid] = useState(false)
  const save = useMutation({
    mutationFn: async (body: { input: Json; expected: Json }) =>
      (
        await EvaluationService.reviseDataset({
          path: { dataset_id: datasetId },
          body: {
            updates: [
              {
                case_index: row.case_index,
                input: body.input,
                expected: body.expected,
                annotators: row.annotators,
              },
            ],
          },
        })
      ).data,
    onSuccess: async (created) => {
      await cache.invalidateQueries({ queryKey: ["evaluation-datasets"] })
      toast.success(R.revised(created.version))
      onSaved(created.id)
    },
  })
  const submit = () => {
    const nextInput = parseObject(input)
    const nextExpected = parseObject(expected)
    if (!nextInput || !nextExpected) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    save.mutate({ input: nextInput, expected: nextExpected })
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto border-0 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{R.editTitle(row.case_index)}</DialogTitle>
          <DialogDescription>
            {readOnly ? R.readOnly : R.editNotice}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="case-input" className="text-sm font-semibold">
            {R.inputJson}
          </label>
          <Textarea
            id="case-input"
            className="min-h-40 font-mono text-xs font-normal"
            value={input}
            readOnly={readOnly}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="case-expected" className="text-sm font-semibold">
            {R.expectedJson}
          </label>
          <Textarea
            id="case-expected"
            className="min-h-32 font-mono text-xs font-normal"
            value={expected}
            readOnly={readOnly}
            onChange={(e) => setExpected(e.target.value)}
          />
        </div>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            {R.invalidObject}
          </p>
        )}
        {save.isError && (
          <ErrorBanner error={parseApiError(save.error)} onRetry={submit} />
        )}
        <DialogFooter>
          <Button variant="outline" disabled={save.isPending} onClick={onClose}>
            {readOnly ? T.close : T.cancel}
          </Button>
          {!readOnly && (
            <Button disabled={save.isPending} onClick={submit}>
              {save.isPending ? R.saving : R.saveNewVersion}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
