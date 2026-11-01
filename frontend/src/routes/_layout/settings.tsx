import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { UsersService } from "@/client"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import { SettingsError } from "@/components/UserSettings/Feedback"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SETTINGS_TEXT as T } from "@/lib/zh"
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{T.title}</h1>
        <p className="text-sm text-muted-foreground">{T.description}</p>
      </div>
      {user.isLoading && <Skeleton className="h-40 w-full" />}
      {user.isError && (
        <SettingsError error={user.error} retry={() => user.refetch()} />
      )}{" "}
      {user.data && !user.isError && (
        <Tabs defaultValue="profile">
          <TabsList>
            <TabsTrigger value="profile">{T.profile}</TabsTrigger>
            <TabsTrigger value="password">{T.passwordTab}</TabsTrigger>
          </TabsList>
          <TabsContent value="profile">
            <UserInformation key={user.data.id} user={user.data} />
          </TabsContent>
          <TabsContent value="password">
            <ChangePassword />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
