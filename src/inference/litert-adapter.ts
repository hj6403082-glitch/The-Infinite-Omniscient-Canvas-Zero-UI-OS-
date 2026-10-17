// The ONLY module allowed to import @litertjs/core (CLAUDE.md §3, enforced by ESLint).
import {
  type CompileOptions,
  isWebGPUSupported,
  loadAndCompile,
  loadLiteRt,
  supportsFeature,
  Tensor,
} from '@litertjs/core'
import type { AcceleratorTarget, InferenceModel, InferenceTensor, LiteRtPort } from './types.ts'

export const COMPILE_OPTIONS: Readonly<Record<AcceleratorTarget, CompileOptions>> = {
  'webnn-npu': { accelerator: 'webnn', webNNOptions: { devicePreference: 'npu' } },
  webgpu: { accelerator: 'webgpu' },
  wasm: { accelerator: 'wasm' },
}

let runtime: Promise<unknown> | undefined

function asLiteRtTensor(tensor: InferenceTensor): Tensor {
  if (!(tensor instanceof Tensor)) throw new TypeError('Input is not a LiteRT tensor created by this adapter')
  return tensor
}

export const liteRtPort: LiteRtPort = {
  async loadRuntime(wasmPath, { jspi }) {
    // LiteRT.js passes the global `Module` to Emscripten, which otherwise looks for the
    // .wasm binary next to the *worker* script rather than next to its glue script.
    if (!runtime) {
      const base = new URL(wasmPath, self.location.href)
      ;(self as { Module?: unknown }).Module = { locateFile: (file: string) => new URL(file, base).href }
      runtime = loadLiteRt(wasmPath, { jspi }).catch((error: unknown) => {
        runtime = undefined
        throw error
      })
    }
    await runtime
  },

  async compile(modelUrl, target): Promise<InferenceModel> {
    const model = await loadAndCompile(modelUrl, COMPILE_OPTIONS[target])
    return {
      run: async (inputs) => model.run(inputs.map(asLiteRtTensor)),
      delete: () => model.delete(),
    }
  },

  createTensor(data, shape) {
    return new Tensor(data, shape)
  },

  async supports(feature) {
    return feature === 'webgpu' ? isWebGPUSupported() : supportsFeature(feature)
  },
}
