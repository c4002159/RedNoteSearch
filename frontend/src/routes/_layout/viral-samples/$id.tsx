import { createFileRoute } from "@tanstack/react-router"
import { SampleDetail } from "@/components/Viral/SampleDetail"
import { VIRAL_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/viral-samples/$id")({
  component: SamplePage,
  head: () => ({ meta: [{ title: `${T.detail} - RedNoteSearch` }] }),
})
function SamplePage() {
  const { id } = Route.useParams()
  return <SampleDetail key={id} id={id} />
}
