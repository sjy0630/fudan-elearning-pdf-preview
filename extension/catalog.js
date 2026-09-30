/* Add verified Canvas installations here; build generates the matching permissions. */
globalThis.CanvasPreviewCatalog = Object.freeze({
  platforms: Object.freeze([
    { id: 'fudan', name: '复旦 eLearning', origin: 'https://elearning.fudan.edu.cn', adapter: 'canvas' },
  ]),
  formats: Object.freeze([
    { id: 'pdf', labelPattern: /\.pdf\b/i, pathPattern: /\.pdf$/i, viewer: 'viewer.html' },
  ]),
  readers: Object.freeze([
    { id: 'bundled', label: '内置阅读器（推荐）' },
  ]),
});
