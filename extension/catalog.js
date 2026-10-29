/* Add verified Canvas installations here; build generates the matching permissions. */
globalThis.CanvasPreviewCatalog = Object.freeze({
  platforms: Object.freeze([
    { id: 'fudan', name: '复旦 eLearning', origin: 'https://elearning.fudan.edu.cn', adapter: 'canvas' },
  ]),
  formats: Object.freeze([
    ...['pdf', 'docx', 'ppt', 'pptx', 'png', 'jpeg', 'webp', 'text'].map(id => Object.freeze({
      ...CanvasFileFormats.get(id), viewer: id === 'pdf' ? 'viewer.html' : id === 'docx' ? 'docx-viewer.html' : ['ppt','pptx'].includes(id) ? 'presentation-viewer.html' : 'file-viewer.html',
    })),
  ]),
  readers: Object.freeze([
    { id: 'bundled', label: '内置阅读器（推荐）' },
  ]),
});
