import {
  type ColumnDef,
  createPaginatedRowModel,
  flexRender,
  type RowData,
  rowPaginationFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table"
import { SimplePager } from "@/components/Common/SimplePager"
import {
  type TableBatchAction,
  TableBatchBar,
  TableSelectAll,
  TableSelectRow,
} from "@/components/Common/TableBatchBar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SHELL_TEXT } from "@/lib/zh"

const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

export type DataTableFeatures = typeof dataTableFeatures

interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData>[]
  data: TData[]
  selection?: {
    selected: Set<string>
    onChange: (ids: Set<string>) => void
    getId: (row: TData) => string
    getLabel: (row: TData) => string
    canSelect?: (row: TData) => boolean
    total: number
    loadAll: () => Promise<string[]>
    actions: TableBatchAction[]
  }
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  selection,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
  })

  const visible = table.getRowModel().rows
  const pageIds = selection
    ? visible
        .filter((row) => selection.canSelect?.(row.original) !== false)
        .map((row) => selection.getId(row.original))
    : []
  return (
    <div className="flex flex-col gap-4">
      {selection && <TableBatchBar {...selection} pageIds={pageIds} />}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className="hover:bg-transparent">
              {selection && (
                <TableHead className="w-12">
                  <TableSelectAll {...selection} pageIds={pageIds} />
                </TableHead>
              )}
              {headerGroup.headers.map((header) => {
                return (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={
                  selection?.selected.has(selection.getId(row.original))
                    ? "selected"
                    : undefined
                }
              >
                {selection && (
                  <TableCell>
                    <TableSelectRow
                      {...selection}
                      id={selection.getId(row.original)}
                      label={selection.getLabel(row.original)}
                      disabled={selection.canSelect?.(row.original) === false}
                    />
                  </TableCell>
                )}
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={columns.length + (selection ? 1 : 0)}
                className="h-32 text-center text-muted-foreground"
              >
                {SHELL_TEXT.noResults}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <SimplePager
        page={table.state.pagination.pageIndex + 1}
        total={data.length}
        size={table.state.pagination.pageSize}
        onPage={(page) => table.setPageIndex(page - 1)}
      />
    </div>
  )
}
