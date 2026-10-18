import { ACCELERATOR_ORDER, type AcceleratorTarget, type InferenceModel, type LiteRtPort } from './types.ts'

export interface InferenceLog {
  info(message: string): void
  warn(message: string): void
}

export interface InitConfig {
  wasmPath: string
  modelUrl: string
  log: InferenceLog
}

export interface AcceleratorAttempt {
  target: AcceleratorTarget
  reason: string
}

export interface InitResult {
  model: InferenceModel
  accelerator: AcceleratorTarget
  attempts: AcceleratorAttempt[]
}

async function unsupportedReason(
  port: LiteRtPort,
  target: AcceleratorTarget,
  jspi: boolean,
): Promise<string | null> {
  switch (target) {
    case 'webnn-npu':
      if (!jspi) return 'unsupported: JSPI unavailable'
      return (await port.supports('webnn')) ? null : 'unsupported: WebNN unavailable'
    case 'webgpu':
      return (await port.supports('webgpu')) ? null : 'unsupported: WebGPU unavailable'
    case 'wasm':
      return null
  }
}

// Loads LiteRT.js and compiles the model on the best accelerator available:
// WebNN (NPU) -> WebGPU (ML Drift) -> WASM/CPU (XNNPACK). CLAUDE.md §3.
export async function initInference(port: LiteRtPort, { wasmPath, modelUrl, log }: InitConfig): Promise<InitResult> {
  // WebNN requires the JSPI build; loading it on a browser without JSPI would fail.
  const jspi = await port.supports('jspi')
  await port.loadRuntime(wasmPath, { jspi })

  const attempts: AcceleratorAttempt[] = []
  for (const target of ACCELERATOR_ORDER) {
    const skip = await unsupportedReason(port, target, jspi)
    if (skip) {
      attempts.push({ target, reason: skip })
      log.warn(`[inference] skipping ${target}: ${skip}`)
      continue
    }
    try {
      const model = await port.compile(modelUrl, target)
      log.info(`[inference] active accelerator: ${target}`)
      return { model, accelerator: target, attempts }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      attempts.push({ target, reason })
      log.warn(`[inference] ${target} failed to compile: ${reason}`)
    }
  }
  throw new Error(
    `No accelerator could compile ${modelUrl}: ${attempts.map((a) => `${a.target}: ${a.reason}`).join('; ')}`,
  )
}
