# Userscript PDF Reader Choice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users select native PDF or bundled PDF.js inside the userscript dialog, remember that choice, and preserve existing multi-format behavior without third-party file uploads.

**Architecture:** Keep the existing bounded network adapter and dialog controller. Add a small preference module, a deterministic local PDF.js bundler/resource provider, and a PDF.js reader with an explicit cancellation lifecycle. Integrate both reader modes with the same validated PDF bytes and shared download/original-file actions.

**Tech Stack:** JavaScript userscript, legacy GM storage APIs, PDF.js 6.3.289, esbuild 0.25.12 (build-time only), Node tests and existing isolated Playwright tests.

---

Approved specification: `docs/superpowers/specs/2026-10-09-userscript-reader-choice-design.md`. User explicitly approved detailed behavior and requested implementation. Continue in the existing checkout on `feature/userscript-reader-choice`, based on the preserved `feature/userscript-multiformat` candidate `a596d61`. Do not create a new worktree, alter main/extension branches, push, publish, or change the daily browser's installed scripts. Run sequential implementation tasks with independent spec then quality review; separate test-only agents may use their own temporary profiles.

## File boundaries

- `userscript/pdf-preference.js`: reader IDs and GM-backed preference state only, no DOM/network.
- `scripts/bundle-pdfjs.mjs`: pinned library/core/worker/data/license packaging only.
- `userscript/pdfjs-runtime.js`: lazy private library instance, allowlisted binary resources and owned worker/document lifetime.
- `userscript/pdfjs-reader.js` and `userscript/pdfjs-reader.css`: PDF-specific controls, canvas/text layer, password and rendering behavior.
- `userscript/preview.template.js`: existing dialog/network controller plus PDF mode selection and common cleanup; retain image/text behavior.
- `scripts/build-userscript.mjs`: embed these modules privately into one installable script, including CSS/resource assets; never runtime imports from CDN.
- `tests/pdf-preference.test.cjs`, `tests/pdfjs-bundle.test.cjs`, `tests/pdfjs-runtime.test.cjs`, `scripts/smoke-reader-choice.mjs`: new focused tests.
- Existing generator tests and multi-format smoke remain regression gates. Test-only fixtures go under `tests/fixtures/` or a self-contained `scripts/reader-test-fixtures.mjs`; never use real course documents.

## Task 1: Deterministic reader preferences

Files: create `userscript/pdf-preference.js`, `tests/pdf-preference.test.cjs`. Do not alter dialog or add grants until integration.

- [ ] Write a failing test that loads the source in a Node VM and obtains `createPdfPreference` through test instrumentation, not a production page-global export. Contract:

```js
const preference = createPdfPreference({getValue, setValue});
assert.equal(preference.get(), 'native');
await preference.load();
await preference.set('pdfjs');
assert.equal(preference.get(), 'pdfjs');
```

`getValue(key, fallback)` and `setValue(key, value)` are injectable storage functions corresponding to GM_getValue/GM_setValue. Key is `fudan-preview.pdf-reader`; stored values are only `native` or `pdfjs`.
- [ ] Run `node --test tests/pdf-preference.test.cjs`; observe missing module/API failure before implementing.
- [ ] Implement the factory with native default, cached load, unknown stored values normalized to native, synchronous or Promise-returning storage supported. `load()` and `set()` return `{persisted: boolean}`; errors produce `{persisted:false}` rather than unhandled rejection. Missing storage is a failure with in-page memory fallback.
- [ ] `set(id)` changes memory immediately, rejects unsupported IDs, serializes storage writes to preserve the last selection, and never lets a late initial load replace a newer user choice. Tests exercise throwing/rejecting reads/writes, delayed initial read, rapid selections, write failure followed by recovery, and a fresh instance reading persisted choice.
- [ ] Run focused and existing tests, self-review, commit owned files. Independent spec and quality review must pass.

## Task 2: Offline PDF.js bundle and runtime

Files: create `scripts/bundle-pdfjs.mjs`, `userscript/pdfjs-runtime.js`, `tests/pdfjs-bundle.test.cjs`, `tests/pdfjs-runtime.test.cjs`; modify package/lock and generator. Keep the current installable version until UI integration.

- [ ] Tests first: module missing; then bundle twice and assert identical source, correct PDF.js version, preserved Apache-2.0 notices, and binary resource byte equality. Reject unknown resource kind, traversal or unlisted filenames. Verify worker source is embedded, not a remote URL.
- [ ] Add exact build-only devDependencies `pdfjs-dist:6.3.289`, `esbuild:0.25.12`; update Node engine/documented minimum to `>=22.13.0` (recommend24). Preserve Playwright1.63.0. Do not run npm ci in the shared checkout: install into a fresh temporary runtime and copy only missing dependency directories after confirming no overwrite, or verify from a clean exported snapshot. Lock actual resolved/integrity metadata, not guessed values.
- [ ] Export `bundlePdfjs()` returning deterministic private JavaScript source. Use esbuild browser IIFE transform/bundle for core rather than fragile string removal of ESM exports. Wrap core execution in a lazy factory, not eval/new Function. Preserve dynamic local-worker machinery but do not add arbitrary remote code loading. Embed worker as literal source plus fixed sorted CMap/font/WASM resource table. Exclude quickjs-eval resources because PDF scripting is not enabled; include license text. Do not ship sourcemaps or expose a mutable page-global registry.
- [ ] Embed sources through explicit one-occurrence markers inside userscript closure. `createPdfjsRuntime()` is private and lazy. Runtime supplies `open(bytes, {signal, onPassword})`, returning a handle with `promise` (PDF document) and idempotent async `destroy()`.
- [ ] Create a dedicated Blob module Worker per document; pass its port to PDF.js, set `isEvalSupported:false`, `useWorkerFetch:false`, and a custom `BinaryDataFactory.fetch({kind, filename})` backed only by the fixed table. Pass `bytes.slice()` to PDF.js so worker transfer cannot detach controller-owned download data. Accepted kinds are cMapUrl/standardFontDataUrl/wasmUrl; unknown values throw. Use local data factories, not fetched synthetic URLs.
- [ ] Runtime must destroy document task, terminate its worker, revoke its worker URL and remove abort listener on failure/cancel/close. Use a bounded initialization timeout and surface worker/CSP failure; do not silently invoke remote/fake-worker fallbacks or relax site CSP. Unit tests simulate only worker/storage boundaries and assert production lifecycle/byte ownership, not mock existence.
- [ ] Run generator consistency and all unit tests. Add a small isolated browser smoke using a valid generated two-page PDF: lazy runtime renders a page and extracts its text offline. This must pass before full UI integration. Record actual script size, not an estimate. Commit and obtain both reviews.

