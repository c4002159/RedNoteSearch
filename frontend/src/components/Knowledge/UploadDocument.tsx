import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import {
  type DocumentPublic,
  type DocumentType,
  KnowledgeService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { parseApiError } from "@/lib/apiError"
import { DOCUMENT_TYPE_LABEL, KB_TEXT as T } from "@/lib/zh"
import { KnowledgeError } from "./Feedback"

const schema = z.object({
  title: z.string().trim().min(1, T.titleRequired).max(200, T.titleLimit),
  doc_type: z.enum([
    "brand_story",
    "product_spec",
    "ingredient",
    "award_claim",
    "compliance_policy",
    "sample_note",
  ]),
})
type Values = z.infer<typeof schema>
export function UploadDocument({
  brandId,
  admin,
  previous,
  onClose,
  onSaved,
}: {
  brandId: string
  admin: boolean
  previous?: { id: string; title: string; doc_type: string }
  onClose: () => void
  onSaved: (row: DocumentPublic) => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState("")
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: previous?.title ?? "",
      doc_type: (previous?.doc_type ?? "brand_story") as DocumentType,
    },
  })
  const mutation = useMutation({
    mutationFn: async (values: Values) => {
      if (!file) throw new Error(T.selectFile)
      const options = { body: { ...values, file }, timeout: 600_000 }
      return (
        admin
          ? previous
            ? await KnowledgeService.ingestNewVersion({
                ...options,
                path: { document_id: previous.id },
              })
            : await KnowledgeService.ingestDocument({
                ...options,
                path: { brand_id: brandId },
              })
          : await KnowledgeService.submitDocument({
              ...options,
              path: { brand_id: brandId },
              body: { ...values, file, supersedes_document_id: previous?.id },
            })
      ).data
    },
    onSuccess: onSaved,
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !mutation.isPending && onClose()}
    >
      <DialogContent
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {previous
              ? admin
                ? T.uploadVersion
                : T.submitVersion
              : admin
                ? T.upload
                : T.submit}
          </DialogTitle>
          <DialogDescription>
            {admin ? T.ingestHint : T.submitHint}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) => {
            if (!file) {
              setFileError(T.selectFile)
              return
            }
            if (!fileError) mutation.mutate(values)
          })}
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <legend className="sr-only">{T.upload}</legend>
            <div className="space-y-1">
              <label htmlFor="kb-file" className="text-sm font-medium">
                {T.file}
              </label>
              <Input
                id="kb-file"
                type="file"
                accept=".pdf,.docx,.md,.txt,.csv"
                onChange={(e) => {
                  const selected = e.target.files?.[0] ?? null
                  setFile(selected)
                  mutation.reset()
                  const extension =
                    selected?.name.split(".").pop()?.toLowerCase() ?? ""
                  setFileError(
                    !selected
                      ? T.selectFile
                      : !["pdf", "docx", "md", "txt", "csv"].includes(extension)
                        ? T.unsupported
                        : selected.size >
                            (["pdf", "docx"].includes(extension) ? 50 : 5) *
                              1024 *
                              1024
                          ? T.tooLarge
                          : "",
                  )
                  if (selected && !form.getValues("title"))
                    form.setValue(
                      "title",
                      selected.name.replace(/\.[^.]+$/, ""),
                    )
                }}
              />
              {file && (
                <p className="text-xs text-muted-foreground">{T.fileHint}</p>
              )}
              {file && fileError && (
                <p role="alert" className="text-sm text-destructive">
                  {fileError}
                </p>
              )}
            </div>
            <div className="space-y-1">
              <label htmlFor="kb-title" className="text-sm font-medium">
                {T.documentTitle}
              </label>
              <Input
                id="kb-title"
                {...form.register("title")}
                aria-invalid={!!form.formState.errors.title}
              />
              <p className="text-xs text-destructive">
                {form.formState.errors.title?.message}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="kb-type" className="text-sm font-medium">
                {T.type}
              </label>
              <select
                id="kb-type"
                className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-3 text-sm"
                {...form.register("doc_type")}
              >
                {Object.entries(DOCUMENT_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          {mutation.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              {T.longRequest}
            </p>
          )}
          {mutation.isError && (
            <>
              <KnowledgeError error={mutation.error} />
              {parseApiError(mutation.error).status === null && (
                <p className="text-sm text-muted-foreground">{T.timeoutHint}</p>
              )}
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {T.cancelled}
            </Button>
            <LoadingButton
              type="submit"
              loading={mutation.isPending}
              disabled={!file || !!fileError}
            >
              {mutation.isPending ? T.processing : admin ? T.upload : T.submit}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
