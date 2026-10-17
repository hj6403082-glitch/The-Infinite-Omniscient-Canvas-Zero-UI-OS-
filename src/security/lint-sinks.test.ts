// @vitest-environment node
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

// CLAUDE.md §1: no HTML/JS execution sinks anywhere in the codebase.
const eslint = new ESLint({ cwd: process.cwd() })

async function errorsFor(code: string, filePath = 'src/__fixture__.tsx') {
  const [result] = await eslint.lintText(code, { filePath })
  // A parse error would also be severity 2; make sure we only count real rule hits.
  expect(result.messages.filter((m) => m.fatal)).toEqual([])
  return result.messages.filter((m) => m.severity === 2 && m.ruleId !== null)
}

const BANNED: Record<string, string> = {
  'innerHTML assignment': `document.body.innerHTML = 'x'`,
  'outerHTML assignment': `document.body.outerHTML = 'x'`,
  insertAdjacentHTML: `document.body.insertAdjacentHTML('beforeend', 'x')`,
  'document.write': `document.write('x')`,
  dangerouslySetInnerHTML: `export const C = () => <div dangerouslySetInnerHTML={{ __html: 'x' }} />`,
  eval: `eval('1')`,
  'new Function': `export const f = new Function('return 1')`,
  'setTimeout with string': `setTimeout('alert(1)', 1)`,
  'setInterval with string': `setInterval('alert(1)', 1)`,
  'createContextualFragment': `document.createRange().createContextualFragment('x')`,
}

describe('lint: banned HTML/JS sinks', () => {
  for (const [name, code] of Object.entries(BANNED)) {
    it(`rejects ${name}`, async () => {
      expect(await errorsFor(code)).not.toHaveLength(0)
    })
  }

  it('accepts ordinary safe code', async () => {
    const code = `export const C = ({ label }: { label: string }) => <p>{label}</p>
setTimeout(() => undefined, 1)
`
    expect(await errorsFor(code)).toEqual([])
  })
})
