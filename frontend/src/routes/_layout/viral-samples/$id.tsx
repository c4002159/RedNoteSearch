import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AnalyzeSample } from "@/components/Viral/AnalyzeSample"
import {
  VIRAL_TABLE,
  ViralBreadcrumb,
  ViralError,
  ViralPager,
} from "@/components/Viral/Feedback"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { formatTime } from "@/lib/format"
import { VIRAL_TEXT as T, ANALYSIS_VISUAL_TEXT as V } from "@/lib/zh"
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
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <ViralBreadcrumb current={T.detail} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.detail}</h1>
          <p className="text-sm text-muted-foreground">
            {codePointCount(row.text)} {T.chars} · {formatTime(row.created_at)}
          </p>
        </div>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
          {" "}
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{T.text}</h2>
            <p className="whitespace-pre-wrap rounded-lg bg-surface-low p-5 text-sm leading-7 [overflow-wrap:anywhere]">
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
          <section className="space-y-3 rounded-xl bg-card p-6 shadow-sm">
            <h2 className="font-semibold">{T.patterns}</h2>
            <div className="overflow-x-auto">
              <Table className={`${VIRAL_TABLE} min-w-[720px]`}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{T.titlePattern}</TableHead>
                    <TableHead>{T.hook}</TableHead>
                    <TableHead>{T.model}</TableHead>
                    <TableHead>{V.sort}</TableHead>
                    <TableHead>{V.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {patterns.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Skeleton className="h-24 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : patterns.isError ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <ViralError
                          error={patterns.error}
                          retry={() => patterns.refetch()}
                        />
                      </TableCell>
                    </TableRow>
                  ) : !patterns.data?.items.length ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EmptyState title={T.emptyPatterns} />
                      </TableCell>
                    </TableRow>
                  ) : (
                    patterns.data.items.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="max-w-72 whitespace-normal font-medium">
                          <Link
                            className="text-link hover:underline"
                            to="/viral-patterns/$id"
                            params={{ id: p.id }}
                          >
                            {p.title_pattern}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-40 whitespace-normal">
                          {p.hook_type}
                        </TableCell>
                        <TableCell className="max-w-40 whitespace-normal break-words">
                          {p.model_id}
                        </TableCell>
                        <TableCell className="whitespace-normal text-xs text-muted-foreground">
                          {formatTime(p.created_at)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="text-link"
                          >
                            <Link
                              to="/viral-patterns/$id"
                              params={{ id: p.id }}
                            >
                              {T.view}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {patterns.data && !patterns.isError && (
              <ViralPager
                page={page}
                total={patterns.data.total}
                onPage={setPage}
              />
            )}
          </section>
        </div>
        <aside className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
          <h2 className="text-base font-semibold">{V.next}</h2>
          <p className="text-xs leading-6 text-muted-foreground">
            {T.waitHint}
          </p>{" "}
          <Button
            className="w-full"
            disabled={!patterns.data || patterns.isFetching || patterns.isError}
            onClick={() => setAnalyzing(true)}
          >
            {T.analysis}
          </Button>
          <Button variant="outline" asChild className="w-full">
            <Link to="/viral-samples">{T.back}</Link>
          </Button>
          <p className="text-xs leading-6 text-muted-foreground">
            {V.textOnly}
          </p>
        </aside>
      </div>
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
