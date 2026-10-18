import { MessageProcessor, STRICT_VALIDATION } from '@a2ui/web_core/v0_9'
import { vi } from 'vitest'
import { buildTrustedCatalog } from '../a2ui/catalog-spec.ts'
import { DataTableApi } from '../a2ui/data-table-api.ts'
import type { A2uiMessage, SystemStatus, ToolContext } from '../tools/types.ts'

export const strictProcessor = () =>
  new MessageProcessor([buildTrustedCatalog([DataTableApi])], undefined, { validationConfig: STRICT_VALIDATION })

export function captureContext(surfaceId: string, status?: Partial<SystemStatus>) {
  const messages: A2uiMessage[] = []
  const controller = new AbortController()
  const context: ToolContext = {
    surfaceId,
    emit: (...m) => messages.push(...m),
    signal: controller.signal,
    openFile: vi.fn(),
    status: () => ({ accelerator: 'webgpu', tensors: { created: 4, deleted: 4 }, activeTasks: 1, ...status }),
  }
  return { context, messages, controller }
}
