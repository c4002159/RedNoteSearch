import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import {
  type ScenarioPublic,
  type ViralPatternPublic,
  type ViralSamplePublic,
  ViralService,
} from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { TemplateAnalysisTabs } from "@/components/Common/TemplateAnalysisTabs"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { formatTime } from "@/lib/format"
import {
  R6_SAMPLE_TEXT as R,
  SCENARIO_TEXT,
  VIRAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
import { AnalyzeSample } from "./AnalyzeSample"
import { ConvertDialog } from "./ConvertDialog"
import { ViralBreadcrumb, ViralError, ViralPager } from "./Feedback"

function EditSample({
  row,
  onClose,
  onSaved,
}: {
  row: ViralSamplePublic
  onClose: () => void
  onSaved: (sample: ViralSamplePublic) => void
}) {
  const [text, setText] = useState(row.text)
  const [source, setSource] = useState(row.source_url ?? "")
  const save = useMutation({
    mutationFn: async () =>
      (
        await ViralService.updateSample({
          path: { sample_id: row.id },
          body: { text: text.trim(), source_url: source.trim() || null },
        })
      ).data,
    onSuccess: onSaved,
  })
  const valid =
    !!text.trim() &&
    codePointCount(text.trim()) <= 5000 &&
    codePointCount(source.trim()) <= 2000
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) save.mutate()
      }}
    >
      <fieldset className="space-y-3" disabled={save.isPending}>
        <div className="space-y-2">
          <label htmlFor="sample-text">{R.text}</label>
          <Textarea
            id="sample-text"
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <CharCounter value={codePointCount(text)} limit={5000} />
        <div className="space-y-2">
          <label htmlFor="sample-source">{R.source}</label>
          <Input
            id="sample-source"
            type="url"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          />
        </div>
      </fieldset>
      {save.isError && <ViralError error={save.error} />}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={save.isPending}
          onClick={onClose}
        >
          {R.cancel}
        </Button>
        <LoadingButton type="submit" loading={save.isPending} disabled={!valid}>
          {R.save}
        </LoadingButton>
      </div>
    </form>
  )
}
function Structure({ row }: { row: ViralPatternPublic }) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          [T.titlePattern, row.title_pattern],
          [T.hook, row.hook_type],
          [T.tone, row.tone],
          [T.emoji, row.emoji_usage],
          [T.hashtags, row.hashtag_usage],
        ].map(([name, value]) => (
          <div key={name} className="rounded-lg bg-surface-low p-4">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="mt-1 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <h3 className="font-semibold">{T.paragraphs}</h3>
      <ol className="list-inside list-decimal space-y-2 text-sm">
        {row.paragraph_structure.map((p, i) => (
          <li
            key={`${i}-${p}`}
            className="whitespace-pre-wrap [overflow-wrap:anywhere]"
          >
            {p}
          </li>
        ))}
      </ol>
      <h3 className="font-semibold">{V.semantic}</h3>
      <p className="whitespace-pre-wrap rounded-lg bg-surface-low p-4 text-sm leading-7 [overflow-wrap:anywhere]">
        {row.abstract_template}
      </p>
    </div>
  )
}
export function SampleDetail({
  id,
  initialPattern,
}: {
  id: string
  initialPattern?: ViralPatternPublic
}) {
  const brand = useBrand(),
    cache = useQueryClient()
  const [page, setPage] = useState(1)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [selected, setSelected] = useState<ViralPatternPublic | undefined>(
    initialPattern,
  )
  const [viewing, setViewing] = useState(false)
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<ScenarioPublic | null>(null)
  const sample = useQuery({
    queryKey: ["viral-sample", id],
    queryFn: async ({ signal }) =>
      (await ViralService.readSample({ path: { sample_id: id }, signal })).data,
    enabled: !!brand.current,
    retry: (n, e) =>
      n < 2 && ![401, 403, 404].includes(parseApiError(e).status ?? 0),
  })
  const allowed = !!sample.data && sample.data.brand_id === brand.current?.id
  const patterns = useQuery({
    queryKey: ["viral-patterns", id, page],
    queryFn: async ({ signal }) =>
      (
        await ViralService.readPatterns({
          path: { sample_id: id },
          query: { page, page_size: 20 },
          signal,
        })
      ).data,
    enabled: allowed,
  })
  const refresh = () => {
    for (const key of [
      "viral-sample",
      "viral-samples",
      "viral-patterns",
      "viral-pattern",
      "viral-pattern-count",
    ])
      void cache.invalidateQueries({ queryKey: [key] })
  }
  if (brand.isLoading || sample.isLoading)
    return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <ViralError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (sample.isError)
    return <ViralError error={sample.error} retry={() => sample.refetch()} />
  if (!sample.data) return null
  if (!allowed) return <ForbiddenPage />
  const row = sample.data
  const active = selected ?? patterns.data?.items[0]
  return (
    <div className="min-w-0 space-y-6">
      <TemplateAnalysisTabs />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViralBreadcrumb current={T.detail} />
        <Button variant="outline" asChild>
          <Link to="/viral-samples">{R.back}</Link>
        </Button>
      </div>
      <h1 className="text-2xl font-bold">{R.sample}</h1>
      <section
        className="space-y-4 rounded-xl bg-card p-6 shadow-sm"
        aria-label={R.sample}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{R.sample}</h2>
          {brand.isAdmin && !editing && (
            <Button variant="outline" onClick={() => setEditing(true)}>
              {R.edit}
            </Button>
          )}
        </div>
        {editing ? (
          <EditSample
            row={row}
            onClose={() => setEditing(false)}
            onSaved={(updated) => {
              cache.setQueryData(["viral-sample", id], updated)
              setEditing(false)
              refresh()
            }}
          />
        ) : (
          <>
            <p className="whitespace-pre-wrap rounded-lg bg-surface-low p-5 text-sm leading-7 [overflow-wrap:anywhere]">
              {row.text}
            </p>
            {row.note && (
              <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                {T.note}：{row.note}
              </p>
            )}
            <p className="text-sm [overflow-wrap:anywhere]">
              {R.source}：{row.source_url || "—"}
            </p>
          </>
        )}
      </section>
      {row.structures_stale && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-tone-warn-bg p-4 text-tone-warn"
        >
          <span>{R.stale}</span>
          <Button
            disabled={!patterns.data || patterns.isFetching}
            onClick={() => setAnalyzing(true)}
          >
            {R.reanalyze}
          </Button>
        </div>
      )}
      <section
        className="rounded-xl bg-card p-6 shadow-sm"
        aria-label={R.structures}
      >
        <h2>
          <button
            type="button"
            className="flex w-full items-center justify-between text-left font-semibold"
            aria-expanded={!collapsed}
            aria-controls="analyzed-structures"
            onClick={() => setCollapsed((value) => !value)}
          >
            {R.structures}
            <span aria-hidden>{collapsed ? "+" : "−"}</span>
          </button>
        </h2>
        <div
          id="analyzed-structures"
          hidden={collapsed}
          className="mt-5 space-y-5"
        >
          {patterns.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : patterns.isError ? (
            <ViralError
              error={patterns.error}
              retry={() => patterns.refetch()}
            />
          ) : !patterns.data?.items.length ? (
            <EmptyState title={T.emptyPatterns} />
          ) : (
            <>
              <div className="space-y-2 text-sm">
                <label htmlFor="sample-structure">{T.titlePattern}</label>
                <select
                  id="sample-structure"
                  className="w-full rounded-lg bg-surface-low p-3"
                  value={active?.id ?? ""}
                  onChange={(e) =>
                    setSelected(
                      patterns.data?.items.find((p) => p.id === e.target.value),
                    )
                  }
                >
                  {active &&
                    !patterns.data.items.some((p) => p.id === active.id) && (
                      <option value={active.id}>{active.title_pattern}</option>
                    )}
                  {patterns.data.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title_pattern} · {formatTime(p.created_at)}
                    </option>
                  ))}
                </select>
              </div>
              {active && <Structure row={active} />}
              <ViralPager
                page={page}
                total={patterns.data.total}
                onPage={(p) => {
                  setPage(p)
                  setSelected(undefined)
                }}
              />
            </>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {!row.structures_stale && (
              <Button
                variant="outline"
                disabled={!patterns.data || patterns.isFetching}
                onClick={() => setAnalyzing(true)}
              >
                {T.analysis}
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!active}
              onClick={() => setViewing(true)}
            >
              {T.view}
            </Button>
            {brand.isAdmin && (
              <Button disabled={!active} onClick={() => setConverting(true)}>
                {T.convert}
              </Button>
            )}
          </div>
        </div>
      </section>
      {result && (
        <div
          role="status"
          className="rounded-xl bg-tone-info-bg p-4 text-tone-info"
        >
          <strong>{T.converted}</strong>
          <p>
            {result.name} · {T.templateVersion} {result.template_version}
          </p>
          <Button asChild size="sm" className="mt-2">
            <Link
              to="/generate"
              search={{ task: undefined, scenario: result.id }}
            >
              {SCENARIO_TEXT.useThis}
            </Link>
          </Button>
        </div>
      )}
      <section
        className="space-y-4 rounded-xl bg-card p-6 shadow-sm"
        aria-label={R.metadata}
      >
        <h2 className="font-semibold">{R.metadata}</h2>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
          {[
            [V.charCount, String(codePointCount(row.text))],
            [T.source, row.source_url || "—"],
            [V.sort, formatTime(row.created_at)],
            ...(active
              ? [
                  [T.model, active.model_id],
                  [T.prompt, active.prompt_version],
                  [T.checker, active.checker_version],
                  [R.analyzedAt, formatTime(active.created_at)],
                ]
              : []),
          ].map(([name, value]) => (
            <div key={name} className="min-w-0 rounded-lg bg-surface-low p-3">
              <dt className="text-xs text-muted-foreground">{name}</dt>
              <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      {viewing && active && (
        <Dialog open onOpenChange={setViewing}>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>{T.patternDetail}</DialogTitle>
              <DialogDescription>{active.title_pattern}</DialogDescription>
            </DialogHeader>
            <Structure row={active} />
          </DialogContent>
        </Dialog>
      )}
      {converting && active && brand.isAdmin && (
        <ConvertDialog
          id={active.id}
          structure={active.abstract_template}
          onClose={() => setConverting(false)}
          onSaved={(r) => {
            setResult(r)
            setConverting(false)
            for (const key of ["scenarios", "scenario-templates"])
              void cache.invalidateQueries({ queryKey: [key] })
          }}
        />
      )}
      {analyzing && patterns.data && (
        <AnalyzeSample
          sampleId={id}
          beforeIds={patterns.data.items.map((p) => p.id)}
          beforeTotal={patterns.data.total}
          onClose={() => {
            setAnalyzing(false)
            refresh()
          }}
          onChecked={refresh}
          onSaved={(p) => {
            setSelected(p)
            setPage(1)
            setAnalyzing(false)
            refresh()
          }}
        />
      )}
    </div>
  )
}
