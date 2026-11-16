import { useAppStore } from '@/store'
import { editorModelRegistry } from '@/lib/editor/monaco/editor-model-registry'
import { normalizeToModelEol } from '@/components/editor/monaco-content-sync'
import {
  beginProgrammaticContentSync,
  endProgrammaticContentSync
} from '@/components/editor/monaco-programmatic-sync'
import { editorTabModelUri } from '@/components/editor/save/queue/editor-save-disk-precondition'
import type { IdeLiveEditSpeed } from '../../../../shared/ide-agent/ide-agent-types'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'

export type ResolvedMonacoTarget = {
  modelUri: string
  isDirty: boolean
  model: ReturnType<NonNullable<ReturnType<typeof editorModelRegistry.get>>['editor']['getModel']>
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function resolveLiveEditSpeedParams(speed: IdeLiveEditSpeed = 'natural'): {
  charsPerFrame: number
  frameIntervalMs: number
  maxFrames: number
  instant: boolean
} {
  if (speed === 'instant' || prefersReducedMotion()) {
    return { charsPerFrame: 10_000, frameIntervalMs: 0, maxFrames: 1, instant: true }
  }
  if (speed === 'fast') {
    return { charsPerFrame: 12, frameIntervalMs: 14, maxFrames: 45, instant: false }
  }
  return { charsPerFrame: 5, frameIntervalMs: 18, maxFrames: 95, instant: false }
}

export function findTargetMonacoModel(
  worktreeId: string,
  relativePath: string
): ResolvedMonacoTarget | null {
  const state = useAppStore.getState()
  const cleanRel = normalizeWorkspaceRelativePath(relativePath).toLowerCase()
  const openFile = state.openFiles.find(
    (f) =>
      f.worktreeId === worktreeId &&
      normalizeWorkspaceRelativePath(f.relativePath).toLowerCase() === cleanRel
  )
  if (!openFile) {
    return null
  }
  if (openFile.isDirty) {
    return { modelUri: '', isDirty: true, model: null }
  }
  const registry = editorModelRegistry.get()
  if (!registry) {
    return null
  }
  const modelUri = editorTabModelUri(state, openFile)
  const model = registry.editor.getModel(registry.Uri.parse(modelUri))
  if (!model || model.isDisposed()) {
    return null
  }
  return { modelUri, isDirty: false, model }
}

export function writeTextToMonacoModel(
  modelUri: string,
  model: NonNullable<ResolvedMonacoTarget['model']>,
  text: string
): void {
  if (!model || model.isDisposed()) {
    return
  }
  const current = model.getValue()
  const normalized = normalizeToModelEol(text, model, current)
  if (current === normalized) {
    return
  }
  beginProgrammaticContentSync(modelUri)
  try {
    model.applyEdits([
      {
        range: model.getFullModelRange(),
        text: normalized
      }
    ])
  } finally {
    endProgrammaticContentSync(modelUri)
  }
}
