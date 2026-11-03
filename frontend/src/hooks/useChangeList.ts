import { useCallback, useRef, useState } from "react"
import { z } from "zod"

const targetSchema = z.enum(["titles", "opening", "body", "cover", "hashtags"])
const itemSchema = z.object({
  id: z.string(),
  source: z.enum(["risk", "request", "evidence"]),
  target: targetSchema,
  sourceId: z.string().optional(),
  matched_text: z.string().optional(),
  suggestion: z.string().optional(),
  instruction: z.string().optional(),
})
const draftSchema = z.object({
  title_candidates: z.array(z.string()),
  body: z.string(),
  hashtags: z.array(z.string()),
  cover_candidates: z.array(z.string()),
})
const stateSchema = z.object({
  items: z.array(itemSchema),
  draft: draftSchema.nullable(),
  note: z.string(),
  dismissedEvidence: z.array(z.string()),
  failure: z
    .object({
      message: z.string(),
      requestId: z.string().nullable(),
      status: z.number().nullable(),
    })
    .nullable(),
})
export type ChangeItem = z.infer<typeof itemSchema>
export type ChangeDraft = z.infer<typeof draftSchema>
export type ChangeListState = z.infer<typeof stateSchema>
const memory = new Map<string, ChangeListState>()
export const changeListKey = (versionId: string) =>
  `rednote:change-list:${versionId}`
export const emptyChangeList = (): ChangeListState => ({
  items: [],
  draft: null,
  note: "",
  dismissedEvidence: [],
  failure: null,
})
export function saveChangeList(versionId: string, state: ChangeListState) {
  memory.set(versionId, state)
  try {
    localStorage.setItem(changeListKey(versionId), JSON.stringify(state))
  } catch {
    /* Browsing can continue without storage. */
  }
}
function readChangeList(versionId: string): ChangeListState {
  try {
    const raw = localStorage.getItem(changeListKey(versionId))
    if (raw) {
      const parsed = stateSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    }
  } catch {
    /* Unavailable storage or corrupt data must not break the result page. */
  }
  return memory.get(versionId) ?? emptyChangeList()
}
export function useChangeList(versionId: string) {
  const [state, setState] = useState(() => readChangeList(versionId))
  const current = useRef(state)
  const update = useCallback(
    (transform: (value: ChangeListState) => ChangeListState) => {
      const next = transform(current.current)
      current.current = next
      saveChangeList(versionId, next)
      setState(next)
    },
    [versionId],
  )
  const add = (items: ChangeItem[]) =>
    update((value) => ({
      ...value,
      items: [
        ...value.items.filter(
          (old) => !items.some((item) => item.id === old.id),
        ),
        ...items,
      ],
    }))
  const remove = (id: string) =>
    update((value) => ({
      ...value,
      items: value.items.filter((item) => item.id !== id),
      dismissedEvidence:
        value.items.find((item) => item.id === id)?.source === "evidence"
          ? [...new Set([...value.dismissedEvidence, id])]
          : value.dismissedEvidence,
    }))
  const syncEvidence = useCallback(
    (items: ChangeItem[]) =>
      update((value) => {
        const dismissedEvidence = value.dismissedEvidence.filter((id) =>
          items.some((item) => item.id === id),
        )
        const next = [
          ...value.items.filter((item) => item.source !== "evidence"),
          ...items.filter((item) => !dismissedEvidence.includes(item.id)),
        ]
        return { ...value, items: next, dismissedEvidence }
      }),
    [update],
  )
  return {
    state,
    update,
    add,
    remove,
    syncEvidence,
    clear: () => update(emptyChangeList),
  }
}
