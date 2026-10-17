// Fixture logits for the stub intent model; label order matches INTENT_LABELS.
// [none, searchFiles, showStatus]
export const LOGITS = {
  confidentSearch: new Float32Array([0.1, 4.0, 0.2]),
  confidentStatus: new Float32Array([0.0, 0.3, 3.5]),
  idle: new Float32Array([3.0, 0.5, 0.4]),
  ambiguous: new Float32Array([0.0, 1.0, 0.9]),
  // Large magnitudes would overflow a naive exp() softmax.
  huge: new Float32Array([-1000, 1000, 999]),
} as const
