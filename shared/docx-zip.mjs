import { Inflate } from 'pako';
import { checkDocxTransfer, DOCX_LIMITS } from './docx-policy.mjs';

const fail = reason => { throw new Error(`ZIP ${reason}。`); };
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
const xmlPart = name => /\.(?:xml|rels)$/i.test(pathKey(name));

function advanceCrc(crc, bytes) {
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ crc >>> 8;
  return crc;
}

function pathKey(name) {
  let value = name;
  for (let depth = 0;; depth++) {
    if (!value || value.startsWith('/') || /[\\:\p{Cc}]/u.test(value)) fail('文件路径不安全');
    const parts = (value.endsWith('/') ? value.slice(0, -1) : value).split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) fail('文件路径不规范');
    if (!/%[\da-f]{2}/i.test(value)) return value.endsWith('/') ? value.slice(0, -1) : value;
    if (depth >= 16 || /%(?:2f|5c|3a)/i.test(value)) fail('文件路径含编码转义');
    try { value = decodeURIComponent(value); } catch { fail('文件路径编码无效'); }
  }
}

function inspect(bytes, limits) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const range = (offset, length, end = bytes.length) => {
    if (offset < 0 || length < 0 || offset + length > end) fail('结构截断或范围无效');
  };
  const u16 = offset => { range(offset, 2); return view.getUint16(offset, true); };
  const u32 = offset => { range(offset, 4); return view.getUint32(offset, true); };
  let end = -1;
  for (let p = bytes.length - 22, first = Math.max(0, bytes.length - 65557); p >= first; p--) {
    if (u32(p) === 0x06054b50 && p + 22 + u16(p + 20) === bytes.length) {
      if (end >= 0) fail('目录结尾存在歧义');
      end = p;
    }
  }
  if (end < 0) fail('缺少有效目录结尾');
  const count = u16(end + 10);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) fail('分卷或目录数量不符');
  if (count === 0xffff || u32(end + 12) === 0xffffffff || u32(end + 16) === 0xffffffff) fail('ZIP64 不支持');
  if (count > limits.entries) fail(`条目数超过限制（${limits.entries}）`);
  const central = u32(end + 16);
  const centralEnd = central + u32(end + 12);
  range(central, centralEnd - central, end);
  if (centralEnd !== end) fail('中央目录存在未知范围');
  const extra = (start, length, rawName, name) => {
    const end = start + length;
    let unicodeName = false;
    for (let p = start; p < end;) {
      range(p, 4, end);
      const id = u16(p);
      const size = u16(p + 2);
      range(p + 4, size, end);
      if (id === 1) fail('ZIP64 扩展不支持');
      if (id === 0x7075) {
        if (unicodeName || size < 5 || bytes[p + 4] !== 1) fail('Unicode 文件名扩展无效或重复');
        unicodeName = true;
        if (u32(p + 5) !== ((advanceCrc(0xffffffff, rawName) ^ 0xffffffff) >>> 0)) fail('Unicode 文件名扩展 CRC 不符');
        let alternate;
        try { alternate = utf8.decode(bytes.subarray(p + 9, p + 4 + size)); } catch { fail('Unicode 文件名扩展不是有效 UTF8'); }
        if (alternate !== name) fail('Unicode 文件名扩展与原始文件名不符');
      }
      p += 4 + size;
    }
  };
  const descriptors = [];
  const paths = new Map();
  let declaredTotal = 0;
  let p = central;
  for (let index = 0; index < count; index++) {
    range(p, 46, centralEnd);
    if (u32(p) !== 0x02014b50) fail('中央目录签名无效');
    const nameLength = u16(p + 28);
    const next = p + 46 + nameLength + u16(p + 30) + u16(p + 32);
    range(p, next - p, centralEnd);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLength);
    let name;
    try { name = utf8.decode(rawName); } catch { fail('文件名不是有效 UTF8'); }
    const key = pathKey(name);
    if (paths.has(key)) fail('文件路径重复或目录冲突');
    paths.set(key, name.endsWith('/'));
    const flags = u16(p + 8);
    if (!(flags & 0x800) && rawName.some(byte => byte >= 0x80)) fail('非 ASCII 文件名需要 UTF8 标志，旧式编码不支持');
    const method = u16(p + 10);
    if (flags & ~0x080e || method === 0 && flags & 6) fail('加密或文件标志不支持');
    if (method !== 0 && method !== 8) fail('压缩方式不支持');
    if (u16(p + 6) > 20 || u16(p + 34)) fail('ZIP64 或分卷文件不支持');
    const crc32 = u32(p + 16);
    const uncompressedSize = u32(p + 24);
    const compressedSize = u32(p + 20);
    const localOffset = u32(p + 42);
    if ([compressedSize, uncompressedSize, localOffset].includes(0xffffffff)) fail('ZIP64 不支持');
    if (uncompressedSize > limits.entryBytes) fail(`声明条目大小超过限制（${limits.entryBytes / 1024 / 1024} MiB）`);
    if (xmlPart(name) && uncompressedSize > limits.xmlBytes) fail(`声明 XML 大小超过限制（${limits.xmlBytes / 1024 / 1024} MiB）`);
    declaredTotal += uncompressedSize;
    if (declaredTotal > limits.expandedBytes) fail(`声明展开大小超过限制（${limits.expandedBytes / 1024 / 1024} MiB）`);
    extra(p + 46 + nameLength, u16(p + 30), rawName, name);
    range(localOffset, 30, central);
    if (u32(localOffset) !== 0x04034b50) fail('本地文件签名无效');
    if (u16(localOffset + 4) > 20 || u16(localOffset + 6) !== flags || u16(localOffset + 8) !== method) fail('本地与中央文件标志不符');
    const localNameLength = u16(localOffset + 26);
    const localExtraLength = u16(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    range(localOffset, dataOffset - localOffset, central);
    if (nameLength !== localNameLength) fail('本地与中央文件名不符');
    for (let i = 0; i < nameLength; i++) {
      if (bytes[p + 46 + i] !== bytes[localOffset + 30 + i]) fail('本地与中央文件名不符');
    }
    extra(localOffset + 30 + localNameLength, localExtraLength, rawName, name);
    const localFields = [u32(localOffset + 14), u32(localOffset + 18), u32(localOffset + 22)];
    const actualFields = [crc32, compressedSize, uncompressedSize];
    if (localFields[1] === 0xffffffff || localFields[2] === 0xffffffff) fail('ZIP64 本地文件不支持');
    if (!localFields.every((value, i) => value === actualFields[i]) && !(flags & 8 && localFields.every(value => value === 0))) fail('本地与中央 CRC 或大小不符');
    const dataEnd = dataOffset + compressedSize;
    range(localOffset, dataEnd - localOffset, central);
    let recordEnd = dataEnd;
    if (flags & 8) {
      const matches = [];
      for (const signed of [false, true]) {
        const start = dataEnd + (signed ? 4 : 0);
        if (start + 12 > central || signed && u32(dataEnd) !== 0x08074b50) continue;
        if (actualFields.every((value, i) => u32(start + i * 4) === value)) matches.push(start + 12);
      }
      if (matches.length !== 1) fail('数据描述符无效或存在歧义');
      recordEnd = matches[0];
    }
    if (name.endsWith('/') && uncompressedSize) fail('目录不能含文件数据');
    if (method === 0 && compressedSize !== uncompressedSize) fail('STORE 文件大小不符');
    descriptors.push(Object.freeze({
      name, directory: name.endsWith('/'), flags, method, crc32, compressedSize, uncompressedSize,
      localOffset, dataOffset, dataEnd, recordEnd,
    }));
    p = next;
  }
  if (p !== centralEnd) fail('中央目录长度不符');
  for (const key of paths.keys()) {
    let slash = key.indexOf('/');
    while (slash >= 0) {
      if (paths.get(key.slice(0, slash)) === false) fail('文件路径与父目录冲突');
      slash = key.indexOf('/', slash + 1);
    }
  }
  let covered = 0;
  for (const entry of [...descriptors].sort((a, b) => a.localOffset - b.localOffset)) {
    if (entry.localOffset !== covered) fail('文件记录重叠或存在未知范围');
    covered = entry.recordEnd;
  }
  if (covered !== central) fail('文件记录存在未知范围');
  return Object.freeze(descriptors);
}

