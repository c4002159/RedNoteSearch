import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { BrandsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { parseApiError } from "@/lib/apiError"
import { ROLE_LABEL, BRAND_PAGE_TEXT as T } from "@/lib/zh"
import { BrandError } from "./Feedback"

const schema = z.object({
  email: z.string().trim().pipe(z.email(T.emailInvalid)),
  role: z.enum(["admin", "editor"]),
})
export function AddMember({
  brandId,
  onClose,
  onSaved,
}: {
  brandId: string
  onClose: () => void
  onSaved: () => void
}) {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", role: "editor" },
  })
  const mutation = useMutation({
    mutationFn: (body: z.infer<typeof schema>) =>
      BrandsService.addMember({ path: { brand_id: brandId }, body }),
    onSuccess: onSaved,
  })
  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(e) => mutation.isPending && e.preventDefault()}
        onInteractOutside={(e) => mutation.isPending && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{T.addMember}</DialogTitle>
          <DialogDescription>{T.addHint}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
        >
          <fieldset disabled={mutation.isPending} className="space-y-3">
            <legend className="sr-only">{T.addMember}</legend>
            <div>
              <label htmlFor="member-email">{T.email}</label>
              <Input
                id="member-email"
                type="email"
                {...form.register("email")}
              />
              <p className="text-xs text-destructive">
                {form.formState.errors.email?.message}
              </p>
            </div>
            <div>
              <label htmlFor="member-role">{T.role}</label>
              <select
                id="member-role"
                className="h-10 w-full rounded-lg border border-transparent bg-surface-low px-3 text-sm"
                {...form.register("role")}
              >
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
          {mutation.isError && (
            <BrandError
              error={mutation.error}
              message={
                (
                  {
                    404: T.emailNotFound,
                    409: T.alreadyMember,
                    422: T.invalidRole,
                  } as Record<number, string>
                )[parseApiError(mutation.error).status ?? 0]
              }
            />
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              {T.cancel}
            </Button>
            <LoadingButton type="submit" loading={mutation.isPending}>
              {T.addMember}
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
