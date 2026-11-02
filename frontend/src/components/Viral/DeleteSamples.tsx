import { useMutation } from "@tanstack/react-query"
import { ViralService } from "@/client"
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
import { LoadingButton } from "@/components/ui/loading-button"
import { parseApiError } from "@/lib/apiError"
import { VIRAL_DELETE_TEXT as D, PAGE_ERROR_TEXT } from "@/lib/zh"

export function DeleteSamples({
  brandId,
  ids,
  onClose,
  onDeleted,
}: {
  brandId: string
  ids: string[]
  onClose: () => void
  onDeleted: () => Promise<void>
}) {
  const mutation = useMutation({
    mutationFn: async () =>
      (
        await ViralService.deleteSamples({
          path: { brand_id: brandId },
          body: { ids },
        })
      ).data,
    onSuccess: onDeleted,
  })
  const error = mutation.isError ? parseApiError(mutation.error) : null
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
          <DialogTitle>{D.confirmTitle}</DialogTitle>
          <DialogDescription>
            {D.confirm(ids.length)} {D.consequence}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <ErrorBanner
            error={{
              ...error,
              message: /[\u3400-\u9fff]/.test(error.message)
                ? error.message
                : (PAGE_ERROR_TEXT.status[error.status ?? 0] ??
                  PAGE_ERROR_TEXT.failed),
            }}
          />
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {D.cancel}
          </Button>
          <LoadingButton
            variant="destructive"
            loading={mutation.isPending}
            disabled={ids.length < 1 || ids.length > 50}
            onClick={() => mutation.mutate()}
          >
            {D.confirmAction}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
