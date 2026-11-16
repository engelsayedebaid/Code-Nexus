import { useEffect } from 'react'
import * as monaco from 'monaco-editor'
import type { languages } from 'monaco-editor'
import { detectLanguage } from '../../../../shared/editor-language/editor-language-detect'
import type { OpenVsxSnippetItem } from '../../../../shared/openvsx/openvsx-types'
import { ensureOpenVsxStoreSubscribed, useOpenVsxStore } from '@/store/plugins/openvsx/use-openvsx-store'

const registeredLanguages = new Set<string>()

const LANGUAGE_ALIASES: Record<string, readonly string[]> = {
  typescriptreact: ['typescript'],
  javascriptreact: ['javascript'],
  shellscript: ['shell'],
  flutter: ['dart'],
  dockercompose: ['yaml']
}

function getFileExtension(filePath: string): string {
  const filename = filePath.split(/[\\/]/).at(-1) ?? ''
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.slice(dotIdx).toLowerCase() : ''
}

function getFileName(filePath: string): string {
  return (filePath.split(/[\\/]/).at(-1) ?? '').toLowerCase()
}

function snippetMatchesModel(
  snippet: OpenVsxSnippetItem,
  modelLang: string,
  detectedLang: string,
  ext: string,
  filename: string
): boolean {
  if (ext && snippet.extensions.includes(ext)) {
    return true
  }
  if (filename && snippet.filenames.some((name) => name.toLowerCase() === filename)) {
    return true
  }
  if (snippet.language === modelLang || snippet.language === detectedLang) {
    return true
  }
  const aliases = LANGUAGE_ALIASES[snippet.language]
  if (aliases && (aliases.includes(modelLang) || aliases.includes(detectedLang))) {
    return true
  }
  return false
}

function createCompletionProvider(): languages.CompletionItemProvider {
  return {
    provideCompletionItems(model, position) {
      const snippets = useOpenVsxStore.getState().snippets
      if (snippets.length === 0) {
        return { suggestions: [] }
      }

      const uriPath = model.uri.path || ''
      const ext = getFileExtension(uriPath)
      const filename = getFileName(uriPath)
      const detectedLang = detectLanguage(uriPath).toLowerCase()
      const modelLang = model.getLanguageId().toLowerCase()
      const word = model.getWordUntilPosition(position)
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      }

      const suggestions: languages.CompletionItem[] = []
      for (const snippet of snippets) {
        if (!snippetMatchesModel(snippet, modelLang, detectedLang, ext, filename)) {
          continue
        }
        for (const prefix of snippet.prefixes) {
          suggestions.push({
            label: prefix,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: snippet.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `${snippet.name} (${snippet.extensionId})`,
            documentation: snippet.description || snippet.name,
            range
          })
        }
      }

      return { suggestions }
    }
  }
}

export function ensureOpenVsxSnippetsRegisteredForLanguage(languageId: string): void {
  const normalized = languageId.trim()
  if (!normalized || registeredLanguages.has(normalized)) {
    return
  }
  registeredLanguages.add(normalized)
  monaco.languages.registerCompletionItemProvider(normalized, createCompletionProvider())
}

export function useOpenVsxSnippetsLanguage(languageId: string): void {
  const loaded = useOpenVsxStore((s) => s.loaded)

  useEffect(() => {
    ensureOpenVsxStoreSubscribed()
    if (!loaded) {
      void useOpenVsxStore.getState().loadInstalled()
    }
  }, [loaded])

  useEffect(() => {
    ensureOpenVsxSnippetsRegisteredForLanguage(languageId)
  }, [languageId])
}
