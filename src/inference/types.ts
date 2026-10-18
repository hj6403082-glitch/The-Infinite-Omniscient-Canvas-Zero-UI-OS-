// Port types: everything outside litert-adapter.ts talks to LiteRT.js through these.

// LiteRT.js only accepts input typed arrays backed by a plain (non-shared) ArrayBuffer,
// but may hand back outputs viewing any ArrayBufferLike (e.g. Wasm memory).
export type TensorData = Float32Array<ArrayBuffer> | Int32Array<ArrayBuffer> | Uint8Array<ArrayBuffer>
export type TensorOutputData = Float32Array | Int32Array | Uint8Array

export interface InferenceTensor {
  data(): Promise<TensorOutputData>
  delete(): void
}

export interface InferenceModel {
  run(inputs: InferenceTensor[]): Promise<InferenceTensor[]>
  delete(): void
}

// Fallback order (CLAUDE.md §3): NPU via WebNN, then WebGPU (ML Drift), then WASM/CPU (XNNPACK).
export const ACCELERATOR_ORDER = ['webnn-npu', 'webgpu', 'wasm'] as const
export type AcceleratorTarget = (typeof ACCELERATOR_ORDER)[number]

export type RuntimeFeature = 'jspi' | 'webnn' | 'webgpu'

export interface LiteRtPort {
  loadRuntime(wasmPath: string, options: { jspi: boolean }): Promise<void>
  compile(modelUrl: string, target: AcceleratorTarget): Promise<InferenceModel>
  createTensor(data: TensorData, shape: number[]): InferenceTensor
  supports(feature: RuntimeFeature): Promise<boolean>
}
