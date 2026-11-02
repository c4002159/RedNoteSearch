import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { type DatasetPublic, EvaluationService } from "@/client"
import { FilterSelect } from "@/components/Common/FilterSelect"
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
import useAuth from "@/hooks/useAuth"
import { useBrand } from "@/hooks/useBrand"
import { codePointCount } from "@/lib/count"
import {
  EVAL_CASE_HINT,
  EVAL_EXAMPLES,
  EVAL_KIND_LABEL,
  EVAL_TEXT as T,
} from "@/lib/zh"
import { EvaluationError } from "./shared"

const casesSchema = z
  .array(
    z.object({
      input: z.record(z.string(), z.unknown()),
      expected: z.record(z.string(), z.unknown()).optional(),
      annotators: z.array(z.string()).optional(),
    }),
  )
  .min(1)
  .max(200)
const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, T.nameRequired)
      .refine((v) => codePointCount(v) <= 100, T.nameLimit),
    kind: z.enum(["compliance", "factcheck", "generation", "brand_leak"]),
    scope: z.enum(["brand", "global"]),
    json: z.string().refine((v) => {
      try {
        return casesSchema.safeParse(JSON.parse(v)).success
      } catch {
        return false
      }
    }, T.invalidJson),
  })
  .refine((v) => !(v.kind === "brand_leak" && v.scope === "global"), {
    path: ["scope"],
    message: T.newScope,
  })
type Values = z.infer<typeof schema>
export function CreateDataset({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (row: DatasetPublic) => void
}) {
  const brand = useBrand(),
    { user } = useAuth()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      kind: "compliance",
      scope: "brand",
      json: JSON.stringify(EVAL_EXAMPLES.compliance, null, 2),
    },
  })
  const mutation = useMutation({
    mutationFn: async (v: Values) =>
      (
        await EvaluationService.createDataset({
          body: {
            name: v.name,
            kind: v.kind,
            brand_id: v.scope === "global" ? null : brand.current!.id,
            cases: casesSchema.parse(JSON.parse(v.json)),
          },
        })
      ).data,
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto rounded-xl border-0 p-6 sm:max-w-3xl"
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.newDataset}</DialogTitle>
          <DialogDescription>
            {T.immutable} {T.newScope}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset className="space-y-5" disabled={mutation.isPending}>
            <legend className="sr-only">{T.newDataset}</legend>
            <div>
              <label className="text-sm font-medium" htmlFor="dataset-name">
                {T.name}
              </label>
              <Input id="dataset-name" {...form.register("name")} />
              <p className="text-xs text-destructive">
                {form.formState.errors.name?.message}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <FilterSelect
                  title={T.kind}
                  value={form.watch("kind")}
                  onChange={(value) => {
                    form.setValue("kind", value as Values["kind"], {
                      shouldValidate: true,
                    })
                    if (value === "brand_leak") form.setValue("scope", "brand")
                  }}
                  options={Object.entries(EVAL_KIND_LABEL).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
              </div>
              <div>
                <FilterSelect
                  title={T.scope}
                  value={form.watch("scope")}
                  onChange={(value) =>
                    form.setValue("scope", value as Values["scope"], {
                      shouldValidate: true,
                    })
                  }
                  options={[
                    { value: "brand", label: T.brand },
                    ...(user?.is_superuser &&
                    form.watch("kind") !== "brand_leak"
                      ? [{ value: "global", label: T.global }]
                      : []),
                  ]}
                />

                <p className="text-xs text-destructive">
                  {form.formState.errors.scope?.message}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="dataset-json" className="text-sm font-medium">
                  {T.json}
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    form.setValue(
                      "json",
                      JSON.stringify(
                        EVAL_EXAMPLES[form.getValues("kind")],
                        null,
                        2,
                      ),
                      { shouldValidate: true },
                    )
                  }
                >
                  {T.useExample}
                </Button>
              </div>
              <Textarea
                id="dataset-json"
                rows={10}
                className="font-mono text-xs"
                {...form.register("json")}
              />
              <p className="text-xs text-muted-foreground">{T.jsonHint}</p>
              <p className="text-xs text-muted-foreground">
                {EVAL_CASE_HINT[form.watch("kind")]}
              </p>
              <p className="text-xs text-destructive">
                {form.formState.errors.json?.message}
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
      </DialogContent>
    </Dialog>
  )
}
