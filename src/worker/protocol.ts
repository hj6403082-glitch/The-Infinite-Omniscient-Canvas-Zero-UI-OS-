// Messages crossing the main thread <-> intent worker boundary.
// Both directions are validated: postMessage payloads are untrusted input.
import { z } from 'zod'
import { TOOL_NAMES } from '../inference/intent-decoder.ts'
import { ACCELERATOR_ORDER } from '../inference/types.ts'

export const MAX_TEXT_LENGTH = 2000

// Same-origin absolute path only: no scheme, no protocol-relative host, no backslashes.
const sameOriginPath = z.string().regex(/^\/(?!\/)[^\s:\\]*$/, 'must be a same-origin absolute path')
const unit = z.number().finite().min(0).max(1)

const WorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('init'), wasmPath: sameOriginPath, modelUrl: sameOriginPath }),
  z.object({ type: z.literal('text'), text: z.string().max(MAX_TEXT_LENGTH) }),
  // Pointer position as a fraction of the viewport, timestamped with performance.now().
  z.object({ type: z.literal('pointer'), x: unit, y: unit, at: z.number().finite().min(0) }),
  z.object({ type: z.literal('stop') }),
])

const AcceleratorSchema = z.enum(ACCELERATOR_ORDER)
const ToolNameSchema = z.enum(TOOL_NAMES)

const WorkerEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    accelerator: AcceleratorSchema,
    attempts: z.array(z.object({ target: AcceleratorSchema, reason: z.string() })),
  }),
  z.object({
    type: z.literal('intent'),
    intent: z.object({ tool: ToolNameSchema, confidence: unit }),
    query: z.string().max(MAX_TEXT_LENGTH),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('stopped'),
    tensors: z.object({ created: z.number().int().min(0), deleted: z.number().int().min(0) }),
  }),
])

export type WorkerCommand = z.infer<typeof WorkerCommandSchema>
export type WorkerEvent = z.infer<typeof WorkerEventSchema>

export function parseWorkerCommand(data: unknown): WorkerCommand | null {
  const result = WorkerCommandSchema.safeParse(data)
  return result.success ? result.data : null
}

export function parseWorkerEvent(data: unknown): WorkerEvent | null {
  const result = WorkerEventSchema.safeParse(data)
  return result.success ? result.data : null
}
