import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { Controller, useForm } from "react-hook-form"
import { z } from "zod"
import { type VoiceProfilePublic, VoiceProfileService } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
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
import { codePointCount } from "@/lib/count"
import { CATALOG_TEXT as T, VOICE_TABLE_TEXT as V } from "@/lib/zh"
import { ListField } from "./Fields"

const limits = {
  tone_keywords: 30,
  preferred_words: 100,
  forbidden_words: 100,
  sample_refs: 30,
} as const
const schema = z.object({
  persona: z
    .string()
    .trim()
    .min(1, T.personaRequired)
    .refine((v) => codePointCount(v) <= 2000, T.personaLimit),
  tone_keywords: z.array(z.string()).max(30, T.tooMany),
  preferred_words: z.array(z.string()).max(100, T.tooMany),
  forbidden_words: z.array(z.string()).max(100, T.tooMany),
  sample_refs: z.array(z.string()).max(30, T.tooMany),
})
export function VoiceForm({
  brandId,
  profile,
  onClose,
  onSaved,
}: {
  brandId: string
  profile?: VoiceProfilePublic
  onClose: () => void
  onSaved: (p: VoiceProfilePublic) => void
}) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      persona: profile?.persona ?? "",
      tone_keywords: profile?.tone_keywords ?? [],
      preferred_words: profile?.preferred_words ?? [],
      forbidden_words: profile?.forbidden_words ?? [],
      sample_refs: profile?.sample_refs ?? [],
    },
  })
  const mutation = useMutation({
    mutationFn: async (body: z.infer<typeof schema>) =>
      (
        await VoiceProfileService.profileCreateVersion({
          path: { brand_id: brandId },
          body,
        })
      ).data,
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="max-h-[85vh] overflow-y-auto rounded-xl border-0 p-6 sm:max-w-3xl"
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {profile ? V.editVersion : T.newVersion}
            {profile ? ` · v${profile.version}` : ""}
          </DialogTitle>
          <DialogDescription>{V.draftHint}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset
            className="space-y-4"
            disabled={mutation.isPending}
            onKeyDownCapture={(event) => {
              if (
                event.target instanceof HTMLInputElement &&
                event.nativeEvent.isComposing &&
                event.key === "Enter"
              )
                event.stopPropagation()
            }}
          >
            <legend className="sr-only">{T.voice}</legend>
            <div className="space-y-2">
              <label htmlFor="voice-persona">{T.persona}</label>
              <Textarea
                id="voice-persona"
                rows={5}
                {...form.register("persona")}
              />
              <div className="flex justify-between gap-2">
                <p className="text-xs text-destructive">
                  {form.formState.errors.persona?.message}
                </p>
                <CharCounter
                  value={codePointCount(form.watch("persona"))}
                  limit={2000}
                />
              </div>
            </div>
            {(Object.keys(limits) as (keyof typeof limits)[]).map((k) => (
              <div key={k}>
                <Controller
                  name={k}
                  control={form.control}
                  render={({ field }) => (
                    <ListField
                      id={`voice-${k}`}
                      title={T[k]}
                      value={field.value}
                      onChange={field.onChange}
                      limit={limits[k]}
                    />
                  )}
                />
                <p className="text-xs text-destructive">
                  {form.formState.errors[k]?.message}
                </p>
                {k === "forbidden_words" && (
                  <p className="text-xs text-muted-foreground">
                    {T.forbiddenHint}
                  </p>
                )}
              </div>
            ))}
          </fieldset>
          <p className="text-xs text-muted-foreground">{V.listHint}</p>
          {mutation.isError && <BrandError error={mutation.error} />}
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
              {V.saveAsNew}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
