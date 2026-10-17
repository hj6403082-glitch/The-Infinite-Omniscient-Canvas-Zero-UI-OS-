// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// CLAUDE.md §3: all LiteRT.js access goes through one adapter module.
const eslint = new ESLint({ cwd: process.cwd() })

async function ruleHits(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath })
  expect(result.messages.filter((m) => m.fatal)).toEqual([])
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
}

describe('lint: LiteRT.js import boundary', () => {
  const importLine = `import { loadAndCompile } from '@litertjs/core'\nexport { loadAndCompile }\n`

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
