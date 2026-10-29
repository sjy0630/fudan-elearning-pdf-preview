# PPT / PPTX Preview Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the bounded shared-core task and independent reviews. The main agent owns integration and packaging. Work in the existing feature checkout; do not create a worktree, push or publish.

**Goal:** Add real local PPT and PPTX preview to both the userscript and standalone extension.

**Architecture:** One bounded background parser/renderer and one shared reader. Existing authorized transfer routes supply original bytes; trusted controls retain download/original actions, while sanitized slides live in a separate empty-sandbox iframe.

**Tech Stack:** JavaScript modules, @web-ppt/core 0.4.5, existing pako/xmldom/DOMPurify/fflate/esbuild, Node 24.19.0.

## Task 1 — Shared parser and reader

Files: `shared/presentation-{policy,package,worker,runtime,sanitize,reader}.mjs`; if needed a carefully parameterized ZIP helper preserving all DOCX defaults; `tests/presentation-*.test.cjs`.

- [ ] Write failing format/budget and parser tests first, then run the targeted tests and record their failure.
- [ ] Implement the approved 50 MiB / 500-page policy, genuine ZIP/CFB recognition, per-task Worker and per-page rendering.
- [ ] Expose exactly the adapter contract from the design: `createPresentationReader({host,bytes,format,mime,signal,makeWorker,onVerified}) -> Promise<{dispose()}>`.
- [ ] Add controls inside host: previous, next, page-number input, zoom in/out, fit; show unsupported/failed pages explicitly.
- [ ] Verify normal samples retain page order, text, images and shapes. Check cancel, stale results and byte preservation with focused bounded tests.
- [ ] Request specification review, then code-quality review; fix actionable findings and commit only owned files.

## Task 2 — Registry and dual integration

Files: `shared/formats.js`, `extension/catalog.js`, `extension/presentation-viewer.{html,css,mjs}`, `userscript/preview.template.js`, `tests/formats.test.cjs`, `tests/presentation-integration.test.cjs`.

- [ ] Add failing shared registry tests using `assert.equal(formats.identify('课件.PPT').id,'ppt')` and the equivalent `pptx`; require exact suffixes, correct MIME, 50 MiB budgets and ZIP/CFB signatures.
- [ ] Run these tests before registry changes; fix the known stale DOCX supported-format expectation.
- [ ] Add descriptor routes: both IDs target `presentation-viewer.html`; no change to PDF/DOCX routes or host permissions.
- [ ] In extension use `readFile(source,{api,format,signal})`, validate source/name/format, call the shared reader, enable download only via `onVerified`, and dispose on cancel/retry/pagehide.
- [ ] In userscript add a dedicated host and PPT cancel/retry controls, call the same reader from an embedded bundle, preserve verified original bytes after display failure and cancel all work on close.
- [ ] Run focused format/routing/source integration checks and inspect actual generated behavior in a local-only development harness.

## Task 3 — Bundle, fixtures, documentation, packages

Files: `scripts/bundle-presentation.mjs`, both build scripts, `scripts/verify-packages.mjs`, demo fixtures and license, help/locales/README, package manifests and generated userscript.

- [ ] Bundle the public parse/render core into a classic local Worker; do not use the upstream PPTX-only Worker. Export the common UI as ESM and private userscript factory.
- [ ] Include exact version checks and full third-party licenses; forbid runtime external imports and CDN.
- [ ] Add normal PPT/PPTX fixtures and help-page demo links; verify fixture format signatures and expected slide content.
- [ ] Set both distributed versions to 1.4.0, accurately state static-preview limitations and 50 MiB / 500-page limits.
- [ ] Build both userscript and Chromium/Firefox packages with Node 24, verify archive resources, permission equality and checksums.
- [ ] Record exact checks passed and any remaining gaps; no store submission, GitHub push or local Chrome update without a separate request.

## Self-review

Scope covers both file formats and both distribution forms. API names, cancellation ownership and download gate are consistent. Normal sample checks are local; no real course data or credentials enter fixtures. Independent review must not treat an unverified upstream claim as a passing integration check.
