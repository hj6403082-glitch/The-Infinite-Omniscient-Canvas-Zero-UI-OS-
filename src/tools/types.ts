import type { A2uiMessage } from '@a2ui/web_core/v0_9'
import type { ToolName } from '../inference/intent-decoder.ts'
import type { AcceleratorTarget } from '../inference/types.ts'

export type { A2uiMessage, ToolName }

export const TASK_END_REASONS = [
  'completed',
  'dismissed',
  'error',
  'timeout',
  'superseded',
  'evicted',
  'shutdown',
] as const
export type TaskEndReason = (typeof TASK_END_REASONS)[number]

export interface SystemStatus {
  accelerator: AcceleratorTarget | null
  tensors: { created: number; deleted: number }
  activeTasks: number
}

export interface ToolContext {
  readonly surfaceId: string
  // Emits A2UI messages for this tool's surface; ignored once the task has ended.
  emit(...messages: A2uiMessage[]): void
  readonly signal: AbortSignal
  status(): SystemStatus
}

// 'complete' ends the task (the surface is deleted); 'continue' keeps it open.
export type ToolActionResult = 'complete' | 'continue'

export interface ToolHandle {
  onAction(name: string, context: Readonly<Record<string, unknown>>): ToolActionResult
}

export interface ToolDefinition {
  readonly name: ToolName
  // Streams the initial surface; resolves once the tool is waiting on the user.
  run(context: ToolContext, args: { query: string }): Promise<ToolHandle>
}
