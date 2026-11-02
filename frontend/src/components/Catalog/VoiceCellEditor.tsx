import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
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

export type VoiceCell =
  | "persona"
  | "tone_keywords"
  | "preferred_words"
  | "forbidden_words"
  | "sample_refs"

const LIMITS = {
  tone_keywords: 30,
  preferred_words: 100,
  forbidden_words: 100,
  sample_refs: 30,
} as const
const PERSONA_LIMIT = 2000

// 点表格里的一格，只改这一格：保存时连同其余各格一起提交，生成新版本，原版本不动。
export function VoiceCellEditor({
  brandId,
  profile,
  field,
  editable,
  onClose,
  onSaved,
}: {
  brandId: string
  profile: VoiceProfilePublic
  field: VoiceCell
  editable: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [persona, setPersona] = useState(profile.persona)
  const [list, setList] = useState<string[]>(
    field === "persona" ? [] : profile[field],
  )
  const save = useMutation({
    mutationFn: async () =>
      (
        await VoiceProfileService.profileCreateVersion({
          path: { brand_id: brandId },
          body: {
            persona: field === "persona" ? persona.trim() : profile.persona,
            tone_keywords: profile.tone_keywords,
            preferred_words: profile.preferred_words,
            forbidden_words: profile.forbidden_words,
            sample_refs: profile.sample_refs,
            ...(field === "persona" ? {} : { [field]: list }),
          },
        })
      ).data,
    onSuccess: onSaved,
  })
  const personaLength = codePointCount(persona)
  const valid =
    field === "persona"
      ? persona.trim().length > 0 && personaLength <= PERSONA_LIMIT
      : true
  const changed =
    field === "persona"
      ? persona.trim() !== profile.persona
      : JSON.stringify(list) !== JSON.stringify(profile[field])
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent
        showCloseButton={!save.isPending}
        className="max-h-[85vh] overflow-y-auto rounded-xl border-0 p-6 sm:max-w-2xl"
        onEscapeKeyDown={(e) => save.isPending && e.preventDefault()}
        onInteractOutside={(e) => save.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {T.version} v{profile.version} ·{" "}
            {field === "sample_refs" ? V.samples : T[field]}
          </DialogTitle>
          <DialogDescription>
            {editable ? V.draftHint : V.fullContent}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (editable && valid && changed) save.mutate()
          }}
        >
          <fieldset className="space-y-3" disabled={save.isPending}>
            {field === "persona" ? (
              <div className="space-y-2">
                <Textarea
                  aria-label={T.persona}
                  rows={12}
                  autoFocus
                  readOnly={!editable}
                  value={persona}
                  onChange={(e) => setPersona(e.target.value)}
                />
                <div className="flex justify-end">
                  <CharCounter value={personaLength} limit={PERSONA_LIMIT} />
                </div>
              </div>
            ) : editable ? (
              <>
                <ListField
                  id={`cell-${field}`}
                  title={field === "sample_refs" ? V.samples : T[field]}
                  value={list}
                  onChange={setList}
                  limit={LIMITS[field]}
                />
                {field === "forbidden_words" && (
                  <p className="text-xs text-muted-foreground">
                    {T.forbiddenHint}
                  </p>
                )}
              </>
            ) : (
              <ul className="space-y-2">
                {list.map((item, index) => (
                  <li
                    key={index}
                    className="whitespace-pre-wrap rounded-lg bg-surface-low p-3 text-sm [overflow-wrap:anywhere]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
          {save.isError && <BrandError error={save.error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={onClose}
            >
              {editable ? T.cancel : V.close}
            </Button>
            {editable && (
              <LoadingButton
                type="submit"
                loading={save.isPending}
                disabled={!valid || !changed}
              >
                {V.saveAsNew}
              </LoadingButton>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
