import { CharCounter } from "@/components/Common/CharCounter"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import type {
  ChangeDraft,
  ChangeItem,
  ChangeListState,
} from "@/hooks/useChangeList"
import { codePointCount } from "@/lib/count"
import { R7_CHANGELIST_TEXT as T } from "@/lib/zh"

export const draftFields = {
  titles: "title_candidates",
  body: "body",
  cover: "cover_candidates",
  hashtags: "hashtags",
} as const
export function manualTargets(
  original: ChangeDraft,
  draft: ChangeDraft | null,
) {
  return draft
    ? (Object.keys(draftFields) as (keyof typeof draftFields)[]).filter(
        (target) =>
          JSON.stringify(original[draftFields[target]]) !==
          JSON.stringify(draft[draftFields[target]]),
      )
    : []
}
export function ChangeList({
  state,
  original,
  pending,
  onRemove,
  onRemoveManual,
  onNote,
}: {
  state: ChangeListState
  original: ChangeDraft
  pending: boolean
  onRemove: (id: string) => void
  onRemoveManual: (target: keyof typeof draftFields) => void
  onNote: (note: string) => void
}) {
  const manual = manualTargets(original, state.draft)
  const groups = ["titles", "body", "cover", "hashtags"] as const
  const content = (item: ChangeItem) =>
    item.source === "risk"
      ? `${item.matched_text}：${item.suggestion}`
      : item.instruction
  return (
    <section className="space-y-4" aria-label={T.title}>
      <h3 className="font-semibold">{T.title}</h3>
      {!state.items.length && !manual.length && (
        <p className="text-sm text-muted-foreground">{T.empty}</p>
      )}
      {groups.map((target) => {
        const items = state.items.filter(
          (item) =>
            item.target === target ||
            (target === "body" && item.target === "opening"),
        )
        const hasManual = manual.includes(target)
        if (!items.length && !hasManual) return null
        return (
          <section
            key={target}
            aria-label={`${T.parts[target]}${T.title}`}
            className="space-y-2"
          >
            <h4 className="text-sm font-semibold">{T.parts[target]}</h4>
            <ul className="space-y-2">
              {hasManual && state.draft && (
                <li className="rounded-lg bg-surface-low p-3 text-sm">
                  <details>
                    <summary className="cursor-pointer">
                      {T.manualSummary(T.parts[target])}
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-xs">
                      {Array.isArray(state.draft[draftFields[target]])
                        ? (state.draft[draftFields[target]] as string[]).join(
                            "\n",
                          )
                        : state.draft.body}
                    </pre>
                  </details>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => onRemoveManual(target)}
                  >
                    {T.remove}
                  </Button>
                </li>
              )}
              {items.map((item) => (
                <li
                  key={item.id}
                  className="rounded-lg bg-surface-low p-3 text-sm"
                >
                  <details>
                    <summary className="cursor-pointer">
                      {item.source === "risk"
                        ? T.suggestion
                        : item.source === "evidence"
                          ? T.evidence
                          : T.requirement}
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words text-xs">
                      {content(item)}
                    </p>
                  </details>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`${T.remove}：${content(item) || T.parts[target]}`}
                    onClick={() => onRemove(item.id)}
                  >
                    {T.remove}
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <div className="space-y-1">
        <label htmlFor="change-list-note" className="text-sm font-medium">
          {T.note}
        </label>
        <Textarea
          id="change-list-note"
          value={state.note}
          disabled={pending}
          rows={3}
          onChange={(e) => onNote(e.target.value)}
        />
        <CharCounter value={codePointCount(state.note)} limit={500} />
        <p className="text-xs text-muted-foreground">{T.noteHint}</p>
      </div>
    </section>
  )
}
