# Synthetic PDF reader fixtures

These small PDFs were generated on 2026-10-09 from original synthetic text.
No course documents, student information, or local font files are inputs.
The generator is MIT licensed; its original PDF page text is CC0-1.0. See
`LICENSE`. SHA-256 hashes and generation version are in `manifest.json`.

| File | Expected behavior |
| --- | --- |
| `chinese-cmap-fonts.pdf` | Two pages with Chinese and Latin text; exercises UniGB-UCS2-H and Adobe-GB1-UCS2 CMaps and the bundled FoxitDingbats font. |
| `encrypted-known-password.pdf` | One page; password `reader-test-2026`; accepts retries and supports cancellation. Owner password is `fixture-owner-2026`. |
| `damaged-valid-header.pdf` | A valid PDF header followed by a truncated dictionary; parsing must fail while original bytes remain downloadable. |

The Chinese fixture names non-embedded STSong-Light, Helvetica, and ZapfDingbats
fonts. No font file is included. Chinese glyph rendering uses the browser's
system fallback; this is a CMap test, not an embedded-CJK-font test. The encrypted
fixture uses deterministic RC4-128 only to exercise the reader's password UI.
The damaged fixture is the first 96 bytes of the Chinese fixture.

`npm run test:reader` uses these committed PDFs and the dependency-free
two-page PDF generator in `scripts/reader-test-fixtures.mjs`. Python is not
required for normal builds or tests. To optionally regenerate these files,
install ReportLab 4.4.9 in an isolated Python environment, then run:

```sh
python tests/fixtures/reader/generate_fixtures.py
```

ReportLab is BSD licensed and supplies the built-in font descriptors. Its
`invariant=1` generation mode makes PDF timestamps, document IDs, and encrypted
output deterministic. Poppler 26.04.0 independently parsed the valid fixtures,
extracted the expected Chinese text, accepted the correct password, and rejected
the wrong password and damaged file during fixture preparation. PDF.js 6.3.289
independently parsed and rendered the valid pages with no external requests.

The browser smoke injects the built userscript and emulates GM storage; it does
not claim to validate installation or grants in an actual userscript manager.
