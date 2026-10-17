import { describe, expect, it } from 'vitest'
import { MAX_TEXT_LENGTH, parseWorkerCommand, parseWorkerEvent } from './protocol.ts'

describe('worker protocol: main -> worker commands', () => {
  it('accepts init, text and pointer signals, and stop', () => {
    expect(parseWorkerCommand({ type: 'init', wasmPath: '/litert-wasm/', modelUrl: '/models/intent.tflite' })).toEqual({
      type: 'init',
      wasmPath: '/litert-wasm/',
      modelUrl: '/models/intent.tflite',
    })
    expect(parseWorkerCommand({ type: 'text', text: 'find invoices' })?.type).toBe('text')
    expect(parseWorkerCommand({ type: 'pointer', x: 0.25, y: 0.75, at: 1000 })?.type).toBe('pointer')
    expect(parseWorkerCommand({ type: 'stop' })).toEqual({ type: 'stop' })
  })

  it('rejects unknown message types and malformed payloads', () => {
    for (const bad of [
      null,
      'stop',
      { type: 'eval', code: '1' },
      { type: 'text' },
      { type: 'text', text: 42 },
      { type: 'pointer', x: 2, y: 0, at: 0 },
      { type: 'pointer', x: Number.NaN, y: 0, at: 0 },
      { type: 'init', wasmPath: '/w/' },
    ]) {
      expect(parseWorkerCommand(bad)).toBeNull()
    }
  })

  it('rejects text longer than the limit', () => {
    expect(parseWorkerCommand({ type: 'text', text: 'x'.repeat(MAX_TEXT_LENGTH) })).not.toBeNull()
    expect(parseWorkerCommand({ type: 'text', text: 'x'.repeat(MAX_TEXT_LENGTH + 1) })).toBeNull()
  })

  it('only accepts same-origin absolute paths for model and wasm locations', () => {
    for (const path of ['https://evil.example/m.tflite', '//evil.example/m', 'javascript:alert(1)', 'm.tflite']) {
      expect(parseWorkerCommand({ type: 'init', wasmPath: '/w/', modelUrl: path })).toBeNull()
      expect(parseWorkerCommand({ type: 'init', wasmPath: path, modelUrl: '/m.tflite' })).toBeNull()
    }
  })

  it('strips unknown keys rather than passing them through', () => {
    expect(parseWorkerCommand({ type: 'stop', extra: '<script>' })).toEqual({ type: 'stop' })
  })
})

describe('worker protocol: worker -> main events', () => {
  it('accepts ready, intent, error and stopped events', () => {
    expect(
      parseWorkerEvent({
        type: 'ready',
        accelerator: 'webgpu',
        attempts: [{ target: 'webnn-npu', reason: 'unsupported: WebNN unavailable' }],
      })?.type,
    ).toBe('ready')
    expect(
      parseWorkerEvent({ type: 'intent', intent: { tool: 'searchFiles', confidence: 0.9 }, query: 'invoices' })?.type,
    ).toBe('intent')
    expect(parseWorkerEvent({ type: 'error', message: 'boom' })?.type).toBe('error')
    expect(parseWorkerEvent({ type: 'stopped', tensors: { created: 4, deleted: 4 } })?.type).toBe('stopped')
  })

  it('rejects unknown tools, accelerators and out-of-range confidence', () => {
    expect(parseWorkerEvent({ type: 'intent', intent: { tool: 'rm -rf', confidence: 0.9 }, query: '' })).toBeNull()
    expect(parseWorkerEvent({ type: 'intent', intent: { tool: 'showStatus', confidence: 1.5 }, query: '' })).toBeNull()
    expect(parseWorkerEvent({ type: 'ready', accelerator: 'quantum', attempts: [] })).toBeNull()
  })
})
