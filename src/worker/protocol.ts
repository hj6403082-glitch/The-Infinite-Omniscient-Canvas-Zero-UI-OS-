// Messages crossing the main thread <-> intent worker boundary.
// Both directions are validated: postMessage payloads are untrusted input.
import { z } from 'zod'
import { SURFACE_ID_PATTERN } from '../a2ui/messages.ts'
import { TOOL_NAMES } from '../inference/intent-decoder.ts'
import { ACCELERATOR_ORDER } from '../inference/types.ts'
import { TASK_END_REASONS } from '../tools/types.ts'

export const MAX_TEXT_LENGTH = 2000

// Same-origin absolute path only: no scheme, no protocol-relative host, no backslashes.
const sameOriginPath = z.string().regex(/^\/(?!\/)[^\s:\\]*$/, 'must be a same-origin absolute path')
const unit = z.number().finite().min(0).max(1)
const SurfaceIdSchema = z.string().regex(SURFACE_ID_PATTERN)
const ActionNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
// Resolved action context: flat JSON primitives only.
const ActionContextSchema = z
  .record(z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null()]))
  .refine((context) => Object.keys(context).length <= 16, 'too many context keys')
const TensorStatsSchema = z.object({ created: z.number().int().min(0), deleted: z.number().int().min(0) })
// Envelope only: each A2UI message is validated in full by the main-thread message gate.
const A2uiBatchSchema = z.array(z.record(z.unknown())).min(1).max(64)

const WorkerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('init'), wasmPath: sameOriginPath, modelUrl: sameOriginPath }),
  z.object({ type: z.literal('text'), text: z.string().max(MAX_TEXT_LENGTH) }),
  // Pointer position as a fraction of the viewport, timestamped with performance.now().
  z.object({ type: z.literal('pointer'), x: unit, y: unit, at: z.number().finite().min(0) }),
  z.object({ type: z.literal('action'), surfaceId: SurfaceIdSchema, name: ActionNameSchema, context: ActionContextSchema }),
  z.object({ type: z.literal('dismiss'), surfaceId: SurfaceIdSchema }),
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
  z.object({ type: z.literal('a2ui'), messages: A2uiBatchSchema }),
  z.object({
    type: z.literal('taskEnded'),
    surfaceId: SurfaceIdSchema,
    tool: ToolNameSchema,
    reason: z.enum(TASK_END_REASONS),
    tensors: TensorStatsSchema,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('stopped'), tensors: TensorStatsSchema }),
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
