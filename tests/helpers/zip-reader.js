import { inflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Zero-dependency ZIP archive reader/verifier for validating generated ZIP & EPUB Blobs.
 * @param {Blob | Uint8Array | ArrayBuffer} input
 */
export async function readZipArchive(input) {
  let bytes;
  if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (input && typeof input.arrayBuffer === 'function') {
    bytes = new Uint8Array(await input.arrayBuffer());
  } else {
    throw new TypeError('readZipArchive expected a Blob, Uint8Array, or ArrayBuffer');
  }

  if (bytes.length < 22) {
    throw new Error(`Invalid ZIP: buffer too small (${bytes.length} bytes)`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  // Locate EOCD signature 0x06054b50 from end
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: End of Central Directory signature not found');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (centralOffset + centralSize > eocdOffset) {
    throw new Error('Invalid ZIP: Central Directory bounds exceed archive');
  }

  const entries = [];
  const files = new Map();
  let ptr = centralOffset;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) {
      throw new Error(`Invalid ZIP: bad Central Directory header at ${ptr}`);
    }
    const flags = view.getUint16(ptr + 8, true);
    const method = view.getUint16(ptr + 10, true);
    const crc = view.getUint32(ptr + 16, true);
    const compSize = view.getUint32(ptr + 20, true);
    const uncompSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error(`Invalid ZIP: bad Local File Header for ${name}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const payload = bytes.subarray(dataStart, dataStart + compSize);

    let data;
    if (method === 0) {
      data = new Uint8Array(payload);
    } else if (method === 8) {
      data = new Uint8Array(inflateRawSync(payload));
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }

    if (data.length !== uncompSize) {
      throw new Error(`Size mismatch for ${name}: expected ${uncompSize}, got ${data.length}`);
    }
    const actualCrc = computeCrc32(data);
    if (actualCrc !== crc) {
      throw new Error(`CRC-32 mismatch for ${name}: expected ${crc}, got ${actualCrc}`);
    }

    const entryMeta = {
      name,
      method,
      flags,
      crc32: crc,
      compressedSize: compSize,
      uncompressedSize: uncompSize,
      data,
      text: () => decoder.decode(data)
    };
    entries.push(entryMeta);
    files.set(name, entryMeta);
  }

  return { entries, files };
}
