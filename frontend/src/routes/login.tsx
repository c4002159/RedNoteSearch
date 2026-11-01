import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { LoginService } from "@/client"
import { AuthLayout } from "@/components/Common/AuthLayout"
import { ErrorBanner } from "@/components/Common/ErrorBanner"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { isLoggedIn } from "@/hooks/useAuth"
import { parseApiError } from "@/lib/apiError"
import { SETTINGS_TEXT as T } from "@/lib/zh"

const schema = z.object({
  username: z.string().trim().pipe(z.email(T.invalidEmail)),
  password: z.string().min(1, T.passwordRequired),
})
export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: () => {
    if (isLoggedIn()) throw redirect({ to: "/" })
  },
  head: () => ({ meta: [{ title: `${T.login} - RedNoteSearch` }] }),
})
function Login() {
  const cache = useQueryClient(),
    navigate = useNavigate()
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: "", password: "" },
    mode: "onBlur",
  })
  const mutation = useMutation({
    mutationFn: async (body: z.infer<typeof schema>) => {
      // Invalid credentials belong to this public form, not the authenticated session error handler.
      try {
        return {
          token: (await LoginService.loginAccessToken({ body })).data
            .access_token,
        }
      } catch (error) {
        const info = parseApiError(error)
        return {
          error:
            info.status === 400 || info.status === 401
              ? { ...info, message: T.invalidCredentials }
              : info,
        }
      }
    },
    onSuccess: (result) => {
      if (result.token) {
        cache.clear()
        localStorage.setItem("access_token", result.token)
        void navigate({ to: "/" })
      }
    },
  })
  const error = mutation.data?.error
  return (
    <AuthLayout>
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={form.handleSubmit((v) => {
          if (!mutation.isPending) mutation.mutate(v)
        })}
      >
        <h1 className="text-center text-2xl font-bold">{T.loginTitle}</h1>
        <fieldset disabled={mutation.isPending} className="space-y-4">
          <legend className="sr-only">{T.login}</legend>
          <div>
            <label htmlFor="login-email">{T.loginEmail}</label>
            <Input
              id="login-email"
              data-testid="email-input"
              type="email"
              autoComplete="username"
              {...form.register("username")}
            />
            <p className="text-xs text-destructive">
              {form.formState.errors.username?.message}
            </p>
          </div>
          <div>
            <label htmlFor="login-password">{T.loginPassword}</label>
            <PasswordInput
              id="login-password"
              data-testid="password-input"
              autoComplete="current-password"
              {...form.register("password")}
            />
            <p className="text-xs text-destructive">
              {form.formState.errors.password?.message}
            </p>
          </div>
        </fieldset>
        {error && (
          <div className="[&_span.inline-flex]:flex-wrap [&_code]:break-all [&_code]:whitespace-normal [&_button]:shrink-0">
            <ErrorBanner error={error} />
            {error.status === 403 && (
              <ForbiddenPage requestId={error.requestId} />
            )}
          </div>
        )}
        <LoadingButton type="submit" loading={mutation.isPending}>
          {mutation.isPending ? T.loading : T.login}
        </LoadingButton>
        <Link to="/recover-password" className="text-center text-sm text-link">
          {T.recover}
        </Link>
        <p className="text-center text-xs text-muted-foreground">
          {T.noSignup}
        </p>
      </form>
    </AuthLayout>
  )
}
