// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// CLAUDE.md: "Pin exact dependency versions (no ^/~)".
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as Record<
  string,
  Record<string, string> | undefined
>

const EXACT_SEMVER = /^\d+\.\d+\.\d+$/

describe('dependency pins', () => {
  for (const field of ['dependencies', 'devDependencies', 'overrides']) {
    it(`${field} use exact versions`, () => {
      const loose = Object.entries(pkg[field] ?? {}).filter(([, range]) => !EXACT_SEMVER.test(range))
      expect(loose).toEqual([])
    })
  }
})
