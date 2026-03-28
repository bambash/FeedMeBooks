#!/usr/bin/env node
/**
 * Generates test fixtures for E2E testing:
 *
 *   test-fixtures/lorem-ipsum.epub   — 3-chapter EPUB with unique per-chapter vocab
 *   test-fixtures/track-01.wav       — TTS audio of chapter 1 text
 *   test-fixtures/track-02.wav       — TTS audio of chapter 2 text
 *   test-fixtures/track-03.wav       — TTS audio of chapter 3 text
 *
 * Requirements:
 *   macOS  — uses `say` + `afconvert` (both built-in)
 *   Linux  — uses `espeak` (apt install espeak)
 *   All    — uses `zip` (standard on macOS/Linux)
 *
 * Usage:
 *   node scripts/generate-fixtures.mjs
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const FIXTURES_DIR = join(process.cwd(), 'test-fixtures');
mkdirSync(FIXTURES_DIR, { recursive: true });

// ─── Chapter content ─────────────────────────────────────────────────────────
// Each chapter uses a distinct vocabulary so the alignment algorithm can tell
// them apart even with imperfect TTS transcription.

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
  },
];

// ─── EPUB generation ─────────────────────────────────────────────────────────

function buildEpub() {
  const tmp = join(tmpdir(), `epub-fixture-${Date.now()}`);
  mkdirSync(join(tmp, 'META-INF'), { recursive: true });
  mkdirSync(join(tmp, 'OEBPS'), { recursive: true });

  writeFileSync(join(tmp, 'mimetype'), 'application/epub+zip');

  writeFileSync(join(tmp, 'META-INF', 'container.xml'), `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf"
              media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const manifestItems = CHAPTERS
    .map(ch => `    <item id="${ch.id}" href="${ch.id}.html" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spineItems = CHAPTERS
    .map(ch => `    <itemref idref="${ch.id}"/>`)
    .join('\n');

  writeFileSync(join(tmp, 'OEBPS', 'content.opf'), `<?xml version="1.0" encoding="UTF-8"?>
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
</package>`);

  const navPoints = CHAPTERS.map((ch, i) => `  <navPoint id="${ch.id}" playOrder="${i + 1}">
    <navLabel><text>${ch.title}</text></navLabel>
    <content src="${ch.id}.html"/>
  </navPoint>`).join('\n');

  writeFileSync(join(tmp, 'OEBPS', 'toc.ncx'), `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="feedmebooks-test-fixture-001"/></head>
  <docTitle><text>Lorem Ipsum Test Book</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>`);

  for (const ch of CHAPTERS) {
    writeFileSync(join(tmp, 'OEBPS', `${ch.id}.html`), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN"
  "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${ch.title}</title></head>
<body>
  <h1>${ch.title}</h1>
  <p>${ch.text}</p>
</body>
</html>`);
  }

  const epubPath = join(FIXTURES_DIR, 'lorem-ipsum.epub');
  if (existsSync(epubPath)) rmSync(epubPath);

  // mimetype must be first and stored uncompressed (-X0), rest can be compressed
  execSync(
    `cd "${tmp}" && zip -X0 "${epubPath}" mimetype && zip -r "${epubPath}" META-INF OEBPS`,
    { stdio: 'pipe' },
  );
  rmSync(tmp, { recursive: true });
  console.log(`✓  EPUB  → ${epubPath}`);
}

// ─── WAV generation via TTS ──────────────────────────────────────────────────

function buildAudio() {
  const isMac = process.platform === 'darwin';

  for (let i = 0; i < CHAPTERS.length; i++) {
    const ch = CHAPTERS[i];
    const wavPath = join(FIXTURES_DIR, `track-0${i + 1}.wav`);
    const text = ch.text.replace(/"/g, "'");

    if (isMac) {
      const aiff = wavPath.replace('.wav', '.aiff');
      execSync(`say -o "${aiff}" -- "${text}"`, { stdio: 'pipe' });
      execSync(`afconvert -f WAVE -d LEI16@16000 "${aiff}" "${wavPath}"`, { stdio: 'pipe' });
      rmSync(aiff);
    } else {
      // Linux — requires: sudo apt-get install espeak
      execSync(`espeak -w "${wavPath}" -s 150 -- "${text}"`, { stdio: 'pipe' });
    }

    console.log(`✓  WAV   → ${wavPath}`);
  }
}

// ─── Run ─────────────────────────────────────────────────────────────────────

console.log('Generating test fixtures...\n');

try {
  buildEpub();
} catch (e) {
  console.error('EPUB generation failed:', e.message);
  console.error('Make sure `zip` is installed (brew install zip / apt install zip)');
  process.exit(1);
}

try {
  buildAudio();
} catch (e) {
  console.error('Audio generation failed:', e.message);
  console.error('macOS: `say` and `afconvert` required (built-in)');
  console.error('Linux: `espeak` required  →  sudo apt-get install espeak');
  process.exit(1);
}

console.log(`\nFixtures written to test-fixtures/`);
