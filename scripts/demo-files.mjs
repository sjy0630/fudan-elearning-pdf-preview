import { deflateSync } from 'node:zlib';
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type),data]);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let i=0;i<8;i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  const length = Buffer.alloc(4), sum = Buffer.alloc(4);
  length.writeUInt32BE(data.length); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length,body,sum]);
}
export function createDemoImage() {
  const width = 480, height = 240, raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) raw.set(x > 120 && x < 360 && y > 60 && y < 180 ? [255,255,255] : [36,86,166], y*(width*3+1)+1+x*3);
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
export function createDemoText() { return Buffer.from('eLearning 文本预览示例\n\n这是一份随扩展安装的 UTF-8 演示文本，不包含真实课程资料。\n可以切换换行、选择编码、复制全文或下载原文件。\n\n<script>这行只作为文字显示，不会执行。</script>\n','utf8'); }
