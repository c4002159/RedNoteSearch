import type { ColumnDef } from "@tanstack/react-table"
import type { UserPublic } from "@/client"
import type { DataTableFeatures } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { SHELL_TEXT } from "@/lib/zh"
import { UserActionsMenu } from "./UserActionsMenu"

export type UserTableData = UserPublic & {
  isCurrentUser: boolean
}

export const columns: ColumnDef<DataTableFeatures, UserTableData>[] = [
  {
    accessorKey: "full_name",
    header: SHELL_TEXT.fullName,
    cell: ({ row }) => {
      const fullName = row.original.full_name
      return (
        <div className="flex items-center gap-2">
          <span
            className={cn("font-medium", !fullName && "text-muted-foreground")}
          >
            {fullName || SHELL_TEXT.na}
          </span>
          {row.original.isCurrentUser && (
            <Badge variant="outline" className="text-xs">
              {SHELL_TEXT.you}
            </Badge>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "email",
    header: SHELL_TEXT.email,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.email}</span>
    ),
  },
  {
    accessorKey: "is_superuser",
    header: SHELL_TEXT.role,
    cell: ({ row }) => (
      <Badge variant={row.original.is_superuser ? "default" : "secondary"}>
        {row.original.is_superuser ? SHELL_TEXT.superuser : SHELL_TEXT.user}
      </Badge>
    ),
  },
  {
    accessorKey: "is_active",
    header: SHELL_TEXT.status,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 rounded-full",
            row.original.is_active ? "bg-green-500" : "bg-gray-400",
          )}
        />
        <span className={row.original.is_active ? "" : "text-muted-foreground"}>
          {row.original.is_active ? SHELL_TEXT.active : SHELL_TEXT.inactive}
        </span>
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">{SHELL_TEXT.actions}</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <UserActionsMenu user={row.original} />
      </div>
    ),
  },
]
