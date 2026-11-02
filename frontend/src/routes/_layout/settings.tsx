import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { UsersService } from "@/client"
import { ForbiddenPage } from "@/components/Common/ForbiddenPage"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import { ExtensionKeysSettings } from "@/components/UserSettings/ExtensionKeysSettings"
import { SettingsError } from "@/components/UserSettings/Feedback"
import ModelConfig from "@/components/UserSettings/ModelConfig"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useBrand } from "@/hooks/useBrand"
import { SETTINGS_TEXT as T, T5_VISUAL_TEXT as V } from "@/lib/zh"
export const Route = createFileRoute("/_layout/settings")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: "profile" | "password" | "models" | "plugin" } => ({
    tab:
      search.tab === "password" ||
      search.tab === "models" ||
      search.tab === "plugin"
        ? search.tab
        : "profile",
  }),
  component: SettingsPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})
function SettingsPage() {
  const { tab = "profile" } = Route.useSearch()
  const navigate = Route.useNavigate()
  const brand = useBrand()
  const user = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => (await UsersService.readUserMe()).data,
  })
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        {V.settings} <span aria-hidden="true">›</span> {T.title}
      </p>
      <div>
        <h1 className="text-2xl font-bold">{T.title}</h1>
        <p className="text-sm text-muted-foreground">{T.description}</p>
      </div>
      {user.isLoading && <Skeleton className="h-40 w-full" />}
      {user.isError && (
        <SettingsError error={user.error} retry={() => user.refetch()} />
      )}{" "}
      {user.data && !user.isError && (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            void navigate({ search: { tab: value as typeof tab } })
          }
          className="space-y-6 [&_form]:h-full [&_form]:max-w-none [&_form]:rounded-xl [&_form]:border-0 [&_form]:p-6 [&_form]:shadow-sm [&_form_label]:mb-2 [&_form_label]:block [&_form_input]:border-0 [&_form_input]:bg-surface-low"
        >
          <TabsList className="h-auto w-full flex-wrap justify-start gap-x-6 gap-y-0 rounded-none border-b border-surface bg-transparent p-0">
            <TabsTrigger
              className="flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-3 text-base font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
              value="profile"
            >
              {T.profile}
            </TabsTrigger>
            <TabsTrigger
              className="flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-3 text-base font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
              value="password"
            >
              {T.passwordTab}
            </TabsTrigger>
            {user.data.is_superuser && (
              <TabsTrigger
                className="flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-3 text-base font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
                value="models"
              >
                {T.modelsTab}
              </TabsTrigger>
            )}
            {brand.isAdmin && (
              <TabsTrigger
                className="flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-3 text-base font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
                value="plugin"
              >
                {T.pluginTab}
              </TabsTrigger>
            )}
          </TabsList>
          <div className="min-w-0">
            <TabsContent className="m-0" value="profile">
              <UserInformation key={user.data.id} user={user.data} />
            </TabsContent>
            <TabsContent className="m-0" value="password">
              <ChangePassword />
            </TabsContent>
            {user.data.is_superuser && (
              <TabsContent className="m-0" value="models">
                <ModelConfig />
              </TabsContent>
            )}
            {!user.data.is_superuser && tab === "models" && <ForbiddenPage />}
            <TabsContent className="m-0" value="plugin">
              <ExtensionKeysSettings />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  )
}
