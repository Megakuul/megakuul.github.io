/** Build the single-file Lambda ZIP during page generation, without client-side tooling. */
export function lambdaZip(code: string) {
  const data = new TextEncoder().encode(code),
    name = new TextEncoder().encode('index.js');
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = new Uint8Array(30),
    l = new DataView(local.buffer);
  l.setUint32(0, 0x04034b50, true);
  l.setUint16(4, 20, true);
  l.setUint32(14, crc, true);
  l.setUint32(18, data.length, true);
  l.setUint32(22, data.length, true);
  l.setUint16(26, name.length, true);
  const central = new Uint8Array(46),
    c = new DataView(central.buffer);
  c.setUint32(0, 0x02014b50, true);
  c.setUint16(4, 20, true);
  c.setUint16(6, 20, true);
  c.setUint32(16, crc, true);
  c.setUint32(20, data.length, true);
  c.setUint32(24, data.length, true);
  c.setUint16(28, name.length, true);
  const end = new Uint8Array(22),
    e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, 1, true);
  e.setUint16(10, 1, true);
  e.setUint32(12, central.length + name.length, true);
  e.setUint32(16, local.length + name.length + data.length, true);
  const bytes = new Uint8Array(
    local.length + name.length + data.length + central.length + name.length + end.length,
  );
  let offset = 0;
  for (const part of [local, name, data, central, name, end]) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}