// A valid ZIP is only a container; OOXML package validation is a separate gate.
export function scanDocxZip(input) {
  return scanBoundedZip(checkDocxTransfer(input), DOCX_LIMITS);
}

export function expandDocxZip(input) {
  return expandBoundedZip(checkDocxTransfer(input), DOCX_LIMITS);
}

// Callers validate transport and provide their own immutable resource policy.
export function scanBoundedZip(bytes, limits) {
  return inspect(bytes, limits);
}

export function expandBoundedZip(bytes, limits) {
  const entries = inspect(bytes, limits);
  const expanded = new Map();
  let total = 0;
  for (const entry of entries) {
    const chunks = [];
    let size = 0;
    let crc = 0xffffffff;
    const xml = xmlPart(entry.name);
    const receive = chunk => {
      size += chunk.length;
      total += chunk.length;
      // Check actual bytes before CRC work or retaining the next output chunk.
      if (size > limits.entryBytes) fail(`实际条目大小超过限制（${limits.entryBytes / 1024 / 1024} MiB）`);
      if (xml && size > limits.xmlBytes) fail(`实际 XML 大小超过限制（${limits.xmlBytes / 1024 / 1024} MiB）`);
      if (total > limits.expandedBytes) fail(`实际展开大小超过限制（${limits.expandedBytes / 1024 / 1024} MiB）`);
      crc = advanceCrc(crc, chunk);
      if (chunk.length) chunks.push(chunk);
    };
    const data = bytes.subarray(entry.dataOffset, entry.dataEnd);
    if (entry.method === 0) receive(data);
    else if (entry.method === 8) {
      const inflater = new Inflate({ raw: true, chunkSize: 65536 });
      let stream;
      inflater.onStart = value => { stream = value; };
      inflater.onData = receive;
      try {
        if (!data.length && !inflater.push(data, true)) fail('DEFLATE 数据无效或截断');
        for (let p = 0; p < data.length; p += 256) {
          if (inflater.ended) fail('DEFLATE 流含多余数据');
          if (!inflater.push(data.subarray(p, p + 256), p + 256 >= data.length) || inflater.err) fail('DEFLATE 数据无效或截断');
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('ZIP ')) throw error;
        fail('DEFLATE 数据无效或截断');
      }
      // Public onStart/ended/err expose completion and exact consumed bytes.
      // Checking total_in also rejects trailing bytes within the final push.
      if (!inflater.ended || inflater.err || !stream || stream.total_in !== data.length) fail('DEFLATE 流不完整或含多余数据');
    } else fail('压缩方式不支持');
    if (size !== entry.uncompressedSize) fail('实际条目大小与声明不符');
    if ((crc ^ 0xffffffff) >>> 0 !== entry.crc32) fail('CRC32 校验失败');
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    expanded.set(entry.name, output);
  }
  return expanded;
}
