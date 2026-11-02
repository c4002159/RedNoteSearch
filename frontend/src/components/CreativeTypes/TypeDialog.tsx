import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { type CreativeTypePublic, CreativeTypesService } from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
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
import { codePointCount } from "@/lib/count"
import { PAGE_ERROR_TEXT, CREATIVE_TYPE_DIALOG_TEXT as T } from "@/lib/zh"

export type TypeAction =
  | { kind: "create" }
  | { kind: "rename" | "delete"; row: CreativeTypePublic }
export function TypeDialog({
  brandId,
  action,
  onClose,
  onSaved,
}: {
  brandId: string
  action: TypeAction
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [name, setName] = useState(
    action.kind === "create" ? "" : action.row.name,
  )
  const deleting = action.kind === "delete"
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.kind === "delete")
        return CreativeTypesService.typesDeleteCreativeType({
          path: { brand_id: brandId, key: action.row.key },
        })
      if (action.kind === "rename")
        return CreativeTypesService.typesRenameCreativeType({
          path: { brand_id: brandId, key: action.row.key },
          body: { name: name.trim() },
        })
      return CreativeTypesService.typesCreateCreativeType({
        path: { brand_id: brandId },
        body: { name: name.trim() },
      })
    },
    onSuccess: async () => {
      await onSaved()
      onClose()
    },
  })
  const error = mutation.isError ? parseApiError(mutation.error) : null
  const used =
    deleting &&
    error?.status === 409 &&
    typeof error.details.templates === "number" &&
    typeof error.details.confirmed_copies === "number"
  const message = error
    ? used
      ? T.used(
          Number(error.details.templates),
          Number(error.details.confirmed_copies),
        )
      : error.status === 409
        ? T.conflict
        : /[\u3400-\u9fff]/.test(error.message)
          ? error.message
          : (PAGE_ERROR_TEXT.status[error.status ?? 0] ??
            PAGE_ERROR_TEXT.failed)
    : ""
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !mutation.isPending && onClose()}
    >
      <DialogContent
        className="rounded-xl border-0 p-6 sm:max-w-lg"
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {deleting
              ? T.remove
              : action.kind === "rename"
                ? T.rename
                : T.create}
          </DialogTitle>
          <DialogDescription>
            {deleting
              ? T.deleteHint(action.row.name)
              : action.kind === "rename"
                ? T.renameHint
                : T.createHint}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (deleting || (name.trim() && codePointCount(name.trim()) <= 20))
              mutation.mutate()
          }}
        >
          {!deleting && (
            <div className="space-y-2">
              <label
                htmlFor="creative-type-name"
                className="text-sm font-medium"
              >
                {T.name}
              </label>
              <Input
                id="creative-type-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={mutation.isPending}
                autoFocus
              />
              <div className="flex justify-end">
                <CharCounter value={codePointCount(name)} limit={20} />
              </div>
            </div>
          )}
          {error && <ErrorBanner error={{ ...error, message }} />}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              {T.cancel}
            </Button>
            <LoadingButton
              type="submit"
              variant={deleting ? "destructive" : "default"}
              loading={mutation.isPending}
              disabled={
                !deleting && (!name.trim() || codePointCount(name.trim()) > 20)
              }
            >
              {deleting ? T.confirmDelete : T.save}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
