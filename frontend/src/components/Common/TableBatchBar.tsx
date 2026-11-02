import { ChevronDown } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TABLE_TEXT as T } from "@/lib/zh"

export const TABLE_SELECTION_LIMIT = 50
export type TableSelection = {
  selected: Set<string>
  onChange: (selected: Set<string>) => void
  pageIds: string[]
}
export type TableBatchAction = {
  label: string
  onSelect: () => void
  destructive?: boolean
  disabled?: boolean
}

export function selectTablePage(selection: TableSelection, checked: boolean) {
  const next = new Set(selection.selected)
  for (const id of selection.pageIds) {
    if (!checked) next.delete(id)
    else if (next.size < TABLE_SELECTION_LIMIT) next.add(id)
  }
  selection.onChange(next)
  if (checked && selection.pageIds.some((id) => !next.has(id)))
    toast.info(T.limit)
}

export function TableSelectAll(props: TableSelection) {
  const count = props.pageIds.filter((id) => props.selected.has(id)).length
  return (
    <Checkbox
      aria-label={T.selectPage}
      disabled={!props.pageIds.length}
      checked={
        count === props.pageIds.length && count > 0
          ? true
          : count > 0
            ? "indeterminate"
            : false
      }
      onCheckedChange={(checked) => selectTablePage(props, checked === true)}
    />
  )
}

export function TableSelectRow({
  id,
  selected,
  onChange,
  label,
  disabled = false,
}: Omit<TableSelection, "pageIds"> & {
  id: string
  label: string
  disabled?: boolean
}) {
  return (
    <Checkbox
      aria-label={T.select(label)}
      checked={selected.has(id)}
      disabled={
        disabled ||
        (!selected.has(id) && selected.size >= TABLE_SELECTION_LIMIT)
      }
      onCheckedChange={(checked) => {
        const next = new Set(selected)
        if (checked === true && next.size < TABLE_SELECTION_LIMIT) next.add(id)
        else next.delete(id)
        onChange(next)
      }}
    />
  )
}

export function TableBatchBar({
  selected,
  onChange,
  pageIds,
  total,
  loadAll,
  actions = [],
}: TableSelection & {
  total: number
  loadAll: () => Promise<string[]>
  actions?: TableBatchAction[]
}) {
  const [pending, setPending] = useState(false)
  const latest = useRef(selected)
  const alive = useRef(true)
  latest.current = selected
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  if (!selected.size) return null
  return (
    <div className="ml-auto flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            {T.selected(selected.size)}
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() =>
              selectTablePage({ selected, onChange, pageIds }, true)
            }
          >
            {T.selectPage}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pending}
            onSelect={async () => {
              setPending(true)
              try {
                const ids = await loadAll()
                if (!alive.current || !latest.current.size) return
                const next = new Set(latest.current)
                for (const id of ids)
                  if (next.size < TABLE_SELECTION_LIMIT) next.add(id)
                onChange(next)
                if (
                  total > TABLE_SELECTION_LIMIT ||
                  ids.some((id) => !next.has(id))
                )
                  toast.info(T.limit)
              } catch {
                if (alive.current) toast.error(T.selectFailed)
              } finally {
                if (alive.current) setPending(false)
              }
            }}
          >
            {T.selectAll(total)}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onChange(new Set())}>
            {T.clear}
          </DropdownMenuItem>
          {actions.length > 0 && <DropdownMenuSeparator />}
          {actions.map((action) => (
            <DropdownMenuItem
              key={action.label}
              disabled={action.disabled}
              className={action.destructive ? "text-destructive" : undefined}
              onSelect={action.onSelect}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <p className="max-w-64 px-2 py-1 text-xs text-muted-foreground">
            {T.limit}
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
