import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ViralService } from "@/client"
import { Pill } from "@/components/Common/StatusBadge"
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
import { TableCell } from "@/components/ui/table"
import { ANALYSIS_VISUAL_TEXT as V } from "@/lib/zh"
import { ViralError } from "./Feedback"

// Counts come from the existing authorized patterns endpoint, not a guessed job state.
export function SampleStructureCells({ id }: { id: string }) {
  const [errorOpen, setErrorOpen] = useState(false)
  const count = useQuery({
    queryKey: ["viral-pattern-count", id],
    queryFn: async ({ signal }) =>
      (
        await ViralService.readPatterns({
          path: { sample_id: id },
          query: { page: 1, page_size: 1 },
          signal,
        })
      ).data.total,
  })
  if (count.isLoading)
    return (
      <>
        <TableCell>
          <Skeleton className="h-5 w-20" />
        </TableCell>
        <TableCell>
          <Skeleton className="h-5 w-8" />
        </TableCell>
      </>
    )
  if (count.isError)
    return (
      <>
        <TableCell>
          <Button
            className="text-tone-err"
            variant="ghost"
            size="sm"
            onClick={() => setErrorOpen(true)}
          >
            {V.unread}
          </Button>
        </TableCell>
        <TableCell>
          —
          {errorOpen && (
            <Dialog open onOpenChange={setErrorOpen}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{V.readCountError}</DialogTitle>
                  <DialogDescription>{V.countHint}</DialogDescription>
                </DialogHeader>
                <ViralError error={count.error} retry={() => count.refetch()} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setErrorOpen(false)}>
                    {V.close}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </TableCell>
      </>
    )
  return (
    <>
      <TableCell>
        <Pill className="whitespace-nowrap" tone={count.data ? "info" : "gray"}>
          {count.data ? V.hasPatterns : V.noPatterns}
        </Pill>
      </TableCell>
      <TableCell>{count.data}</TableCell>
    </>
  )
}
