import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { UsersService } from "@/client"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { SETTINGS_TEXT as T } from "@/lib/zh"
import { SettingsError } from "./Feedback"

const password = z
  .string()
  .refine(
    (v) => codePointCount(v) >= 8 && codePointCount(v) <= 128,
    T.passwordLength,
  )
const schema = z
  .object({
    current_password: password,
    new_password: password,
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    message: T.passwordMismatch,
    path: ["confirm_password"],
  })
  .refine((v) => v.current_password !== v.new_password, {
    message: T.passwordSame,
    path: ["new_password"],
  })
export default function ChangePassword() {
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      current_password: "",
      new_password: "",
      confirm_password: "",
    },
  })
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      UsersService.updatePasswordMe({
        body: {
          current_password: v.current_password,
          new_password: v.new_password,
        },
      }),
    onSuccess: () => {
      form.reset()
      toast.success(T.passwordSaved)
    },
  })
  const error = parseApiError(mutation.error)
  return (
    <form
      className="max-w-2xl space-y-4 rounded-xl border bg-card p-5"
      onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
    >
      <h2 className="text-lg font-semibold">{T.passwordTab}</h2>
      <p className="text-sm text-muted-foreground">{T.passwordHint}</p>
      <fieldset className="space-y-4" disabled={mutation.isPending}>
        <legend className="sr-only">{T.passwordTab}</legend>
        {(
          [
            {
              key: "current_password",
              title: T.currentPassword,
              testId: "current-password-input",
            },
            {
              key: "new_password",
              title: T.newPassword,
              testId: "new-password-input",
            },
            {
              key: "confirm_password",
              title: T.confirmPassword,
              testId: "confirm-password-input",
            },
          ] as const
        ).map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key}>{f.title}</label>
            <PasswordInput
              id={f.key}
              data-testid={f.testId}
              placeholder={
                f.key === "current_password"
                  ? T.currentPassword
                  : T.passwordPlaceholder
              }
              autoComplete={
                f.key === "current_password"
                  ? "current-password"
                  : "new-password"
              }
              {...form.register(f.key)}
            />
            <p className="text-xs text-destructive">
              {form.formState.errors[f.key]?.message}
            </p>
          </div>
        ))}
      </fieldset>
      {mutation.isError && (
        <SettingsError
          error={mutation.error}
          message={
            error.status === 400 && error.message === "Incorrect password"
              ? T.currentWrong
              : undefined
          }
        />
      )}
      <div className="flex justify-end">
        <LoadingButton
          type="submit"
          loading={mutation.isPending}
          disabled={!form.formState.isDirty}
        >
          {T.updatePassword}
        </LoadingButton>
      </div>
    </form>
  )
}
