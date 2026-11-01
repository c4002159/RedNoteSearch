import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { UsersService } from "@/client"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import { SettingsError } from "@/components/UserSettings/Feedback"
import ModelConfig from "@/components/UserSettings/ModelConfig"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SETTINGS_TEXT as T, T5_VISUAL_TEXT as V } from "@/lib/zh"
export const Route = createFileRoute("/_layout/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: `${T.title} - RedNoteSearch` }] }),
})
function SettingsPage() {
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
          defaultValue="profile"
          className="space-y-6 [&_form]:h-full [&_form]:max-w-none [&_form]:rounded-xl [&_form]:border-0 [&_form]:p-6 [&_form]:shadow-sm [&_form_label]:mb-2 [&_form_label]:block [&_form_input]:border-0 [&_form_input]:bg-surface-low"
        >
          <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b border-surface bg-transparent p-0">
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
            <TabsTrigger
              className="flex-none rounded-none border-0 border-b-2 border-transparent px-0 py-3 text-base font-semibold data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-link data-[state=active]:shadow-none"
              value="models"
            >
              模型与密钥
            </TabsTrigger>
          </TabsList>
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <TabsContent
              forceMount
              className="m-0 data-[state=inactive]:hidden xl:data-[state=inactive]:block"
              value="profile"
            >
              <UserInformation key={user.data.id} user={user.data} />
            </TabsContent>
            <TabsContent
              forceMount
              className="m-0 data-[state=inactive]:hidden xl:data-[state=inactive]:block"
              value="password"
            >
              <ChangePassword />
            </TabsContent>
            <TabsContent className="m-0 xl:col-span-2" value="models">
              <ModelConfig />
            </TabsContent>
          </div>
        </Tabs>
      )}
    </div>
  )
}
