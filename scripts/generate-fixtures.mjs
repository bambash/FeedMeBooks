#!/usr/bin/env node
/**
 * Generates test fixtures for E2E testing — pure Node.js, zero external deps.
 *
 *   test-fixtures/lorem-ipsum.epub   — 3-chapter valid EPUB 2.0
 *   test-fixtures/track-01.wav       — sine-wave audio, distinct freq per chapter
 *   test-fixtures/track-02.wav       — 16 kHz mono 16-bit PCM, ~28 s each
 *   test-fixtures/track-03.wav
 *
 * Usage:
 *   node scripts/generate-fixtures.mjs
 */

import { createHash } from 'crypto';
import { deflateSync, crc32 } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const FIXTURES_DIR = join(process.cwd(), 'test-fixtures');
mkdirSync(FIXTURES_DIR, { recursive: true });

const CHAPTERS = [
  {
    id: 'ch1',
    title: 'Chapter One: Beginnings',
    text: [
      'The morning light fell softly through the ancient curtains.',
      'Thomas walked slowly toward the window, wondering what the day would bring.',
      'Every journey begins with a single step, he reminded himself quietly.',
      'The village below was waking, smoke rising from the chimneys.',
    ].join(' '),
    freq: 440,
  },
  {
    id: 'ch2',
    title: 'Chapter Two: The Forest',
    text: [
      'Deep within the forest the shadows danced between tall oaks.',
      'Elena listened carefully to the rustling leaves and distant birdsong.',
      'She had wandered far from the village path, searching for something.',
      'The ancient trees whispered secrets that only silence could reveal.',
    ].join(' '),
    freq: 587,
  },
  {
    id: 'ch3',
    title: 'Chapter Three: The Return',
    text: [
      'By evening the travelers had finally reached the familiar stone bridge.',
      'The river rushed beneath them, cold and clear from the mountain peaks.',
      'Home was now visible across the valley, golden lights burning warmly.',
      'They smiled at each other, knowing the adventure was nearly complete.',
    ].join(' '),
    freq: 784,
  },
];

// ─── CRC-32 (unsigned) ────────────────────────────────────────────────────────

function crc32Buf(buf) {
  return crc32(buf) >>> 0; // signed → unsigned
}

// ─── Little-endian helpers ────────────────────────────────────────────────────

function u16le(v) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(v, 0); return b; }
function u32le(v) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(v, 0); return b; }

// ─── Local file header ────────────────────────────────────────────────────────

function localFileHeader(name, compressed, crc, size, csize, method) {
  const nameBuf = Buffer.from(name, 'utf8');
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // signature
    u16le(20),        // version needed
    u16le(0),         // flags
    u16le(method),    // compression: 0=stored, 8=deflated
    u16le(0),         // mod time (DOS), 0 is fine
    u16le(0),         // mod date
    u32le(crc),
    u32le(csize),
    u32le(size),
    u16le(nameBuf.length),
    u16le(0),         // extra field length
    nameBuf,
    compressed,
  ]);
}

// ─── Central directory entry ──────────────────────────────────────────────────

function centralDirEntry(name, crc, size, csize, method, offset) {
  const nameBuf = Buffer.from(name, 'utf8');
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]), // signature
    u16le(20),        // version made by
    u16le(20),        // version needed
    u16le(0),         // flags
    u16le(method),
    u16le(0),         // mod time
    u16le(0),         // mod date
    u32le(crc),
    u32le(csize),
    u32le(size),
    u16le(nameBuf.length),
    u16le(0),         // extra field length
    u16le(0),         // comment length
    u16le(0),         // disk number start
    u16le(0),         // internal attrs
    u32le(0),         // external attrs
    u32le(offset),
    nameBuf,
  ]);
}

// ─── End of central directory record ──────────────────────────────────────────

function eocdRecord(entryCount, cdSize, cdOffset) {
  return Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16le(0),         // disk number
    u16le(0),         // disk with CD start
    u16le(entryCount),
    u16le(entryCount),
    u32le(cdSize),
    u32le(cdOffset),
    u16le(0),         // comment length
  ]);
}

// ─── EPUB builder ─────────────────────────────────────────────────────────────

