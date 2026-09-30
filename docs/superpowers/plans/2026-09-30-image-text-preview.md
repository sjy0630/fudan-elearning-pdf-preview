# Image and Text Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local image and plain-text preview to both standalone extension and installable userscript, keeping their distributions separate.

**Architecture:** A dependency-free shared format module supplies filename identification, content validation and text decoding. Each edition keeps its own network adapter and UI, with the userscript embedding shared source at build time. Existing PDF paths remain supported; no remote code, upload service or additional default site permissions.

**Tech Stack:** JavaScript, WebExtension, GM_xmlhttpRequest, Node built-in tests, existing Playwright/Selenium browser harnesses.

---

Approved specification: `docs/superpowers/specs/2026-09-30-image-text-preview-design.md`, including userscript amendment, approved with “可以，开始执行”. Use existing extension checkout; no branch reset, main merge, store action or publication. Agent implementation is sequential with independent spec then quality review. User may opt for inline execution; default is skill-recommended agent implementation.

## Task 1: Shared format contract

Status: completed in `28c2203` and `5673be3`; spec and quality re-review passed. The quality review found exponential comment-regex backtracking, fixed with a forward scanner and timed adversarial regression. Fresh shared + existing focused suites passed 28/28; this is not browser/UI completion evidence.

Files: create `shared/formats.js`, `tests/formats.test.cjs`; no UI changes.

- [ ] Write failing tests and run `node --test tests/formats.test.cjs` before implementation. Tests load the shared script with Node require and use its `globalThis.CanvasFileFormats` API. Assert format lookup is absent before module exists, then test behavior: `identify('图.PNG').id === 'png'`, `identify('a.txt.exe') === null`, `identify('a.svg') === null`; every specified text suffix maps to `text`.
- [ ] Implement immutable descriptors `{id, mime, extensions, limit}` and `identify(name)`, `get(id)`, `safeName(name, formatId)`. Use 100/20/2 MiB for PDF/image/text respectively. Filename identification uses final suffix, not word boundary. Names strip controls/path separators without blindly adding `.pdf`.
- [ ] Implement `validate(bytes, formatId, mime = '')` returning `{mime, width?, height?}`. Tests exercise PDF magic; PNG IHDR; JPEG SOF; WebP VP8/VP8L/VP8X dimensions, malformed/truncated data and animation rejection; exact pixel/side limits; wrong signatures and MIME. Missing/octet-stream MIME allowed only with valid content. Reject empty non-text files and every oversized buffer. Header checks are not full decoding: UI still handles decoder rejection.
- [ ] Implement `decodeText(bytes, encoding = 'auto')` returning a string. Tests cover UTF-8, UTF-8 BOM, UTF-16 BOM, user-selected GB18030, invalid UTF-8, control bytes, HTML document/form response rejection, and literal script strings remaining ordinary text. Unsupported encodings rejected; no silent replacement. `validate` for text checks MIME/size but defers encoding errors to `decodeText` so the UI can offer manual encoding.
- [ ] Run new tests plus `node --test tests/extension.test.cjs tests/userscript.test.cjs tests/archive.test.cjs`; self-review; commit only shared source/test. Independent spec and quality review must pass before integration.

## Task 2: Extension routing and bounded reader

Status: completed in `a6d1c2d`, `027292e`, `ecfd4c3`; spec and quality re-review passed. Legacy arbitrary PDF names and MIME-independent PDF signature checking were restored after review. 21 targeted extension tests pass. Version bumped before builds; old ZIP hashes retained. Non-PDF viewer still pending Task 3, so this is not a usable multi-format release yet.

Files: modify `extension/catalog.js`, `core.js`, `content.js`, `background.js`, `reader.mjs`, `scripts/build.mjs`; add tests to `tests/extension.test.cjs` and `tests/localization.test.cjs`.

- [ ] Tests first: describe named Canvas images/text and direct URL fallback; preserve verifier; reject unknown/mismatched messages; keep `open-pdf` legacy behavior and explicit download controls. Run targeted Node tests and observe failures.
- [ ] Load generated `formats.js` before catalog/core in content scripts, workers, Firefox background and reader pages. Build copies from `shared/formats.js`, not a hand-maintained second source. Catalog enumerates shared descriptors with `viewer.html` for PDF and `file-viewer.html` otherwise.
- [ ] Use `open-file` for new content messages; backend validates format and safe filename before opening a trusted registered viewer. Pass `format`, `source`, `original`, `name` query values. `open-pdf` only maps to PDF; no arbitrary viewer paths accepted.
- [ ] Introduce `readFile(source, {api, format, fetchImpl, limit, timeout, signal})` returning `{bytes, mime}`; retain `readPdf` compatibility wrapper returning bytes. Test actual Response streams for declared/streamed limits, precise errors, denied requests, HTML, aborts, redirects and cleanup. Format determines Accept and maximum (an injected smaller limit is allowed, never a larger bypass).
- [ ] Shared validation checks data before rendering; PDF retains old behavior. Listener/timer cleanup executes on all paths, caller cancellation propagates. Run old and new tests, commit and obtain both reviews.

