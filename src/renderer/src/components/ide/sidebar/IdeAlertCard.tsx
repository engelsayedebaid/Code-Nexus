import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  RefreshCw,
  RotateCcw,
  Sparkles,
  X
} from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/class-names'
import type {
  IdeConversation,
  IdeProviderAgentOption
} from '../../../../../shared/ide-agent/ide-agent-types'

type ClassifiedIdeAlert = {
  kind:
    | 'model_unavailable'
    | 'provider_auth'
    | 'rate_limit'
    | 'structured_json'
    | 'verification'
    | 'generic'
  tone: 'error' | 'warning'
  title: string
  summary: string
  hint?: string
  modelName?: string
  providerName?: string
  technicalDetail?: string
}

const MODEL_UNAVAILABLE_RE = /^Model\s+"([^"]+)"\s+is not available for\s+([^.]+)\./i

export function classifyIdeAlert(rawError: string): ClassifiedIdeAlert {
  const trimmed = rawError.trim().replace(/^Error:\s*/i, '')
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const firstLine = lines[0] ?? trimmed
  const extraDetail = lines.length > 1 ? trimmed : undefined

  const modelMatch = MODEL_UNAVAILABLE_RE.exec(firstLine)
  if (modelMatch) {
    const [, modelName, providerName] = modelMatch
    return {
      kind: 'model_unavailable',
      tone: 'error',
      title: 'Model unavailable',
      summary: `"${modelName}" is not currently available for ${providerName}.`,
      hint: 'Refresh the model list to reload dynamic models, or switch to an available model below.',
      modelName,
      providerName,
      technicalDetail: extraDetail
    }
  }

  if (
    /not detected on PATH|not signed in|authentication|unauthorized|\b401\b|\b403\b|api[ _-]?key|does not support IDE chat|cannot generate text/i.test(
      trimmed
    )
  ) {
    return {
      kind: 'provider_auth',
      tone: 'error',
      title: 'Provider setup required',
      summary: firstLine,
      hint: 'Verify the provider CLI is installed and signed in, or select another provider from the model picker.',
      technicalDetail: extraDetail
    }
  }

  if (/rate[ _-]?limit|usage limit|quota|\b429\b|timed?\s*out|deadline exceeded/i.test(trimmed)) {
    return {
      kind: 'rate_limit',
      tone: 'warning',
      title: 'Rate limit or timeout',
      summary: firstLine,
      hint: 'Wait a moment and retry, or switch to a faster/alternative model.',
      technicalDetail: extraDetail
    }
  }

  if (/structured implementation plan JSON|invalid structured JSON/i.test(trimmed)) {
    return {
      kind: 'structured_json',
      tone: 'warning',
      title: 'Malformed structured response',
      summary: firstLine,
      hint: 'Retry the turn or switch to a stronger coding model.',
      technicalDetail: extraDetail
    }
  }

  if (/^Verification failed:/i.test(trimmed)) {
    return {
      kind: 'verification',
      tone: 'warning',
      title: 'Verification checks failed',
      summary: firstLine.replace(/^Verification failed:\s*/i, 'Failing check: '),
      hint: 'Inspect Checks & commands above for full output, or ask the agent to fix the failure.',
      technicalDetail: extraDetail
    }
  }

  return {
    kind: 'generic',
    tone: 'error',
    title: 'Request failed',
    summary: firstLine.length <= 280 ? firstLine : `${firstLine.slice(0, 280)}…`,
    technicalDetail: extraDetail ?? (firstLine.length > 280 ? trimmed : undefined)
  }
}

function resolveFallbackSelection(
  conversation: IdeConversation | null | undefined,
  providers: readonly IdeProviderAgentOption[] | undefined,
  failingModelName?: string
): { agentId: string; modelId: string; label: string } | null {
  if (!providers || providers.length === 0) {
    return null
  }
  const currentProvider = providers.find((p) => p.id === conversation?.agentId && p.available)
  if (currentProvider) {
    const candidate =
      currentProvider.models.find(
        (m) => m.id !== conversation?.modelId && m.id !== failingModelName
      ) ??
      (currentProvider.defaultModelId !== conversation?.modelId &&
      currentProvider.defaultModelId !== failingModelName
        ? { id: currentProvider.defaultModelId, label: currentProvider.defaultModelId }
        : null)
    if (candidate) {
      const display =
        candidate.label === 'default'
          ? `${currentProvider.label} default`
          : `${currentProvider.label} · ${candidate.label}`
      return {
        agentId: currentProvider.id,
        modelId: candidate.id,
        label: display
      }
    }
  }

  const alternate = providers.find((p) => p.available && p.id !== conversation?.agentId)
  if (!alternate) {
    return null
  }
  const model = alternate.models[0] ?? {
    id: alternate.defaultModelId,
    label: alternate.defaultModelId
  }
  return {
    agentId: alternate.id,
    modelId: model.id,
    label: `${alternate.label} · ${model.label}`
  }
}

