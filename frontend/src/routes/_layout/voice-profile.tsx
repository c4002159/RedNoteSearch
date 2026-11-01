import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import { toast } from "sonner"
import { type VoiceProfilePublic, VoiceProfileService } from "@/client"
import { BrandConfirm, BrandError } from "@/components/Brands/Feedback"
import { CatalogGuard } from "@/components/Catalog/Fields"
import { VoiceForm } from "@/components/Catalog/VoiceForm"
import { EmptyState } from "@/components/Common/EmptyState"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { formatTime } from "@/lib/format"
import { CATALOG_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/voice-profile")({
  component: () => (
    <CatalogGuard>
      <VoicePage />
    </CatalogGuard>
  ),
  head: () => ({ meta: [{ title: `${T.voice} - RedNoteSearch` }] }),
})
function VoicePage() {
  const brand = useBrand(),
    id = brand.current!.id,
    cache = useQueryClient()
  const [version, setVersion] = useState<number | null>(null),
    [creating, setCreating] = useState(false),
    [activate, setActivate] = useState<VoiceProfilePublic | null>(null)
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
  const active = useQuery({
    queryKey: ["catalog-voice-active", id],
    queryFn: async ({ signal }) =>
      (
        await VoiceProfileService.profileReadActiveProfile({
          path: { brand_id: id },
          signal,
        })
      ).data,
    retry: (n, e) =>
      n < 1 && ![401, 403, 404].includes(parseApiError(e).status ?? 0),
  })
  const selected =
    versions.data?.find(
      (v) => v.version === (version ?? active.data?.version),
    ) ?? versions.data?.[0]
  const mutation = useMutation({
    mutationFn: () =>
      VoiceProfileService.profileActivateVersion({
        path: { brand_id: id, version: activate!.version },
      }),
    onSuccess: () => {
      setActivate(null)
      toast.success(T.saved)
      void cache.invalidateQueries({ queryKey: ["catalog-voice-versions", id] })
      void cache.invalidateQueries({ queryKey: ["catalog-voice-active", id] })
    },
  })
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.voice}</h1>
          <p className="text-sm text-muted-foreground">{T.voiceHint}</p>
        </div>
        {brand.isAdmin && (
          <Button onClick={() => setCreating(true)}>
            {selected ? T.basedOn : T.newVersion}
          </Button>
        )}
      </div>
      {(versions.isLoading || active.isLoading) && (
        <Skeleton className="h-40 w-full" />
      )}
      {versions.isError && (
        <BrandError error={versions.error} retry={() => versions.refetch()} />
      )}{" "}
      {active.isError && parseApiError(active.error).status !== 404 && (
        <BrandError error={active.error} retry={() => active.refetch()} />
      )}{" "}
      {active.isError &&
        parseApiError(active.error).status === 404 &&
        !!versions.data?.length && (
          <p className="rounded-lg bg-surface p-3 text-sm">{T.noActive}</p>
        )}
      {versions.data &&
        !versions.isError &&
        (versions.data.length === 0 ? (
          <EmptyState title={T.noVoice} />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <ul className="space-y-3">
              {versions.data.map((p) => (
                <li
                  key={p.version}
                  className="space-y-2 rounded-xl border bg-card p-4"
                >
                  <Button
                    variant={
                      selected?.version === p.version ? "secondary" : "ghost"
                    }
                    onClick={() => setVersion(p.version)}
                  >
                    {T.version} v{p.version}
                  </Button>
                  <Pill tone={p.is_active ? "info" : "gray"}>
                    {p.is_active ? T.inUse : T.inactive}
                  </Pill>
                  <p className="text-xs text-muted-foreground">
                    {T.created}：{formatTime(p.created_at)}
                  </p>
                  {brand.isAdmin && !p.is_active && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        mutation.reset()
                        setActivate(p)
                      }}
                    >
                      {T.activate}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {selected && (
              <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
                <h2 className="font-semibold">
                  {T.version} v{selected.version}
                </h2>
                <h3 className="text-sm font-medium">{T.persona}</h3>
                <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                  {selected.persona}
                </p>
                {(
                  [
                    "tone_keywords",
                    "preferred_words",
                    "forbidden_words",
                    "sample_refs",
                  ] as const
                ).map((k) => (
                  <div key={k} className="space-y-2">
                    <h3 className="text-sm font-medium">{T[k]}</h3>
                    {selected[k].length === 0 ? (
                      <p className="text-sm text-muted-foreground">{T.none}</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {selected[k].map((s, i) => (
                          <li
                            key={i}
                            className="whitespace-pre-wrap [overflow-wrap:anywhere]"
                          >
                            {s}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </section>
            )}
          </div>
        ))}
      {brand.isAdmin && creating && (
        <VoiceForm
          brandId={id}
          profile={selected}
          onClose={() => setCreating(false)}
          onSaved={(p) => {
            setCreating(false)
            setVersion(p.version)
            toast.success(T.saved)
            void cache.invalidateQueries({
              queryKey: ["catalog-voice-versions", id],
            })
          }}
        />
      )}{" "}
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
