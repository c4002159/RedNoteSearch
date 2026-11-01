import { createFileRoute } from "@tanstack/react-router"
import { DocumentList } from "@/components/Knowledge/DocumentList"
import { KB_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/knowledge/review")({
  component: () => <DocumentList review />,
  head: () => ({ meta: [{ title: `${T.reviewTitle} - RedNoteSearch` }] }),
})