## Task 3: PDF.js reader UI and dialog integration

Files: create `userscript/pdfjs-reader.js`, `userscript/pdfjs-reader.css`; modify template, generator, package version and tests. Candidate version becomes userscript1.2.0; extension version/branch unchanged.

- [ ] Write failing browser assertions for PDF-only `阅读器` combobox, native default, stored pdfjs choice, hidden selector for images/text, and successful two-page rendering. Generated-script metadata test expects only new `GM_getValue` and `GM_setValue` grants, no new match/connect scope or @require.
- [ ] Reader interface is `createPdfjsReader({container, bytes, signal, onError})` returning `{ready, destroy}`. It owns controls, loading task, render/text tasks and resize listener; never fetches school URLs. Controls: previous/next, numeric page field, page count, zoom in/out, fit width. Disable controls until loaded; clamp page and scale. Render one visible page with a text layer; fit on container resize. Bound canvas area to16M pixels and scaling to avoid unbounded allocation.
- [ ] Bundle the text-layer CSS required by pinned PDF.js, plus scoped reader layout rules; no CSS external resource requests. Set the PDF.js scale variables before text-layer rendering and keep text selection working. Use actual text-layer browser checks, not only canvas presence.
- [ ] `onPassword` requests a nonpersistent password; wrong password permits retry, cancel destroys the loading task and shows cancellation with native fallback still available. Do not persist password or document information.
- [ ] In `loadPdf`, retain the validated original PDF bytes in state. Add PDF-only mode select, preference feedback and reader container alongside existing iframe. On mode switch, save ID through the preference module, cancel/destroy previous reader, and mount chosen reader from existing bytes without another network call or automatic download. The native adapter uses Blob iframe; shared raw download always keeps original bytes. Start PDF.js at page1 after switching.
- [ ] Keep separate generation checks for dialog/file and render tasks. Close/reopen/pagehide must invalidate callbacks before cancellation, dispose current reader, clear retained bytes and all object URLs, and restore existing focus/scroll behavior. A stale destroy/render/password response cannot replace the new view.
- [ ] Worker/init/render failure retains selected preference and original-file action, shows explicit `切换到浏览器自带` action and does not automatically upload/retry through other services. Storage failures retain current-page selection and show a nonfatal persistence warning. Do not treat native iframe load as proof of rendered PDF.
- [ ] Regenerate single .user.js, run all unit and multi-format regressions, then reader-choice browser smoke. Commit and obtain spec/quality review.

## Task 4: Representative acceptance and handoff

Files: `scripts/smoke-reader-choice.mjs`, test fixture module/files, README, roadmap, validation records. No store or GitHub operations.

- [ ] Prepare harmless valid two-page PDF, Chinese-font PDF, encrypted PDF with known test password, damaged PDF and controlled worker-denial scenario. State fixture provenance; add an independent fixture validity check where practical. Never count an invalid `%PDF-` stub as render evidence.
- [ ] Test native↔PDF.js switches, page/zoom/text selection, no extra source requests, original bytes download, persisted preference after reload, invalid/storing-failure cases, password success/wrong/cancel, close during load and rapid switching. Test binary resource routing and no external network after source bytes arrive; both Chromium and Firefox, exact versions recorded.
- [ ] Repeat representative tests in actual Tampermonkey isolated profile with bundled code (not addScriptTag). Confirm new storage permission behavior and CSP/worker failure fallback. Preserve distinction between actual manager tests and injected/mock-storage tests. Do not reuse completed1.1.0 evidence as proof of1.2.0 behavior.
- [ ] Clean-snapshot install/build/test/check and byte reproducibility; inspect single-file size, license notices, metadata permissions, source/worker URLs and absence of runtime CDN. Unit tests and source smoke are not broad compatibility promises.
- [ ] Update docs with actual passed/failed/untested results and install instructions. Final independent code/spec review, resolve findings, commit local branch only. Keep multiformat brancha596d61, main and standalone-extension intact. Full goal is not complete until selectable reader and supported formats are genuinely verified; deferred distribution remains deferred.

## Self-review

Preference, byte ownership, resource packaging, UI, passwords, fallback, lifecycle, privacy and verification requirements each map to a task. Runtime and UI APIs above are consistent; defaults and errors are explicit. The already-approved execution approach is sequential subagent implementation in this existing checkout; no additional direction prompt is needed. Testing agents working on frozen1.1.0 fixtures do not modify this implementation.
