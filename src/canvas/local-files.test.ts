import { describe, expect, it, vi } from 'vitest'
import { createLocalFileStore, openLocalFile, safeBlobType } from './local-files.ts'

const file = (path: string, body = 'x', lastModified = 1_700_000_000_000) => {
  const name = path.split('/').at(-1)!
  const f = new File([body], name, { lastModified })
  Object.defineProperty(f, 'webkitRelativePath', { value: path })
  return f
}

describe('safeBlobType: user files must never run script in our origin', () => {
  it('gives viewable types their real MIME type', () => {
    expect(safeBlobType('report.pdf')).toBe('application/pdf')
    expect(safeBlobType('PHOTO.JPG')).toBe('image/jpeg')
    expect(safeBlobType('notes.md')).toBe('text/plain')
    expect(safeBlobType('data.json')).toBe('text/plain')
    expect(safeBlobType('song.mp3')).toBe('audio/mpeg')
  })

  it('forces scriptable or unknown types to download as opaque bytes', () => {
    for (const name of ['page.html', 'page.htm', 'doc.xhtml', 'logo.svg', 'app.js', 'run.exe', 'README', 'x.xml', 'a.mhtml']) {
      expect(safeBlobType(name), name).toBe('application/octet-stream')
    }
  })
})

describe('local file store', () => {
  it('turns a folder selection into metadata with stable user ids', () => {
    const store = createLocalFileStore()
    const payload = store.connect([file('Docs/finance/plan.xlsx', 'abcd', 1234.9), file('Docs/a.txt')])
    expect(payload).toEqual({
      source: 'Docs',
      files: [
        { id: 'u1', name: 'plan.xlsx', path: 'Docs/finance/plan.xlsx', size: 4, modified: 1234 },
        { id: 'u2', name: 'a.txt', path: 'Docs/a.txt', size: 1, modified: 1_700_000_000_000 },
      ],
    })
    expect(store.get('u1')?.name).toBe('plan.xlsx')
    expect(store.get('f1')).toBeUndefined()
  })

  it('skips hidden files and folders', () => {
    const payload = createLocalFileStore().connect([file('Docs/.git/config'), file('Docs/.DS_Store'), file('Docs/ok.txt')])
    expect(payload?.files.map((f) => f.name)).toEqual(['ok.txt'])
  })

  it('caps the number of files and truncates over-long names and paths', () => {
    const many = Array.from({ length: 5005 }, (_, i) => file(`Big/${i}.txt`))
    expect(createLocalFileStore().connect(many)?.files).toHaveLength(5000)
    const long = createLocalFileStore().connect([file(`Deep/${'d/'.repeat(600)}${'n'.repeat(300)}.txt`)])!.files[0]
    expect(long.name.length).toBeLessThanOrEqual(255)
    expect(long.path.length).toBeLessThanOrEqual(1024)
  })

  it('returns null for an empty selection and replaces earlier folders', () => {
    const store = createLocalFileStore()
    expect(store.connect([])).toBeNull()
    store.connect([file('A/one.txt')])
    store.connect([file('B/two.txt')])
    expect(store.get('u1')?.name).toBe('two.txt')
  })
})

describe('openLocalFile', () => {
  function env() {
    const anchor = { href: '', download: '', rel: '', click: vi.fn() }
    return {
      anchor,
      open: vi.fn(),
      createObjectURL: vi.fn((blob: Blob) => `blob:test/${blob.type}`),
      revokeObjectURL: vi.fn(),
      createAnchor: vi.fn(() => anchor),
      setTimeout: vi.fn((fn: () => void) => fn()),
    }
  }

  it('opens viewable files in a new tab without an opener and revokes the URL later', () => {
    const e = env()
    expect(openLocalFile(file('Docs/report.pdf'), e)).toBe('opened')
    expect(e.open).toHaveBeenCalledWith('blob:test/application/pdf', '_blank', 'noopener,noreferrer')
    expect(e.revokeObjectURL).toHaveBeenCalledWith('blob:test/application/pdf')
  })

  it('downloads anything that could execute instead of opening it', () => {
    const e = env()
    expect(openLocalFile(file('Docs/page.html', '<script>alert(1)</script>'), e)).toBe('downloaded')
    expect(e.open).not.toHaveBeenCalled()
    expect(e.anchor).toMatchObject({ href: 'blob:test/application/octet-stream', download: 'page.html', rel: 'noopener' })
    expect(e.anchor.click).toHaveBeenCalled()
  })
})
