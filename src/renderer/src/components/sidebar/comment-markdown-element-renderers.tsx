import type { Components } from 'react-markdown'
import { createCompactCommentMarkdownComponents } from './comment-markdown-compact-components'
import { createDocumentCommentMarkdownComponents } from './comment-markdown-document-components'
import type {
  CommentMarkdownLinkClickHandler,
  DocumentCodeBlockRenderer
} from './comment-markdown-link-handlers'

export type {
  CommentMarkdownLinkClickHandler,
  DocumentCodeBlockRenderer
} from './comment-markdown-link-handlers'

export const compactCommentMarkdownComponents: Components = createCompactCommentMarkdownComponents()
export const documentCommentMarkdownComponents: Components =
  createDocumentCommentMarkdownComponents()

export function selectCommentMarkdownComponents({
  variant,
  onLinkClick,
  renderCodeBlock,
  expandImages
}: {
  variant: 'compact' | 'document'
  onLinkClick?: CommentMarkdownLinkClickHandler
  renderCodeBlock?: DocumentCodeBlockRenderer
  expandImages: boolean
}): Components {
  if (variant === 'document') {
    return onLinkClick || renderCodeBlock
      ? createDocumentCommentMarkdownComponents(onLinkClick, renderCodeBlock)
      : documentCommentMarkdownComponents
  }
  return onLinkClick || expandImages
    ? createCompactCommentMarkdownComponents(onLinkClick, expandImages)
    : compactCommentMarkdownComponents
}
