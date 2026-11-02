import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import {
  TableBatchBar,
  TableSelectAll,
  TableSelectRow,
} from "@/components/Common/TableBatchBar"
import { TemplateAnalysisTabs } from "@/components/Common/TemplateAnalysisTabs"
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
import { AddSample } from "@/components/Viral/AddSample"
import { DeleteSamples } from "@/components/Viral/DeleteSamples"
import {
  VIRAL_TABLE,
  ViralBreadcrumb,
  ViralError,
  ViralPager,
} from "@/components/Viral/Feedback"
import { SampleStructureCells } from "@/components/Viral/SampleStructureCells"
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import {
  VIRAL_DELETE_TEXT as D,
  VIRAL_TEXT as T,
  ANALYSIS_VISUAL_TEXT as V,
} from "@/lib/zh"
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
  const brand = useBrand()
  const currentBrandName = brand.current?.name ?? ""
  const [page, setPage] = useState(1),
    [sort, setSort] = useState<"created_at" | "-created_at">("-created_at"),
    [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string[] | null>(null)
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
  const selection = {
    selected,
    onChange: setSelected,
    pageIds: samples.data?.items.map((row) => row.id) ?? [],
  }
  return (
    <div className="min-w-0 space-y-6 [&_[data-slot=table-container]]:border-0">
      <TemplateAnalysisTabs />
      <ViralBreadcrumb current={T.title} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{T.title}</h1>
          <p className="text-sm text-muted-foreground">{T.description}</p>
        </div>
        <Button onClick={() => setAdding(true)}>{T.add}</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <p className="text-xs text-muted-foreground">{V.sampleTotal}</p>
          <p className="mt-2 text-3xl font-semibold text-link">
            {samples.isLoading ? "" : (samples.data?.total ?? "")}
          </p>
        </div>
        <div className="rounded-xl bg-card p-6 shadow-sm">
          <p className="text-xs text-muted-foreground">{V.currentBrand}</p>
          <p className="mt-2 text-base font-semibold">
            {brandId && currentBrandName}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {brand.isAdmin ? (
          <TableBatchBar
            showSelectAllPrompt
            {...selection}
            total={samples.data?.total ?? 0}
            loadAll={async () =>
              (
                await ViralService.readSamples({
                  path: { brand_id: brandId },
                  query: { page: 1, page_size: 50, sort },
                })
              ).data.items.map((row) => row.id)
            }
            actions={[
              {
                label: D.bulk,
                destructive: true,
                onSelect: () => setDeleting([...selected]),
              },
            ]}
          />
        ) : (
          <span />
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setSort("-created_at")
            setPage(1)
          }}
        >
          {V.clear}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="overflow-x-auto">
          <Table className={VIRAL_TABLE}>
            <TableHeader>
              <TableRow>
                {brand.isAdmin && (
                  <TableHead className="w-12">
                    <TableSelectAll {...selection} />
                  </TableHead>
                )}
                <TableHead className="w-[30%]">{V.sampleSummary}</TableHead>
                <TableHead>{V.charCount}</TableHead>
                <TableHead className="w-[22%]">{V.source}</TableHead>
                <TableHead>{V.status}</TableHead>
                <TableHead>{V.structureCount}</TableHead>
                <TableHead aria-label={V.sort}>
                  <HeaderFilter
                    title={V.sort}
                    value={sort}
                    showAll={false}
                    onChange={(value) => {
                      setSort(value as "created_at" | "-created_at")
                      setPage(1)
                    }}
                    options={[
                      { value: "-created_at", label: T.newest },
                      { value: "created_at", label: T.oldest },
                    ]}
                  />
                </TableHead>
                {brand.isAdmin && <TableHead>{D.actions}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {samples.isLoading ? (
                <TableRow>
                  <TableCell colSpan={brand.isAdmin ? 8 : 6}>
                    <Skeleton className="h-32 w-full" />
                  </TableCell>
                </TableRow>
              ) : samples.isError ? (
                <TableRow>
                  <TableCell colSpan={brand.isAdmin ? 8 : 6}>
                    <ViralError
                      error={samples.error}
                      retry={() => samples.refetch()}
                    />
                  </TableCell>
                </TableRow>
              ) : !samples.data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={brand.isAdmin ? 8 : 6}>
                    <EmptyState title={T.empty} description={D.sampleHint} />
                  </TableCell>
                </TableRow>
              ) : (
                samples.data.items.map((row) => (
                  <TableRow key={row.id}>
                    {brand.isAdmin && (
                      <TableCell>
                        <TableSelectRow
                          id={row.id}
                          label={row.excerpt}
                          {...selection}
                        />
                      </TableCell>
                    )}
                    <TableCell className="whitespace-normal">
                      <Link
                        className="line-clamp-2 font-medium text-link hover:underline"
                        to="/viral-samples/$id"
                        params={{ id: row.id }}
                      >
                        {row.excerpt}
                      </Link>
                      {row.note && (
                        <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
                          {row.note}
                        </p>
                      )}
                    </TableCell>
                    <TableCell variant="secondary">{row.char_count}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal">
                      <p className="line-clamp-2 break-all text-xs text-muted-foreground">
                        {row.source_url || ""}
                      </p>
                    </TableCell>
                    <SampleStructureCells id={row.id} />
                    <TableCell className="whitespace-normal text-xs text-muted-foreground tabular-nums">
                      {row.created_at ? formatTime(row.created_at) : ""}
                    </TableCell>
                    {brand.isAdmin && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => setDeleting([row.id])}
                        >
                          {D.single}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {samples.data && !samples.isError && (
          <ViralPager page={page} total={samples.data.total} onPage={setPage} />
        )}
      </div>
      <p className="rounded-lg bg-surface-low p-4 text-xs leading-6 text-muted-foreground">
        {V.countHint} {V.textOnly}
      </p>
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
      {deleting && brand.isAdmin && (
        <DeleteSamples
          brandId={brandId}
          ids={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            const removed = new Set(deleting)
            setSelected(
              (previous) =>
                new Set([...previous].filter((id) => !removed.has(id))),
            )
            setDeleting(null)
            setPage(1)
            await cache.invalidateQueries({
              queryKey: ["viral-samples", brandId],
            })
            for (const key of [
              "viral-pattern",
              "viral-patterns",
              "viral-sample",
              "viral-pattern-count",
              "scenario-templates",
              "scenarios",
            ]) {
              void cache.invalidateQueries({
                queryKey: [key],
                refetchType: "none",
              })
            }
          }}
        />
      )}
    </div>
  )
}
