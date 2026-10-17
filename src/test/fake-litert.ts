import { vi } from 'vitest'
import type {
  AcceleratorTarget,
  InferenceModel,
  InferenceTensor,
  LiteRtPort,
  RuntimeFeature,
  TensorOutputData,
} from '../inference/types.ts'

export class FakeTensor implements InferenceTensor {
  deleteCount = 0
  readonly values: TensorOutputData
  readonly shape: number[]
  constructor(values: TensorOutputData, shape: number[] = [values.length]) {
    this.values = values
    this.shape = shape
  }
  data = vi.fn(async () => {
    if (this.deleteCount > 0) throw new Error('read after delete')
    return this.values
  })
  delete = vi.fn(() => {
    this.deleteCount += 1
  })
}

export class FakeModel implements InferenceModel {
  deleteCount = 0
  readonly outputs: FakeTensor[] = []
  // Default model: echoes the input values as one fresh output tensor.
  run = vi.fn(async (inputs: InferenceTensor[]): Promise<InferenceTensor[]> => {
    const out = new FakeTensor(Float32Array.from(await inputs[0].data()))
    this.outputs.push(out)
    return [out]
  })
  delete = vi.fn(() => {
    this.deleteCount += 1
  })
}

export interface FakePortOptions {
  features?: Partial<Record<RuntimeFeature, boolean>>
  failCompile?: Partial<Record<AcceleratorTarget, Error>>
}

export function createFakePort({ features = {}, failCompile = {} }: FakePortOptions = {}) {
  const tensors: FakeTensor[] = []
  const models: FakeModel[] = []
  const port = {
    loadRuntime: vi.fn(async () => undefined),
    compile: vi.fn(async (_url: string, target: AcceleratorTarget) => {
      const error = failCompile[target]
      if (error) throw error
      const model = new FakeModel()
      models.push(model)
      return model
    }),
    createTensor: vi.fn((data: TensorOutputData, shape: number[]) => {
      const tensor = new FakeTensor(data, shape)
      tensors.push(tensor)
      return tensor
    }),
    supports: vi.fn(async (feature: RuntimeFeature) => features[feature] ?? true),
  } satisfies LiteRtPort
  return { port, tensors, models }
}
