import { GitHubBodyImageUrlsContext } from './comment-markdown-github-image-urls'
import React from 'react'
import {
  CommentMarkdownMermaidContext,
  CommentMarkdownMermaidSourceContext
} from './comment-markdown-mermaid-policy'
import type { Components, Options as MarkdownOptions } from 'react-markdown'
import {
  commentMarkdownSanitizeSchema,
  commentMarkdownAllowedTagNames,
  commentMarkdownUrlTransform
} from './comment-markdown-sanitize'
import { commentMarkdownRemarkPlugins as remarkPlugins } from './comment-markdown-remark-plugins'
import { remarkChatMath } from './chat-markdown-math'
import { copyChatMathSelection } from './chat-markdown-math-selection'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { type Options as SanitizeSchema } from 'rehype-sanitize'
import remend from 'remend'
import { cn } from '@/lib/class-names'
import {
  selectCommentMarkdownComponents,
  type CommentMarkdownLinkClickHandler,
  type DocumentCodeBlockRenderer
} from './comment-markdown-element-renderers'
import {
  linkNativeChatFilePaths,
  type FileLinkExists
} from '../../../../shared/native-chat/native-chat-file-link-tree'
import { CommentMarkdownBlockLineContext } from './comment-markdown-code-renderers'
import { markdownMessageDirection, rehypeMarkdownDirection } from './comment-markdown-direction'
import './comment-markdown-direction.css'
import { htmlRendersAsText, remarkUnknownHtmlAsText } from './comment-markdown-unknown-html-as-text'
import { CommentMarkdownWords } from './CommentMarkdownWords'
import {
  MemoizedMarkdown,
  useMarkdownBlocks,
  markdownBlockContent
} from './comment-markdown-block-pipeline'
import {
  linkGitHubReferences,
  type GitHubRepoReference
} from '../../../../shared/github/github-reference-links'

export type { CommentMarkdownLinkClickHandler } from './comment-markdown-element-renderers'

type MarkdownPlugins = NonNullable<MarkdownOptions['rehypePlugins']>
type RemarkPlugins = NonNullable<MarkdownOptions['remarkPlugins']>
type UrlTransform = NonNullable<MarkdownOptions['urlTransform']>

const commentMarkdownFileUriUrlTransform: UrlTransform = (value, key, node) => {
  if (key === 'href' && node?.tagName === 'a' && value.trim().toLowerCase().startsWith('file:')) {
    return value
  }
  return commentMarkdownUrlTransform(value, key, node)
}

function remarkNativeChatFileLinks(
  exists: FileLinkExists
): () => (tree: Parameters<typeof linkNativeChatFilePaths>[0]) => void {
  return () => (tree) => linkNativeChatFilePaths(tree, exists)
}

export function remarkGitHubReferences(
  defaultRepo: GitHubRepoReference
): () => (tree: Parameters<typeof linkGitHubReferences>[0]) => void {
  return () => (tree) => linkGitHubReferences(tree, defaultRepo)
}

// Escape HTML before remark-breaks so newlines inside it still break.
const unknownHtmlAsTextRemarkPlugins = [
  remarkUnknownHtmlAsText(commentMarkdownAllowedTagNames),
  ...remarkPlugins
]
const unknownHtmlRendersAsText = (html: string): boolean =>
  htmlRendersAsText(html, commentMarkdownAllowedTagNames)

export type MarkdownDirectionOverride = 'auto' | 'rtl' | 'ltr'

const DIRECTION_BLOCK_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'table'
])

const LTR_LITERAL_TEXT = /^(?:https?:\/\/|\/|~\/|[A-Za-z]:[\\/]|[\w.-]+\/[\w./-]+|[0-9a-f]{7,40}$)/i

function textOfHastNode(node: unknown): string {
  if (!node || typeof node !== 'object') {
    return ''
  }
  const record = node as { type?: string; value?: string; children?: unknown[] }
  if (record.type === 'text' && typeof record.value === 'string') {
    return record.value
  }
  if (Array.isArray(record.children)) {
    return record.children.map(textOfHastNode).join('')
  }
  return ''
}

function rehypeDirectionOverride(override: 'rtl' | 'ltr') {
  return () => (tree: unknown) => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return
      }
      const element = node as {
        type?: string
        tagName?: string
        properties?: Record<string, unknown>
        children?: unknown[]
      }
      if (element.type === 'element' && element.tagName) {
        if (DIRECTION_BLOCK_TAGS.has(element.tagName)) {
          element.properties ??= {}
          element.properties.dir = override
        } else if (
          element.tagName === 'a' &&
          LTR_LITERAL_TEXT.test(textOfHastNode(element).trim())
        ) {
          element.properties ??= {}
          element.properties.dir = 'ltr'
        }
      }
      if (Array.isArray(element.children)) {
        for (const child of element.children) {
          visit(child)
        }
      }
    }
    visit(tree)
  }
}

