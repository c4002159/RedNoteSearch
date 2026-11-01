import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { type ViralSamplePublic, ViralService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Textarea } from "@/components/ui/textarea"
import { codePointCount } from "@/lib/count"
import { VIRAL_TEXT as T } from "@/lib/zh"
import { ViralError } from "./Feedback"

const limited = (n: number) =>
  z.string().refine((v) => codePointCount(v) <= n, T.tooLong)
const schema = z.object({
  text: limited(5000).refine((v) => !!v.trim(), T.required),
  note: limited(1000),
  source_url: limited(2000).refine((v) => {
    if (!v) return true
    try {
      return ["http:", "https:"].includes(new URL(v).protocol)
    } catch {
      return false
    }
  }, T.urlInvalid),
})
type Values = z.infer<typeof schema>
export function AddSample({
  brandId,
  onClose,
  onSaved,
}: {
  brandId: string
  onClose: () => void
  onSaved: (row: ViralSamplePublic) => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { text: "", note: "", source_url: "" },
  })
  const mutation = useMutation({
    mutationFn: async (values: Values) =>
      (
        await ViralService.createSample({
          path: { brand_id: brandId },
          body: {
            ...values,
            note: values.note || null,
            source_url: values.source_url || null,
          },
        })
      ).data,
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.add}</DialogTitle>
          <DialogDescription>{T.immutable}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <legend className="sr-only">{T.add}</legend>
            {(
              [
                ["text", T.text, 5000],
                ["note", T.note, 1000],
                ["source_url", T.source, 2000],
              ] as const
            ).map(([key, title, limit]) => (
              <div key={key} className="space-y-1">
                <label htmlFor={`viral-${key}`} className="text-sm font-medium">
                  {title}
                </label>
                {key === "source_url" ? (
                  <Input
                    id={`viral-${key}`}
                    {...form.register(key)}
                    aria-invalid={!!form.formState.errors[key]}
                  />
                ) : (
                  <Textarea
                    id={`viral-${key}`}
                    rows={key === "text" ? 8 : 2}
                    {...form.register(key)}
                    aria-invalid={!!form.formState.errors[key]}
                  />
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-xs text-destructive">
                    {form.formState.errors[key]?.message}
                  </span>
                  <CharCounter
                    value={codePointCount(form.watch(key))}
                    limit={limit}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          {mutation.isError && <ViralError error={mutation.error} />}
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
