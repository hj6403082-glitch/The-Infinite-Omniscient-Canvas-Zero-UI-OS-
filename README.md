# The Infinite Omniscient Canvas

A Zero-UI operating-system canvas. You type into a single command bar, an
**on-device model predicts your intent**, and the canvas **builds the UI you
need** from trusted native components. When you are done, it tears that UI
down again.

- **Edge-native inference:** [LiteRT.js](https://www.npmjs.com/package/@litertjs/core)
  in a Web Worker. It targets the **NPU via WebNN** and falls back to WebGPU and
  then WASM (XNNPACK CPU).
- **Generative UI without generated code:** tools stream
  [A2UI v0.9](https://a2ui.org/) JSON, which is rendered only through a
  **Trusted Catalog** of reviewed React and lit components. No HTML, CSS or
  JavaScript is ever generated.
- **Explicit accelerator memory management:** every tensor is `delete()`d after
  every inference cycle, and a tensor ledger proves it (`0 live`).

```
 command bar ──text/pointer──▶ ┌──────────── Web Worker (classic) ─────────────┐
                               │ IntentLoop (500 ms debounce)                   │
                               │   └▶ InferenceSession ─▶ LiteRT.js             │
                               │        WebNN·NPU → WebGPU → WASM               │
                               │        tensor.delete() every cycle (ledger)    │
                               │   └▶ intent ─▶ TaskManager ─▶ tool             │
                               │                 createSurface … deleteSurface  │
                               └──────────────── A2UI JSON ─────────────────────┘
                                                    │ zod-validated protocol
 main thread ◀──────────────────────────────────────┘
   message gate (schema, catalog, markup, URL policy, size)
     └▶ rAF batcher (≤ 1 apply / frame)
          └▶ MessageProcessor (STRICT) ─▶ A2uiSurface + Trusted Catalog
                                           (basic catalog + DataTable)
```

## Quick start

```bash
npm ci
npm run dev          # http://localhost:5173
```

Then type, for example:

| You type | The canvas builds | Ends when |
| --- | --- | --- |
| `find my invoices`, `search for the tax pdf` | **File search**: a loading state, then a `DataTable` bound to `/results` | you open a file (terminal action) or dismiss it |
| `system status`, `how is the npu memory` | **System status**: the accelerator, the tensor ledger and active tasks | you press **Done** or dismiss it |
| anything else | nothing; the canvas stays clear | |

The header shows the active accelerator (hover it to see why any fallback
happened), the tensor ledger and the last predicted intent.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server. The worker is served as a classic script at `/@canvas/intent-worker.js`. |
| `npm run build` / `npm run preview` | Production build; preview serves it with the header CSP. |
| `npm run check` | Lint, typecheck, unit tests and build (what CI runs). |
| `npm test` | Vitest unit and integration tests (jsdom). |
| `npm run test:e2e` | Playwright against the production build under CSP and Trusted Types. Set `CANVAS_E2E_CHROMIUM=/path/to/chrome` to use a preinstalled browser. |

To add or upgrade dependencies, use `npx -y npm@11.21.0 i -D --save-exact <pkg>@<x.y.z>`.
npm 10.9 crashes resolving vitest's optional peers. Versions are pinned exactly.

## Security model

- **A2UI only.** The model chooses a tool and its arguments. Deterministic tools
  emit A2UI built from a static component tree; user text only ever enters the
  data model.
- **Zero-trust gate** (`src/a2ui/message-gate.ts`). Every message from the
  worker is checked before the strict `MessageProcessor` sees it, and any
  message that fails is dropped whole. The checks are:
  - a size cap,
  - the official v0.9 schema,
  - our surface-id format,
  - the trusted catalog id only,
  - no markup or event handlers in component definitions,
  - no script URLs or executable markup in data,
  - a URL policy for `url`/`href`/`src` (same-origin paths only by default).
- **Trusted Catalog** (`src/a2ui/trusted-catalog.ts`). The basic catalog minus
  `Video`, `AudioPlayer` and `openUrl`, plus `DataTable`. Unknown component
  types are rejected. No markdown renderer is registered, so lit's `unsafeHTML`
  path is unreachable.
- **CSP and Trusted Types.** The policy is `default-src 'self'; script-src 'self'
  'wasm-unsafe-eval'; style-src 'self'; object-src 'none'; base-uri 'none';
  require-trusted-types-for 'script'`. It is injected as a `<meta>` tag at build
  time.
  - **Serve it as an HTTP header in production** (`CSP_HEADER_POLICY` in
    `src/security/csp.ts`, which adds `frame-ancestors 'none'`). Only the header
    form also governs the worker. `vite preview` already does this.
  - The worker URL is minted by a Trusted Types policy (same-origin only).
  - Inside the worker, a Trusted Types default policy admits only LiteRT's own
    `litert_wasm_*.js` glue.
- **Lint-enforced boundaries.** Raw HTML/JS sinks are banned.
  `@litertjs/core` may only be imported by `src/inference/litert-adapter.ts`.
  Worker-side code may only `import type` from `@a2ui/*`.

## Testing on a real NPU (manual)

CI and headless browsers have no NPU, so they exercise the WASM fallback. To try
the WebNN NPU path:

1. Use a browser that exposes WebNN with NPU support. In Chromium-based browsers
   it may need to be enabled at `chrome://flags/#web-machine-learning-neural-network`.
2. Run `npm run build && npm run preview` and open http://localhost:4173.
3. The accelerator badge should read **WebNN · NPU**. If it does not, hover it:
   the tooltip lists why each accelerator was skipped. Typing `system status`
   shows the same information on the canvas.

The tensor ledger should always return to `0 live` after a surface closes.

## The stub intent model

`public/models/intent.tflite` (3.8 KB) is a real TFLite model. It has one
`FULLY_CONNECTED` layer from 256 features to the logits `[none, searchFiles,
showStatus]`, with keyword weights.

It is generated by `scripts/generate-stub-model.py`, which:
- builds the FlatBuffer directly,
- picks a collision-free hash seed and writes it to `src/inference/featurize.ts`,
- verifies the model with Google's LiteRT interpreter,
- writes a parity fixture that a unit test checks against the TypeScript
  featurizer.

```bash
python3 -m venv .venv && .venv/bin/pip install tflite flatbuffers numpy ai-edge-litert
.venv/bin/python scripts/generate-stub-model.py
```

To swap in a real quantized intent model, replace the model file, update
`featurize.ts` (preprocessing), and update `INTENT_LABELS` in
`src/inference/intent-decoder.ts`.

## Project layout

```
src/inference/  LiteRT port + adapter, accelerator fallback, TensorLedger,
                InferenceSession, featurizer, intent decoder
src/worker/     zod protocol, IntentLoop, worker runtime, worker TT policy, entry
src/tools/      tool registry, TaskManager (surface lifecycle), searchFiles, showStatus
src/a2ui/       message builders, gate, URL policy, frame batcher, Trusted Catalog, DataTable
src/canvas/     controller, worker bridge, TT worker URL, runtime wiring, Canvas UI
src/security/   CSP + lint-boundary tests
src/build/      Vite plugins: LiteRT wasm serving, dev classic worker
e2e/            Playwright suite (flows, security, frame-time budget)
scripts/        stub model generator
```
