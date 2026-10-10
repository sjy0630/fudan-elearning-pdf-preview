# Distribution Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prepare a verified 1.1.1 extension with bilingual installation metadata and accurate distribution/Firefox submission documentation, without publishing or merging.

**Architecture:** Keep the existing extension and PDF request flow unchanged. Two locale catalogs feed manifest message references; package verification checks their presence, references and source bytes. Store copy and signing instructions are documentation, not automatic store updates.

**Tech Stack:** Node.js built-in test runner, existing MV3 builds, fflate, Playwright, Selenium, optional available web-ext CLI.

---

## Task 1: Localized distribution candidate and documentation

Files: create `tests/localization.test.cjs`, `extension/_locales/{zh_CN,en}/messages.json`, `docs/FIREFOX-SUBMISSION.md`, `docs/STORE-SEARCH.md`; modify `scripts/build.mjs`, `scripts/verify-packages.mjs`, `package.json`, `package-lock.json`, `README.md`, `extension/help.html`, `docs/{STORE-LISTING,VALIDATION,ROADMAP}.md`.

- [x] Baseline: clean extension branch, `npm test` passes 16 tests. Continue in the user's designated extension checkout; do not create a branch, merge or publish.
- [x] Add test-first localization assertions. Build once using `execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: root })`; for both outputs assert `default_locale === 'zh_CN'`, name/description/action references, expected locale catalogs and nonempty messages. Compare locale bytes with source. Run `node --test tests/localization.test.cjs` and observe failure on absent `default_locale` before implementing.
- [x] Add the two catalogs with the same three keys:

```json
{
  "extensionName": { "message": "复旦 eLearning PDF 预览" },
  "extensionDescription": { "message": "点击 eLearning 的 PDF 文件名即可阅读，免 Tampermonkey，自带阅读器，文件仅在浏览器中处理。" },
  "actionTitle": { "message": "eLearning PDF 预览" }
}
```

```json
{
  "extensionName": { "message": "Fudan eLearning PDF Preview" },
  "extensionDescription": { "message": "Preview Fudan eLearning PDFs in your browser with a bundled reader. No Tampermonkey or third-party document uploads." },
  "actionTitle": { "message": "eLearning PDF Preview" }
}
```

- [x] In the existing manifest object replace the three literal strings and add the default locale:

```js
name: '__MSG_extensionName__',
description: '__MSG_extensionDescription__',
default_locale: 'zh_CN',
// Inside existing action, retain popup and icons:
default_title: '__MSG_actionTitle__',
```

- [x] Set package version and both root lockfile version fields to `1.1.1`; do not update dependencies. Extend the existing package verification loop after manifest checks:

```js
assert.equal(manifest.default_locale, 'zh_CN');
assert.equal(manifest.name, '__MSG_extensionName__');
assert.equal(manifest.description, '__MSG_extensionDescription__');
assert.equal(manifest.action.default_title, '__MSG_actionTitle__');
const references = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
for (const locale of ['zh_CN', 'en']) {
  const resource = `_locales/${locale}/messages.json`;
  assert.ok(files[resource]?.length, `Missing ${resource}`);
  assert.deepEqual(Buffer.from(files[resource]), await readFile(new URL(`extension/${resource}`, root)));
  const messages = JSON.parse(Buffer.from(files[resource]).toString());
  for (const key of references) assert.ok(typeof messages[key]?.message === 'string' && messages[key].message.trim(), `${locale}: missing ${key}`);
}
```

- [x] Extend archive-name rejection to catch iCloud-style numeric duplicate suffixes; preserve safe existing paths and all PDF assets. Run `npm test`, `npm run check`, `npm run build`, `npm run verify:packages`; expected all pass with unchanged permissions/IDs and exactly two locale files added to each archive.
- [x] Update README and existing help with store direct-link sharing/search FAQ, post-install refresh/login/duplicate-script advice and unsigned Firefox limitation. Label classmate installation as user-reported only. Keep published 1.1.0 release links until an actual new release exists. Clarify that 1.1.1 is a local candidate and only installation metadata is bilingual.
- [x] Rewrite store copy as separate Chinese and English ready-to-paste listings. Keep non-affiliation/privacy/precise permissions and explain that adding a store locale requires dashboard action and a separate submission, not merely changing the ZIP.
- [x] Add Firefox submission checklist: fixed ID, package path, checksums command, exact reproducible build commands, PDF.js version/source/license, source snapshot/lockfile requirements, demo reviewer steps, permission/data disclosure and static-warning interpretation. No account action, agreement, signing or submission. Use extension-branch privacy/source links.
- [x] Fix outdated validation/publication claims without overwriting historical test evidence. Reorder roadmap to distribution → images/plain text → other schools/readers. Add dated search investigation notes distinguishing user report, observation and hypotheses; no promised search fix.
- [x] Commit only specified code/docs after self-review and verification; report status and exact evidence. Independent spec and quality reviews follow.

## Task 2: Final evidence and handoff

- [x] Inspect public store/search using permitted browser tools; if unavailable record the access limitation, not an inferred result. Do not edit Partner Center in this iteration.
- [x] Run available Chromium/Edge and Firefox smoke tests using isolated existing test runners. Record unavailable browser/runtime checks explicitly. Re-run Firefox lint with an available web-ext version; record exact error/warning counts and nature, do not equate lint success with Mozilla approval.
- [x] Record results in `docs/VALIDATION.md` and `docs/FIREFOX-SUBMISSION.md` only after reading fresh outputs; verify ZIP checksums again after any help changes. Preserve old release assets and do not issue a new release.
- [x] Run `git diff --check`, review full diff and tests; commit evidence. Keep extension branch in place, report local vs published status and next owner-confirmed submission step. No merge, cleanup or store submission.

Self-review: all approved design requirements map to steps above. Search visibility and third-party approval are not implementation acceptance guarantees; real account tests remain explicitly separate.
