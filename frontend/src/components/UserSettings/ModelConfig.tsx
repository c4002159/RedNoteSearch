import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import {
  EvaluationService,
  type ProviderPublic,
  SettingsService,
} from "@/client"
import { ListField } from "@/components/Catalog/Fields"
import { Pill } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { PasswordInput } from "@/components/ui/password-input"
import { Skeleton } from "@/components/ui/skeleton"
import { MODEL_CONFIG_TEXT as T } from "@/lib/zh"
import { SettingsError } from "./Feedback"

const SOURCE = {
  database: { label: T.sourceDatabase, tone: "ok" },
  env: { label: T.sourceEnv, tone: "info" },
  none: { label: T.sourceNone, tone: "gray" },
} as const

function ProviderCard({ provider }: { provider: ProviderPublic }) {
  const cache = useQueryClient()
  const [apiKey, setApiKey] = useState("")
  const [models, setModels] = useState<string[]>(provider.models)
  const done = (message: string) => {
    setApiKey("")
    cache.invalidateQueries({ queryKey: ["providers"] })
    cache.invalidateQueries({ queryKey: ["models"] })
    toast.success(message)
  }
  const save = useMutation({
    mutationFn: () =>
      SettingsService.updateProvider({
        path: { provider: provider.provider },
        body: {
          api_key: apiKey.trim() || undefined,
          models:
            provider.provider === "deepseek" &&
            JSON.stringify(models) !== JSON.stringify(provider.models)
              ? models
              : undefined,
        },
      }),
    onSuccess: () => done(T.savedToast),
  })
  const clear = useMutation({
    mutationFn: () =>
      SettingsService.clearProvider({ path: { provider: provider.provider } }),
    onSuccess: () => done(T.clearedToast),
  })
  const source = SOURCE[provider.key_source]
  const dirty =
    apiKey.trim().length > 0 ||
    (provider.provider === "deepseek" &&
      JSON.stringify(models) !== JSON.stringify(provider.models))
  const busy = save.isPending || clear.isPending
  return (
    <section className="space-y-4 rounded-xl bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold">{provider.label}</h3>
        <Pill tone={source.tone}>{source.label}</Pill>
        {provider.key_hint && (
          <span className="text-xs text-muted-foreground">
            {T.keySaved} {provider.key_hint}
          </span>
        )}
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="space-y-2">
          <label
            htmlFor={`key-${provider.provider}`}
            className="text-sm font-medium"
          >
            {T.keyLabel}
          </label>
          <PasswordInput
            id={`key-${provider.provider}`}
            autoComplete="new-password"
            placeholder={T.keyPlaceholder}
            value={apiKey}
            disabled={busy}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        {provider.provider === "deepseek" && (
          <div className="space-y-1">
            <ListField
              id="deepseek-models"
              title={T.modelsLabel}
              value={models}
              onChange={setModels}
              limit={10}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">{T.modelsHint}</p>
          </div>
        )}
        {(save.isError || clear.isError) && (
          <SettingsError error={save.error ?? clear.error} />
        )}
        <div className="flex flex-wrap items-center justify-end gap-3">
          {provider.key_source === "database" ||
          provider.models_source === "database" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              title={T.clearHint}
              onClick={() => clear.mutate()}
            >
              {T.clear}
            </Button>
          ) : null}
          <LoadingButton
            type="submit"
            loading={save.isPending}
            disabled={!dirty || busy}
          >
            {T.save}
          </LoadingButton>
        </div>
      </form>
    </section>
  )
}

// 仅平台管理员可见：密钥由后端加密保存，页面只显示尾号。
export default function ModelConfig() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await SettingsService.readProviders()).data,
  })
  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => (await EvaluationService.readModels()).data,
  })
  const items = models.data?.items ?? []
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold">{T.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{T.intro}</p>
      </div>
      {providers.isLoading && <Skeleton className="h-40 w-full" />}
      {providers.isError && (
        <SettingsError
          error={providers.error}
          retry={() => providers.refetch()}
        />
      )}
      {providers.data?.items.map((p) => (
        <ProviderCard
          key={`${p.provider}-${p.updated_at}-${p.key_source}`}
          provider={p}
        />
      ))}
      {items.length > 0 && (
        <section className="space-y-2 rounded-xl bg-card p-6 shadow-sm">
          <h3 className="text-base font-semibold">{T.currentModels}</h3>
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
                    {m.enabled ? T.enabled : T.disabled}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {models.data && items.length === 0 && (
        <p className="text-sm text-muted-foreground">{T.noModels}</p>
      )}
    </div>
  )
}
