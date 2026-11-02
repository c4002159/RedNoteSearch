import { useMutation, useQuery } from "@tanstack/react-query"
import { type ReactNode, useEffect, useRef } from "react"
import { ToneService } from "@/client"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage, MissingPage } from "@/components/Common/ForbiddenPage"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { parseApiError } from "@/lib/apiError"
import { toneKey, uniqueTones } from "@/lib/toneKey"
import { TONE_DIALOG_TEXT as T } from "@/lib/zh"

function ToneError({
  error,
  model = false,
  retry,
}: {
  error: unknown
  model?: boolean
  retry?: () => void
}) {
  const info = parseApiError(error)
  if (info.status === 403) return <ForbiddenPage requestId={info.requestId} />
  if (info.status === 404) return <MissingPage requestId={info.requestId} />
  const message =
    model && info.status === 503
      ? T.unavailable
      : model &&
          info.status === 422 &&
          ["TONE_NO_VALID_SUGGESTIONS", "TONE_INVALID_MODEL_OUTPUT"].includes(
            info.code,
          )
        ? T.noValid
        : /[\u3400-\u9fff]/u.test(info.message)
          ? info.message
          : T.failed
  return (
    <ErrorBanner error={{ ...info, message, details: {} }} onRetry={retry} />
  )
}

