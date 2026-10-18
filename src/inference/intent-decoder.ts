export const TOOL_NAMES = ['searchFiles', 'showStatus'] as const
export type ToolName = (typeof TOOL_NAMES)[number]

// Output label order of the intent model. 'none' means "no tool should run".
export const INTENT_LABELS = ['none', ...TOOL_NAMES] as const
export type IntentLabel = (typeof INTENT_LABELS)[number]

export interface Intent {
  tool: ToolName
  confidence: number
}

export const DEFAULT_INTENT_THRESHOLD = 0.6

export function decodeIntent(
  logits: Float32Array,
  { threshold = DEFAULT_INTENT_THRESHOLD }: { threshold?: number } = {},
): Intent | null {
  if (logits.length !== INTENT_LABELS.length) {
    throw new Error(`decodeIntent: expected ${INTENT_LABELS.length} logits, got ${logits.length}`)
  }
  if (!logits.every(Number.isFinite)) throw new Error('decodeIntent: non-finite logit')

  // Softmax shifted by the max logit so exp() cannot overflow.
  const max = Math.max(...logits)
  const exps = Array.from(logits, (l) => Math.exp(l - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  const best = exps.indexOf(Math.max(...exps))
  const label = INTENT_LABELS[best]
  const confidence = exps[best] / sum

  if (label === 'none' || confidence < threshold) return null
  return { tool: label, confidence }
}
