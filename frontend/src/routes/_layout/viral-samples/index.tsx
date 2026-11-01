import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { AddSample } from "@/components/Viral/AddSample"
import { ViralError, ViralPager } from "@/components/Viral/Feedback"
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import { VIRAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/viral-samples/")({
  component: SamplesPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})
function SamplesPage() {
  const brand = useBrand(),
    cache = useQueryClient()
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  if (brand.isError)
    return (
      <ViralError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  return <BrandSamples key={brand.current.id} brandId={brand.current.id} />
}
function BrandSamples({ brandId }: { brandId: string }) {
  const cache = useQueryClient(),
    navigate = useNavigate()
  const [page, setPage] = useState(1),
    [sort, setSort] = useState<"created_at" | "-created_at">("-created_at"),
    [adding, setAdding] = useState(false)
  const samples = useQuery({
    queryKey: ["viral-samples", brandId, page, sort],
    queryFn: async ({ signal }) =>
      (
        await ViralService.readSamples({
          path: { brand_id: brandId },
          query: { page, page_size: 20, sort },
          signal,
        })
      ).data,
  })
  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        <Button onClick={() => setAdding(true)}>{T.add}</Button>
      </div>
      <select
        aria-label={T.sort}
        className="h-10 rounded-lg border border-transparent bg-surface-low px-3 text-sm"
        value={sort}
        onChange={(e) => {
          setSort(e.target.value as "created_at" | "-created_at")
          setPage(1)
        }}
      >
        <option value="-created_at">{T.newest}</option>
        <option value="created_at">{T.oldest}</option>
      </select>
      {samples.isLoading && <Skeleton className="h-48 w-full" />}
      {samples.isError && (
        <ViralError error={samples.error} retry={() => samples.refetch()} />
      )}
      {samples.data &&
        !samples.isError &&
        (samples.data.items.length === 0 ? (
          <EmptyState title={T.empty} description={T.immutable} />
        ) : (
          <ul className="grid min-w-0 gap-3">
            {samples.data.items.map((row) => (
              <li
                key={row.id}
                className="min-w-0 space-y-2 rounded-xl border bg-card p-4"
              >
                <Link
                  className="whitespace-pre-wrap font-medium text-link hover:underline [overflow-wrap:anywhere]"
                  to="/viral-samples/$id"
                  params={{ id: row.id }}
                >
                  {row.excerpt}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {row.char_count} {T.chars} · {formatTime(row.created_at)}
                </p>
                {row.note && (
                  <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
                    {row.note}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ))}
      {samples.data && !samples.isError && (
        <ViralPager page={page} total={samples.data.total} onPage={setPage} />
      )}
      {adding && (
        <AddSample
          brandId={brandId}
          onClose={() => setAdding(false)}
          onSaved={(row) => {
            setAdding(false)
            void cache.invalidateQueries({ queryKey: ["viral-samples"] })
            void navigate({ to: "/viral-samples/$id", params: { id: row.id } })
          }}
        />
      )}
    </div>
  )
}