## Task 3: Local image/text interface and demonstration

Status: completed in `c484289` and `e8361dc`; independent spec and quality re-review passed. 43 Node tests, actual installed Chromium 155 / Edge 154 / Firefox 156.0.1 each 20 browser checks, focused source UI 10 checks. Follow-up fixed failed-decode URL retention and expanded installed acceptance across formats/encodings/lifecycle. Generated-directory conflict copies caused verifier mismatch and oversized diagnostics (exit 137); strict byte comparison now has bounded diagnostics, verified with a failing synthetic mismatch then clean rebuild. Real school login integration remains untested in this iteration.

Files: create `extension/file-viewer.html`, `file-viewer.mjs`, `file-viewer.css`; extend `scripts/demo.mjs` or create `scripts/demo-files.mjs`; modify build/help and browser smoke harnesses.

- [ ] Add failing browser checks for fixed image/text demos and simulated Canvas links, with malicious text/HTML, malformed and oversized fixtures. No authenticated user profile involved.
- [ ] Viewer validates parameters then calls bounded reader. Use generation counters plus AbortController for reload/leave; revoke Blob URLs and reset controls. Keep safe original-file action available on failure. Demo names map only to fixed bundled resources.
- [ ] Image controls: `zoom-in`, `zoom-out`, `rotate`, `fit`; compute rotated bounding dimensions and fit viewport; decode only after header limits. Text controls: `wrap`, `encoding` (auto/UTF-8/GB18030), `copy`; insert via `textContent`, never HTML parsing. Preserve bytes for download, signal clipboard failure without new permission.
- [ ] Test all controls and error flows on isolated Chromium/Edge/Firefox, including literal script text not executing. Add generated local demos to help. Update candidate package and lock root version to 1.2.0 before first build so 1.1.1 ZIP stays intact. Update syntax and package verification coverage. Run builds serially before browser tests, commit and review.

## Task 4: Userscript build and parity

Status: in progress. User-facing installable script remains single-file; source-generation tools are for maintainers only.

Files: create `userscript/preview.template.js`, `scripts/build-userscript.mjs`; generate `elearning-pdf-preview.user.js`; expand `tests/userscript.test.cjs` and browser fixtures.

- [ ] Add failing tests for multi-format link handling, verifier, MIME-preserving fetch/GM fallback, streamed and GM completion size guards, aborted late responses and generated/source consistency.
- [ ] Move current userscript into template with explicit shared-source insertion marker inside its closure; generator combines header, shared format factory/source and adapter without exposing page-global mutable configuration. No remote require. Version 1.1.0; preserve update/download URLs and existing grants.
- [ ] Extend fetch path with stream limits; GM uses header/progress guards when available plus mandatory final Blob check, keeps MIME and honors abort/timeout. Preserve PDF iframe; separate image and pre nodes share validation semantics with extension. Add controls, encoding/clipboard feedback, request generation cleanup and focus restoration. Never execute document text.
- [ ] Test browser dialog operations, repeat/close load race, original/download links, raw download bytes and PDF regression with injected script. Explicitly distinguish injected GM mocks from real manager testing. Commit, spec review, quality review.

## Task 5: Final validation and separate edition handoff

Files: `README.md`, `docs/VALIDATION.md`, `docs/ROADMAP.md`, help/store capability descriptions; userscript-only branch packaging.

- [ ] Run `npm test`, `npm run check`, `npm run build`, `npm run verify:packages`, then serial browser suites. Record exact test counts, versions, failed attempts and untested scenarios. Re-run package tests after changes, but never rebuild during browser suite.
- [ ] Inspect generated archives for shared module and new pages/demos, correct versions and unchanged default permissions. No new Release or submission in this task. Keep 1.1.1 candidate ZIP bytes unchanged.
- [ ] Inspect local main and remote main before constructing userscript-only delivery branch. Include script, shared source, generator, its tests and relevant user documentation only; do not merge standalone extension history into main. No forced checkout/reset or automatic main push. If a separate checkout is required, obtain worktree consent per skill before creating it; continue all other validation meanwhile.
- [ ] Final independent requirement and quality review, fix concrete findings, then finish-development skill. Mark only verified tasks complete; broader schools/readers goal remains incomplete.

## Self-review

The dependency order is shared validation → extension adapter/UI → userscript adapter/UI → distribution checks. Every spec section maps to a task, including charset recovery, WebP animation refusal, single-file userscript installation, GM buffering limitations and separate branch delivery. Default site permissions and non-execution invariants apply to all tests. These tasks describe implementation contracts; neither interface availability nor release status is claimed until executed and verified.
