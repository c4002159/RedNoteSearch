import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { type ConfirmedCopyPublic, ResultsService } from "@/client"
import { CharCounter } from "@/components/Common/CharCounter"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { parseApiError } from "@/lib/apiError"
import { codePointCount } from "@/lib/count"
import { RESULTS_TEXT as T } from "@/lib/zh"
import { ResultsError } from "./Feedback"

type Values = {
  title: string
  post_url: string
  published_at: string
  likes: string
  collects: string
  comments: string
  captured_at: string
}
type Field = keyof Values

function localTime(value: string | null) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
}

function validTime(value: string) {
  return (
    !value ||
    (!Number.isNaN(new Date(value).getTime()) &&
      new Date(value).getTime() <= Date.now() + 600000)
  )
}

function validUrl(value: string) {
  if (!value) return true
  try {
    const url = new URL(value)
    return (
      !/\s/u.test(value) &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ["xiaohongshu.com", "xhslink.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
  } catch {
    return false
  }
}

export function RecordDialog({
  copy,
  mode,
  brandId,
  onClose,
}: {
  copy: ConfirmedCopyPublic
  mode: "publish" | "metric"
  brandId: string
  onClose: () => void
}) {
  const cache = useQueryClient()
  const [values, setValues] = useState<Values>({
    title: copy.title,
    post_url: copy.post_url ?? "",
    published_at: localTime(copy.published_at),
    likes: "",
    collects: "",
    comments: "",
    captured_at: "",
  })
  const [approximate, setApproximate] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const mutation = useMutation({
    mutationFn: async () => {
      if (mode === "publish")
        return ResultsService.updateConfirmedCopy({
          path: { copy_id: copy.id },
          body: {
            title: values.title.trim(),
            post_url: values.post_url.trim() || null,
            published_at: values.published_at
              ? new Date(values.published_at).toISOString()
              : null,
          },
        })
      return ResultsService.addMetric({
        path: { copy_id: copy.id },
        body: {
          likes: Number(values.likes),
          collects: Number(values.collects),
          comments: Number(values.comments),
          approximate,
          source: "manual",
          ...(values.captured_at
            ? { captured_at: new Date(values.captured_at).toISOString() }
            : {}),
        },
      })
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["results", brandId] })
      void cache.invalidateQueries({ queryKey: ["results-summary", brandId] })
      onClose()
    },
    onError: (error) => {
      const info = parseApiError(error)
      if (info.status !== 422 || !Array.isArray(info.details.errors)) return
      const next: Partial<Record<Field, string>> = {}
      for (const item of info.details.errors) {
        if (!item || typeof item !== "object") continue
        const { loc, msg } = item as { loc?: unknown; msg?: unknown }
        const field = Array.isArray(loc) ? loc[loc.length - 1] : null
        if (typeof field === "string" && Object.keys(values).includes(field))
          next[field as Field] =
            typeof msg === "string" && /[\u3400-\u9fff]/u.test(msg)
              ? msg
              : T.fieldError
      }
      setErrors(next)
    },
  })
  const change = (field: Field, value: string) => {
    setValues((old) => ({ ...old, [field]: value }))
    setErrors((old) => ({ ...old, [field]: undefined }))
    mutation.reset()
  }
  function submit() {
    const next: Partial<Record<Field, string>> = {}
    if (mode === "publish") {
      if (!values.title.trim() || codePointCount(values.title.trim()) > 200)
        next.title = T.titleError
      if (!validUrl(values.post_url.trim())) next.post_url = T.urlError
      if (!validTime(values.published_at)) next.published_at = T.timeError
    } else {
      for (const field of ["likes", "collects", "comments"] as const) {
        if (!/^\d+$/u.test(values[field]) || Number(values[field]) > 1000000000)
          next[field] = T.numberError
      }
      if (!validTime(values.captured_at)) next.captured_at = T.timeError
    }
    setErrors(next)
    if (!Object.keys(next).length) mutation.mutate()
  }
  const field = (
    name: Field,
    label: string,
    type = "text",
    hint?: ReactNode,
  ) => (
    <div className="space-y-2">
      <label htmlFor={`result-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={`result-${name}`}
        type={type}
        value={values[name]}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `result-${name}-error` : undefined}
        disabled={mutation.isPending}
        onChange={(e) => change(name, e.target.value)}
        {...(type === "number" ? { min: 0, max: 1000000000, step: 1 } : {})}
      />
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      {errors[name] && (
        <p
          id={`result-${name}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {errors[name]}
        </p>
      )}
    </div>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "publish" ? T.publish : T.newReading}
          </DialogTitle>
          <DialogDescription>
            {mode === "publish" ? T.publishHint : T.metricHint}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <p className="rounded-lg bg-surface-low p-3 text-sm break-words">
            {copy.title}
          </p>
          {mutation.isError && <ResultsError error={mutation.error} />}
          {mode === "publish" ? (
            <>
              {field(
                "title",
                T.copyTitle,
                "text",
                <CharCounter
                  value={codePointCount(values.title)}
                  limit={200}
                />,
              )}
              {field(
                "published_at",
                T.publishedAt,
                "datetime-local",
                T.timeHint,
              )}
              {field("post_url", T.url, "url", T.urlHint)}
              {/https:\/\/(?:[\w-]+\.)*xhslink\.com(?:[/:?#]|$)/iu.test(
                values.post_url,
              ) && (
                <p className="rounded-lg bg-surface-low p-3 text-xs text-muted-foreground">
                  {T.shortLink}
                </p>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {field("likes", T.likes, "number")}
                {field("collects", T.collects, "number")}
                {field("comments", T.comments, "number")}
              </div>
              <label
                htmlFor="result-approximate"
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id="result-approximate"
                  checked={approximate}
                  disabled={mutation.isPending}
                  onCheckedChange={(checked) =>
                    setApproximate(checked === true)
                  }
                />
                {T.approximate}
              </label>
              {field(
                "captured_at",
                T.capturedAt,
                "datetime-local",
                <>
                  {T.captureHint} {T.timeHint}
                </>,
              )}
            </>
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
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? T.saving : T.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
