import type { Components } from 'react-markdown'
import { readGitHubCalloutKind } from '../../../../shared/github/github-callouts'
import { MarkdownGitHubCallout } from '@/components/markdown-github-callout'
import { isTrustedCompactImageSrc } from './comment-markdown-sanitize'
import { ExpandableMarkdownImage } from './MarkdownImageLightbox'
import {
  handleMarkdownAnchorAuxClick,
  handleMarkdownAnchorClick,
  type CommentMarkdownLinkClickHandler
} from './comment-markdown-link-handlers'

export function createCompactCommentMarkdownComponents(
  onLinkClick?: CommentMarkdownLinkClickHandler,
  expandImages = false
): Components {
  return {
    // Avoid paragraph margins in dense cards.
    p: ({ children, dir }) => (
      <span dir={dir} className="comment-md-p">
        {children}
      </span>
    ),
    a: ({ href, children, dir }) => (
      <a
        dir={dir}
        href={href || undefined}
        target="_blank"
        rel="noreferrer"
        className="underline underline-offset-2 text-foreground/80 hover:text-foreground"
        onClick={(e) => handleMarkdownAnchorClick(e, href, onLinkClick)}
        onAuxClick={(e) => handleMarkdownAnchorAuxClick(e, href, onLinkClick)}
      >
        {children}
      </a>
    ),
    // Bare fences have no language class; style all code inline, then use higher-specificity pre/code overrides for blocks.
    // Keep compact diagrams as bounded source so async SVG cannot reshape sidebar lists.
    code: ({ children, dir }) => (
      <code
        dir={dir}
        className="rounded bg-accent px-1 py-px text-[10px] font-mono [overflow-wrap:anywhere]"
      >
        {children}
      </code>
    ),
    pre: ({ children, dir }) => (
      <pre
        dir={dir ?? 'ltr'}
        className="my-1 max-h-32 max-w-full overflow-x-auto rounded bg-accent p-1.5 text-[10px] font-mono"
      >
        {children}
      </pre>
    ),
    ul: ({ children, dir }) => (
      <ul dir={dir} className={`my-0.5 ${dir === 'rtl' ? 'mr-3' : 'ml-3'} list-disc space-y-0`}>
        {children}
      </ul>
    ),
    ol: ({ children, start, dir }) => (
      <ol
        dir={dir}
        start={start}
        className={`my-0.5 ${dir === 'rtl' ? 'mr-3' : 'ml-3'} list-decimal space-y-0`}
      >
        {children}
      </ol>
    ),
    // Task checkboxes are read-only; pointer input would otherwise activate card editing.
    li: ({ children, dir }) => (
      <li dir={dir} className="leading-normal [&>input]:pointer-events-none">
        {children}
      </li>
    ),
    // Preserve compact span flow while heading roles retain navigable hierarchy.
    h1: ({ children, dir }) => (
      <span
        dir={dir}
        className="comment-md-h comment-md-h1 font-bold"
        role="heading"
        aria-level={1}
      >
        {children}
      </span>
    ),
    h2: ({ children, dir }) => (
      <span
        dir={dir}
        className="comment-md-h comment-md-h2 font-bold"
        role="heading"
        aria-level={2}
      >
        {children}
      </span>
    ),
    h3: ({ children, dir }) => (
      <span
        dir={dir}
        className="comment-md-h comment-md-h3 font-semibold"
        role="heading"
        aria-level={3}
      >
        {children}
      </span>
    ),
    h4: ({ children, dir }) => (
      <span dir={dir} className="comment-md-h font-semibold" role="heading" aria-level={4}>
        {children}
      </span>
    ),
    h5: ({ children, dir }) => (
      <span dir={dir} className="comment-md-h font-semibold" role="heading" aria-level={5}>
        {children}
      </span>
    ),
    h6: ({ children, dir }) => (
      <span dir={dir} className="comment-md-h font-semibold" role="heading" aria-level={6}>
        {children}
      </span>
    ),
    hr: () => <hr className="my-1 border-border/50" />,
    blockquote: ({ node, children, dir }) => {
      const calloutKind = readGitHubCalloutKind(node?.properties.dataCallout)
      // The accent rule sits on the reading start: right for Arabic, left otherwise.
      const frame = dir === 'rtl' ? 'border-r-2 pr-2' : 'border-l-2 pl-2'
      return calloutKind ? (
        <MarkdownGitHubCallout kind={calloutKind} dir={dir} className={`my-0.5 ${frame}`}>
          {children}
        </MarkdownGitHubCallout>
      ) : (
        <blockquote
          dir={dir}
          className={`my-0.5 ${frame} border-border/60 text-muted-foreground/80`}
        >
          {children}
        </blockquote>
      )
    },
    // Inline only app-managed screenshots; avoid fetching arbitrary remote images in compact cards.
    img: ({ alt, src }) => {
      if (!isTrustedCompactImageSrc(src)) {
        if (!src) {
          return alt ? <span>{alt}</span> : null
        }
        return (
          <a
            href={src || undefined}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 text-foreground/80 hover:text-foreground"
            onClick={(e) => handleMarkdownAnchorClick(e, src, onLinkClick)}
            onAuxClick={(e) => handleMarkdownAnchorAuxClick(e, src, onLinkClick)}
          >
            {alt || src}
          </a>
        )
      }

      if (expandImages) {
        return (
          <ExpandableMarkdownImage
            src={src}
            alt={alt}
            triggerClassName="my-1"
            className="max-h-32 max-w-full rounded-sm object-contain outline outline-1 outline-border/70"
          />
        )
      }

      const image = (
        <img
          src={src}
          alt={alt ?? ''}
          className="my-1 max-h-32 max-w-full rounded-sm object-contain outline outline-1 outline-border/70"
        />
      )
      return src ? (
        <a
          href={src || undefined}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => handleMarkdownAnchorClick(e, src, onLinkClick)}
          onAuxClick={(e) => handleMarkdownAnchorAuxClick(e, src, onLinkClick)}
        >
          {image}
        </a>
      ) : (
        image
      )
    },
    // Contain GFM tables with scrolling so wide content cannot expand narrow sidebar cards.
    table: ({ children, dir }) => (
      <div className="my-1 max-w-full overflow-x-auto">
        <table
          dir={dir}
          className="text-[10px] border-collapse [&_td]:border [&_td]:border-border/40 [&_td]:px-1 [&_td]:py-0.5 [&_th]:border [&_th]:border-border/40 [&_th]:px-1 [&_th]:py-0.5 [&_th]:font-semibold [&_th]:text-start"
        >
          {children}
        </table>
      </div>
    )
  } satisfies Components
}
