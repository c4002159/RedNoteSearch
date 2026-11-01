import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { type DatasetPublic, EvaluationService, type RunPublic } from "@/client"
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
import { EVAL_KIND_LABEL, label, EVAL_TEXT as T } from "@/lib/zh"
import { EvaluationError } from "./shared"

type Values = { dataset_id: string; model_ids: string[] }
export function CreateRun({
  dataset,
  onClose,
  onSaved,
}: {
  dataset?: DatasetPublic
  onClose: () => void
  onSaved: (row: RunPublic) => void
}) {
  const datasets = useQuery({
    queryKey: ["evaluation-datasets", "all"],
    queryFn: async () => (await EvaluationService.readDatasets()).data.items,
    enabled: !dataset,
  })
  const schema = z
    .object({
      dataset_id: z.string().min(1, T.selectDataset),
      model_ids: z.array(z.string()),
    })
    .superRefine((v, ctx) => {
      const d = dataset ?? datasets.data?.find((r) => r.id === v.dataset_id)
      if (!d) {
        ctx.addIssue({
          code: "custom",
          path: ["dataset_id"],
          message: T.selectDataset,
        })
        return
      }
      if (d.kind !== "compliance" && v.model_ids.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["model_ids"],
          message: T.modelRequired,
        })
      if (
        d.kind !== "brand_leak" &&
        d.kind !== "compliance" &&
        v.model_ids.length > 5
      )
        ctx.addIssue({
          code: "custom",
          path: ["model_ids"],
          message: T.modelLimit,
        })
    })
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { dataset_id: dataset?.id ?? "", model_ids: [] },
  })
  const selected =
    dataset ?? datasets.data?.find((r) => r.id === form.watch("dataset_id"))
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await EvaluationService.readModels()).data.items,
    enabled: !!selected && selected.kind !== "compliance",
  })
  const key = useRef({ payload: "", id: "" })
  const mutation = useMutation({
    mutationFn: async (v: Values) => {
      const baselines: ("lexicon_only" | "no_verification")[] =
        selected?.kind === "compliance"
          ? ["lexicon_only"]
          : selected?.kind === "factcheck"
            ? ["no_verification"]
            : []
      const body = {
        dataset_id: v.dataset_id,
        model_ids: selected?.kind === "compliance" ? [] : v.model_ids,
        baselines,
      }
      const payload = JSON.stringify(body)
      if (key.current.payload !== payload)
        key.current = { payload, id: crypto.randomUUID() }
      return (
        await EvaluationService.createRun({
          body,
          headers: { "idempotency-key": key.current.id },
        })
      ).data
    },
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.newRun}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <legend className="sr-only">{T.newRun}</legend>
            {dataset ? (
              <p className="text-sm">
                {dataset.name} · v{dataset.version} ·{" "}
                {label(EVAL_KIND_LABEL, dataset.kind)}
              </p>
            ) : (
              <div>
                <label htmlFor="run-dataset" className="text-sm font-medium">
                  {T.selectDataset}
                </label>
                <select
                  id="run-dataset"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  {...form.register("dataset_id")}
                >
                  <option value="">{T.selectDataset}</option>
                  {datasets.data?.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name} · v{row.version}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-destructive">
                  {form.formState.errors.dataset_id?.message}
                </p>
              </div>
            )}
            {datasets.isLoading && !dataset && (
              <Skeleton className="h-10 w-full" />
            )}
            {datasets.isError && !dataset && (
              <EvaluationError
                error={datasets.error}
                retry={() => datasets.refetch()}
              />
            )}
            {selected && (
              <p className="rounded-lg bg-surface p-3 text-sm">
                {selected.kind === "compliance"
                  ? T.baselineCompliance
                  : selected.kind === "factcheck"
                    ? T.baselineFactcheck
                    : T.baselineNone}
              </p>
            )}
            {selected && selected.kind !== "compliance" && (
              <div className="space-y-2">
                <p className="text-sm font-medium">{T.model}</p>
                {models.isLoading && <Skeleton className="h-16 w-full" />}
                {models.isError && (
                  <EvaluationError
                    error={models.error}
                    retry={() => models.refetch()}
                  />
                )}
                {models.data?.filter((m) => m.enabled).length === 0 && (
                  <EmptyState title={T.noModels} />
                )}{" "}
                {models.data
                  ?.filter((m) => m.enabled)
                  .map((m) => (
                    <label
                      key={m.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        value={m.id}
                        {...form.register("model_ids")}
                      />
                      {m.model_name}
                    </label>
                  ))}
                <p className="text-xs text-destructive">
                  {form.formState.errors.model_ids?.message}
                </p>
              </div>
            )}
          </fieldset>
          {mutation.isError && (
            <>
              <EvaluationError error={mutation.error} />
              {parseApiError(mutation.error).status === null && (
                <p className="text-sm text-muted-foreground">
                  {T.runNetworkHint}
                </p>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              disabled={
                !selected ||
                (selected.kind !== "compliance" && models.isLoading)
              }
            >
              {mutation.isPending ? T.creatingRun : T.newRun}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
