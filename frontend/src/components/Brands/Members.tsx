import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { BrandsService, type MemberPublic, type MemberRole } from "@/client"
import { EmptyState } from "@/components/Common/EmptyState"
import { LoadingState } from "@/components/Common/LoadingState"
import { Button } from "@/components/ui/button"
import { label, ROLE_LABEL, BRAND_PAGE_TEXT as T } from "@/lib/zh"
import { AddMember } from "./AddMember"
import { BrandConfirm, BrandError } from "./Feedback"

export function Members({ brandId }: { brandId: string }) {
  const cache = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [action, setAction] = useState<{
    row: MemberPublic
    role?: MemberRole
  } | null>(null)
  const query = useQuery({
    queryKey: ["brand-members", brandId],
    queryFn: async ({ signal }) =>
      (await BrandsService.readMembers({ path: { brand_id: brandId }, signal }))
        .data.items,
  })
  const mutation = useMutation({
    mutationFn: async () => {
      if (!action) return
      const path = { brand_id: brandId, user_id: action.row.user_id }
      return action.role
        ? BrandsService.updateMember({ path, body: { role: action.role } })
        : BrandsService.removeMember({ path })
    },
    onSuccess: async () => {
      setAction(null)
      toast.success(T.saved)
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["brand-members", brandId] }),
        cache.invalidateQueries({ queryKey: ["brands"] }),
      ])
    },
  })
  return (
    <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">{T.members}</h2>
        <Button size="sm" onClick={() => setAdding(true)}>
          {T.addMember}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{T.lastAdmin}</p>
      {adding && (
        <AddMember
          brandId={brandId}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            toast.success(T.saved)
            void cache.invalidateQueries({
              queryKey: ["brand-members", brandId],
            })
          }}
        />
      )}
      {query.isLoading && <LoadingState className="h-32 w-full" />}
      {query.isError && (
        <BrandError error={query.error} retry={() => query.refetch()} />
      )}
      {query.data &&
        !query.isError &&
        (query.data.length === 0 ? (
          <EmptyState title={T.noMembers} />
        ) : (
          <ul className="divide-y">
            {query.data.map((m) => (
              <li
                key={m.user_id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">
                    {m.full_name || T.unknownUser}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {m.email}
                  </p>
                </div>
                <select
                  aria-label={`${T.role}：${m.email}`}
                  value={m.role}
                  className="h-10 rounded-lg border border-transparent bg-surface-low px-2 text-sm"
                  disabled={mutation.isPending}
                  onChange={(e) => {
                    mutation.reset()
                    setAction({ row: m, role: e.target.value as MemberRole })
                  }}
                >
                  {!(m.role in ROLE_LABEL) && (
                    <option value={m.role}>{label(ROLE_LABEL, m.role)}</option>
                  )}
                  {(["admin", "editor"] as const).map((role) => (
                    <option key={role} value={role}>
                      {label(ROLE_LABEL, role)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    mutation.reset()
                    setAction({ row: m })
                  }}
                >
                  {T.remove}
                </Button>
              </li>
            ))}
          </ul>
        ))}
      {action && (
        <BrandConfirm
          title={action.role ? T.changeRole : T.remove}
          description={`${action.row.email} · ${action.role ? label(ROLE_LABEL, action.role) : T.removeHint}`}
          pending={mutation.isPending}
          error={mutation.error}
          onClose={() => setAction(null)}
          onConfirm={() => mutation.mutate()}
        />
      )}
    </section>
  )
}
