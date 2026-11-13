import React from 'react'
import type { Components } from 'react-markdown'
import { readGitHubCalloutKind } from '../../../../shared/github/github-callouts'
import { MarkdownGitHubCallout } from '@/components/markdown-github-callout'
import { GitHubBodyImageUrlsContext } from './comment-markdown-github-image-urls'
import {
  CommentMarkdownDocumentCode,
  CommentMarkdownDocumentPre
} from './comment-markdown-code-renderers'
import {
  GitHubUserAttachmentImage,
  GitHubUserAttachmentVideo,
  isGitHubUserAttachmentUrl,
  isGitHubUserAttachmentVideoLink
} from './comment-markdown-github-attachment-media'
import { ExpandableMarkdownImage } from './MarkdownImageLightbox'
import {
  handleMarkdownAnchorAuxClick,
  handleMarkdownAnchorClick,
  handleMarkdownImageClick,
  type CommentMarkdownLinkClickHandler,
  type DocumentCodeBlockRenderer
} from './comment-markdown-link-handlers'

function DocumentMarkdownImage({
  alt,
  src,
  onLinkClick
}: {
  alt?: string
  src?: string
  onLinkClick?: CommentMarkdownLinkClickHandler
}): React.JSX.Element | null {
  const imageUrls = React.useContext(GitHubBodyImageUrlsContext)

  const mapped = Boolean(src && imageUrls?.[src])
  const [attachment, setAttachment] = React.useState({ src, mapped })
  if (attachment.src !== src || (mapped && !attachment.mapped)) {
    setAttachment({ src, mapped })
  }
  // Removing access data must not unmount an already-loaded attachment with the same identity.
  if (
    src &&
    (isGitHubUserAttachmentUrl(src) || mapped || (attachment.src === src && attachment.mapped))
  ) {
    return <GitHubUserAttachmentImage src={src} alt={alt} />
  }
  if (!src) {
    return alt ? <span>{alt}</span> : null
  }
  // Show document screenshots in a viewport lightbox rather than constraining them to the drawer.
  if (onLinkClick) {
    return (
      <img
        src={src}
        alt={alt ?? ''}
        className="my-3 max-h-96 max-w-full cursor-pointer rounded-md object-contain outline outline-1 outline-black/10 dark:outline-white/10"
        onClick={(e) => handleMarkdownImageClick(e, src, onLinkClick)}
      />
    )
  }
  return (
    <ExpandableMarkdownImage
      src={src}
      alt={alt}
      className="max-h-96 max-w-full rounded-md object-contain outline outline-1 outline-black/10 dark:outline-white/10"
    />
  )
}

export function createDocumentCommentMarkdownComponents(
  onLinkClick?: CommentMarkdownLinkClickHandler,
  renderCodeBlock?: DocumentCodeBlockRenderer
): Components {
  return {
    p: ({ children, dir }) => (
      <p dir={dir} className="my-2 first:mt-0 last:mb-0">
        {children}
      </p>
    ),
    a: ({ href, children, dir }) =>
      isGitHubUserAttachmentVideoLink(href, children) ? (
        // GitHub APIs return uploaded videos as links; embed them as GitHub’s renderer does.
        <GitHubUserAttachmentVideo href={href}>{children}</GitHubUserAttachmentVideo>
      ) : (
        <a
          dir={dir}
          href={href || undefined}
          target="_blank"
          rel="noreferrer"
          className="break-all text-primary underline underline-offset-2 hover:text-primary/80"
          onClick={(e) => handleMarkdownAnchorClick(e, href, onLinkClick)}
          onAuxClick={(e) => handleMarkdownAnchorAuxClick(e, href, onLinkClick)}
        >
          {children}
        </a>
      ),
    code: CommentMarkdownDocumentCode,
    pre: ({ node, children, dir }) => (
      <CommentMarkdownDocumentPre
        dir={dir}
        renderCodeBlock={renderCodeBlock}
        blockLine={node?.position?.start.line}
      >
        {children}
      </CommentMarkdownDocumentPre>
    ),
    ul: ({ children, dir }) => (
      <ul dir={dir} className={`my-2 ${dir === 'rtl' ? 'mr-5' : 'ml-5'} list-disc space-y-1`}>
        {children}
      </ul>
    ),
    ol: ({ children, start, dir }) => (
      <ol
        dir={dir}
        start={start}
        className={`my-2 ${dir === 'rtl' ? 'mr-5' : 'ml-5'} list-decimal space-y-1`}
      >
        {children}
      </ol>
    ),
    li: ({ children, dir }) => (
      <li dir={dir} className="leading-relaxed [&>input]:pointer-events-none">
        {children}
      </li>
    ),
    h1: ({ children, dir }) => (
      <h1 dir={dir} className="mb-2 mt-4 text-[18px] font-semibold leading-tight first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children, dir }) => (
      <h2 dir={dir} className="mb-2 mt-4 text-[16px] font-semibold leading-tight first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children, dir }) => (
      <h3 dir={dir} className="mb-2 mt-3 text-[15px] font-semibold leading-tight first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children, dir }) => (
      <h4 dir={dir} className="mb-1 mt-3 font-semibold first:mt-0">
        {children}
      </h4>
    ),
    h5: ({ children, dir }) => (
      <h5 dir={dir} className="mb-1 mt-3 font-semibold first:mt-0">
        {children}
      </h5>
    ),
    h6: ({ children, dir }) => (
      <h6 dir={dir} className="mb-1 mt-3 font-semibold first:mt-0">
        {children}
      </h6>
    ),
    hr: () => <hr className="my-4 border-border/60" />,
    blockquote: ({ node, children, dir }) => {
      const calloutKind = readGitHubCalloutKind(node?.properties.dataCallout)
      const frame = dir === 'rtl' ? 'border-r-2 pr-3' : 'border-l-2 pl-3'
      return calloutKind ? (
        <MarkdownGitHubCallout kind={calloutKind} dir={dir} className={`my-3 ${frame}`}>
          {children}
        </MarkdownGitHubCallout>
      ) : (
        <blockquote dir={dir} className={`my-3 ${frame} border-border/70 text-muted-foreground`}>
          {children}
        </blockquote>
      )
    },
    img: ({ alt, src }) => <DocumentMarkdownImage alt={alt} src={src} onLinkClick={onLinkClick} />,
    // Contain document GFM tables even in wider dashboard dialogs.
    table: ({ children, dir }) => (
      <div className="my-3 max-w-full overflow-x-auto rounded-md border border-border/60">
        <table
          dir={dir}
          className="min-w-full border-collapse text-[13px] [&_td]:border [&_td]:border-border/50 [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-border/50 [&_th]:bg-muted/60 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-start [&_th]:font-semibold"
        >
          {children}
        </table>
      </div>
    )
  } satisfies Components
}
