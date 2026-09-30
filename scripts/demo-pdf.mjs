const stream = (heading, subtitle, page) => `q\n0.14 0.34 0.65 rg\n48 658 516 86 re f\nQ\nBT /F1 26 Tf 1 1 1 rg 68 705 Td (${heading}) Tj ET\nBT /F1 14 Tf 0.2 0.25 0.3 rg 68 610 Td (${subtitle}) Tj ET\nBT /F1 12 Tf 0.2 0.25 0.3 rg 68 568 Td (This is a generated demo. It contains no student or course data.) Tj ET\nBT /F1 13 Tf 0.2 0.25 0.3 rg 68 522 Td (Select this text, change the zoom, or try the next page.) Tj ET\nBT /F1 12 Tf 0.2 0.25 0.3 rg 68 70 Td (Page ${page} of 2) Tj ET\n`;
const first = stream('PDF preview works', 'Open a PDF without installing Tampermonkey.', 1);
const second = stream('Second page', 'Page navigation works. Your file stays in your browser.', 2);
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}endstream`,
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  `<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}endstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
const start = Buffer.byteLength(pdf);
pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
export function createDemoPdf() { return Buffer.from(pdf, 'ascii'); }
