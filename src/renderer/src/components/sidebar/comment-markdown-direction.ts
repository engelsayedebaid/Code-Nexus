// Markdown content carries its own direction: each block follows its first strong
// character, so Arabic reads right-to-left while English blocks stay LTR.

import type { Element, Root } from 'hast'

type Direction = 'rtl' | 'ltr'

const STRONG_CHARACTER = /\p{L}/u
// Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic, Arabic Supplement/Extended,
// presentation forms, and the supplementary RTL script planes.
const RIGHT_TO_LEFT_CHARACTER =
  /[\u0590-\u08FF\uFB1D-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u

/** Text whose script is decided by its first strong character; null when it has none. */
export function markdownTextDirection(text: string): Direction | null {
  for (const character of text) {
    if (STRONG_CHARACTER.test(character)) {
      return RIGHT_TO_LEFT_CHARACTER.test(character) ? 'rtl' : 'ltr'
    }
  }
  return null
}

/** Code, paths, and links are literals: they say nothing about the prose direction. */
function withoutLiterals(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\]\([^)\s]*\)/g, '] ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
}

/** Direction of a whole message, so its container can start at the matching edge. */
export function markdownMessageDirection(markdown: string): Direction {
  return markdownTextDirection(withoutLiterals(markdown)) ?? 'ltr'
}

/** Blocks that own their text alignment; literals are skipped when reading their script. */
const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'li',
  'ul',
  'ol',
  'table',
  'td',
  'th',
  'dd',
  'dt',
  'figcaption'
])

const LITERAL_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'svg', 'math', 'img'])

function firstStrongDirection(node: Root | Element): Direction | null {
  for (const child of node.children) {
    if (child.type === 'text') {
      const direction = markdownTextDirection(child.value)
      if (direction) {
        return direction
      }
    } else if (child.type === 'element' && !LITERAL_TAGS.has(child.tagName)) {
      const direction = firstStrongDirection(child)
      if (direction) {
        return direction
      }
    }
  }
  return null
}

function annotate(node: Root | Element, insidePre: boolean): void {
  for (const child of node.children) {
    if (child.type !== 'element') {
      continue
    }
    const tagName = child.tagName
    const pre = insidePre || tagName === 'pre'
    if (tagName === 'pre') {
      // Fenced code and terminal output keep their left-to-right ordering everywhere.
      child.properties = { ...child.properties, dir: 'ltr' }
    } else if (tagName === 'code' && !insidePre) {
      // Inline spans of code, paths, URLs, and hashes isolate themselves in both scripts.
      child.properties = { ...child.properties, dir: 'auto' }
    } else if (!insidePre && BLOCK_TAGS.has(tagName)) {
      const direction = firstStrongDirection(child)
      if (direction) {
        child.properties = { ...child.properties, dir: direction }
      }
    }
    annotate(child, pre)
  }
}

/** Runs after sanitize so each markdown block keeps the direction it renders with. */
export function rehypeMarkdownDirection(): (tree: Root) => void {
  return (tree) => annotate(tree, false)
}
