import { Link } from "@tanstack/react-router"
import useAuth from "@/hooks/useAuth"
import {
  label,
  MODEL_CONFIGURATION_TEXT as T,
  TASK_ERROR_LABEL,
} from "@/lib/zh"

export function ModelConfigurationHint({ task = false }: { task?: boolean }) {
  const { user } = useAuth()
  const canConfigure = user?.is_superuser === true
  return (
    <div className="space-y-2 text-sm">
      <p>
        {canConfigure
          ? task
            ? TASK_ERROR_LABEL.model_not_configured
            : T.admin
          : T.member}
      </p>
      {canConfigure && (
        <Link
          to="/settings"
          search={{ tab: "models" }}
          className="inline-block text-link underline"
        >
          {T.settings}
        </Link>
      )}
    </div>
  )
}

export function TaskFailureMessage({ error }: { error: string }) {
  return (
    <div role="alert" className="text-sm text-destructive">
      {error === "model_not_configured" ? (
        <ModelConfigurationHint task />
      ) : (
        label(TASK_ERROR_LABEL, error, "task_error")
      )}
    </div>
  )
}
