import { useAppStore } from '@/store'
import { notifyEditorExternalFileChange } from '@/components/editor/autosave/editor-autosave'
import {
  computeCharacterStreamSteps,
  type CharacterStreamFrame
} from '../../../../shared/ide-agent/ide-patch-chunker'
import type { IdeLiveEditSpeed } from '../../../../shared/ide-agent/ide-agent-types'
import { normalizeWorkspaceRelativePath } from '../../../../shared/ide-agent/ide-plan-policy'
import {
  findTargetMonacoModel,
  resolveLiveEditSpeedParams,
  writeTextToMonacoModel
} from './ide-monaco-model-bridge'

type ActiveFileStreamSession = {
  key: string
  worktreeId: string
  worktreePath: string
  relativePath: string
  label: string
  frames: CharacterStreamFrame[]
  frameIndex: number
  finalContent: string
  timerId: ReturnType<typeof setTimeout> | null
  waitModelAttempts: number
  sourceKind: 'streamed' | 'patch_preview'
}

const activeSessions = new Map<string, ActiveFileStreamSession>()

function sessionKey(worktreeId: string, relativePath: string): string {
  return `${worktreeId}::${normalizeWorkspaceRelativePath(relativePath).toLowerCase()}`
}

function commitAndFinishSession(session: ActiveFileStreamSession, syncDiskBaseline: boolean): void {
  if (session.timerId !== null) {
    clearTimeout(session.timerId)
    session.timerId = null
  }
  activeSessions.delete(session.key)
  const resolved = findTargetMonacoModel(session.worktreeId, session.relativePath)
  if (resolved && !resolved.isDirty && resolved.model) {
    writeTextToMonacoModel(resolved.modelUri, resolved.model, session.finalContent)
  }
  const lastFrame = session.frames.at(-1)
  if (lastFrame) {
    useAppStore.getState().setIdeActiveEditHighlight({
      relativePath: session.relativePath,
      startLine: lastFrame.startLine,
      endLine: lastFrame.endLine,
      cursorLine: lastFrame.cursorLine,
      cursorColumn: lastFrame.cursorColumn,
      label: session.label,
      status: 'committed',
      progressPercent: 100,
      updatedAt: Date.now()
    })
  }
  if (syncDiskBaseline) {
    notifyEditorExternalFileChange({
      relativePath: session.relativePath,
      worktreeId: session.worktreeId,
      worktreePath: session.worktreePath
    })
  }
}

function tickSession(session: ActiveFileStreamSession, frameIntervalMs: number): void {
  if (activeSessions.get(session.key) !== session) {
    return
  }
  const resolved = findTargetMonacoModel(session.worktreeId, session.relativePath)
  if (resolved?.isDirty) {
    activeSessions.delete(session.key)
    return
  }
  if (!resolved || !resolved.model) {
    session.waitModelAttempts += 1
    if (session.waitModelAttempts <= 35) {
      session.timerId = setTimeout(() => tickSession(session, frameIntervalMs), 25)
      return
    }
    commitAndFinishSession(session, true)
    return
  }

  const frame = session.frames[session.frameIndex]
  if (!frame) {
    commitAndFinishSession(session, true)
    return
  }

  writeTextToMonacoModel(resolved.modelUri, resolved.model, frame.text)
  useAppStore.getState().setIdeActiveEditHighlight({
    relativePath: session.relativePath,
    startLine: frame.startLine,
    endLine: frame.endLine,
    cursorLine: frame.cursorLine,
    cursorColumn: frame.cursorColumn,
    label: session.label,
    status: session.sourceKind === 'streamed' ? 'streaming' : 'revealing',
    progressPercent: frame.progressPercent,
    updatedAt: Date.now()
  })

  session.frameIndex += 1
  if (session.frameIndex >= session.frames.length) {
    commitAndFinishSession(session, true)
    return
  }
  session.timerId = setTimeout(() => tickSession(session, frameIntervalMs), frameIntervalMs)
}

