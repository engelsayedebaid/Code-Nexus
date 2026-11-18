import React, { useCallback } from 'react'
import CommentMarkdown, {
  type CommentMarkdownLinkClickHandler,
  type MarkdownDirectionOverride
} from '@/components/sidebar/CommentMarkdown'
import { NativeChatCodeBlock } from '@/components/native-chat/markdown/code/NativeChatCodeBlock'
import type { DocumentCodeBlockRenderer } from '@/components/sidebar/comment-markdown-element-renderers'
import { cn } from '@/lib/class-names'
import {
  openWorkspaceFileInEditor,
  resolveActiveWorkspaceLinkTarget
} from './ide-workspace-navigation'
import '../../native-chat/markdown/native-chat-markdown.css'
import './ide-chat-markdown.css'

const IdeCodeBlockRenderer: DocumentCodeBlockRenderer = ({ language, sourceLine, children }) => (
  <NativeChatCodeBlock language={language} sourceLine={sourceLine}>
    {children}
  </NativeChatCodeBlock>
)

export const IdeChatMarkdown = React.memo(function IdeChatMarkdown({
  content,
  streaming = false,
  directionOverride,
  className
}: {
  content: string
  streaming?: boolean
  directionOverride?: MarkdownDirectionOverride
  className?: string
}) {
  const handleLinkClick = useCallback<CommentMarkdownLinkClickHandler>((event, href) => {
    if (!href) {
      return
    }
    const target = resolveActiveWorkspaceLinkTarget(href)
    if (target) {
      event.preventDefault()
      openWorkspaceFileInEditor(target.relativePath, target.line)
      return
    }
    if (/^https?:\/\//i.test(href)) {
      event.preventDefault()
      window.open(href, '_blank', 'noopener,noreferrer')
    }
  }, [])

  return (
    <CommentMarkdown
      content={content}
      variant="document"
      math
      growing={streaming}
      unknownHtmlAsText
      allowFileUriLinks
      directionOverride={directionOverride}
      onLinkClick={handleLinkClick}
      renderCodeBlock={IdeCodeBlockRenderer}
      renderMermaid={!streaming}
      keepMermaidSourceWhilePending
      className={cn(
        'native-chat-markdown orca-ide-chat-markdown min-w-0 text-sm leading-7 text-foreground/90',
        className
      )}
    />
  )
})
