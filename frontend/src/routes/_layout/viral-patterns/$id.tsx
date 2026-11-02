import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ViralService } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Skeleton } from "@/components/ui/skeleton"
import { ViralError } from "@/components/Viral/Feedback"
import { SampleDetail } from "@/components/Viral/SampleDetail"
import { useBrand } from "@/hooks/useBrand"
import { parseApiError } from "@/lib/apiError"
import { VIRAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/viral-patterns/$id")({
  component: PatternPage,
  head: () => ({ meta: [{ title: `${T.detail} - RedNoteSearch` }] }),
})
function PatternPage() {
  const { id } = Route.useParams()
  const brand = useBrand()
  const cache = useQueryClient()
  const pattern = useQuery({
    queryKey: ["viral-pattern", id],
    queryFn: async ({ signal }) =>
      (await ViralService.readPattern({ path: { pattern_id: id }, signal }))
        .data,
    enabled: !!brand.current,
    retry: (n, e) =>
      n < 2 && ![401, 403, 404].includes(parseApiError(e).status ?? 0),
  })
  if (brand.isError)
    return (
      <ViralError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (brand.isLoading) return <Skeleton className="h-48 w-full" />
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (pattern.isError)
    return <ViralError error={pattern.error} retry={() => pattern.refetch()} />
  if (!pattern.data) return <Skeleton className="h-48 w-full" />
  if (pattern.data.brand_id !== brand.current?.id) return <ForbiddenPage />
  return (
    <SampleDetail
      key={pattern.data.sample_id}
      id={pattern.data.sample_id}
      initialPattern={pattern.data}
    />
  )
}
