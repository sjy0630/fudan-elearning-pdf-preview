// Original MIT-licensed fixtures. Generate a real docx-js package before deriving
// compatibility/adversarial variants; no fabricated minimal document substitutes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Zip, ZipDeflate } from 'fflate';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, LevelFormat, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, ImageRun,
  FootnoteReferenceRun, EndnoteReferenceRun,
} from 'docx';
import { verifyDocxPackage } from '../shared/docx-package.mjs';

export const fixtureDirectory = fileURLToPath(new URL('../tests/fixtures/docx/', import.meta.url));
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
export const RS = 'http://purl.oclc.org/ooxml/officeDocument/relationships/';
const encoder = new TextEncoder();
const fixedDate = new Date('2026-01-01T00:00:00Z');

// Sequential entry streaming preserves literal Map keys, including __proto__.
export function zipFixtureParts(parts, level = 6) {
  const chunks = [];
  const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk); });
  for (const [name, bytes] of parts) {
    const entry = new ZipDeflate(name, { level });
    entry.mtime = fixedDate;
    archive.add(entry);
    entry.push(bytes, true);
  }
  archive.end();
  return new Uint8Array(Buffer.concat(chunks));
}

export function editFixtureXml(parts, name, edit) {
  const doc = new DOMParser({ normalizeLineEndings: value => value.replace(/\r\n?/g, '\n'), onError() { throw Error('Fixture XML parse failed'); } })
    .parseFromString(new TextDecoder().decode(parts.get(name)), 'application/xml');
  edit(doc);
  parts.set(name, encoder.encode(new XMLSerializer().serializeToString(doc)));
}

export async function readFixtureParts(name = 'normal.docx') {
  return verifyDocxPackage(await fs.readFile(path.join(fixtureDirectory, name))).parts;
}

function table() {
  const widths = [3008, 3009, 3009];
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' };
  const cell = (text, width, options = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    borders: { top: border, bottom: border, left: border, right: border },
    children: [new Paragraph(text)], ...options,
  });
  return new Table({
    width: { size: 9026, type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ children: [cell('跨行课程', widths[0], { rowSpan: 2 }), cell('跨列学习目标', widths[1] + widths[2], { columnSpan: 2 })] }),
      new TableRow({ children: [cell('知识理解', widths[1]), cell('实际练习', widths[2])] }),
      new TableRow({ children: [cell('完成情况', widths[0]), cell('已阅读', widths[1]), cell('已验证', widths[2])] }),
    ],
  });
}

export async function createNormalDocx() {
  const png = await fs.readFile(path.join(fixtureDirectory, 'learning-chart.png'));
  const jpeg = await fs.readFile(path.join(fixtureDirectory, 'mountain-landscape.jpg'));
  const levels = format => [0, 1].map(level => ({
    level, format, text: format === LevelFormat.BULLET ? (level ? '○' : '•') : (level ? '%1.%2.' : '%1.'),
    alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const image = (type, data, title) => new Paragraph({ children: [new ImageRun({
    type, data, transformation: { width: 160, height: 100 },
    altText: { title, description: `原创${title}`, name: title },
  })] });
  const document = new Document({
    title: '中文课程阅读样本', creator: 'Codex fixture authors', description: 'MIT original DOCX conversion fixture',
    styles: {
      default: { document: { run: { font: 'Arial', size: 24 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true }, paragraph: { outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true }, paragraph: { outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: 'course-numbers', levels: levels(LevelFormat.DECIMAL) }, { reference: 'course-bullets', levels: levels(LevelFormat.BULLET) }] },
    footnotes: { 1: { children: [new Paragraph('脚注：课程材料仅用于本地阅读验证。')] } },
    endnotes: { 1: { children: [new Paragraph('尾注：原创图片和文字采用 MIT 许可。')] } },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun('中文课程阅读样本')] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('第一章 本地阅读')] }),
        new Paragraph('这是一个真实的中文 Word 文档，用于验证语义预览与原始文件保留。'),
        new Paragraph({ children: [
          new TextRun({ text: '粗体重点', bold: true }), new TextRun('，'),
          new TextRun({ text: '斜体说明', italics: true }), new TextRun('，'),
          new TextRun({ text: '下划线提示', underline: {} }), new TextRun('；x'),
          new TextRun({ text: '2', superScript: true }), new TextRun(' 和 H'),
          new TextRun({ text: '2', subScript: true }), new TextRun('O。'),
        ] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('阅读步骤与材料')] }),
        new Paragraph({ numbering: { reference: 'course-numbers', level: 0 }, children: [new TextRun('阅读课程讲义')] }),
        new Paragraph({ numbering: { reference: 'course-numbers', level: 1 }, children: [new TextRun('记录关键概念')] }),
        new Paragraph({ numbering: { reference: 'course-numbers', level: 0 }, children: [new TextRun('完成实践练习')] }),
        new Paragraph({ numbering: { reference: 'course-bullets', level: 0 }, children: [new TextRun('文字与图片材料')] }),
        new Paragraph({ numbering: { reference: 'course-bullets', level: 1 }, children: [new TextRun('图示帮助理解')] }),
        table(), image('png', png, '学习进度图'), image('jpg', jpeg, '山景插图'),
        new Paragraph({ children: [new TextRun('这句话引用脚注'), new FootnoteReferenceRun(1), new TextRun('和尾注'), new EndnoteReferenceRun(1), new TextRun('。')] }),
      ],
    }],
  });
  const generated = new Uint8Array(await Packer.toBuffer(document));
  const parts = verifyDocxPackage(generated).parts;
  // docx-js uses wall-clock core-property timestamps and ZIP dates. Canonicalize
  // these metadata fields only; document/relationship/image content is generated.
  editFixtureXml(parts, 'docProps/core.xml', doc => {
    for (const local of ['created', 'modified']) for (const node of Array.from(doc.getElementsByTagName(`dcterms:${local}`))) node.textContent = '2026-01-01T00:00:00Z';
  });
  return zipFixtureParts(parts);
}

export async function generateDocxFixtures() {
  const normal = await createNormalDocx();
  verifyDocxPackage(normal);
  await fs.writeFile(path.join(fixtureDirectory, 'normal.docx'), normal);
  const files = ['normal.docx', 'learning-chart.png', 'mountain-landscape.jpg'];
  const manifest = { license: 'MIT', generator: 'scripts/docx-fixtures.mjs / docx 9.10.0', baseline: 'normal.docx', deterministicMetadata: '2026-01-01T00:00:00Z', files: {} };
  for (const name of files) {
    const bytes = await fs.readFile(path.join(fixtureDirectory, name));
    manifest.files[name] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await fs.writeFile(path.join(fixtureDirectory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await generateDocxFixtures(), null, 2));
}
