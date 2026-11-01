import { createFileRoute } from "@tanstack/react-router"
import { DocumentList } from "@/components/Knowledge/DocumentList"
import { KB_TEXT as T } from "@/lib/zh"
export const Route = createFileRoute("/_layout/knowledge/")({
  component: () => <DocumentList />,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})
