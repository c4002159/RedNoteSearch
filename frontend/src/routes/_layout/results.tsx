import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useState } from "react"
import {
  type ConfirmedCopyPublic,
  CreativeTypesService,
  ResultsService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { Pill } from "@/components/Common/StatusBadge"
import { Pager } from "@/components/Knowledge/Feedback"
import { ResultsError, reading } from "@/components/Results/Feedback"
import { RecordDialog } from "@/components/Results/RecordDialog"
import { SummaryCards } from "@/components/Results/SummaryCards"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useBrand } from "@/hooks/useBrand"
import { formatTime } from "@/lib/format"
import { SCENE_LABEL, RESULTS_TEXT as T } from "@/lib/zh"

export const Route = createFileRoute("/_layout/results")({
  component: ResultsPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})

function ResultsPage() {
  const brand = useBrand()
  const cache = useQueryClient()
  if (brand.isLoading)
    return <Skeleton aria-label={T.loading} className="h-64 w-full" />
  if (brand.isError)
    return (
      <ResultsError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  return <BrandResults key={brand.current.id} brandId={brand.current.id} />
}

function BrandResults({ brandId }: { brandId: string }) {
  const [page, setPage] = useState(1)
  const [pending, setPending] = useState(false)
  const [search, setSearch] = useState("")
  const [q, setQ] = useState("")
  const [record, setRecord] = useState<{
    copy: ConfirmedCopyPublic
    mode: "publish" | "metric"
  } | null>(null)
  const summary = useQuery({
    queryKey: ["results-summary", brandId],
    queryFn: async ({ signal }) =>
      (
        await ResultsService.readResultsSummary({
          path: { brand_id: brandId },
          signal,
        })
      ).data,
  })
  const list = useQuery({
    queryKey: ["results", brandId, page, pending, q],
    queryFn: async ({ signal }) =>
      (
        await ResultsService.readConfirmedCopies({
          path: { brand_id: brandId },
          query: {
            page,
            page_size: 20,
            needs_metrics: pending || undefined,
            q: q || undefined,
          },
          signal,
        })
      ).data,
  })
  const types = useQuery({
    queryKey: ["creative-types", brandId],
    queryFn: async ({ signal }) =>
      (
        await CreativeTypesService.typesReadCreativeTypes({
          path: { brand_id: brandId },
          signal,
        })
      ).data,
  })
  const sceneName = (scene: string) =>
    types.data?.items.find((type) => type.key === scene)?.name ??
    (SCENE_LABEL as Record<string, string>)[scene] ??
    T.otherType
  return (
    <div className="min-w-0 space-y-6 text-sm">
      <header>
        <h1 className="text-2xl font-semibold">{T.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{T.description}</p>
      </header>
      {summary.isPending ? (
        <Skeleton aria-label={T.loadingSummary} className="h-64 w-full" />
      ) : summary.isError ? (
        <ResultsError error={summary.error} retry={summary.refetch} />
      ) : (
        summary.data && <SummaryCards data={summary.data} />
      )}
      <section className="min-w-0 overflow-hidden rounded-xl bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div
            role="tablist"
            aria-label={T.filter}
            className="flex gap-1 rounded-lg bg-surface-low p-1"
          >
            {[false, true].map((value) => (
              <Button
                key={String(value)}
                role="tab"
                aria-selected={pending === value}
                variant={pending === value ? "default" : "ghost"}
                onClick={() => {
                  setPending(value)
                  setPage(1)
                }}
              >
                {value
                  ? `${T.pending}（${summary.data?.pending_count ?? "—"}）`
                  : T.all}
              </Button>
            ))}
          </div>
          <form
            className="flex max-w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQ(search.trim())
              setPage(1)
            }}
          >
            <Input
              aria-label={T.search}
              placeholder={T.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" variant="outline">
              {T.searchButton}
            </Button>
          </form>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[1100px]">
            <TableHeader className="bg-surface-low">
              <TableRow>
                {[
                  T.copyTitle,
                  T.template,
                  T.promotion,
                  T.confirmedAt,
                  T.publication,
                  T.latest,
                  T.operations,
                ].map((title) => (
                  <TableHead key={title} className="text-[13px] font-semibold">
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isPending ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Skeleton
                      aria-label={T.loadingList}
                      className="my-4 h-32 w-full"
                    />
                  </TableCell>
                </TableRow>
              ) : list.isError ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <ResultsError error={list.error} retry={list.refetch} />
                  </TableCell>
                </TableRow>
              ) : !list.data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      title={pending ? T.noPending : T.empty}
                      description={pending ? T.pendingHint : T.emptyHint}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                list.data.items.map((copy: ConfirmedCopyPublic) => (
                  <TableRow key={copy.id}>
                    <TableCell className="max-w-60 min-w-44 whitespace-normal">
                      <p className="break-words font-medium">{copy.title}</p>
                      {copy.needs_metrics && (
                        <Pill tone="warn">{T.pending}</Pill>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 whitespace-normal">
                      <p className="break-words">{copy.scenario_name}</p>
                      <span className="text-xs text-muted-foreground">
                        {sceneName(copy.scene)}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-36 whitespace-normal break-words">
                      {copy.promo_label}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatTime(copy.confirmed_at)}
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal">
                      <p className="text-xs">{formatTime(copy.published_at)}</p>
                      <p className="mt-1 break-all text-xs text-muted-foreground">
                        {copy.post_url || T.noUrl}
                      </p>
                    </TableCell>
                    <TableCell className="min-w-40 whitespace-normal">
                      {copy.latest_metric ? (
                        <>
                          <p className="text-xs">
                            {T.likes}{" "}
                            {reading(
                              copy.latest_metric.likes,
                              copy.latest_metric.approximate,
                            )}{" "}
                            · {T.collects}{" "}
                            {reading(
                              copy.latest_metric.collects,
                              copy.latest_metric.approximate,
                            )}{" "}
                            · {T.comments}{" "}
                            {reading(
                              copy.latest_metric.comments,
                              copy.latest_metric.approximate,
                            )}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatTime(copy.latest_metric.captured_at)}
                          </p>
                        </>
                      ) : (
                        T.noReading
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-link"
                          onClick={() =>
                            setRecord({
                              copy,
                              mode:
                                !copy.post_url || !copy.published_at
                                  ? "publish"
                                  : "metric",
                            })
                          }
                        >
                          {!copy.post_url || !copy.published_at
                            ? T.publish
                            : T.metric}
                        </Button>
                        {copy.post_url && copy.published_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-link"
                            onClick={() => setRecord({ copy, mode: "publish" })}
                          >
                            {T.editPublish}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
      <Pager page={page} total={list.data?.total ?? 0} onPage={setPage} />
      {record && (
        <RecordDialog
          copy={record.copy}
          mode={record.mode}
          brandId={brandId}
          onClose={() => setRecord(null)}
        />
      )}
    </div>
  )
}
