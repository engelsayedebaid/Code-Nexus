import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { markdownTextDirection } from '@/components/sidebar/comment-markdown-direction'

const directionKey = new PluginKey('richMarkdownDirection')

// Containers whose layout (list markers, table column order, quote bars) follows their content direction.
const DIRECTIONAL_CONTAINERS = new Set([
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'blockquote'
])

function firstStrongDirection(node: ProseMirrorNode): 'rtl' | 'ltr' | null {
  let direction: 'rtl' | 'ltr' | null = null
  node.descendants((child) => {
    if (direction || !child.isText) {
      return !direction
    }
    // Inline code, paths, and URLs are literals: they say nothing about the prose direction.
    if (child.marks.some((mark) => mark.type.spec.code)) {
      return true
    }
    direction = markdownTextDirection(child.text ?? '')
    return !direction
  })
  return direction
}

function collectDecorations(doc: ProseMirrorNode): Decoration[] {
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (node.type.spec.code) {
      return false
    }
    const directional = node.isTextblock || DIRECTIONAL_CONTAINERS.has(node.type.name)
    if (!directional) {
      return true
    }
    const direction = firstStrongDirection(node)
    if (direction) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { dir: direction }))
    }
    return true
  })
  return decorations
}

/** View-only `dir` attributes so Arabic prose aligns RTL without changing the stored Markdown. */
export const RichMarkdownDirection = Extension.create({
  name: 'richMarkdownDirection',

  addProseMirrorPlugins() {
    let cachedDoc: ProseMirrorNode | null = null
    let cachedDecorations: DecorationSet | null = null
    return [
      new Plugin({
        key: directionKey,
        props: {
          decorations(state) {
            if (state.doc !== cachedDoc || !cachedDecorations) {
              cachedDoc = state.doc
              cachedDecorations = DecorationSet.create(state.doc, collectDecorations(state.doc))
            }
            return cachedDecorations
          }
        }
      })
    ]
  }
})
