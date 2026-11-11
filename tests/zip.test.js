import test from 'node:test';
import assert from 'node:assert/strict';
import { createZipBlob } from '../src/core/zip.js';
import { readZipArchive } from './helpers/zip-reader.js';

test('createZipBlob packs stored mimetype first and deflates larger entries cleanly', async () => {
  const repeatedText = 'Capítulo de teste com bastante repetição para acionar deflate-raw.\n'.repeat(20);
  const blob = await createZipBlob([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'OEBPS/capítulo-01.xhtml', data: repeatedText },
    { name: 'OEBPS/small.txt', data: 'abc' },
    { name: 'OEBPS/bin.dat', data: new Uint8Array([1, 2, 3, 4, 255]) }
  ]);

  assert.equal(blob.type, 'application/epub+zip');
  const archive = await readZipArchive(blob);

  assert.equal(archive.entries.length, 4);
  assert.equal(archive.entries[0].name, 'mimetype');
  assert.equal(archive.entries[0].method, 0); // Stored uncompressed
  assert.equal(archive.entries[0].text(), 'application/epub+zip');

  // Verify raw EPUB OCF requirement: uncompressed 'mimetype' starts right after 30-byte header + 8-byte name
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(30, 38)), 'mimetype');
  assert.equal(new TextDecoder().decode(bytes.subarray(38, 58)), 'application/epub+zip');

  // Non-ASCII UTF-8 filename flag (0x0800) and round-trip content fidelity
  const chEntry = archive.files.get('OEBPS/capítulo-01.xhtml');
  assert.ok(chEntry);
  assert.equal(chEntry.flags & 0x0800, 0x0800);
  assert.equal(chEntry.method, 8); // Deflated
  assert.ok(chEntry.compressedSize < chEntry.uncompressedSize);
  assert.equal(chEntry.text(), repeatedText);

  assert.equal(archive.files.get('OEBPS/small.txt').method, 0);
  assert.equal(archive.files.get('OEBPS/small.txt').text(), 'abc');
  assert.deepEqual(archive.files.get('OEBPS/bin.dat').data, new Uint8Array([1, 2, 3, 4, 255]));
});

test('createZipBlob supports empty entry list and empty file contents', async () => {
  const emptyArchiveBlob = await createZipBlob([]);
  const emptyArchive = await readZipArchive(emptyArchiveBlob);
  assert.equal(emptyArchive.entries.length, 0);

  const zeroByteBlob = await createZipBlob([
    { name: 'empty.txt', data: '' },
    { name: 'empty.bin', data: new Uint8Array(0) }
  ]);
  const zeroArchive = await readZipArchive(zeroByteBlob);
  assert.equal(zeroArchive.entries.length, 2);
  assert.equal(zeroArchive.files.get('empty.txt').text(), '');
  assert.equal(zeroArchive.files.get('empty.bin').data.length, 0);
});

test('createZipBlob rejects invalid arguments and malformed entries', async () => {
  await assert.rejects(() => createZipBlob(null), TypeError);
  await assert.rejects(() => createZipBlob([{ name: '', data: 'x' }]), /non-empty string name/);
  await assert.rejects(() => createZipBlob([{ name: 'a.txt' }]), /missing data/);
  await assert.rejects(() => createZipBlob([{ name: 'a.txt', data: 12345 }]), TypeError);
});

test('readZipArchive rejects truncated or corrupted ZIP buffers', async () => {
  await assert.rejects(() => readZipArchive(new Uint8Array(10)), /too small/);
  const valid = await createZipBlob([{ name: 'test.txt', data: 'hello world' }]);
  const corrupted = new Uint8Array(await valid.arrayBuffer());
  // Flip a byte inside the file payload to trigger CRC mismatch
  corrupted[30 + 'test.txt'.length + 1] ^= 0xff;
  await assert.rejects(() => readZipArchive(corrupted), /CRC-32 mismatch/);
});
