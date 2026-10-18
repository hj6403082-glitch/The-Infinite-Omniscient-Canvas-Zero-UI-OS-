// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// CLAUDE.md §3: all LiteRT.js access goes through one adapter module.
const eslint = new ESLint({ cwd: process.cwd() })

async function ruleHits(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  expect(result.messages.filter((m) => m.fatal)).toEqual([])
  return result.messages.filter((m) => m.ruleId?.endsWith('no-restricted-imports'))
}

const importLine = `import { loadAndCompile } from '@litertjs/core'\nexport { loadAndCompile }\n`

describe('lint: LiteRT.js import boundary', () => {

  it('rejects @litertjs/core imports outside the adapter', async () => {
    expect(await ruleHits(importLine, 'src/worker/intent-loop.ts')).toHaveLength(1)
  })

  it('rejects type-only imports and subpaths too', async () => {
    const code = `import type { Tensor } from '@litertjs/core/dist/index.js'\nexport type T = Tensor\n`
    expect(await ruleHits(code, 'src/inference/run-inference.ts')).toHaveLength(1)
  })

  it('allows the adapter itself', async () => {
    expect(await ruleHits(importLine, 'src/inference/litert-adapter.ts')).toEqual([])
  })
})

describe('lint: worker code stays free of the A2UI runtime', () => {
  it('rejects value imports of @a2ui/* in worker-side code', async () => {
    const code = `import { MessageProcessor } from '@a2ui/web_core/v0_9'\nexport { MessageProcessor }\n`
    expect(await ruleHits(code, 'src/tools/search-files.ts')).toHaveLength(1)
    expect(await ruleHits(code, 'src/worker/worker-runtime.ts')).toHaveLength(1)
    expect(await ruleHits(code, 'src/a2ui/messages.ts')).toHaveLength(1)
  })

  it('allows type-only imports there, and value imports on the main thread', async () => {
    const typeOnly = `import type { A2uiMessage } from '@a2ui/web_core/v0_9'\nexport type M = A2uiMessage\n`
    expect(await ruleHits(typeOnly, 'src/tools/search-files.ts')).toEqual([])
    const value = `import { MessageProcessor } from '@a2ui/web_core/v0_9'\nexport { MessageProcessor }\n`
    expect(await ruleHits(value, 'src/canvas/Canvas.tsx')).toEqual([])
  })

  it('still enforces the LiteRT boundary in worker-side code', async () => {
    expect(await ruleHits(importLine, 'src/tools/search-files.ts')).toHaveLength(1)
  })
})
