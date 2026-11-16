import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdeEditorHighlightTarget } from '../../../../shared/ide-agent/ide-agent-events'

type OpenFileStub = {
  id: string
  worktreeId: string
  relativePath: string
  filePath: string
  isDirty: boolean
}

class FakeMonacoModel {
  value: string
  editsHistory: string[] = []

  constructor(initial = '') {
    this.value = initial
  }

  getValue(): string {
    return this.value
  }

  getEOL(): string {
    return '\n'
  }

  isDisposed(): boolean {
    return false
  }

  getFullModelRange() {
    return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
  }

  applyEdits(edits: { text: string }[]): void {
    const next = edits.at(-1)?.text ?? ''
    this.value = next
    this.editsHistory.push(next)
  }
}

const mockModels = new Map<string, FakeMonacoModel>()
const mockState: {
  openFiles: OpenFileStub[]
  ideActiveEditHighlight: IdeEditorHighlightTarget | null
  setIdeActiveEditHighlight: (target: IdeEditorHighlightTarget | null) => void
} = {
  openFiles: [],
  ideActiveEditHighlight: null,
  setIdeActiveEditHighlight(target) {
    mockState.ideActiveEditHighlight = target
  }
}

const notifyExternalMock = vi.fn()

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => mockState
  }
}))

vi.mock('@/lib/editor/monaco/editor-model-registry', () => ({
  editorModelRegistry: {
    get: () => ({
      Uri: { parse: (s: string) => s },
      editor: { getModel: (uri: string) => mockModels.get(uri) ?? null }
    })
  }
}))

vi.mock('@/components/editor/save/queue/editor-save-disk-precondition', () => ({
  editorTabModelUri: (_state: unknown, openFile: OpenFileStub) =>
    `file:///ws/${openFile.relativePath}`
}))

vi.mock('@/components/editor/autosave/editor-autosave', () => ({
  notifyEditorExternalFileChange: (args: unknown) => notifyExternalMock(args)
}))

import {
  enqueueLiveCharacterCoding,
  hasActiveLiveCharacterCoding,
  stopAllLiveCharacterCoding
} from './ide-live-character-coder'

describe('ide-live-character-coder', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockModels.clear()
    mockState.openFiles = []
    mockState.ideActiveEditHighlight = null
    notifyExternalMock.mockClear()
  })

  afterEach(() => {
    stopAllLiveCharacterCoding({ cancelled: true })
    vi.useRealTimers()
  })

  it('reveals characters progressively into Monaco model and commits disk baseline when done', async () => {
    const model = new FakeMonacoModel('')
    mockModels.set('file:///ws/src/LoginPage.tsx', model)
    mockState.openFiles.push({
      id: 'f1',
      worktreeId: 'wt1',
      relativePath: 'src/LoginPage.tsx',
      filePath: '/ws/src/LoginPage.tsx',
      isDirty: false
    })

    enqueueLiveCharacterCoding({
      worktreeId: 'wt1',
      worktreePath: '/ws',
      relativePath: 'src/LoginPage.tsx',
      beforeContent: '',
      afterContent: 'const LoginPage = () => <div>Hi</div>',
      startLine: 1,
      endLine: 1,
      label: 'Generating LoginPage.tsx',
      speed: 'natural',
      sourceKind: 'patch_preview'
    })

    expect(model.editsHistory.length).toBe(1)
    expect(model.editsHistory[0]).toBe('const')
    expect(mockState.ideActiveEditHighlight?.status).toBe('revealing')

    await vi.runAllTimersAsync()

    expect(model.editsHistory.length).toBeGreaterThan(3)
    expect(model.getValue()).toBe('const LoginPage = () => <div>Hi</div>')
    expect(mockState.ideActiveEditHighlight?.status).toBe('committed')
    expect(mockState.ideActiveEditHighlight?.progressPercent).toBe(100)
    expect(notifyExternalMock).toHaveBeenCalledTimes(1)
  })

  it('extends an active streamed session smoothly without resetting prior characters', async () => {
    const model = new FakeMonacoModel('')
    mockModels.set('file:///ws/src/auth.ts', model)
    mockState.openFiles.push({
      id: 'f2',
      worktreeId: 'wt1',
      relativePath: 'src/auth.ts',
      filePath: '/ws/src/auth.ts',
      isDirty: false
    })

    enqueueLiveCharacterCoding({
      worktreeId: 'wt1',
      worktreePath: '/ws',
      relativePath: 'src/auth.ts',
      beforeContent: '',
      afterContent: 'export const a',
      startLine: 1,
      endLine: 1,
      label: 'Streaming auth.ts',
      speed: 'natural',
      sourceKind: 'streamed'
    })

    expect(model.getValue()).toBe('expor')
    expect(mockState.ideActiveEditHighlight?.status).toBe('streaming')

    enqueueLiveCharacterCoding({
      worktreeId: 'wt1',
      worktreePath: '/ws',
      relativePath: 'src/auth.ts',
      beforeContent: '',
      afterContent: 'export const auth = true\n',
      startLine: 1,
      endLine: 1,
      label: 'Streaming auth.ts',
      speed: 'natural',
      sourceKind: 'streamed'
    })

    await vi.runAllTimersAsync()
    expect(model.getValue()).toBe('export const auth = true\n')
    expect(notifyExternalMock).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite dirty user buffers and supports cancellation recovery', async () => {
    const dirtyModel = new FakeMonacoModel('user unsaved draft')
    mockModels.set('file:///ws/src/dirty.ts', dirtyModel)
    mockState.openFiles.push({
      id: 'f3',
      worktreeId: 'wt1',
      relativePath: 'src/dirty.ts',
      filePath: '/ws/src/dirty.ts',
      isDirty: true
    })

    enqueueLiveCharacterCoding({
      worktreeId: 'wt1',
      worktreePath: '/ws',
      relativePath: 'src/dirty.ts',
      beforeContent: '',
      afterContent: 'ai overwrite attempt',
      startLine: 1,
      endLine: 1,
      label: 'Editing dirty.ts',
      speed: 'natural',
      sourceKind: 'patch_preview'
    })

    await vi.runAllTimersAsync()
    expect(dirtyModel.getValue()).toBe('user unsaved draft')
    expect(dirtyModel.editsHistory).toHaveLength(0)

    const cleanModel = new FakeMonacoModel('')
    mockModels.set('file:///ws/src/cancel.ts', cleanModel)
    mockState.openFiles.push({
      id: 'f4',
      worktreeId: 'wt1',
      relativePath: 'src/cancel.ts',
      filePath: '/ws/src/cancel.ts',
      isDirty: false
    })

    enqueueLiveCharacterCoding({
      worktreeId: 'wt1',
      worktreePath: '/ws',
      relativePath: 'src/cancel.ts',
      beforeContent: '',
      afterContent: 'export const longValue = "abcdef"',
      startLine: 1,
      endLine: 1,
      label: 'Editing cancel.ts',
      speed: 'natural',
      sourceKind: 'patch_preview'
    })
    expect(hasActiveLiveCharacterCoding('wt1', 'src/cancel.ts')).toBe(true)

    stopAllLiveCharacterCoding({ cancelled: true })
    expect(hasActiveLiveCharacterCoding('wt1', 'src/cancel.ts')).toBe(false)
    expect(mockState.ideActiveEditHighlight).toBeNull()
  })
})
