import { describe, expect, it } from 'vitest'
import { isAllowedUrl } from './url-policy.ts'

describe('URL policy (E3)', () => {
  it('allows same-origin absolute paths', () => {
    expect(isAllowedUrl('/icons/pdf.svg')).toBe(true)
    expect(isAllowedUrl('/a/b?c=d#e')).toBe(true)
  })

  it('rejects script schemes, protocol-relative and relative URLs', () => {
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'data:image/png;base64,AAAA',
      'vbscript:msgbox',
      '//evil.example/x.png',
      '/\\evil.example/x.png',
      'icons/pdf.svg',
      '',
      ' /leading-space',
      'http://example.com/x.png',
    ]) {
      expect(isAllowedUrl(url), url).toBe(false)
    }
  })

  it('allows https only for explicitly approved origins', () => {
    expect(isAllowedUrl('https://cdn.example/x.png')).toBe(false)
    expect(isAllowedUrl('https://cdn.example/x.png', ['https://cdn.example'])).toBe(true)
    expect(isAllowedUrl('https://cdn.example.evil.com/x.png', ['https://cdn.example'])).toBe(false)
    expect(isAllowedUrl('http://cdn.example/x.png', ['http://cdn.example'])).toBe(false)
  })
})
