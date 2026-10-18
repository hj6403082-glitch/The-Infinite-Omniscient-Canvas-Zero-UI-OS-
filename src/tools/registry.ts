import { TOOL_NAMES, type ToolName } from '../inference/intent-decoder.ts'
import type { ToolDefinition } from './types.ts'

const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name)

export function createToolRegistry(tools: readonly ToolDefinition[]) {
  const byName = new Map<ToolName, ToolDefinition>()
  for (const tool of tools) {
    if (!isToolName(tool.name)) throw new Error(`Unknown tool name: ${String(tool.name)}`)
    if (byName.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`)
    byName.set(tool.name, tool)
  }
  return {
    names: [...byName.keys()],
    get(name: string): ToolDefinition {
      const tool = isToolName(name) ? byName.get(name) : undefined
      if (!tool) throw new Error(`Tool not registered: ${name}`)
      return tool
    },
  }
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>
