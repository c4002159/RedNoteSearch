import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { type ScenarioPublic, ViralService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import {
  VIRAL_TEMPLATE_EDIT_TEXT as E,
  PAGE_ERROR_TEXT,
  SCENE_LABEL,
  VIRAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, T.nameRequired)
    .refine((v) => codePointCount(v) <= 100, T.tooLong),
  scene: z.enum([
    "seeding",
    "review",
    "tutorial",
    "launch",
    "promotion",
    "story",
  ]),
  structure: z
    .string()
    .trim()
    .min(1, E.required)
    .refine((v) => codePointCount(v) <= 2000, E.tooLong),
})
type Values = z.infer<typeof schema>
export function ConvertDialog({
  id,
  structure,
  onClose,
  onSaved,
}: {
  id: string
  structure: string
  onClose: () => void
  onSaved: (r: ScenarioPublic) => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: T.defaultName, scene: "seeding", structure },
  })
  const mutation = useMutation({
    mutationFn: async (
      body: Values & { on_name_conflict: "reject" | "new_version" },
    ) =>
      (await ViralService.convertPattern({ path: { pattern_id: id }, body }))
        .data,
    onSuccess: onSaved,
  })
  const error = mutation.isError ? parseApiError(mutation.error) : null
  const conflict = error?.status === 409
  const structureLength = codePointCount(form.watch("structure"))
  const submit = (on_name_conflict: "reject" | "new_version") =>
    form.handleSubmit((values) =>
      mutation.mutate({ ...values, on_name_conflict }),
    )
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-xl border-0 p-6 sm:max-w-2xl"
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.convert}</DialogTitle>
          <DialogDescription>
            {T.convertHint} {V.convertVersion}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={submit("reject")}>
          <fieldset className="space-y-5" disabled={mutation.isPending}>
            <legend className="sr-only">{T.convert}</legend>
            <div className="space-y-1">
              <label htmlFor="template-name" className="text-sm font-medium">
                {T.name}
              </label>
              <Input
                id="template-name"
                {...form.register("name", {
                  onChange: () => {
                    if (conflict) mutation.reset()
                  },
                })}
                aria-invalid={!!form.formState.errors.name}
              />
              <p className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{T.scene}</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {Object.entries(SCENE_LABEL).map(([k, v]) => (
                  <label
                    key={k}
                    className="flex cursor-pointer items-center gap-3 rounded-xl bg-surface-low p-4 text-sm has-checked:bg-primary/10 has-checked:text-link has-checked:ring-1 has-checked:ring-primary"
                  >
                    <input
                      type="radio"
                      value={k}
                      {...form.register("scene")}
                      className="accent-primary"
                    />
                    {v}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-2">
              <label
                htmlFor="template-structure"
                className="text-sm font-medium"
              >
                {E.structure}
              </label>
              <Textarea
                id="template-structure"
                rows={8}
                {...form.register("structure")}
                aria-invalid={!!form.formState.errors.structure}
              />
              <div className="flex justify-between gap-3">
                <p className="text-xs text-destructive">
                  {form.formState.errors.structure?.message}
                </p>
                <CharCounter value={structureLength} limit={2000} />
              </div>
              <p className="text-xs text-muted-foreground">{E.hint}</p>
            </div>
          </fieldset>
          {error && (
            <ErrorBanner
              error={{
                ...error,
                message: conflict
                  ? E.conflict
                  : /[\u3400-\u9fff]/.test(error.message)
                    ? error.message
                    : (PAGE_ERROR_TEXT.status[error.status ?? 0] ??
                      PAGE_ERROR_TEXT.failed),
              }}
            />
          )}
          {conflict && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  mutation.reset()
                  form.setFocus("name", { shouldSelect: true })
                }}
              >
                {E.rename}
              </Button>
              <Button
                type="button"
                disabled={structureLength > 2000}
                onClick={submit("new_version")}
              >
                {E.newVersion}
              </Button>
            </div>
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
              disabled={conflict || structureLength > 2000}
            >
              {T.convert}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
