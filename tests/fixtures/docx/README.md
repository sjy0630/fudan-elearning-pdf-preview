# Original DOCX conversion fixtures

`normal.docx` is the safe baseline for native Word/schema checks. It is an
original Chinese document created with the public docx-js 9.10.0 API, including
semantic headings, nested numbering and bullets, emphasis, sub/superscript,
merged table rows/columns, footnote/endnote and embedded PNG/JPEG illustrations.
All text, illustrations and fixture source are original and licensed under MIT.

Generate the illustrations with Pillow (`python generate-assets.py`), then run
`node scripts/docx-fixtures.mjs` from the repository. The generator verifies the
genuine docx-js package, fixes only core timestamps and ZIP metadata, and records
exact artifact SHA-256 hashes in `manifest.json`. No downloaded document/media is
used. The generator's semantic content is deterministic; tests verify byte
reproducibility. Adversarial/compatibility variants are derived in memory by the
conversion tests and must not be opened in native Word.