export function IdeAlertCard({
  error,
  conversation,
  providers,
  providersLoading = false,
  onDismiss,
  onRetry,
  onRefreshModels,
  onSelectFallbackModel,
  className
}: {
  error: string
  conversation?: IdeConversation | null
  providers?: readonly IdeProviderAgentOption[]
  providersLoading?: boolean
  onDismiss?: () => void
  onRetry?: () => void
  onRefreshModels?: () => void
  onSelectFallbackModel?: (selection: { agentId: string; modelId: string }) => void
  className?: string
}) {
  const info = useMemo(() => classifyIdeAlert(error), [error])
  const fallback = useMemo(
    () =>
      info.kind === 'model_unavailable' || info.kind === 'provider_auth'
        ? resolveFallbackSelection(conversation, providers, info.modelName)
        : null,
    [conversation, info.kind, info.modelName, providers]
  )

  const [detailsOpen, setDetailsOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    try {
      if (window.api?.ui?.writeClipboardText) {
        await window.api.ui.writeClipboardText(error)
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(error)
      }
      setCopied(true)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = window.setTimeout(() => {
        copyTimerRef.current = null
        setCopied(false)
      }, 1500)
    } catch {
      /* ignore clipboard unavailability */
    }
  }

  const isWarning = info.tone === 'warning'
  const showRefreshAction =
    Boolean(onRefreshModels) && (info.kind === 'model_unavailable' || info.kind === 'provider_auth')
  const showFallbackAction = Boolean(onSelectFallbackModel && fallback)
  const hasFooterActions = Boolean(onRetry) || showRefreshAction || showFallbackAction

  return (
    <div
      dir="ltr"
      role="alert"
      data-testid="ide-alert-card"
      className={cn(
        'rounded-xl border p-2.5 text-left shadow-xs',
        isWarning ? 'border-border bg-muted/35' : 'border-destructive/30 bg-destructive/[0.06]',
        className
      )}
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg',
            isWarning ? 'bg-muted text-chat-warning' : 'bg-destructive/15 text-destructive'
          )}
        >
          {isWarning ? (
            <AlertTriangle className="size-3.5" aria-hidden="true" />
          ) : (
            <AlertCircle className="size-3.5" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{info.title}</span>
              {info.providerName ? (
                <Badge variant="referenceLabel">{info.providerName}</Badge>
              ) : null}
              {info.modelName ? <Badge variant="referenceLabel">{info.modelName}</Badge> : null}
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                size="icon-xs"
                variant="ghost"
                onClick={() => void handleCopy()}
                aria-label={copied ? 'Copied error' : 'Copy error details'}
                title={copied ? 'Copied' : 'Copy error'}
              >
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              </Button>
              {onDismiss ? (
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={onDismiss}
                  aria-label="Dismiss error"
                  title="Dismiss"
                >
                  <X className="size-3" />
                </Button>
              ) : null}
            </div>
          </div>

          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
            {info.summary}
          </p>

          {info.hint ? (
            <p className="text-2xs leading-relaxed text-muted-foreground">{info.hint}</p>
          ) : null}

          {info.technicalDetail ? (
            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded py-0.5 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {detailsOpen ? (
                    <ChevronDown className="size-3 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" />
                  )}
                  <span>Technical details</span>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <pre className="scrollbar-sleek mt-1 max-h-36 overflow-auto rounded-lg border border-border/60 bg-background/80 p-2 font-mono text-3xs whitespace-pre-wrap break-words text-muted-foreground">
                  {info.technicalDetail}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {hasFooterActions ? (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {onRetry ? (
                <Button size="xs" variant="outline" onClick={onRetry}>
                  <RotateCcw className="size-3" />
                  Retry
                </Button>
              ) : null}

              {showRefreshAction ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={providersLoading}
                  onClick={onRefreshModels}
                >
                  {providersLoading ? (
                    <LoadingSpinner className="size-3" />
                  ) : (
                    <RefreshCw className="size-3" />
                  )}
                  Refresh models
                </Button>
              ) : null}

              {showFallbackAction && fallback ? (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() =>
                    onSelectFallbackModel?.({
                      agentId: fallback.agentId,
                      modelId: fallback.modelId
                    })
                  }
                >
                  <Sparkles className="size-3" />
                  Use {fallback.label}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
