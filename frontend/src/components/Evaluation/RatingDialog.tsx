import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { EvaluationService } from "@/client"
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
import { Textarea } from "@/components/ui/textarea"
import { codePointCount } from "@/lib/count"
import { EVAL_TEXT as T, ANALYSIS_VISUAL_TEXT as V } from "@/lib/zh"
import { EvaluationError } from "./shared"
export const rubricSchema = z.object({
  rubric_version: z.string(),
  scale: z
    .object({
      min: z.number().int(),
      max: z.number().int(),
      meaning: z.string().optional(),
    })
    .refine((v) => v.min <= v.max),
  dimensions: z
    .array(
      z.object({ key: z.string(), name: z.string(), description: z.string() }),
    )
    .min(1),
  note: z.string().optional(),
})
export function useRubric() {
  return useQuery({
    queryKey: ["evaluation-rubric"],
    queryFn: async () =>
      rubricSchema.parse((await EvaluationService.readRubrics()).data),
  })
}
type Rubric = z.infer<typeof rubricSchema>
export function RatingDialog({
  runId,
  resultId,
  onClose,
  onSaved,
}: {
  runId: string
  resultId: string
  onClose: () => void
  onSaved: () => void
}) {
  const rubric = useRubric()
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-xl border-0 p-6 sm:max-w-2xl"
        showCloseButton={false}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
        onInteractOutside={(e) => busy && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.rate}</DialogTitle>
          <DialogDescription>
            {V.manual} · {T.ratingHint}
          </DialogDescription>
        </DialogHeader>
        {rubric.isLoading && <Skeleton className="h-32 w-full" />}
        {rubric.isError && (
          <>
            <EvaluationError
              error={rubric.error}
              retry={() => rubric.refetch()}
            />
            <Button variant="outline" onClick={onClose}>
              {T.close}
            </Button>
          </>
        )}
        {rubric.data ? (
          <ScoreForm
            key={`${resultId}-${rubric.data.rubric_version}`}
            rubric={rubric.data}
            runId={runId}
            resultId={resultId}
            onSaved={onSaved}
            onClose={onClose}
            onBusy={setBusy}
          />
        ) : (
          !rubric.isLoading &&
          !rubric.isError && <EmptyState title={T.rubricInvalid} />
        )}
      </DialogContent>
    </Dialog>
  )
}
function ScoreForm({
  rubric,
  runId,
  resultId,
  onSaved,
  onClose,
  onBusy,
}: {
  rubric: Rubric
  runId: string
  resultId: string
  onSaved: () => void
  onClose: () => void
  onBusy: (busy: boolean) => void
}) {
  const schema = z
    .object({
      scores: z.record(z.string(), z.number().optional()),
      note: z.string().refine((v) => codePointCount(v) <= 1000, T.noteLimit),
    })
    .superRefine((v, ctx) => {
      for (const dimension of rubric.dimensions) {
        const score = v.scores[dimension.key]
        if (
          score === undefined ||
          !Number.isInteger(score) ||
          score < rubric.scale.min ||
          score > rubric.scale.max
        )
          ctx.addIssue({
            code: "custom",
            path: ["scores", dimension.key],
            message: T.scoreRequired,
          })
      }
    })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { scores: {}, note: "" },
  })
  const mutation = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) =>
      EvaluationService.rate({
        path: { run_id: runId },
        body: {
          result_id: resultId,
          scores: Object.fromEntries(
            rubric.dimensions.map((d) => [d.key, v.scores[d.key]!]),
          ),
          rubric_version: rubric.rubric_version,
          note: v.note || null,
        },
      }),
    onSuccess: onSaved,
  })
  useEffect(() => onBusy(mutation.isPending), [mutation.isPending, onBusy])
  const options = Array.from(
    { length: rubric.scale.max - rubric.scale.min + 1 },
    (_, i) => i + rubric.scale.min,
  )
  return (
    <form
      className="space-y-4"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <p className="text-xs text-muted-foreground">
        {T.rubric}：{rubric.rubric_version} ·{" "}
        {rubric.scale.meaning ?? `${rubric.scale.min}–${rubric.scale.max}`}
      </p>
      <fieldset className="space-y-4" disabled={mutation.isPending}>
        <legend className="sr-only">{T.rate}</legend>
        {rubric.dimensions.map((d) => (
          <Controller
            key={d.key}
            name={`scores.${d.key}`}
            control={form.control}
            render={({ field, fieldState }) => (
              <fieldset className="space-y-2 rounded-xl bg-surface-low p-5">
                <legend className="px-1 text-sm font-medium">{d.name}</legend>
                <p className="text-xs text-muted-foreground">{d.description}</p>
                <div className="flex flex-wrap gap-2">
                  {options.map((score) => (
                    <label
                      key={score}
                      className="flex min-w-12 flex-1 cursor-pointer items-center justify-center gap-1 rounded-lg bg-card px-3 py-3 text-sm has-checked:bg-selected-tint has-checked:text-link has-checked:ring-2 has-checked:ring-primary"
                    >
                      <input
                        type="radio"
                        name={field.name}
                        checked={field.value === score}
                        value={score}
                        onChange={() => field.onChange(score)}
                        onBlur={field.onBlur}
                      />
                      {score}
                    </label>
                  ))}
                </div>
                {fieldState.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {fieldState.error.message}
                  </p>
                )}
              </fieldset>
            )}
          />
        ))}
        <div>
          <label htmlFor="rating-note" className="text-sm font-medium">
            {T.note}
          </label>
          <Textarea id="rating-note" {...form.register("note")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.note?.message}
          </p>
        </div>
      </fieldset>
      {mutation.isError && <EvaluationError error={mutation.error} />}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={mutation.isPending}
          onClick={onClose}
        >
          {T.cancel}
        </Button>
        <LoadingButton type="submit" loading={mutation.isPending}>
          {T.save}
        </LoadingButton>
      </DialogFooter>
    </form>
  )
}
