import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Check } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { type VoiceProfilePublic, VoiceProfileService } from "@/client"
import { BrandConfirm, BrandError } from "@/components/Brands/Feedback"
import { CatalogGuard } from "@/components/Catalog/Fields"
import { VoiceForm } from "@/components/Catalog/VoiceForm"
import { EmptyState } from "@/components/Common/EmptyState"
import { LoadingState } from "@/components/Common/LoadingState"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import { codePointCount } from "@/lib/count"
import { formatTime } from "@/lib/format"
import { CATALOG_TEXT as T, VOICE_TABLE_TEXT as V } from "@/lib/zh"

export const Route = createFileRoute("/_layout/voice-profile")({
  component: () => (
    <CatalogGuard>
      <VoicePage />
    </CatalogGuard>
  ),
  head: () => ({ meta: [{ title: `${T.voice} - RedNoteSearch` }] }),
})
const listFields = [
  "tone_keywords",
  "preferred_words",
  "forbidden_words",
  "sample_refs",
] as const
type ListField = (typeof listFields)[number]
type Detail = {
  version: number
  field: "persona" | ListField
  values: string[]
}
const tones = {
  tone_keywords: "info",
  preferred_words: "ok",
  forbidden_words: "err",
  sample_refs: "gray",
} as const

function VoicePage() {
  const brand = useBrand(),
    id = brand.current!.id,
    cache = useQueryClient()
  const [editing, setEditing] = useState<VoiceProfilePublic | "new" | null>(
    null,
  )
  const [activate, setActivate] = useState<VoiceProfilePublic | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const versions = useQuery({
    queryKey: ["catalog-voice-versions", id],
    queryFn: async ({ signal }) =>
      (
        await VoiceProfileService.profileReadVersions({
          path: { brand_id: id },
          signal,
        })
      ).data.items,
  })
  const refresh = () => {
    void cache.invalidateQueries({ queryKey: ["catalog-voice-versions", id] })
    void cache.invalidateQueries({ queryKey: ["catalog-voice-active", id] })
  }
  const mutation = useMutation({
    mutationFn: () =>
      VoiceProfileService.profileActivateVersion({
        path: { brand_id: id, version: activate!.version },
      }),
    onSuccess: () => {
      setActivate(null)
      toast.success(T.saved)
      refresh()
    },
  })
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.voice}</h1>
          <p className="text-sm text-muted-foreground">{T.voiceHint}</p>
        </div>
        {brand.isAdmin && (
          <Button onClick={() => setEditing("new")}>{T.newVersion}</Button>
        )}
      </div>
      {versions.isLoading && <LoadingState className="h-40 w-full" />}
      {versions.isError && (
        <BrandError error={versions.error} retry={() => versions.refetch()} />
      )}
      {versions.data &&
        !versions.isError &&
        (versions.data.length === 0 ? (
          <EmptyState title={T.noVoice} />
        ) : (
          <>
            {!versions.data.some((row) => row.is_active) && (
              <p className="rounded-lg bg-surface-low p-4 text-sm">
                {T.noActive}
              </p>
            )}
            <div className="min-w-0 overflow-x-auto rounded-xl bg-card shadow-sm">
              <Table className="w-full min-w-[58rem] table-fixed [&_thead]:bg-surface-low [&_tr]:border-surface">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">{V.version}</TableHead>
                    <TableHead className="w-28">{T.created}</TableHead>
                    <TableHead>{T.persona}</TableHead>
                    {listFields.map((field) => (
                      <TableHead key={field}>
                        {field === "sample_refs" ? V.samples : T[field]}
                      </TableHead>
                    ))}
                    <TableHead className="w-14 text-center">
                      {V.available}
                    </TableHead>
                    <TableHead className="w-24 text-right">
                      {V.actions}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {versions.data.map((row) => (
                    <TableRow key={row.version}>
                      <TableCell className="align-top font-medium">
                        v{row.version}
                      </TableCell>
                      <TableCell className="whitespace-normal align-top text-xs text-muted-foreground">
                        {formatTime(row.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-normal align-top">
                        <button
                          type="button"
                          className="text-left text-sm text-link hover:underline [overflow-wrap:anywhere]"
                          aria-label={`v${row.version} · ${V.viewPersona}`}
                          onClick={() =>
                            setDetail({
                              version: row.version,
                              field: "persona",
                              values: [row.persona],
                            })
                          }
                        >
                          {codePointCount(row.persona) > 20
                            ? `${Array.from(row.persona).slice(0, 20).join("")}…`
                            : row.persona || T.none}
                        </button>
                      </TableCell>
                      {listFields.map((field) => (
                        <TableCell
                          key={field}
                          className="whitespace-normal align-top"
                        >
                          {row[field].length === 0 ? (
                            <span className="text-muted-foreground">
                              {T.none}
                            </span>
                          ) : (
                            <button
                              type="button"
                              className="flex w-full min-w-0 flex-wrap gap-1.5 rounded-lg text-left focus-visible:outline-ring"
                              aria-label={`v${row.version} · ${V.viewAll}${T[field]}`}
                              onClick={() =>
                                setDetail({
                                  version: row.version,
                                  field,
                                  values: row[field],
                                })
                              }
                            >
                              {row[field].slice(0, 3).map((item, index) => (
                                <Pill
                                  key={index}
                                  tone={tones[field]}
                                  className="max-w-full"
                                >
                                  <span className="block truncate">{item}</span>
                                </Pill>
                              ))}
                              {row[field].length > 3 && (
                                <span className="rounded-full bg-surface-low px-2 py-0.5 text-xs text-link">
                                  +{row[field].length - 3}
                                </span>
                              )}
                            </button>
                          )}
                        </TableCell>
                      ))}
                      <TableCell className="align-top text-center">
                        {row.is_active ? (
                          <span className="inline-flex rounded-full bg-tone-info-bg p-1 text-primary">
                            <Check aria-hidden="true" className="size-4" />
                            <span className="sr-only">{T.inUse}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-right">
                        {brand.isAdmin ? (
                          <div className="flex flex-col items-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-link"
                              onClick={() => setEditing(row)}
                            >
                              {T.edit}
                            </Button>
                            {!row.is_active && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-link"
                                onClick={() => {
                                  mutation.reset()
                                  setActivate(row)
                                }}
                              >
                                {T.activate}
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {V.readonly}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ))}
      {detail && (
        <Dialog open onOpenChange={(open) => !open && setDetail(null)}>
          <DialogContent className="max-h-[85vh] overflow-y-auto rounded-xl border-0 sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {T.version} v{detail.version} · {T[detail.field]}
              </DialogTitle>
              <DialogDescription>{V.fullContent}</DialogDescription>
            </DialogHeader>
            <ul className="space-y-3">
              {detail.values.map((item, index) => (
                <li
                  key={index}
                  className="whitespace-pre-wrap rounded-lg bg-surface-low p-4 text-sm leading-7 [overflow-wrap:anywhere]"
                >
                  {item}
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetail(null)}>
                {V.close}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {brand.isAdmin && editing && (
        <VoiceForm
          key={editing === "new" ? "new" : editing.version}
          brandId={id}
          profile={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            toast.success(T.saved)
            refresh()
          }}
        />
      )}
      {brand.isAdmin && activate && (
        <BrandConfirm
          title={`${T.activate} v${activate.version}`}
          description={T.activateHint}
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setActivate(null)}
          onConfirm={() => mutation.mutate()}
        />
      )}
    </div>
  )
}
