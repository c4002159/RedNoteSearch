import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { type ScenarioPublic, ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ViralBreadcrumb, ViralError } from "@/components/Viral/Feedback"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { formatTime } from "@/lib/format"
import {
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
})
type Values = z.infer<typeof schema>
export const Route = createFileRoute("/_layout/viral-patterns/$id")({
  component: PatternPage,
  head: () => ({ meta: [{ title: `${T.patternDetail} - RedNoteSearch` }] }),
})
function ConvertDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string
  onClose: () => void
  onSaved: (r: ScenarioPublic) => void
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: T.defaultName, scene: "seeding" },
  })
  const mutation = useMutation({
    mutationFn: async (body: Values) =>
      (await ViralService.convertPattern({ path: { pattern_id: id }, body }))
        .data,
    onSuccess: onSaved,
  })
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
        <form
          className="space-y-5"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset className="space-y-5" disabled={mutation.isPending}>
            <legend className="sr-only">{T.convert}</legend>
            <div className="space-y-1">
              <label htmlFor="template-name" className="text-sm font-medium">
                {T.name}
              </label>
              <Input
                id="template-name"
                {...form.register("name")}
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
              {T.convert}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function SourceCard({ id }: { id: string }) {
  const sample = useQuery({
    queryKey: ["viral-sample", id],
    queryFn: async ({ signal }) =>
      (await ViralService.readSample({ path: { sample_id: id }, signal })).data,
    retry: (n, error) =>
      n < 2 && ![401, 403, 404].includes(parseApiError(error).status ?? 0),
  })
  return (
    <section className="min-w-0 space-y-4 rounded-xl bg-card p-6 shadow-sm">
      <h2 className="font-semibold">{V.sampleInfo}</h2>
      {sample.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : sample.isError ? (
        <ViralError error={sample.error} retry={() => sample.refetch()} />
      ) : (
        sample.data && (
          <>
            <dl className="space-y-3 rounded-xl bg-surface-low p-4 text-xs">
              <div>
                <dt className="text-muted-foreground">{V.charCount}</dt>
                <dd>{codePointCount(sample.data.text)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{V.sort}</dt>
                <dd>{formatTime(sample.data.created_at)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{T.source}</dt>
                <dd className="break-all">{sample.data.source_url || "—"}</dd>
              </div>
            </dl>
            <p className="line-clamp-5 rounded-xl bg-surface-low p-4 text-xs leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {sample.data.text}
            </p>
          </>
        )
      )}
    </section>
  )
}
function PatternPage() {
  const { id } = Route.useParams(),
    brand = useBrand(),
    cache = useQueryClient()
  const [converting, setConverting] = useState(false),
    [result, setResult] = useState<ScenarioPublic | null>(null)
  const pattern = useQuery({
    queryKey: ["viral-pattern", id],
    queryFn: async ({ signal }) =>
      (await ViralService.readPattern({ path: { pattern_id: id }, signal }))
        .data,
    enabled: !!brand.current,
    retry: (n, e) =>
      n < 2 && ![401, 403, 404].includes(parseApiError(e).status ?? 0),
  })
  if (brand.isLoading || pattern.isLoading)
    return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <ViralError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (pattern.isError)
    return <ViralError error={pattern.error} retry={() => pattern.refetch()} />
  if (!pattern.data) return null
  if (pattern.data.brand_id !== brand.current.id) return <ForbiddenPage />
  const row = pattern.data
  return (
    <div className="min-w-0 space-y-5 [&_[data-slot=table-container]]:border-0">
      <ViralBreadcrumb current={T.patternDetail} sampleId={row.sample_id} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.patternDetail}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
      </div>
      {result && (
        <div
          role="status"
          className="rounded-lg border bg-tone-info-bg p-4 text-tone-info"
        >
          <strong>{T.converted}</strong>
          <p className="break-words">
            {result.name} · {T.templateVersion} {result.template_version}
          </p>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
          <section className="rounded-xl bg-card p-6 shadow-sm">
            <h2 className="mb-5 text-base font-semibold">
              {V.structureFeatures}
            </h2>
            <div className="grid gap-3">
              {[
                [T.titlePattern, row.title_pattern],
                [T.hook, row.hook_type],
                [T.tone, row.tone],
                [T.emoji, row.emoji_usage],
                [T.hashtags, row.hashtag_usage],
              ].map(([name, value]) => (
                <div
                  className="min-w-0 gap-4 rounded-xl bg-surface-low p-4 sm:flex"
                  key={name}
                >
                  <h2 className="mb-1 shrink-0 text-sm font-medium text-muted-foreground sm:w-24">
                    {name}
                  </h2>
                  <p className="min-w-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </section>
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{T.paragraphs}</h2>
            <ol className="space-y-3 text-sm">
              {row.paragraph_structure.map((p, i) => (
                <li
                  key={i}
                  className="flex gap-4 rounded-xl bg-surface-low p-4 whitespace-pre-wrap [overflow-wrap:anywhere]"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-link">
                    {i + 1}
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          </section>
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{V.semantic}</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              {V.textOnly}
            </p>
            <p className="rounded-xl bg-surface-low p-5 whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
              {row.abstract_template}
            </p>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{V.versionInfo}</h2>
            <dl className="grid gap-4 text-sm">
              {[
                [T.model, row.model_id],
                [T.prompt, row.prompt_version],
                [T.checker, row.checker_version],
                [V.sort, formatTime(row.created_at)],
              ].map(([name, value]) => (
                <div
                  className="min-w-0 rounded-lg bg-surface-low p-3"
                  key={name}
                >
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="[overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
          <SourceCard id={row.sample_id} />
          <section className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{V.next}</h2>
            <p className="text-xs leading-6 text-muted-foreground">
              {T.convertHint} {V.convertVersion}
            </p>
            {brand.isAdmin && (
              <Button className="w-full" onClick={() => setConverting(true)}>
                {T.convert}
              </Button>
            )}
            <Button variant="outline" asChild className="w-full">
              <Link to="/viral-samples/$id" params={{ id: row.sample_id }}>
                {T.backSample}
              </Link>
            </Button>
          </section>
        </aside>
      </div>
      {converting && brand.isAdmin && (
        <ConvertDialog
          id={id}
          onClose={() => setConverting(false)}
          onSaved={(r) => {
            setResult(r)
            setConverting(false)
            void cache.invalidateQueries({ queryKey: ["scenarios"] })
          }}
        />
      )}
    </div>
  )
}