function rehypeBidiIsolateLinks() {
  return () => (tree: unknown) => {
    const visit = (node: unknown) => {
      if (!node || typeof node !== 'object') {
        return
      }
      const element = node as {
        type?: string
        tagName?: string
        properties?: Record<string, unknown>
        children?: unknown[]
      }
      if (
        element.type === 'element' &&
        element.tagName === 'a' &&
        LTR_LITERAL_TEXT.test(textOfHastNode(element).trim())
      ) {
        element.properties ??= {}
        element.properties.dir = 'ltr'
      }
      if (Array.isArray(element.children)) {
        for (const child of element.children) {
          visit(child)
        }
      }
    }
    visit(tree)
  }
}

// GitHub comments use raw HTML; parse it then sanitize before rendering.
// Direction is read after sanitize so only the surviving blocks are annotated.
const rehypePlugins: MarkdownPlugins = [
  rehypeRaw,
  [rehypeSanitize, commentMarkdownSanitizeSchema],
  rehypeMarkdownDirection,
  rehypeBidiIsolateLinks()
]

const rehypePluginsRtl: MarkdownPlugins = [
  rehypeRaw,
  [rehypeSanitize, commentMarkdownSanitizeSchema],
  rehypeDirectionOverride('rtl')
]

const rehypePluginsLtr: MarkdownPlugins = [
  rehypeRaw,
  [rehypeSanitize, commentMarkdownSanitizeSchema],
  rehypeDirectionOverride('ltr')
]

/** Keep extensions stable per surface; new objects rebuild components and remount their contents. */
export type CommentMarkdownExtension = {
  remarkPlugins: RemarkPlugins
  /** Extra flow syntax requires one of these markers; omitted means unknown grammar. */
  extraFlowSyntaxMarkers?: readonly string[]
  sanitizeAttributes: Record<string, readonly string[]>
  components: Components
}

function extensionRehypePlugins(
  extension: CommentMarkdownExtension,
  directionOverride: MarkdownDirectionOverride
): MarkdownPlugins {
  const attributes: NonNullable<SanitizeSchema['attributes']> = {
    ...commentMarkdownSanitizeSchema.attributes
  }
  for (const [tagName, names] of Object.entries(extension.sanitizeAttributes)) {
    attributes[tagName] = [...(attributes[tagName] ?? []), ...names]
  }
  return [
    rehypeRaw,
    [rehypeSanitize, { ...commentMarkdownSanitizeSchema, attributes }],
    directionOverride === 'auto'
      ? rehypeMarkdownDirection
      : rehypeDirectionOverride(directionOverride),
    ...(directionOverride === 'auto' ? [rehypeBidiIsolateLinks()] : [])
  ]
}

type CommentMarkdownProps = React.ComponentPropsWithoutRef<'div'> & {
  content: string
  bodyImageUrls?: Readonly<Record<string, string>>
  math?: boolean
  variant?: 'compact' | 'document'
  githubRepo?: GitHubRepoReference | null
  onLinkClick?: CommentMarkdownLinkClickHandler
  allowFileUriLinks?: boolean
  /** Turns detected file paths into links, keeping only those this confirms exist. */
  fileLinkExists?: FileLinkExists
  expandImages?: boolean
  renderCodeBlock?: DocumentCodeBlockRenderer
  renderMermaid?: boolean
  keepMermaidSourceWhilePending?: boolean
  /** The content is still being appended to: render it block by block, so each
   *  append re-renders only the last block, and close markup its end leaves open.
   *  The block-by-block render stays on once seen. */
  growing?: boolean
  /** Give each word its own `data-word` element, for a stylesheet to animate as words arrive. */
  fadeWords?: boolean
  extension?: CommentMarkdownExtension
  /** Show raw HTML that sanitize would strip as literal text instead of dropping its tags. */
  unknownHtmlAsText?: boolean
  /** Optional per-message direction override ('auto' uses per-block Arabic/LTR detection). */
  directionOverride?: MarkdownDirectionOverride
}