function Group({
  title,
  children,
  hint,
}: {
  title: string
  children: ReactNode
  hint?: string
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

function Choice({
  tone,
  detail,
  onUse,
}: {
  tone: string
  detail: ReactNode
  onUse: (tone: string) => void
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-surface-low p-3">
      <div className="min-w-0 space-y-1">
        <span className="inline-block max-w-full break-words rounded-lg bg-card px-2 py-1 text-sm font-medium text-primary">
          {tone}
        </span>
        <div className="break-words text-xs leading-relaxed text-muted-foreground">
          {detail}
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="shrink-0 text-link"
        aria-label={T.useTone(tone)}
        onClick={() => onUse(tone)}
      >
        {T.use}
      </Button>
    </div>
  )
}

function monthDay(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function engagement(value: number, approximate: boolean) {
  const number =
    value >= 10000
      ? `${Number((value / 10000).toFixed(1))}${T.tenThousand}`
      : value.toLocaleString("zh-CN", { maximumFractionDigits: 1 })
  return `${approximate ? T.approximately : ""}${number}`
}

export function ToneSuggestDialog({
  brandId,
  scene,
  productId,
  onClose,
  onUse,
}: {
  brandId: string
  scene?: string
  productId?: string
  onClose: () => void
  onUse: (tone: string) => void
}) {
  const shown = useRef(new Map<string, string>())
  const list = useQuery({
    queryKey: ["tone-suggestions", brandId, scene ?? ""],
    queryFn: async ({ signal }) =>
      (
        await ToneService.readToneSuggestions({
          path: { brand_id: brandId },
          query: { ...(scene ? { scene } : {}) },
          signal,
        })
      ).data,
  })
  const model = useMutation({
    mutationFn: async () =>
      (
        await ToneService.generateToneSuggestions({
          path: { brand_id: brandId },
          body: {
            ...(scene ? { scene } : {}),
            ...(productId ? { product_id: productId } : {}),
            count: 5,
            exclude: [...shown.current.values()].slice(-30),
          },
        })
      ).data,
    retry: false,
  })
  const data = list.data
  const history = uniqueTones(data?.history ?? [])
  const template = uniqueTones(data?.template ?? [])
  const results = uniqueTones(data?.results.items ?? [])
  const modelItems = uniqueTones(model.data?.items ?? [])
  useEffect(() => {
    const items = [
      ...(data?.history ?? []),
      ...(data?.template ?? []),
      ...(data?.results.enough_data ? data.results.items : []),
      ...(model.data?.items ?? []),
    ]
    for (const { tone } of uniqueTones(items)) {
      // Backend limits exclude entries to 1–40 Unicode code points.
      const value = [...tone.trim()].slice(0, 40).join("")
      const key = toneKey(value)
      if (key) shown.current.set(key, value)
    }
  }, [data, model.data])
  const allEmpty =
    data &&
    !history.length &&
    !template.length &&
    (!data.results.enough_data || !results.length)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{T.title}</DialogTitle>
          <DialogDescription>{T.description}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto pr-1">
          <p className="rounded-lg bg-surface-low p-3 text-xs leading-relaxed text-muted-foreground">
            {T.sceneHint}
          </p>
          {list.isPending ? (
            <Skeleton aria-label={T.loading} className="h-52 w-full" />
          ) : list.isError ? (
            <ToneError error={list.error} retry={list.refetch} />
          ) : (
            data && (
              <>
                {allEmpty && (
                  <p
                    role="status"
                    className="rounded-xl bg-surface-low p-4 text-sm"
                  >
                    {T.allEmpty}
                  </p>
                )}
                <Group title={T.history} hint={T.count(history.length)}>
                  <div className="space-y-2">
                    {history.length ? (
                      history.map((item) => (
                        <Choice
                          key={`${item.source}:${item.tone}`}
                          tone={item.tone}
                          detail={
                            item.source === "preset" ? (
                              <>
                                {T.preset}
                                <span className="ml-2 text-primary">
                                  {T.brandWide}
                                </span>
                              </>
                            ) : (
                              T.task(
                                item.count ?? 0,
                                monthDay(item.last_used_at),
                              )
                            )
                          }
                          onUse={onUse}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {T.emptyHistory}
                      </p>
                    )}
                  </div>
                </Group>
                <Group title={T.template} hint={T.count(template.length)}>
                  <p className="text-xs text-primary">{T.brandWide}</p>
                  <div className="space-y-2">
                    {template.length ? (
                      template.map((item) => (
                        <Choice
                          key={item.tone}
                          tone={item.tone}
                          detail={T.samples(item.sample_count)}
                          onUse={onUse}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {T.emptyTemplate}
                      </p>
                    )}
                  </div>
                </Group>
                <Group
                  title={T.results}
                  hint={
                    data.results.enough_data
                      ? T.count(results.length)
                      : undefined
                  }
                >
                  <div className="space-y-2">
                    {!data.results.enough_data ? (
                      <p className="rounded-lg bg-surface-low p-3 text-xs text-muted-foreground">
                        {T.insufficient(data.results.min_notes)}
                      </p>
                    ) : results.length ? (
                      results.map((item) => (
                        <Choice
                          key={item.tone}
                          tone={item.tone}
                          detail={T.performance(
                            item.note_count,
                            engagement(
                              item.average_engagement,
                              item.approximate,
                            ),
                          )}
                          onUse={onUse}
                        />
                      ))
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {T.emptyResults}
                      </p>
                    )}
                  </div>
                </Group>
              </>
            )
          )}
          {(model.isPending || model.isError || model.data) && (
            <Group title={T.modelGroup} hint={T.modelHint}>
              {model.isPending ? (
                <div
                  role="status"
                  className="rounded-lg bg-surface-low p-4 text-sm"
                >
                  {T.generating}
                </div>
              ) : model.isError ? (
                <ToneError error={model.error} model />
              ) : (
                <div className="space-y-2">
                  <p role="status" className="text-xs text-muted-foreground">
                    {T.count(modelItems.length)}
                  </p>
                  {modelItems.length ? (
                    modelItems.map((item) => (
                      <Choice
                        key={item.tone}
                        tone={item.tone}
                        detail={item.reason}
                        onUse={onUse}
                      />
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">{T.noValid}</p>
                  )}
                </div>
              )}
            </Group>
          )}
        </div>
        <div className="space-y-3 border-t border-border/40 pt-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {T.disclaimer}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {T.close}
            </Button>
            <Button
              type="button"
              disabled={model.isPending}
              onClick={() => {
                if (!model.isPending) model.mutate()
              }}
            >
              {model.isPending ? T.generating : T.generate}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
