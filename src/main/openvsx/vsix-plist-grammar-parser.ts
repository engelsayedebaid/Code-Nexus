type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue }

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|apos|quot);/g, (_match, entity: string) => {
    switch (entity) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'apos':
        return "'"
      case 'quot':
        return '"'
      default: {
        if (entity.startsWith('#x')) {
          const code = Number.parseInt(entity.slice(2), 16)
          return Number.isFinite(code) ? String.fromCodePoint(code) : ''
        }
        if (entity.startsWith('#')) {
          const code = Number.parseInt(entity.slice(1), 10)
          return Number.isFinite(code) ? String.fromCodePoint(code) : ''
        }
        return ''
      }
    }
  })
}

class PlistScanner {
  private pos = 0

  constructor(private readonly xml: string) {}

  parseRoot(): PlistValue | null {
    this.skipProlog()
    while (this.pos < this.xml.length) {
      this.skipWhitespaceAndComments()
      if (this.pos >= this.xml.length) {
        break
      }
      if (this.xml.startsWith('<plist', this.pos)) {
        const gt = this.xml.indexOf('>', this.pos)
        if (gt === -1) {
          return null
        }
        this.pos = gt + 1
        this.skipWhitespaceAndComments()
        return this.parseValue()
      }
      if (this.xml.startsWith('<dict', this.pos) || this.xml.startsWith('<array', this.pos)) {
        return this.parseValue()
      }
      this.pos += 1
    }
    return null
  }

  private skipProlog(): void {
    this.skipWhitespaceAndComments()
    while (this.xml.startsWith('<?', this.pos) || this.xml.startsWith('<!DOCTYPE', this.pos)) {
      const end = this.xml.indexOf('>', this.pos)
      if (end === -1) {
        return
      }
      this.pos = end + 1
      this.skipWhitespaceAndComments()
    }
  }

  private skipWhitespaceAndComments(): void {
    while (this.pos < this.xml.length) {
      const ch = this.xml[this.pos]
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos += 1
        continue
      }
      if (this.xml.startsWith('<!--', this.pos)) {
        const close = this.xml.indexOf('-->', this.pos + 4)
        this.pos = close === -1 ? this.xml.length : close + 3
        continue
      }
      break
    }
  }

  private readTagName(): { name: string; selfClosing: boolean; closing: boolean } | null {
    this.skipWhitespaceAndComments()
    if (this.xml[this.pos] !== '<') {
      return null
    }
    const gt = this.xml.indexOf('>', this.pos + 1)
    if (gt === -1) {
      return null
    }
    const rawInside = this.xml.slice(this.pos + 1, gt).trim()
    this.pos = gt + 1
    if (rawInside.startsWith('/')) {
      return { name: rawInside.slice(1).trim(), selfClosing: false, closing: true }
    }
    const selfClosing = rawInside.endsWith('/')
    const cleaned = selfClosing ? rawInside.slice(0, -1).trim() : rawInside
    const spaceIdx = cleaned.search(/\s/)
    const name = spaceIdx === -1 ? cleaned : cleaned.slice(0, spaceIdx)
    return { name, selfClosing, closing: false }
  }

  private readTextUntilCloseTag(tagName: string): string {
    const closeMarker = `</${tagName}`
    let result = ''
    while (this.pos < this.xml.length) {
      if (this.xml.startsWith('<![CDATA[', this.pos)) {
        const endCdata = this.xml.indexOf(']]>', this.pos + 9)
        if (endCdata === -1) {
          result += this.xml.slice(this.pos + 9)
          this.pos = this.xml.length
          break
        }
        result += this.xml.slice(this.pos + 9, endCdata)
        this.pos = endCdata + 3
        continue
      }
      const nextLt = this.xml.indexOf('<', this.pos)
      if (nextLt === -1) {
        result += decodeXmlEntities(this.xml.slice(this.pos))
        this.pos = this.xml.length
        break
      }
      result += decodeXmlEntities(this.xml.slice(this.pos, nextLt))
      if (this.xml.startsWith(closeMarker, nextLt)) {
        const gt = this.xml.indexOf('>', nextLt)
        this.pos = gt === -1 ? this.xml.length : gt + 1
        break
      }
      if (this.xml.startsWith('<!--', nextLt)) {
        const endComment = this.xml.indexOf('-->', nextLt + 4)
        this.pos = endComment === -1 ? this.xml.length : endComment + 3
        continue
      }
      // Stray '<' inside text
      result += '<'
      this.pos = nextLt + 1
    }
    return result
  }

  private parseValue(): PlistValue | null {
    const tag = this.readTagName()
    if (!tag || tag.closing) {
      return null
    }

    switch (tag.name) {
      case 'dict': {
        const obj: Record<string, PlistValue> = {}
        if (tag.selfClosing) {
          return obj
        }
        while (this.pos < this.xml.length) {
          this.skipWhitespaceAndComments()
          if (this.xml.startsWith('</dict', this.pos)) {
            this.readTagName()
            break
          }
          const keyTag = this.readTagName()
          if (!keyTag || keyTag.closing) {
            break
          }
          if (keyTag.name !== 'key') {
            continue
          }
          const key = keyTag.selfClosing ? '' : this.readTextUntilCloseTag('key')
          this.skipWhitespaceAndComments()
          const value = this.parseValue()
          if (value !== null) {
            obj[key] = value
          }
        }
        return obj
      }
      case 'array': {
        const items: PlistValue[] = []
        if (tag.selfClosing) {
          return items
        }
        while (this.pos < this.xml.length) {
          this.skipWhitespaceAndComments()
          if (this.xml.startsWith('</array', this.pos)) {
            this.readTagName()
            break
          }
          const value = this.parseValue()
          if (value === null) {
            break
          }
          items.push(value)
        }
        return items
      }
      case 'string':
      case 'data':
      case 'date':
        return tag.selfClosing ? '' : this.readTextUntilCloseTag(tag.name)
      case 'integer':
      case 'real': {
        const raw = tag.selfClosing ? '0' : this.readTextUntilCloseTag(tag.name).trim()
        const num = Number(raw)
        return Number.isFinite(num) ? num : 0
      }
      case 'true':
        if (!tag.selfClosing) {
          this.readTextUntilCloseTag('true')
        }
        return true
      case 'false':
        if (!tag.selfClosing) {
          this.readTextUntilCloseTag('false')
        }
        return false
      default:
        return tag.selfClosing ? '' : this.readTextUntilCloseTag(tag.name)
    }
  }
}

export function parseXmlPlist(content: string): Record<string, unknown> | null {
  try {
    const trimmed = content.trimStart()
    if (!trimmed.startsWith('<')) {
      return null
    }
    const parsed = new PlistScanner(content).parseRoot()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed
    }
    return null
  } catch {
    return null
  }
}
