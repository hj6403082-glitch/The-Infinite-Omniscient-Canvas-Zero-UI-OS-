import { A2uiMessageSchema, type A2uiMessage, type MessageProcessor } from '@a2ui/web_core/v0_9'
import { SURFACE_ID_PATTERN, TRUSTED_CATALOG_ID } from './messages.ts'
import { isAllowedUrl } from './url-policy.ts'

export const MAX_MESSAGE_BYTES = 256 * 1024
const MAX_DEPTH = 32
const URL_PROPS = new Set(['url', 'href', 'src'])

// Script-capable URL schemes, matched after stripping whitespace/control characters.
const SCRIPT_SCHEME = /(?:javascript|vbscript|data:text\/html)/i
// Component definitions are static, reviewed-shape trees: no markup or handlers at all.
const COMPONENT_MARKUP = /<\s*[a-z!/?]|\bon[a-z]+\s*=/i
// Data values are rendered as text, so ordinary "<" is fine; executable markup is not.
const DATA_MARKUP =
  /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta|base|form|img|video|audio)\b|<[^>]*\bon[a-z]+\s*=/i

// Drops whitespace, C0/C1 controls and NBSP, which browsers ignore inside URL schemes.
const strip = (s: string) =>
  Array.from(s)
    .filter((c) => {
      const code = c.codePointAt(0)!
      return code > 0x20 && (code < 0x7f || code > 0xa0)
    })
    .join('')

function* strings(value: unknown, depth = 0): Generator<string> {
  if (depth > MAX_DEPTH) throw new Error('nesting too deep')
  if (typeof value === 'string') yield value
  else if (Array.isArray(value)) for (const item of value) yield* strings(item, depth + 1)
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      yield key
      yield* strings(item, depth + 1)
    }
  }
}

function surfaceIdOf(message: A2uiMessage): string {
  const body = Object.entries(message).find(([key]) => key !== 'version')?.[1] as { surfaceId: string }
  return body.surfaceId
}

// Returns a rejection reason, or null when the message may reach the processor.
function inspect(message: A2uiMessage): string | null {
  if (!SURFACE_ID_PATTERN.test(surfaceIdOf(message))) return 'unexpected surface id'
  if ('createSurface' in message && message.createSurface.catalogId !== TRUSTED_CATALOG_ID) {
    return 'untrusted catalog'
  }
  if ('updateComponents' in message) {
    for (const s of strings(message.updateComponents.components)) {
      if (COMPONENT_MARKUP.test(s) || SCRIPT_SCHEME.test(strip(s))) return 'markup or script URL in components'
    }
    for (const component of message.updateComponents.components) {
      for (const [key, value] of Object.entries(component)) {
        if (!URL_PROPS.has(key)) continue
        if (typeof value !== 'string') return `${key} must be a literal URL`
        if (!isAllowedUrl(value)) return `${key} violates the URL policy`
      }
    }
  }
  if ('updateDataModel' in message) {
    for (const s of strings(message.updateDataModel.value)) {
      if (DATA_MARKUP.test(s) || SCRIPT_SCHEME.test(strip(s))) return 'executable content in data model'
    }
  }
  return null
}

// Zero-trust gate in front of the MessageProcessor: every message is validated on its own
// and dropped whole on any failure (CLAUDE.md §2).
export function createMessageGate(
  processor: Pick<MessageProcessor, 'processMessages'>,
  { onReject }: { onReject(reason: string, message: unknown): void },
) {
  function applyOne(raw: unknown): boolean {
    let size: number
    try {
      size = JSON.stringify(raw)?.length ?? 0
    } catch {
      onReject('not serializable', raw)
      return false
    }
    if (size > MAX_MESSAGE_BYTES) {
      onReject(`message too large (${size} bytes)`, raw)
      return false
    }
    const parsed = A2uiMessageSchema.safeParse(raw)
    if (!parsed.success) {
      onReject('failed the A2UI v0.9 schema', raw)
      return false
    }
    let reason: string | null
    try {
      reason = inspect(parsed.data)
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
    if (reason) {
      onReject(reason, raw)
      return false
    }
    try {
      processor.processMessages([parsed.data])
      return true
    } catch (error) {
      onReject(`processor: ${error instanceof Error ? error.message : String(error)}`, raw)
      return false
    }
  }

  return {
    // Returns how many messages were applied.
    apply(batch: readonly unknown[]): number {
      let applied = 0
      for (const raw of batch) if (applyOne(raw)) applied += 1
      return applied
    },
  }
}
