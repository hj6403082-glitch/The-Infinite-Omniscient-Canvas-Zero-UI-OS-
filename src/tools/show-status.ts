import { a2ui, jsonPointer } from '../a2ui/messages.ts'
import type { AcceleratorTarget } from '../inference/types.ts'
import type { ToolDefinition } from './types.ts'

const ACCELERATOR_LABELS: Record<AcceleratorTarget, string> = {
  'webnn-npu': 'WebNN (NPU)',
  webgpu: 'WebGPU (ML Drift)',
  wasm: 'WebAssembly CPU (XNNPACK)',
}

export const showStatusTool: ToolDefinition = {
  name: 'showStatus',
  async run({ surfaceId, emit, status }) {
    const { accelerator, tensors, activeTasks } = status()
    emit(
      a2ui.updateComponents(surfaceId, [
        { id: 'root', component: 'Card', child: 'body' },
        { id: 'body', component: 'Column', children: ['title', 'accelerator', 'tensors', 'tasks', 'done'] },
        { id: 'title', component: 'Text', variant: 'h3', text: 'System status' },
        { id: 'accelerator', component: 'Text', text: { path: '/accelerator' } },
        { id: 'tensors', component: 'Text', text: { path: '/tensors' } },
        { id: 'tasks', component: 'Text', variant: 'caption', text: { path: '/tasks' } },
        { id: 'done', component: 'Button', variant: 'primary', child: 'doneLabel', action: { event: { name: 'acknowledge' } } },
        { id: 'doneLabel', component: 'Text', text: 'Done' },
      ]),
      a2ui.updateDataModel(surfaceId, jsonPointer(), {
        accelerator: `Accelerator: ${accelerator ? ACCELERATOR_LABELS[accelerator] : 'not initialized'}`,
        tensors: `Tensors: ${tensors.created} created · ${tensors.deleted} deleted · ${tensors.created - tensors.deleted} live`,
        tasks: `Active tasks: ${activeTasks}`,
      }),
    )
    return { onAction: (name) => (name === 'acknowledge' ? 'complete' : 'continue') }
  },
}
