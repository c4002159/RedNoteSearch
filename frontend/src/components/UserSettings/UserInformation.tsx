import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { type UserPublic, UsersService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { codePointCount } from "@/lib/count"
import { SETTINGS_TEXT as T } from "@/lib/zh"
import { SettingsError } from "./Feedback"

const schema = z.object({
  full_name: z.string().refine((v) => codePointCount(v) <= 255, T.nameLimit),
})
export default function UserInformation({ user }: { user: UserPublic }) {
  const cache = useQueryClient()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: user.full_name ?? "" },
  })
  const { isDirty } = form.formState
  useEffect(() => {
    if (!isDirty) form.reset({ full_name: user.full_name ?? "" })
  }, [user.full_name, isDirty, form.reset])
  const mutation = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) =>
      (
        await UsersService.updateUserMe({
          body: { full_name: v.full_name.trim() || null },
        })
      ).data,
    onSuccess: (u) => {
      cache.setQueryData(["currentUser"], u)
      form.reset({ full_name: u.full_name ?? "" })
      toast.success(T.profileSaved)
    },
  })
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-5"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="text-lg font-semibold">{T.profile}</h2>
      <fieldset disabled={mutation.isPending} className="space-y-4">
        <legend className="sr-only">{T.profile}</legend>
        <div>
          <label htmlFor="settings-name">{T.name}</label>
          <Input id="settings-name" {...form.register("full_name")} />
          <p className="text-xs text-destructive">
            {form.formState.errors.full_name?.message}
          </p>
        </div>
        <div>
          <label htmlFor="settings-email">{T.email}</label>
          <Input
            id="settings-email"
            type="email"
            value={user.email}
            readOnly
            aria-describedby="email-hint"
          />
          <p id="email-hint" className="text-xs text-muted-foreground">
            {T.emailHint}
          </p>
        </div>
      </fieldset>
      {mutation.isError && <SettingsError error={mutation.error} />}
      <div className="flex gap-2">
        <LoadingButton
          type="submit"
          loading={mutation.isPending}
          disabled={!isDirty}
        >
          {T.save}
        </LoadingButton>
        <Button
          type="button"
          variant="outline"
          disabled={!isDirty || mutation.isPending}
          onClick={() => {
            form.reset({ full_name: user.full_name ?? "" })
            mutation.reset()
          }}
        >
          {T.reset}
        </Button>
      </div>
    </form>
  )
}
