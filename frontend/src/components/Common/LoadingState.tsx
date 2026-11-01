import { Skeleton } from "@/components/ui/skeleton"
import { PAGE_LOADING_TEXT } from "@/lib/zh"

export function LoadingState({ className }: { className?: string }) {
  return (
    <div role="status" className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {PAGE_LOADING_TEXT.loading}
      </p>
      <Skeleton className={className} />
    </div>
  )
}