// Why forwardRef + rest props: Radix's HoverCardTrigger asChild merges a ref
// and event handlers (onPointerEnter, onPointerLeave, data-state, etc.) onto
// the child. Without forwarding both, the hover card cannot open or position.
const CommentMarkdown = React.memo(
  React.forwardRef<HTMLDivElement, CommentMarkdownProps>(function CommentMarkdown(
    {
      content,
      bodyImageUrls,
      math = false,
      className,
      variant = 'compact',
      githubRepo,
      onLinkClick,
      allowFileUriLinks = false,
      fileLinkExists,
      expandImages = false,
      renderCodeBlock,
      renderMermaid = true,
      keepMermaidSourceWhilePending = false,
      growing = false,
      fadeWords = false,
      extension,
      onCopy,
      unknownHtmlAsText = false,
      directionOverride = 'auto',
      ...rest
    },
    ref
  ) {
    const baseComponents = React.useMemo(
      () =>
        selectCommentMarkdownComponents({
          variant,
          onLinkClick,
          renderCodeBlock,
          expandImages
        }),
      [expandImages, renderCodeBlock, variant, onLinkClick]
    )
    const components = React.useMemo(
      () => (extension ? { ...baseComponents, ...extension.components } : baseComponents),
      [baseComponents, extension]
    )
    const fadingComponents = React.useMemo(
      () => ({ ...components, span: CommentMarkdownWords }),
      [components]
    )
    const activeRehypePlugins = React.useMemo<MarkdownPlugins>(() => {
      if (extension) {
        return extensionRehypePlugins(extension, directionOverride)
      }
      if (directionOverride === 'rtl') {
        return rehypePluginsRtl
      }
      if (directionOverride === 'ltr') {
        return rehypePluginsLtr
      }
      return rehypePlugins
    }, [directionOverride, extension])
    const activeRemarkPlugins = React.useMemo(() => {
      const basePlugins = unknownHtmlAsText ? unknownHtmlAsTextRemarkPlugins : remarkPlugins
      const plugins = fileLinkExists
        ? [...basePlugins, remarkNativeChatFileLinks(fileLinkExists)]
        : basePlugins
      const withMath: RemarkPlugins = math ? [...plugins, remarkChatMath] : plugins
      const withExtension = extension ? [...withMath, ...extension.remarkPlugins] : withMath
      return githubRepo ? [...withExtension, remarkGitHubReferences(githubRepo)] : withExtension
    }, [extension, fileLinkExists, githubRepo, math, unknownHtmlAsText])
    const blocks = useMarkdownBlocks(
      content,
      growing,
      math,
      activeRemarkPlugins,
      extension,
      unknownHtmlAsText ? unknownHtmlRendersAsText : undefined
    )
    const [hadWordFade, setHadWordFade] = React.useState(fadeWords)
    if (fadeWords && !hadWordFade) {
      setHadWordFade(true)
    }
    const wrapsWords = fadeWords || hadWordFade
    const messageDirection = React.useMemo(() => {
      if (directionOverride === 'rtl') {
        return 'rtl'
      }
      if (directionOverride === 'ltr') {
        return 'ltr'
      }
      return markdownMessageDirection(content) === 'rtl' ? 'rtl' : undefined
    }, [content, directionOverride])

    return (
      <GitHubBodyImageUrlsContext.Provider value={bodyImageUrls}>
        <CommentMarkdownMermaidContext.Provider value={renderMermaid}>
          <CommentMarkdownMermaidSourceContext.Provider value={keepMermaidSourceWhilePending}>
            <div
              ref={ref}
              dir={messageDirection}
              data-direction-override={directionOverride !== 'auto' ? directionOverride : undefined}
              className={cn(
                'comment-markdown',
                // Descendant pre/code selectors outrank inline-code pill utilities to reset block-code styling.
                '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none',
                'min-w-0 max-w-full [overflow-wrap:anywhere]',
                className
              )}
              onCopy={(event) => {
                onCopy?.(event)
                if (math && !event.defaultPrevented) {
                  copyChatMathSelection(event)
                }
              }}
              {...rest}
            >
              {blocks.map((block, index) => (
                <CommentMarkdownBlockLineContext.Provider key={block.start} value={block.line}>
                  <MemoizedMarkdown
                    block={block.tree ? block : undefined}
                    remarkPlugins={activeRemarkPlugins}
                    rehypePlugins={activeRehypePlugins}
                    math={math}
                    fadeWords={wrapsWords}
                    components={wrapsWords ? fadingComponents : components}
                    urlTransform={
                      allowFileUriLinks
                        ? commentMarkdownFileUriUrlTransform
                        : commentMarkdownUrlTransform
                    }
                  >
                    {growing && index === blocks.length - 1 && !block.literalMath
                      ? remend(markdownBlockContent(block), {
                          linkMode: 'text-only',
                          ...(math ? { katex: false, inlineKatex: false } : {})
                        })
                      : markdownBlockContent(block)}
                  </MemoizedMarkdown>
                </CommentMarkdownBlockLineContext.Provider>
              ))}
            </div>
          </CommentMarkdownMermaidSourceContext.Provider>
        </CommentMarkdownMermaidContext.Provider>
      </GitHubBodyImageUrlsContext.Provider>
    )
  })
)

export default CommentMarkdown
