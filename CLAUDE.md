# CLAUDE.md — The Infinite Omniscient Canvas (Zero-UI OS)

Project memory and **non-negotiable** architectural rules. Every change must comply.
If a task appears to require breaking a rule, stop and ask; do not work around it.

## Status

Phase: architecture & planning. No application code exists yet. Implementation
starts only after the TDD plan is explicitly approved by the project owner.

## 1. Generative UI — A2UI only

- All runtime-generated UI is expressed **exclusively** as A2UI (Agent-to-User
  Interface) protocol messages (JSON). Target protocol: **A2UI v0.9**
  (`@a2ui/web_core/v0_9`, `@a2ui/react/v0_9`).
- The agent/model path must **never** emit, and the client must **never**
  accept, raw HTML, CSS, or executable JavaScript. No `dangerouslySetInnerHTML`,
  `innerHTML`, `eval`, `new Function`, `setTimeout(string)`, inline styles from
  model output, or dynamic `import()` of model-supplied specifiers.
- Do not hallucinate A2UI component types, properties, or message shapes.
  Only use what exists in the pinned `@a2ui/*` version and our Trusted Catalog.
  When unsure, read the installed package's `.d.ts` files.
- (Scope note: this rule governs what the AI produces at runtime. Our own
  hand-written, reviewed React/TSX source code is, of course, allowed.)

## 2. Zero-Trust Rendering — the Trusted Catalog

- A2UI surfaces are flat **adjacency lists** of components referencing each
  other by ID. They are rendered only through a **Trusted Catalog**: a fixed,
  code-reviewed map of `componentType -> React component`.
- Any component type not in the catalog is **rejected** (rendered as nothing and
  logged), never interpreted.
- All incoming messages are schema-validated (zod / A2UI integrity checker)
  before reaching the `MessageProcessor`. Invalid messages are dropped whole.
- Data binding uses **JSON Pointers** (RFC 6901) into the surface data model
  only. No expressions, no template strings evaluated as code.
- URL-bearing props (images, links) are allowlisted (`https:` and approved
  origins); `javascript:`, `data:text/html`, and relative-protocol URLs are rejected.
- Use the official shared library `@a2ui/web_core` (`MessageProcessor`, surface
  and data models) with the `@a2ui/react` renderer. Do not fork or re-implement
  the protocol state machine.
- Hydration target is 60 FPS: coalesce streamed messages and apply them at most
  once per `requestAnimationFrame`; never block the main thread on inference.
- Ship a strict CSP: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  style-src 'self'; object-src 'none'; base-uri 'none'` plus Trusted Types
  (`require-trusted-types-for 'script'`).

## 3. Edge-Native Inference — LiteRT.js on the NPU via WebNN

- Local inference uses Google **LiteRT.js** (`@litertjs/core`, WebAssembly).
- Load the runtime with `loadLiteRt(...)` (WebNN requires the JSPI build/option),
  then compile models **only** with `loadAndCompile`, targeting the NPU:

  ```ts
  const model = await loadAndCompile(modelUrl, {
    accelerator: 'webnn',
    webNNOptions: { devicePreference: 'npu' },
  });
  ```

- Inference runs in a dedicated Web Worker, never on the main/UI thread.
- All LiteRT.js access goes through one adapter module so it can be mocked in
  tests and audited for memory safety.

## 4. Memory Management — explicit `tensor.delete()`

- JavaScript GC does **not** reclaim NPU/accelerator memory.
- Every `Tensor` created **or returned** (inputs, every output from
  `model.run(...)`, and every tensor produced by `copyTo`/`moveTo`) must have
  `.delete()` called after **every** inference cycle, in a `finally` block so it
  runs on error paths too.
- Compiled models are `.delete()`d on worker shutdown / model swap.
- Tests must assert that, for each cycle, `created tensors === deleted tensors`
  (tracked via the adapter).

## 5. Core loop — Tool-Call Render Pattern

1. Background loop (worker): the local model predicts user intent.
2. Intent resolves to a registered tool call (deterministic tool registry; the
   model selects a tool + args, it does not author UI).
3. The tool streams A2UI messages to the client (`createSurface` →
   component/data-model updates) to hydrate native catalog components
   (e.g. loading states, interactive data tables) bound via JSON Pointers.
4. On task completion (or cancel/error/timeout) the tool emits `deleteSurface`;
   the canvas unmounts the components and frees their state. No surface may
   outlive its task.

## Engineering workflow

- Strict TDD: write the failing test first, make it pass, refactor.
- TypeScript `strict: true`; no `any` in the inference or A2UI boundary modules.
- Pin exact dependency versions (no `^`/`~`) and only adopt releases that are
  at least ~1 week old.
- Before committing: lint, typecheck, and unit tests must pass.
