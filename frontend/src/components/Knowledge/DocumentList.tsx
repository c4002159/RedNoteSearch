import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { FileText } from "lucide-react"
import { useState } from "react"
import {
  type DocumentStatus,
  type DocumentType,
  KnowledgeService,
} from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { HeaderFilter } from "@/components/Common/FilterSelect"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { LoadingState } from "@/components/Common/LoadingState"
import { SearchBox } from "@/components/Common/SearchBox"
import { DocumentStatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
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
import {
  DOCUMENT_STATUS_LABEL,
  DOCUMENT_TYPE_LABEL,
  label,
  KB_TEXT as T,
  T5_VISUAL_TEXT as V,
} from "@/lib/zh"
import { IndexBadge, KnowledgeError, Pager } from "./Feedback"
import { UploadDocument } from "./UploadDocument"

export function DocumentList({ review = false }: { review?: boolean }) {
  const brand = useBrand()
  const cache = useQueryClient()
  if (brand.isLoading) return <LoadingState className="h-48 w-full" />
  if (brand.isError)
    return (
      <KnowledgeError
        error={cache.getQueryState(["brands"])?.error}
        retry={brand.refetch}
      />
    )
  if (!brand.current) return <EmptyState title={T.selectBrand} />
  if (review && !brand.isAdmin) return <ForbiddenPage />
  return (
    <BrandDocuments
      key={brand.current.id}
      brandId={brand.current.id}
      brandName={brand.current.name}
      admin={brand.isAdmin}
      review={review}
    />
  )
}
function BrandDocuments({
  brandId,
  brandName,
  admin,
  review,
}: {
  brandId: string
  brandName: string
  admin: boolean
  review: boolean
}) {
  const client = useQueryClient(),
    navigate = useNavigate()
  const [status, setStatus] = useState<DocumentStatus | "">("")
  const [type, setType] = useState<DocumentType | "">("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [upload, setUpload] = useState(false)
  const clear = () => {
    setQ("")
    setType("")
    setStatus("")
    setPage(1)
  }
  const filtered = Boolean(q || type || (!review && status))
  const documents = useQuery({
    queryKey: ["knowledge", brandId, review, status, type, q, page],
    queryFn: async ({ signal }) =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: {
            status: review ? "pending_review" : status || undefined,
            doc_type: type || undefined,
            q: q || undefined,
            page,
            page_size: 20,
          },
          signal,
        })
      ).data,
  })
  const pending = useQuery({
    queryKey: ["knowledge-pending", brandId],
    queryFn: async () =>
      (
        await KnowledgeService.readDocuments({
          path: { brand_id: brandId },
          query: { status: "pending_review", page: 1, page_size: 1 },
        })
      ).data.total,
    enabled: admin,
  })
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 basis-80">
          <h1 className="text-2xl font-bold">
            {review ? T.reviewTitle : T.title}
          </h1>
          <p className="text-sm text-muted-foreground">
            {review ? T.queueDescription : T.description}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {V.workspace}
            {brandName}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SearchBox
            value={q}
            placeholder="搜索资料标题或文件名"
            onChange={(v) => {
              setQ(v)
              setPage(1)
            }}
          />
          {filtered && (
            <Button variant="ghost" onClick={clear}>
              {T.clear}
            </Button>
          )}
          {review ? (
            <Button asChild variant="outline">
              <Link to="/knowledge">{T.back}</Link>
            </Button>
          ) : (
            <>
              {admin && (
                <Button asChild variant="outline">
                  <Link to="/knowledge/review">
                    {T.queue}
                    {pending.data !== undefined ? ` (${pending.data})` : ""}
                  </Link>
                </Button>
              )}
              <Button onClick={() => setUpload(true)}>
                {admin ? T.upload : T.submit}
              </Button>
            </>
          )}
        </div>
      </div>
      {documents.isLoading && <LoadingState className="h-48 w-full" />}
      {documents.isError && (
        <KnowledgeError
          error={documents.error}
          retry={() => documents.refetch()}
        />
      )}
      {documents.data && !documents.isError && (
        <div className="min-w-0 overflow-x-auto rounded-xl bg-card shadow-sm">
          <Table className="w-full min-w-[62rem] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-72 whitespace-nowrap">
                  {V.documentTitle}
                </TableHead>
                <TableHead className="whitespace-nowrap">
                  <HeaderFilter
                    title={V.typeColumn}
                    value={type}
                    onChange={(v) => {
                      setType(v as DocumentType | "")
                      setPage(1)
                    }}
                    options={Object.entries(DOCUMENT_TYPE_LABEL).map(
                      ([value, label]) => ({ value, label }),
                    )}
                  />
                </TableHead>
                <TableHead className="min-w-32 whitespace-nowrap">
                  {review ? (
                    T.relation
                  ) : (
                    <HeaderFilter
                      title={V.documentStatus}
                      value={status}
                      onChange={(v) => {
                        setStatus(v as DocumentStatus | "")
                        setPage(1)
                      }}
                      options={Object.entries(DOCUMENT_STATUS_LABEL).map(
                        ([value, label]) => ({ value, label }),
                      )}
                    />
                  )}
                </TableHead>
                {!review && (
                  <TableHead className="whitespace-nowrap">{T.index}</TableHead>
                )}
                <TableHead className="whitespace-nowrap">{T.version}</TableHead>
                <TableHead className="whitespace-nowrap">{T.author}</TableHead>
                <TableHead className="whitespace-nowrap">{V.updated}</TableHead>
                <TableHead className="whitespace-nowrap text-right">
                  {V.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.data.items.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={review ? 6 : 7}
                    className="whitespace-normal py-10 text-center text-sm text-muted-foreground"
                  >
                    {review
                      ? T.noPending
                      : filtered
                        ? T.filteredEmpty
                        : T.empty}
                  </TableCell>
                </TableRow>
              )}
              {documents.data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="min-w-72 whitespace-normal">
                    <Link
                      className="flex items-start gap-2.5 hover:text-link"
                      to="/knowledge/$id"
                      params={{ id: row.id }}
                    >
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-link">
                        <FileText className="size-4" />
                      </span>
                      <span className="line-clamp-2 text-sm font-medium leading-6 text-foreground [overflow-wrap:anywhere]">
                        {row.title}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {label(DOCUMENT_TYPE_LABEL, row.doc_type)}
                  </TableCell>
                  <TableCell>
                    {review ? (
                      row.version > 1 ? (
                        T.update
                      ) : (
                        T.newDocument
                      )
                    ) : (
                      <DocumentStatusBadge status={row.status} />
                    )}
                  </TableCell>
                  {!review && (
                    <TableCell>
                      <IndexBadge
                        documentStatus={row.status}
                        status={row.index_status}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-sm">
                    v{row.version}
                    {row.is_current && (
                      <p className="mt-1 text-xs text-tone-ok">{T.current}</p>
                    )}
                  </TableCell>
                  <TableCell className="min-w-32">
                    <span
                      className="block truncate"
                      title={row.submitted_by_name || T.unknown}
                    >
                      {row.submitted_by_name || T.unknown}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-normal text-xs text-muted-foreground">
                    {formatTime(row.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      className="whitespace-nowrap text-sm font-medium text-link hover:underline"
                      to="/knowledge/$id"
                      params={{ id: row.id }}
                    >
                      {review ? T.review : V.viewDetails}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {documents.data && !documents.isError && (
        <Pager page={page} total={documents.data.total} onPage={setPage} />
      )}
      {upload && (
        <UploadDocument
          brandId={brandId}
          admin={admin}
          onClose={() => setUpload(false)}
          onSaved={(row) => {
            setUpload(false)
            void client.invalidateQueries({ queryKey: ["knowledge"] })
            void client.invalidateQueries({ queryKey: ["knowledge-pending"] })
            void navigate({ to: "/knowledge/$id", params: { id: row.id } })
          }}
        />
      )}
    </div>
  )
}
