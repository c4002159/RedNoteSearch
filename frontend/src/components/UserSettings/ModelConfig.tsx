import { useQuery } from "@tanstack/react-query"
import { EvaluationService } from "@/client"
import { Pill } from "@/components/Common/StatusBadge"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsError } from "./Feedback"

// 只读：模型清单来自后端；密钥只放在服务器的 .env，网页不保存也不显示。
export default function ModelConfig() {
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await EvaluationService.readModels()).data,
  })
  const items = models.data?.items ?? []
  return (
    <section className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-base font-semibold">模型与密钥</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          生成、检查和评测用的模型由部署人员在服务器上配置。接口密钥只保存在服务器的
          <code className="mx-1 rounded bg-surface-low px-1">.env</code>
          文件里，网页不会保存、也不会显示；需要更换密钥或模型，请联系管理员修改后重启服务。
        </p>
      </div>
      {models.isLoading && <Skeleton className="h-20 w-full" />}
      {models.isError && (
        <SettingsError error={models.error} retry={() => models.refetch()} />
      )}
      {models.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">还没有配置模型。</p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border/40">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-3 py-3 text-sm"
            >
              <span className="font-medium">{m.model_name}</span>
              <span className="text-muted-foreground">{m.provider}</span>
              <span className="ml-auto">
                <Pill tone={m.enabled ? "ok" : "gray"}>
                  {m.enabled ? "已启用" : "未启用"}
                </Pill>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
