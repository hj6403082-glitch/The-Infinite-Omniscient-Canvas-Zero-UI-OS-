import { describe, expect, it } from 'vitest'
import { createToolRegistry } from './registry.ts'
import type { ToolDefinition } from './types.ts'

const tool = (name: string): ToolDefinition =>
  ({ name, run: async () => ({ onAction: () => 'continue' }) }) as unknown as ToolDefinition

describe('tool registry (CLAUDE.md §5.2: deterministic, the model only selects)', () => {
  it('returns registered tools by name', () => {
    const search = tool('searchFiles')
    const registry = createToolRegistry([search, tool('showStatus')])
    expect(registry.get('searchFiles')).toBe(search)
    expect(registry.names).toEqual(['searchFiles', 'showStatus'])
  })

  it('throws for names that are not registered', () => {
    const registry = createToolRegistry([tool('searchFiles')])
    expect(() => registry.get('showStatus')).toThrow(/not registered: showStatus/)
    expect(() => registry.get('constructor')).toThrow(/not registered/)
    expect(() => registry.get('__proto__')).toThrow(/not registered/)
  })

  it('refuses tools the intent model cannot name', () => {
    expect(() => createToolRegistry([tool('deleteEverything')])).toThrow(/Unknown tool name: deleteEverything/)
  })

  it('refuses duplicate registrations', () => {
    expect(() => createToolRegistry([tool('showStatus'), tool('showStatus')])).toThrow(/Duplicate tool: showStatus/)
  })
})
