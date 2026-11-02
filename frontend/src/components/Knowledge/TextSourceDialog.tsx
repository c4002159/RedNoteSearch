import { useState } from "react"
import { toast } from "sonner"
import {
  type DocumentPublic,
  type DocumentType,
  KnowledgeService,
  type KnowledgeTextVersion,
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
import { Textarea } from "@/components/ui/textarea"
import { codePointCount } from "@/lib/count"
import { DOCUMENT_TYPE_LABEL, R6_KNOWLEDGE_UI_TEXT as T } from "@/lib/zh"
import { KnowledgeError } from "./Feedback"

export function TextSourceDialog({
  brandId,
  previous,
  onClose,
  onSaved,
}: {
  brandId: string
  previous?: DocumentPublic
  onClose: () => void
  onSaved: (row: DocumentPublic) => void
}) {
  const [title, setTitle] = useState(previous?.title ?? "")
  const [description, setDescription] = useState(
    previous?.source_description ?? "",
  )
  const [text, setText] = useState("")
  const [docType, setDocType] = useState<DocumentType>(
    (previous?.doc_type as DocumentType) ?? "sample_note",
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [validation, setValidation] = useState("")
  const note = !previous || previous.source_kind === "note"
  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        showCloseButton={!pending}
        onEscapeKeyDown={(event) => pending && event.preventDefault()}
        onInteractOutside={(event) => pending && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{previous ? T.editTitle : T.addNote}</DialogTitle>
          <DialogDescription>
            {previous ? T.versionHint : T.submitted}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (pending) return
            const nextTitle = title.trim(),
              nextDescription = description.trim()
            const body: KnowledgeTextVersion = {}
            if (!nextTitle || codePointCount(nextTitle) > 200)
              return setValidation(T.titleError)
            if (note && !nextDescription)
              return setValidation(T.descriptionError)
            if (codePointCount(nextDescription) > 1000)
              return setValidation(T.descriptionLimit)
            if (
              (!previous && !text.trim()) ||
              (text !== "" && !text.trim()) ||
              codePointCount(text) > 50000
            )
              return setValidation(T.textError)
            if (previous) {
              if (nextTitle !== previous.title) body.title = nextTitle
              if (nextDescription !== (previous.source_description ?? ""))
                body.source_description = nextDescription
              if (docType !== previous.doc_type) body.doc_type = docType
              if (text !== "") body.text = text
              if (!Object.keys(body).length) return setValidation(T.unchanged)
            }
            setValidation("")
            setError(null)
            setPending(true)
            try {
              const result = previous
                ? await KnowledgeService.createTextVersion({
                    path: { document_id: previous.id },
                    body,
                  })
                : await KnowledgeService.submitNote({
                    path: { brand_id: brandId },
                    body: {
                      title: nextTitle,
                      source_description: nextDescription,
                      text,
                      doc_type: docType,
                    },
                  })
              toast.success(previous ? T.versionPending : T.submitted)
              onSaved(result.data)
            } catch (cause) {
              setError(cause)
            } finally {
              setPending(false)
            }
          }}
        >
          <fieldset disabled={pending} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="text-source-title">{T.title}</label>
              <Input
                id="text-source-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="text-source-description">{T.description}</label>
              <Textarea
                id="text-source-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {T.descriptionHint}
              </p>
            </div>
            <div className="space-y-1">
              <label htmlFor="text-source-type">{T.type}</label>
              <select
                id="text-source-type"
                className="h-10 w-full rounded-lg bg-surface-low px-2 text-sm"
                value={docType}
                onChange={(event) =>
                  setDocType(event.target.value as DocumentType)
                }
              >
                {Object.entries(DOCUMENT_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label htmlFor="text-source-body">{T.text}</label>
              <Textarea
                id="text-source-body"
                rows={8}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {previous && (
                <p className="text-xs text-muted-foreground">{T.replaceHint}</p>
              )}
            </div>
          </fieldset>
          {validation && (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          )}
          {!!error && <KnowledgeError error={error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton type="submit" loading={pending}>
              {T.submit}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