export function enqueueLiveCharacterCoding(params: {
  worktreeId: string
  worktreePath: string
  relativePath: string
  beforeContent: string | null | undefined
  afterContent: string | undefined
  startLine: number
  endLine: number
  label: string
  speed?: IdeLiveEditSpeed
  sourceKind?: 'streamed' | 'patch_preview'
}): void {
  const cleanRel = normalizeWorkspaceRelativePath(params.relativePath)
  const key = sessionKey(params.worktreeId, cleanRel)
  const speedCfg = resolveLiveEditSpeedParams(params.speed)
  const existing = activeSessions.get(key)

  if (
    existing &&
    params.sourceKind === 'streamed' &&
    !speedCfg.instant &&
    typeof params.afterContent === 'string' &&
    params.afterContent.startsWith(existing.finalContent)
  ) {
    const extraFrames = computeCharacterStreamSteps({
      beforeContent: existing.finalContent,
      afterContent: params.afterContent,
      charsPerFrame: speedCfg.charsPerFrame,
      maxFrames: 24
    })
    if (extraFrames.length > 0) {
      existing.frames.push(...extraFrames)
      existing.finalContent = params.afterContent
      existing.label = params.label
    }
    return
  }

  if (existing) {
    commitAndFinishSession(existing, false)
  }

  if (typeof params.afterContent !== 'string') {
    useAppStore.getState().setIdeActiveEditHighlight({
      relativePath: cleanRel,
      startLine: params.startLine,
      endLine: params.endLine,
      label: params.label,
      status: 'committed',
      progressPercent: 100,
      updatedAt: Date.now()
    })
    notifyEditorExternalFileChange({
      relativePath: cleanRel,
      worktreeId: params.worktreeId,
      worktreePath: params.worktreePath
    })
    return
  }

  const resolvedNow = findTargetMonacoModel(params.worktreeId, cleanRel)
  const effectiveBefore =
    params.beforeContent !== undefined
      ? params.beforeContent
      : (resolvedNow?.model?.getValue() ?? null)

  const frames = computeCharacterStreamSteps({
    beforeContent: effectiveBefore,
    afterContent: params.afterContent,
    charsPerFrame: speedCfg.charsPerFrame,
    maxFrames: speedCfg.maxFrames
  })

  if (speedCfg.instant || frames.length <= 1) {
    const session: ActiveFileStreamSession = {
      key,
      worktreeId: params.worktreeId,
      worktreePath: params.worktreePath,
      relativePath: cleanRel,
      label: params.label,
      frames,
      frameIndex: frames.length,
      finalContent: params.afterContent,
      timerId: null,
      waitModelAttempts: 0,
      sourceKind: params.sourceKind ?? 'patch_preview'
    }
    commitAndFinishSession(session, true)
    return
  }

  const session: ActiveFileStreamSession = {
    key,
    worktreeId: params.worktreeId,
    worktreePath: params.worktreePath,
    relativePath: cleanRel,
    label: params.label,
    frames,
    frameIndex: 0,
    finalContent: params.afterContent,
    timerId: null,
    waitModelAttempts: 0,
    sourceKind: params.sourceKind ?? 'patch_preview'
  }
  activeSessions.set(key, session)
  tickSession(session, speedCfg.frameIntervalMs)
}

export function stopAllLiveCharacterCoding(options?: { cancelled?: boolean }): void {
  const sessions = [...activeSessions.values()]
  activeSessions.clear()
  for (const session of sessions) {
    if (session.timerId !== null) {
      clearTimeout(session.timerId)
      session.timerId = null
    }
    if (!options?.cancelled) {
      const resolved = findTargetMonacoModel(session.worktreeId, session.relativePath)
      if (resolved && !resolved.isDirty && resolved.model) {
        writeTextToMonacoModel(resolved.modelUri, resolved.model, session.finalContent)
      }
    }
    notifyEditorExternalFileChange({
      relativePath: session.relativePath,
      worktreeId: session.worktreeId,
      worktreePath: session.worktreePath
    })
  }
  useAppStore.getState().setIdeActiveEditHighlight(null)
}

export function hasActiveLiveCharacterCoding(worktreeId: string, relativePath: string): boolean {
  return activeSessions.has(sessionKey(worktreeId, relativePath))
}
