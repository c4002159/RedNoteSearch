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
import { ViralError } from "@/components/Viral/Feedback"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { SCENE_LABEL, VIRAL_TEXT as T } from "@/lib/zh"

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
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.convert}</DialogTitle>
          <DialogDescription>{T.convertHint}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset className="space-y-3" disabled={mutation.isPending}>
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
            <div className="space-y-1">
              <label htmlFor="template-scene" className="text-sm font-medium">
                {T.scene}
              </label>
              <select
                id="template-scene"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                {...form.register("scene")}
              >
                {Object.entries(SCENE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
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
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost">
        <Link to="/viral-samples/$id" params={{ id: row.sample_id }}>
          {T.backSample}
        </Link>
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.patternDetail}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        {brand.isAdmin && (
          <Button onClick={() => setConverting(true)}>{T.convert}</Button>
        )}
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
      <section className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
        {[
          [T.titlePattern, row.title_pattern],
          [T.hook, row.hook_type],
          [T.tone, row.tone],
          [T.emoji, row.emoji_usage],
          [T.hashtags, row.hashtag_usage],
        ].map(([name, value]) => (
          <div className="min-w-0" key={name}>
            <h2 className="mb-1 text-sm font-medium text-muted-foreground">
              {name}
            </h2>
            <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {value}
            </p>
          </div>
        ))}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.paragraphs}</h2>
        <ol className="list-decimal space-y-2 pl-6 text-sm">
          {row.paragraph_structure.map((p, i) => (
            <li
              key={i}
              className="whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              {p}
            </li>
          ))}
        </ol>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.template}</h2>
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
          {row.abstract_template}
        </p>
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.versions}</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {[
            [T.model, row.model_id],
            [T.prompt, row.prompt_version],
            [T.checker, row.checker_version],
          ].map(([name, value]) => (
            <div className="min-w-0" key={name}>
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="[overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
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