function buildEpub() {
  const files = [];

  // mimetype — must be first, stored uncompressed
  files.push({ name: 'mimetype', body: Buffer.from('application/epub+zip'), store: true });

  files.push({
    name: 'META-INF/container.xml',
    body: Buffer.from(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf"
              media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
  });

  const manifestItems = CHAPTERS
    .map(ch => `    <item id="${ch.id}" href="${ch.id}.html" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spineItems = CHAPTERS
    .map(ch => `    <itemref idref="${ch.id}"/>`)
    .join('\n');

  files.push({
    name: 'OEBPS/content.opf',
    body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Lorem Ipsum Test Book</dc:title>
    <dc:creator>FeedMeBooks Fixture Generator</dc:creator>
    <dc:identifier id="uid">feedmebooks-test-fixture-001</dc:identifier>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
${manifestItems}
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`),
  });

  const navPoints = CHAPTERS.map((ch, i) => `  <navPoint id="${ch.id}" playOrder="${i + 1}">
    <navLabel><text>${ch.title}</text></navLabel>
    <content src="${ch.id}.html"/>
  </navPoint>`).join('\n');

  files.push({
    name: 'OEBPS/toc.ncx',
    body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="feedmebooks-test-fixture-001"/></head>
  <docTitle><text>Lorem Ipsum Test Book</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`),
  });

  for (const ch of CHAPTERS) {
    files.push({
      name: `OEBPS/${ch.id}.html`,
      body: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"
  "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${ch.title}</title></head>
<body>
  <h1>${ch.title}</h1>
  <p>${ch.text}</p>
</body>
</html>`),
    });
  }

  // Build ZIP
  const localParts = [];
  const cdParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const crc = crc32Buf(f.body);
    let compressed, method, csize;

    if (f.store) {
      compressed = f.body;
      method = 0;
      csize = f.body.length;
    } else {
      compressed = deflateSync(f.body);
      method = 8;
      csize = compressed.length;
    }

    const header = localFileHeader(f.name, compressed, crc, f.body.length, csize, method);
    localParts.push(header);
    cdParts.push(centralDirEntry(f.name, crc, f.body.length, csize, method, offset));
    offset += header.length;
  }

  const cd = Buffer.concat(cdParts);
  const eocd = eocdRecord(files.length, cd.length, offset);

  const epubPath = join(FIXTURES_DIR, 'lorem-ipsum.epub');
  writeFileSync(epubPath, Buffer.concat([...localParts, cd, eocd]));
  console.log(`✓  EPUB  → ${epubPath}`);
}

// ─── WAV builder (sine wave test tones) ───────────────────────────────────────

function buildWav(ch, index) {
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const channels = 1;
  const durationSec = 28;
  const numSamples = sampleRate * durationSec;
  const freq = ch.freq;

  // Generate sine wave samples
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Apply a gentle envelope to avoid clicks at start/end
    let envelope = 1.0;
    const fadeSamples = Math.min(sampleRate * 0.05, numSamples / 4);
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i > numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples;
    samples[i] = Math.floor(16000 * envelope * Math.sin(2 * Math.PI * freq * t));
  }

  const dataSize = numSamples * (bitsPerSample / 8) * channels;
  const dataBuf = Buffer.from(samples.buffer);

  const fmtChunk = Buffer.concat([
    Buffer.from([0x66, 0x6d, 0x74, 0x20]), // "fmt "
    u32le(16),            // chunk size (PCM)
    u16le(1),             // audio format (PCM)
    u16le(channels),
    u32le(sampleRate),
    u32le(sampleRate * channels * bitsPerSample / 8), // byte rate
    u16le(channels * bitsPerSample / 8),              // block align
    u16le(bitsPerSample),
  ]);

  const dataChunkHeader = Buffer.concat([
    Buffer.from([0x64, 0x61, 0x74, 0x61]), // "data"
    u32le(dataSize),
  ]);

  const fileSize = 4 + (8 + fmtChunk.length) + (8 + dataSize);
  const riffHeader = Buffer.concat([
    Buffer.from([0x52, 0x49, 0x46, 0x46]), // "RIFF"
    u32le(fileSize),
    Buffer.from([0x57, 0x41, 0x56, 0x45]), // "WAVE"
  ]);

  const wavPath = join(FIXTURES_DIR, `track-0${index + 1}.wav`);
  writeFileSync(wavPath, Buffer.concat([riffHeader, fmtChunk, dataChunkHeader, dataBuf]));
  console.log(`✓  WAV   → ${wavPath} (${freq} Hz tone, ${durationSec}s)`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log('Generating test fixtures (pure Node.js)...\n');

buildEpub();
CHAPTERS.forEach((ch, i) => buildWav(ch, i));

console.log(`\nFixtures written to test-fixtures/`);
