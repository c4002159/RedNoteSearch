import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AnalyzeSample } from "@/components/Viral/AnalyzeSample"
import { ViralError, ViralPager } from "@/components/Viral/Feedback"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { formatTime } from "@/lib/format"
import { VIRAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/viral-samples/$id")({
  component: SamplePage,
  head: () => ({ meta: [{ title: `${T.detail} - RedNoteSearch` }] }),
})
function SamplePage() {
  const { id } = Route.useParams(),
    brand = useBrand(),
    cache = useQueryClient(),
    navigate = useNavigate()
  const [page, setPage] = useState(1),
    [analyzing, setAnalyzing] = useState(false)
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
  return (
    <div className="min-w-0 space-y-5">
      <Button asChild variant="ghost">
        <Link to="/viral-samples">{T.back}</Link>
      </Button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.detail}</h1>
          <p className="text-sm text-muted-foreground">
            {codePointCount(row.text)} {T.chars} · {formatTime(row.created_at)}
          </p>
        </div>
        <Button
          disabled={!patterns.data || patterns.isFetching || patterns.isError}
          onClick={() => setAnalyzing(true)}
        >
          {T.analysis}
        </Button>
      </div>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.text}</h2>
        <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
          {row.text}
        </p>
        {row.note && (
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {T.note}：{row.note}
          </p>
        )}
        {row.source_url && (
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {T.source}：{row.source_url}
          </p>
        )}
      </section>
      <section className="space-y-3 rounded-xl border bg-card p-4">
        <h2 className="font-semibold">{T.patterns}</h2>
        {patterns.isLoading && <Skeleton className="h-20 w-full" />}
        {patterns.isError && (
          <ViralError error={patterns.error} retry={() => patterns.refetch()} />
        )}
        {patterns.data &&
          !patterns.isError &&
          (patterns.data.items.length === 0 ? (
            <EmptyState title={T.emptyPatterns} />
          ) : (
            <ul className="space-y-3">
              {patterns.data.items.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">{p.title_pattern}</p>
                    <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {p.hook_type} · {p.model_id} · {formatTime(p.created_at)}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/viral-patterns/$id" params={{ id: p.id }}>
                      {T.view}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          ))}
        {patterns.data && !patterns.isError && (
          <ViralPager
            page={page}
            total={patterns.data.total}
            onPage={setPage}
          />
        )}
      </section>
      {analyzing && patterns.data && (
        <AnalyzeSample
          key={id}
          sampleId={id}
          beforeIds={patterns.data.items.map((p) => p.id)}
          beforeTotal={patterns.data.total}
          onClose={() => {
            setAnalyzing(false)
            void patterns.refetch()
          }}
          onChecked={() => {
            void patterns.refetch()
          }}
          onSaved={(p) => {
            setAnalyzing(false)
            void cache.invalidateQueries({ queryKey: ["viral-patterns", id] })
            void navigate({ to: "/viral-patterns/$id", params: { id: p.id } })
          }}
        />
      )}
    </div>
  )
}
