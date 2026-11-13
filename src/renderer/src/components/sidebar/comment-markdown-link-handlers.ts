import type React from 'react'
import { NATIVE_CHAT_FILE_HREF_PREFIX } from '../../../../shared/native-chat/native-chat-href-routing'

export type CommentMarkdownLinkClickHandler = (
  event: React.MouseEvent<HTMLElement>,
  href: string | undefined
) => void

/** Rendered as a component, so it may hold state. */
export type DocumentCodeBlockRenderer = (props: {
  children?: React.ReactNode
  language?: string
  /** Whole-document fence line stays stable while streaming only escapes within lines or appends text. */
  sourceLine?: number
}) => React.JSX.Element

export function handleMarkdownAnchorClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
  onLinkClick: CommentMarkdownLinkClickHandler | undefined
): void {
  // Link clicks must not activate outer cards; images consume clicks only with a wired handler.
  event.stopPropagation()
  const trimmedHref = href?.trim()
  if (
    trimmedHref?.toLowerCase().startsWith('file:') ||
    trimmedHref?.startsWith(NATIVE_CHAT_FILE_HREF_PREFIX)
  ) {
    event.preventDefault()
  }
  onLinkClick?.(event, href)
}

export function handleMarkdownAnchorAuxClick(
  event: React.MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
  onLinkClick: CommentMarkdownLinkClickHandler | undefined
): void {
  if (event.button === 1) {
    handleMarkdownAnchorClick(event, href, onLinkClick)
  }
}

export function handleMarkdownImageClick(
  event: React.MouseEvent<HTMLImageElement>,
  src: string | undefined,
  onLinkClick: CommentMarkdownLinkClickHandler | undefined
): void {
  if (!onLinkClick) {
    return
  }
  event.stopPropagation()
  onLinkClick(event, src)
}
