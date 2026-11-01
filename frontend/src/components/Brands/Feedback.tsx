import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
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
import { PAGE_ERROR_TEXT, BRAND_PAGE_TEXT as T } from "@/lib/zh"

export function BrandError({
  error,
  retry,
  message,
}: {
  error: unknown
  retry?: () => void
  message?: string
}) {
  const info = parseApiError(error)
  const localized =
    info.status === 409 &&
    info.message === "A brand must keep at least one admin"
      ? PAGE_ERROR_TEXT.lastAdmin
      : /[\u3400-\u9fff]/.test(info.message)
        ? info.message
        : (PAGE_ERROR_TEXT.status[info.status ?? 0] ?? PAGE_ERROR_TEXT.failed)
  return (
    <div className="space-y-3">
      <ErrorBanner
        error={{ ...info, message: message ?? localized }}
        onRetry={retry}
      />
      {info.status === 403 && <ForbiddenPage requestId={info.requestId} />}
    </div>
  )
}
export function BrandConfirm({
  title,
  description,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string
  description: string
  pending: boolean
  error: unknown
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent
        showCloseButton={!pending}
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onInteractOutside={(e) => pending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {!!error && <BrandError error={error} />}
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={onClose}>
            {T.cancel}
          </Button>
          <LoadingButton loading={pending} onClick={onConfirm}>
            {T.confirm}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
