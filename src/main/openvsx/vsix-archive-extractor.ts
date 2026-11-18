import { unzipSync } from 'fflate'
import { mkdir, rm, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_ZIP_ENTRIES = 10_000
const MAX_UNCOMPRESSED_TOTAL_BYTES = 128 * 1024 * 1024
const MAX_SINGLE_ENTRY_BYTES = 32 * 1024 * 1024

function sanitizeZipEntryPath(rawName: string): string | null {
  if (!rawName || rawName.includes('\0')) {
    return null
  }
  const normalizedSlashes = rawName.replaceAll('\\', '/')
  if (normalizedSlashes.endsWith('/')) {
    return null
  }
  if (normalizedSlashes.startsWith('/') || /^[A-Za-z]:/.test(normalizedSlashes)) {
    return null
  }

  const parts = normalizedSlashes
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.')
  if (parts.length === 0) {
    return null
  }
  if (parts.some((segment) => segment === '..')) {
    return null
  }
  return parts.join('/')
}

function assertContainedPath(rootDir: string, relativePosixPath: string): string {
  const resolvedRoot = path.resolve(rootDir)
  const target = path.resolve(resolvedRoot, ...relativePosixPath.split('/'))
  const rel = path.relative(resolvedRoot, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Unsafe archive path escapes target directory: "${relativePosixPath}"`)
  }
  return target
}

export async function resolveExtractedExtensionRoot(extractedDir: string): Promise<string> {
  const nestedExtensionDir = path.join(extractedDir, 'extension')
  const nestedPkg = path.join(nestedExtensionDir, 'package.json')
  try {
    const nestedStat = await stat(nestedPkg)
    if (nestedStat.isFile()) {
      return nestedExtensionDir
    }
  } catch {
    // Fallback to root package.json below
  }

  const rootPkg = path.join(extractedDir, 'package.json')
  try {
    const rootStat = await stat(rootPkg)
    if (rootStat.isFile()) {
      return extractedDir
    }
  } catch {
    // Missing package.json handled below
  }

  throw new Error('VSIX archive does not contain extension/package.json')
}

export async function extractVsixArchive(
  archiveBytes: Uint8Array,
  targetDir: string
): Promise<{ extensionRootDir: string; entryCount: number }> {
  let seenEntries = 0
  let seenUncompressedBytes = 0

  const unzipped = unzipSync(archiveBytes, {
    filter: (file) => {
      seenEntries += 1
      if (seenEntries > MAX_ZIP_ENTRIES) {
        throw new Error(`VSIX archive exceeds maximum of ${MAX_ZIP_ENTRIES} entries`)
      }
      if (file.originalSize > MAX_SINGLE_ENTRY_BYTES) {
        throw new Error(`VSIX entry "${file.name}" exceeds maximum size`)
      }
      seenUncompressedBytes += file.originalSize
      if (seenUncompressedBytes > MAX_UNCOMPRESSED_TOTAL_BYTES) {
        throw new Error(
          `VSIX uncompressed content exceeds maximum of ${MAX_UNCOMPRESSED_TOTAL_BYTES} bytes`
        )
      }
      return sanitizeZipEntryPath(file.name) !== null
    }
  })

  const parentDir = path.dirname(targetDir)
  await mkdir(parentDir, { recursive: true })
  const stagingDir = path.join(
    parentDir,
    `.staging-${path.basename(targetDir)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  )

  try {
    await mkdir(stagingDir, { recursive: true })
    const createdDirs = new Set<string>([stagingDir])
    let totalActualBytes = 0
    let entryCount = 0

    for (const [rawEntryName, content] of Object.entries(unzipped)) {
      const safeRelative = sanitizeZipEntryPath(rawEntryName)
      if (!safeRelative) {
        continue
      }
      totalActualBytes += content.byteLength
      if (
        totalActualBytes > MAX_UNCOMPRESSED_TOTAL_BYTES ||
        content.byteLength > MAX_SINGLE_ENTRY_BYTES
      ) {
        throw new Error('VSIX archive decompressed beyond safety limits')
      }

      const targetPath = assertContainedPath(stagingDir, safeRelative)
      const dir = path.dirname(targetPath)
      if (!createdDirs.has(dir)) {
        await mkdir(dir, { recursive: true })
        createdDirs.add(dir)
      }
      await writeFile(targetPath, content)
      entryCount += 1
    }

    await resolveExtractedExtensionRoot(stagingDir)

    await rm(targetDir, { recursive: true, force: true })
    await rename(stagingDir, targetDir)

    const extensionRootDir = await resolveExtractedExtensionRoot(targetDir)
    return { extensionRootDir, entryCount }
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}
