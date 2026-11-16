import { randomUUID } from 'node:crypto'
import { lstat, mkdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { openAuthorizedDocPreviewTarget } from '../../shared/document-preview/doc-preview-file-access'
import type { IdeChatAttachment } from '../../shared/ide-agent/ide-agent-types'
import {
  SMART_PASTE_CONFIG,
  countTextLines,
  detectPastedTextFormat
} from '../../shared/smart-paste/smart-paste-config'
import {
  searchAttachmentLines,
  sliceAttachmentContentPage,
  type IdeAttachmentContentPage,
  type IdeAttachmentSearchHit
} from './ide-attachment-text-queries'

export type { IdeAttachmentContentPage, IdeAttachmentSearchHit }

const SAFE_ATTACHMENT_ID_RE = /^[A-Za-z0-9_-]{4,128}$/
const SAFE_CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,256}$/

function isErrno(error: unknown, codes: readonly string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  )
}

function assertSafeId(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value) || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}`)
  }
  return value
}

function isInsideCanonicalDir(canonicalRoot: string, canonicalTarget: string): boolean {
  const rel = relative(canonicalRoot, canonicalTarget)
  if (rel === '') {
    return true
  }
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function assertNotSymlinkIfExists(targetPath: string): Promise<void> {
  try {
    const info = await lstat(targetPath)
    if (info.isSymbolicLink()) {
      throw new Error('Symbolic links are not permitted in attachment storage')
    }
  } catch (error) {
    if (!isErrno(error, ['ENOENT'])) {
      throw error
    }
  }
}

export class IdeAttachmentStore {
  constructor(readonly rootDir: string) {}

  private async ensureRootDir(): Promise<string> {
    await mkdir(this.rootDir, { recursive: true })
    await assertNotSymlinkIfExists(this.rootDir)
    return realpath(this.rootDir)
  }

  private async resolveConversationDir(
    conversationId: string,
    create: boolean
  ): Promise<{ canonicalRoot: string; convDir: string } | null> {
    const safeConvId = assertSafeId(conversationId, SAFE_CONVERSATION_ID_RE, 'conversationId')
    const canonicalRoot = create
      ? await this.ensureRootDir()
      : await realpath(this.rootDir).catch((error) => {
          if (isErrno(error, ['ENOENT', 'ENOTDIR'])) {
            return null
          }
          throw error
        })
    if (!canonicalRoot) {
      return null
    }
    const convDir = join(canonicalRoot, safeConvId)
    if (create) {
      await mkdir(convDir, { recursive: true })
    }
    await assertNotSymlinkIfExists(convDir)
    try {
      const canonicalConv = await realpath(convDir)
      if (!isInsideCanonicalDir(canonicalRoot, canonicalConv)) {
        throw new Error('Attachment directory escapes storage root')
      }
      return { canonicalRoot, convDir: canonicalConv }
    } catch (error) {
      if (!create && isErrno(error, ['ENOENT', 'ENOTDIR'])) {
        return null
      }
      throw error
    }
  }

  async savePastedText(params: {
    conversationId: string
    attachmentId?: string
    displayName?: string
    content: string
    mimeType?: string
  }): Promise<IdeChatAttachment> {
    const sizeBytes = Buffer.byteLength(params.content, 'utf8')
    if (sizeBytes <= 0) {
      throw new Error('Cannot save empty pasted text attachment')
    }
    if (sizeBytes > SMART_PASTE_CONFIG.maxAttachmentBytes) {
      throw new Error('Pasted text attachment exceeds maximum supported size')
    }
    const attachmentId = assertSafeId(
      params.attachmentId ?? `paste-${randomUUID()}`,
      SAFE_ATTACHMENT_ID_RE,
      'attachmentId'
    )
    const dirInfo = await this.resolveConversationDir(params.conversationId, true)
    if (!dirInfo) {
      throw new Error('Unable to initialize attachment storage directory')
    }
    const targetPath = join(dirInfo.convDir, `${attachmentId}.txt`)
    await assertNotSymlinkIfExists(targetPath)
    const tmpPath = join(dirInfo.convDir, `${attachmentId}.${randomUUID()}.tmp`)
    await writeFile(tmpPath, params.content, 'utf8')
    try {
      await rename(tmpPath, targetPath)
    } catch (error) {
      await unlink(tmpPath).catch(() => {})
      throw error
    }
    const { format } = detectPastedTextFormat(params.content)
    return {
      id: attachmentId,
      kind: 'pasted_text',
      name: params.displayName?.trim() || 'Pasted text',
      mimeType: params.mimeType?.trim() || (format === 'text' ? 'text/plain' : `text/${format}`),
      sizeBytes,
      lineCount: countTextLines(params.content),
      charCount: params.content.length,
      format,
      createdAt: Date.now(),
      status: 'ready'
    }
  }

  async readFullText(
    conversationId: string,
    attachmentId: string
  ): Promise<
    | { exists: true; content: string; sizeBytes: number; lineCount: number; charCount: number }
    | { exists: false }
  > {
    const safeAttId = assertSafeId(attachmentId, SAFE_ATTACHMENT_ID_RE, 'attachmentId')
    const dirInfo = await this.resolveConversationDir(conversationId, false)
    if (!dirInfo) {
      return { exists: false }
    }
    const targetPath = join(dirInfo.convDir, `${safeAttId}.txt`)
    await assertNotSymlinkIfExists(targetPath)
    let opened: Awaited<ReturnType<typeof openAuthorizedDocPreviewTarget>>
    try {
      opened = await openAuthorizedDocPreviewTarget({
        boundaryPath: dirInfo.canonicalRoot,
        entryPath: targetPath,
        targetPath,
        implicitRootPath: dirInfo.convDir,
        authorizedRootPaths: []
      })
    } catch (error) {
      if (isErrno(error, ['ENOENT', 'ENOTDIR'])) {
        return { exists: false }
      }
      throw error
    }
    const { handle, stats } = opened
    try {
      if (stats.size > SMART_PASTE_CONFIG.maxAttachmentBytes) {
        throw new Error('Attachment file exceeds maximum supported size')
      }
      const buffer = Buffer.alloc(stats.size)
      let offset = 0
      while (offset < stats.size) {
        const { bytesRead } = await handle.read(buffer, offset, stats.size - offset, offset)
        if (bytesRead <= 0) {
          break
        }
        offset += bytesRead
      }
      const content = buffer.subarray(0, offset).toString('utf8')
      return {
        exists: true,
        content,
        sizeBytes: stats.size,
        lineCount: countTextLines(content),
        charCount: content.length
      }
    } finally {
      await handle.close()
    }
  }

  async readRange(params: {
    conversationId: string
    attachmentId: string
    startLine?: number
    endLine?: number
    maxChars?: number
  }): Promise<IdeAttachmentContentPage> {
    const loaded = await this.readFullText(params.conversationId, params.attachmentId)
    if (!loaded.exists) {
      return {
        exists: false,
        attachmentId: params.attachmentId,
        content: '',
        startLine: 1,
        endLine: 0,
        totalLines: 0,
        sizeBytes: 0,
        charCount: 0,
        hasMore: false
      }
    }
    return sliceAttachmentContentPage({
      attachmentId: params.attachmentId,
      fullContent: loaded.content,
      sizeBytes: loaded.sizeBytes,
      charCount: loaded.charCount,
      startLine: params.startLine,
      endLine: params.endLine,
      maxChars: params.maxChars
    })
  }

  async searchContent(params: {
    conversationId: string
    attachmentId: string
    query: string
    maxMatches?: number
  }): Promise<{ exists: boolean; hits: IdeAttachmentSearchHit[]; totalLines: number }> {
    const loaded = await this.readFullText(params.conversationId, params.attachmentId)
    if (!loaded.exists) {
      return { exists: false, hits: [], totalLines: 0 }
    }
    return searchAttachmentLines({
      fullContent: loaded.content,
      lineCount: loaded.lineCount,
      query: params.query,
      maxMatches: params.maxMatches
    })
  }

  async deleteAttachment(conversationId: string, attachmentId: string): Promise<void> {
    const safeAttId = assertSafeId(attachmentId, SAFE_ATTACHMENT_ID_RE, 'attachmentId')
    const dirInfo = await this.resolveConversationDir(conversationId, false)
    if (!dirInfo) {
      return
    }
    const targetPath = join(dirInfo.convDir, `${safeAttId}.txt`)
    await assertNotSymlinkIfExists(targetPath)
    await unlink(targetPath).catch((error) => {
      if (!isErrno(error, ['ENOENT'])) {
        throw error
      }
    })
  }

  async deleteConversationAttachments(conversationId: string): Promise<void> {
    const dirInfo = await this.resolveConversationDir(conversationId, false)
    if (!dirInfo) {
      return
    }
    await rm(dirInfo.convDir, { recursive: true, force: true })
  }
}

export function resolveEngineAttachmentStore(
  rootDir: string | null,
  override?: IdeAttachmentStore | null
): IdeAttachmentStore | null {
  if (override !== undefined) {
    return override
  }
  return rootDir ? new IdeAttachmentStore(rootDir) : null
}

export function requireEngineAttachmentStore(store: IdeAttachmentStore | null): IdeAttachmentStore {
  if (!store) {
    throw new Error('Attachment storage is unavailable for this session')
  }
  return store
}
