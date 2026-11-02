import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { Pencil } from "lucide-react"
import { Suspense, useState } from "react"
import { type UserPublic, UsersService } from "@/client"
import AddUser from "@/components/Admin/AddUser"
import { columns, type UserTableData } from "@/components/Admin/columns"
import EditUser from "@/components/Admin/EditUser"
import { DataTable } from "@/components/Common/DataTable"
import { TableBatchDialog } from "@/components/Common/TableBatchDialog"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import useAuth from "@/hooks/useAuth"
import { SHELL_TEXT, TABLE_TEXT as T } from "@/lib/zh"

function getUsersQueryOptions() {
  return {
    queryFn: async () =>
      (await UsersService.readUsers({ query: { skip: 0, limit: 100 } })).data,
    queryKey: ["users"],
  }
}

export const Route = createFileRoute("/_layout/admin")({
  component: Admin,
  beforeLoad: async () => {
    const { data: user } = await UsersService.readUserMe()
    if (!user.is_superuser) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: SHELL_TEXT.adminTitle,
      },
    ],
  }),
})

function UsersTableContent() {
  const { user: currentUser } = useAuth()
  const cache = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const { data: users } = useSuspenseQuery(getUsersQueryOptions())

  const tableData: UserTableData[] = users.data.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  const userColumns: typeof columns = columns.map((column) =>
    "accessorKey" in column && column.accessorKey === "full_name"
      ? {
          ...column,
          cell: ({ row }) => <UserName user={row.original} />,
        }
      : column,
  )
  return (
    <>
      <DataTable
        columns={userColumns}
        data={tableData}
        selection={{
          selected,
          onChange: setSelected,
          getId: (row) => row.id,
          getLabel: (row) => row.full_name || row.email,
          canSelect: (row) => !row.isCurrentUser,
          total: users.count,
          loadAll: async () =>
            (
              await UsersService.readUsers({ query: { skip: 0, limit: 100 } })
            ).data.data
              .filter((row) => row.id !== currentUser?.id)
              .slice(0, 50)
              .map((row) => row.id),
          actions: [
            {
              label: T.delete,
              destructive: true,
              onSelect: () => setDeleting([...selected]),
            },
          ],
        }}
      />
      {deleting && (
        <TableBatchDialog
          ids={deleting}
          title={T.delete}
          execute={(id) => UsersService.deleteUser({ path: { user_id: id } })}
          onClose={() => setDeleting(null)}
          onApplied={(ids) => {
            setSelected(
              (previous) =>
                new Set([...previous].filter((id) => !ids.includes(id))),
            )
            void cache.invalidateQueries({ queryKey: ["users"] })
          }}
        />
      )}
    </>
  )
}

function UserName({ user }: { user: UserTableData }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      {user.full_name &&
        (user.isCurrentUser ? (
          <span>{user.full_name}</span>
        ) : (
          <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group flex items-center gap-1 text-link font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {user.full_name}
                <Pencil
                  aria-hidden
                  className="size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <EditUser user={user} onSuccess={() => setOpen(false)} />
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      {user.isCurrentUser && <Badge variant="outline">{SHELL_TEXT.you}</Badge>}
    </div>
  )
}

function UsersTable() {
  return (
    <Suspense fallback={<PendingUsers />}>
      <UsersTableContent />
    </Suspense>
  )
}

function Admin() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {SHELL_TEXT.users}
          </h1>
          <p className="text-muted-foreground">{SHELL_TEXT.manageUsers}</p>
        </div>
        <AddUser />
      </div>
      <UsersTable />
    </div>
  )
}
