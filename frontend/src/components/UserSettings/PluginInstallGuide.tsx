import { isAxiosError } from "axios"
import { useState } from "react"
import { toast } from "sonner"
import { ExtensionService } from "@/client"
import { BrandError } from "@/components/Brands/Feedback"
import { Button } from "@/components/ui/button"
import { EXTENSION_KEYS_TEXT as T } from "@/lib/zh"

function StepDiagram({ step }: { step: number }) {
  return (
    <svg
      viewBox="0 0 320 120"
      role="img"
      aria-label={`${T.installSteps[step].title} ${T.diagram}`}
      className="h-32 w-full rounded-lg bg-surface-low text-muted-foreground"
    >
      <rect
        x="18"
        y="12"
        width="284"
        height="96"
        rx="8"
        fill="none"
        stroke="currentColor"
      />
      <path d="M18 34h284" stroke="currentColor" />
      <circle cx="30" cy="23" r="3" fill="currentColor" />
      {step === 0 && (
        <g
          className="text-link"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M70 47v25m-9-9 9 9 9-9M52 77v10h36V77M166 55h19l7 8h58v28h-84zM106 72h37m-7-7 7 7-7 7" />
          <text x="190" y="51" fill="currentColor" stroke="none" fontSize="11">
            {T.folder}
          </text>
        </g>
      )}
      {step === 1 && (
        <g fill="currentColor" fontSize="12">
          <text x="42" y="28">
            {T.extensionAddress}
          </text>
          <text x="42" y="73">
            {T.developerMode}
          </text>
          <rect
            x="232"
            y="56"
            width="44"
            height="23"
            rx="12"
            className="text-link"
          />
          <circle cx="264" cy="67" r="8" className="text-primary-foreground" />
        </g>
      )}
      {step === 2 && (
        <g fill="currentColor" fontSize="11">
          <text x="34" y="52">
            {T.loadUnpacked}
          </text>
          <path d="M38 63h23l7 7h52v26H38z" fill="none" stroke="currentColor" />
          <text x="135" y="73" className="text-link">
            results-helper/
          </text>
          <text x="145" y="92">
            manifest.json
          </text>
        </g>
      )}
      {step === 3 && (
        <g fill="currentColor" fontSize="12">
          <text x="38" y="55">
            {T.connectionSettings}
          </text>
          <rect
            x="38"
            y="64"
            width="120"
            height="27"
            rx="4"
            fill="none"
            stroke="currentColor"
          />
          <text x="48" y="82">
            rnk1.••••••
          </text>
          <text x="180" y="82" className="text-link">
            {T.authorize}
          </text>
        </g>
      )}
    </svg>
  )
}

export function PluginInstallGuide() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const download = async () => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      const { data } = await ExtensionService.downloadExtensionPackage()
      const url = URL.createObjectURL(data)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "results-helper.zip"
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      // Axios uses the requested blob response type for JSON errors too.
      if (isAxiosError(cause) && cause.response?.data instanceof Blob) {
        try {
          cause.response.data = JSON.parse(await cause.response.data.text())
        } catch {
          // Keep the original failure for the shared generic error block.
        }
      }
      setError(cause)
    } finally {
      setPending(false)
    }
  }
  return (
    <details className="rounded-xl bg-card p-5 shadow-sm">
      <summary className="cursor-pointer font-medium focus-visible:ring-2 focus-visible:ring-ring">
        {T.instructions}
      </summary>
      <ol className="mt-5 space-y-5">
        {T.installSteps.map((step, index) => (
          <li
            key={step.title}
            className="grid min-w-0 gap-4 rounded-lg border border-border/40 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
          >
            <div className="min-w-0 space-y-3">
              <h3 className="flex items-center gap-2 font-medium">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-link">
                  {index + 1}
                </span>
                {step.title}
              </h3>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {step.description}
              </p>
              {index === 0 && (
                <Button disabled={pending} onClick={() => void download()}>
                  {pending ? T.downloading : T.download}
                </Button>
              )}
              {index === 1 && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(T.extensionAddress)
                      toast.success(T.copied)
                    } catch {
                      toast.error(T.copyFailed)
                    }
                  }}
                >
                  {T.copyAddress}
                </Button>
              )}
              {index === 0 && !!error && <BrandError error={error} />}
            </div>
            <StepDiagram step={index} />
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm font-medium">{T.updateHint}</p>
      <p className="mt-3 text-sm text-muted-foreground">{T.useHint}</p>
    </details>
  )
}
