import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { KnowledgeService, type SellingPoint } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
import { EmptyState } from "@/components/Common/EmptyState"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { CATALOG_TEXT as T } from "@/lib/zh"
export function SourceReference({
  point,
  admin,
}: {
  point: SellingPoint
  admin: boolean
}) {
  const id = point.source_document_id,
    chunk = point.source_chunk_id
  const document = useQuery({
    queryKey: ["product-source-document", id],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readDocument({
          path: { document_id: id! },
          signal,
        })
      ).data,
    enabled: !!id,
    retry: false,
  })
  const snippet = useQuery({
    queryKey: ["product-source-chunk", id, chunk],
    enabled: admin && !!id && !!chunk,
    queryFn: async ({ signal }) => {
      for (let page = 1; ; page++) {
        const data = (
          await KnowledgeService.readChunks({
            path: { document_id: id! },
            query: { page, page_size: 100 },
            signal,
          })
        ).data
        const found = data.items.find((c) => c.id === chunk)
        if (found) return found.content
        if (page * 100 >= data.total) return null
      }
    },
    retry: false,
  })
  if (!id) return <p className="text-xs text-muted-foreground">{T.draftHint}</p>
  return (
    <div className="space-y-1 text-xs [overflow-wrap:anywhere]">
      {document.isLoading && <Skeleton className="h-4 w-full" />}
      {document.isError && <BrandError error={document.error} />}{" "}
      {document.data && (
        <>
          <p>
            {document.data.title} · v{document.data.version}
          </p>
          {(!document.data.is_current ||
            document.data.status !== "approved") && (
            <p className="text-muted-foreground">{T.sourceOld}</p>
          )}
        </>
      )}
      {chunk && (
        <>
          <p>
            {T.sourceChunk}：{chunk}
          </p>
          {!admin ? (
            <p>{T.sourceReadonly}</p>
          ) : snippet.isLoading ? (
            <Skeleton className="h-6 w-full" />
          ) : snippet.isError ? (
            <BrandError error={snippet.error} />
          ) : (
            <p className="whitespace-pre-wrap">{snippet.data ?? T.noChunks}</p>
          )}
        </>
      )}
    </div>
  )
}
export function SourcePicker({
  brandId,
  onClose,
  onSelect,
}: {
  brandId: string
  onClose: () => void
  onSelect: (documentId: string, chunkId: string | null) => void
}) {
  const [page, setPage] = useState(1),
    [documentId, setDocumentId] = useState(""),
    [chunkId, setChunkId] = useState(""),
    [chunkPage, setChunkPage] = useState(1)
  const docs = useQuery({
    queryKey: ["product-source-options", brandId, page],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: { status: "approved", page, page_size: 20 },
          signal,
        })
      ).data,
  })
  const chunks = useQuery({
    queryKey: ["product-source-chunks", documentId, chunkPage],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readChunks({
          path: { document_id: documentId },
          query: { page: chunkPage, page_size: 20 },
          signal,
        })
      ).data,
    enabled: !!documentId,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{T.sourceChoose}</DialogTitle>
          <DialogDescription>{T.sourceHint}</DialogDescription>
        </DialogHeader>
        {docs.isLoading && <Skeleton className="h-20 w-full" />}
        {docs.isError && (
          <BrandError error={docs.error} retry={() => docs.refetch()} />
        )}
        <label htmlFor="source-doc">{T.sourceDocument}</label>
        <select
          id="source-doc"
          className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-2 text-sm"
          value={documentId}
          onChange={(e) => {
            setDocumentId(e.target.value)
            setChunkId("")
            setChunkPage(1)
          }}
        >
          <option value="">{T.sourceChoose}</option>
          {docs.data?.items
            .filter((d) => d.is_current)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · v{d.version}
              </option>
            ))}
        </select>
        {docs.data && (
          <>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 1}
                onClick={() => {
                  setPage(page - 1)
                  setDocumentId("")
                  setChunkId("")
                }}
              >
                {T.previous}
              </Button>
              <span>
                {page} {T.page}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page * 20 >= docs.data.total}
                onClick={() => {
                  setPage(page + 1)
                  setDocumentId("")
                  setChunkId("")
                }}
              >
                {T.next}
              </Button>
            </div>
            {!docs.data.items.some((d) => d.is_current) && (
              <EmptyState title={T.noDocuments} />
            )}
          </>
        )}
        {documentId && (
          <>
            <label htmlFor="source-chunk">{T.sourceChunk}</label>
            {chunks.isLoading && <Skeleton className="h-12 w-full" />}
            {chunks.isError && (
              <BrandError error={chunks.error} retry={() => chunks.refetch()} />
            )}
            <select
              id="source-chunk"
              value={chunkId}
              onChange={(e) => setChunkId(e.target.value)}
              className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-2 text-sm"
            >
              <option value="">{T.noChunk}</option>
              {chunks.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.chunk_index} · {c.content.slice(0, 60)}
                </option>
              ))}
            </select>
            {chunks.data && (
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={chunkPage === 1}
                  onClick={() => {
                    setChunkPage(chunkPage - 1)
                    setChunkId("")
                  }}
                >
                  {T.previous}
                </Button>
                <span>
                  {chunkPage} {T.page}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={chunkPage * 20 >= chunks.data.total}
                  onClick={() => {
                    setChunkPage(chunkPage + 1)
                    setChunkId("")
                  }}
                >
                  {T.next}
                </Button>
              </div>
            )}
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
              {chunks.data?.items.find((c) => c.id === chunkId)?.content}
            </p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {T.cancel}
          </Button>
          <Button
            disabled={
              !documentId ||
              docs.isError ||
              docs.isFetching ||
              chunks.isFetching ||
              chunks.isError
            }
            onClick={() => onSelect(documentId, chunkId || null)}
          >
            {T.sourceChoose}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
