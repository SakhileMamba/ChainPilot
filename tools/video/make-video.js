#!/usr/bin/env node
// Generates the video tutorial for the website (site/assets/video/):
//   1. narration for each scene in tools/video/storyboard.js: your own recordings in
//      video/voice/<scene id>.wav|mp3|m4a if present, otherwise a macOS voice
//   2. records the real control panel (and the website's download page) in Chrome,
//      acting out every scene with a cursor, spotlights and callouts; the casino is
//      replaced by simulated rounds and MoMo by the local test server
//   3. encodes H.264 + AAC, and writes captions, chapters and a transcript for the site
//
//   npm run video                       build it (needs ffmpeg and Google Chrome)
//   npm run video -- --script-only      only write video/narration.md, for recording your own voice
//   npm run video -- --voice Samantha   another macOS voice (list them: say -v '?')
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import { DesktopApp } from '../../desktop/app.js';
import { Controller } from '../../desktop/controller.js';
import { startServer } from '../../desktop/server.js';
import { SubscriptionApi } from '../../desktop/subscription.js';
import { LicenseStore } from '../../src/license.js';
import { PRODUCT, siteLink } from '../../src/product.js';
import { startDevApi } from '../lib/dev-api.js';
import { ROOT } from '../lib/sign.js';
import { serve } from '../serve.js';
import { Director } from './director.js';
import { card } from './scenes.js';
import { fakeLaunch, simulatedRun } from './sim.js';
import { CHAPTERS, STORYBOARD } from './storyboard.js';

const { values: opts } = parseArgs({
  options: {
    voice: { type: 'string', default: 'Tessa' }, // South African English
    rate: { type: 'string', default: '170' }, // words per minute
    crf: { type: 'string', default: '28' }, // H.264 quality: lower = better and bigger
    'script-only': { type: 'boolean' },
    keep: { type: 'boolean' }, // keep the work folder (frames, audio) for inspection
  },
});

const OUT = path.join(ROOT, 'site', 'assets', 'video');
const VOICE_DIR = path.join(ROOT, 'video', 'voice');
const NAME = `${PRODUCT.id}-tutorial`;
const W = 1280;
const H = 720;
const SCALE = 1.5; // recorded at 1920 x 1080
const RATE = 48_000;
const DEMO_MACHINE = '7F3K-9QXA-2M8D-H4PZ'; // shown in the video instead of this computer's real ID
const log = (message) => console.log(`[video] ${message}`);
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { maxBuffer: 1 << 30, ...options });

// ---- 1. the narration script, for anyone recording their own voice ----
mkdirSync(VOICE_DIR, { recursive: true });
writeFileSync(
  path.join(ROOT, 'video', 'narration.md'),
  [
    `# ${PRODUCT.name} video tutorial: narration script`,
    '',
    'Record one audio file per scene (WAV, MP3 or M4A) named after its id, e.g. `video/voice/01-welcome.wav`,',
    'then run `npm run video`. Scenes without a recording use the built-in voice. Each scene lasts as long',
    'as its recording, so pace doesn\'t matter; keep to the words so the on-screen actions line up.',
    '',
    ...STORYBOARD.flatMap((s) => [`## ${s.id} · ${s.chapter}`, '', s.say, '']),
  ].join('\n'),
);
writeFileSync(path.join(ROOT, 'video', 'narration.json'), JSON.stringify(STORYBOARD.map(({ id, chapter, say }) => ({ id, chapter, text: say })), null, 2) + '\n');
log(`wrote video/narration.md (${STORYBOARD.length} scenes)`);
if (opts['script-only']) process.exit(0);

// ---- checks ----
for (const tool of ['ffmpeg', 'ffprobe']) {
  try {
    run(tool, ['-version'], { stdio: 'ignore' });
  } catch {
    console.error(`${tool} not found. Install ffmpeg (macOS: brew install ffmpeg).`);
    process.exit(1);
  }
}
for (const scene of STORYBOARD) {
  for (const [, , phrase] of scene.run.toString().matchAll(/cue\((['"`])(.+?)\1\)/g)) {
    if (!scene.say.includes(phrase)) throw new Error(`${scene.id}: cue "${phrase}" is not in its narration`);
  }
}

const WORK = mkdtempSync(path.join(os.tmpdir(), 'chainpilot-video-'));
const seconds = (file) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());

// ---- 2. a voice for each scene ----
mkdirSync(path.join(WORK, 'voice'));
const voices = STORYBOARD.map((scene) => {
  for (const ext of ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'aiff']) {
    const file = path.join(VOICE_DIR, `${scene.id}.${ext}`);
    if (existsSync(file)) return { file, source: 'recorded', seconds: seconds(file) };
  }
  if (process.platform !== 'darwin') {
    return { file: null, source: 'none', seconds: scene.say.split(/\s+/).length / 2.6 }; // captions only
  }
  const file = path.join(WORK, 'voice', `${scene.id}.wav`);
  run('say', ['-v', opts.voice, '-r', opts.rate, '--file-format=WAVE', '--data-format=LEI16@48000', '-o', file, scene.say]);
  return { file, source: `macOS voice ${opts.voice}`, seconds: seconds(file) };
});
const recorded = voices.filter((v) => v.source === 'recorded').length;
log(`narration: ${recorded} recorded clip(s), ${voices.length - recorded} generated; ${voices.reduce((s, v) => s + v.seconds, 0).toFixed(0)} s in total`);

// ---- 3. the website, the app and a pretend MoMo, all local ----
const latest = path.join(ROOT, 'dist', 'windows', 'latest.json');
run(process.execPath, [path.join(ROOT, 'tools', 'build-site.js'), '--out', path.join(WORK, 'site'), ...(existsSync(latest) ? ['--downloads', path.dirname(latest)] : [])], { stdio: 'ignore' });
const site = await serve(path.join(WORK, 'site'));
const momo = await startDevApi({ approveAfterMs: 7000 });
const dataDir = path.join(WORK, 'data');
const licenses = new LicenseStore(dataDir, { machine: DEMO_MACHINE });
const controller = new Controller({
  dataDir,
  licenses,
  launch: fakeLaunch,
  run: simulatedRun({ seed: 1, rtp: PRODUCT.game.rtp }),
  browsers: () => [{ channel: 'chrome', path: 'chrome' }],
});
const app = new DesktopApp({ dataDir, licenses, controller, api: new SubscriptionApi(momo.url), open: () => {}, pollMs: 1500 });
await app.refreshRemote();
const server = await startServer({ app });

const icon = `data:image/svg+xml;base64,${readFileSync(path.join(ROOT, 'desktop', 'ui', 'icon.svg')).toString('base64')}`;
const ctx = {
  icon,
  name: PRODUCT.name,
  appUrl: server.url,
  currency: PRODUCT.currency,
  monthPrice: String((PRODUCT.plans.find((p) => p.id === 'month') ?? PRODUCT.plans[0]).price),
  installerName: existsSync(latest) ? JSON.parse(readFileSync(latest, 'utf8')).file : `${PRODUCT.name}-Setup.exe`,
  siteHost: siteLink() ? siteLink().replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
};

// ---- 4. record ----
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
const page = await context.newPage();
page.on('dialog', (dialog) => dialog.accept());
const d = new Director(page);
await d.goto(`${site.url}download.html`);
await d.card(card({ icon, kicker: 'Video tutorial', title: `${PRODUCT.name}: setup, play, and how compounding works`, sub: PRODUCT.tagline, items: CHAPTERS }));

const frames = [];
const framesDir = path.join(WORK, 'frames');
mkdirSync(framesDir);
let cdp;
async function startScreencast() {
  cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const file = path.join(framesDir, `${String(frames.length + 1).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ t: metadata.timestamp ?? Date.now() / 1000, file });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: W * SCALE, maxHeight: H * SCALE, everyNthFrame: 1 });
}
// A navigation can swap the page's renderer and end the screencast, so restart it after each one.
d.onNavigate = async () => {
  await cdp?.send('Page.stopScreencast').catch(() => {});
  await cdp?.detach().catch(() => {});
  await startScreencast();
};
const originalGoto = d.goto.bind(d);
d.goto = async (url) => {
  await originalGoto(url);
  await d.onNavigate();
};

await startScreencast();
const t0 = Date.now() / 1000;
const timeline = [];
for (const [i, scene] of STORYBOARD.entries()) {
  const narration = voices[i];
  const start = Date.now() / 1000;
  log(`${scene.id} (${narration.seconds.toFixed(1)} s)`);
  d.begin(scene.say, narration.seconds * 1000);
  try {
    await Promise.all([scene.run(d, ctx), sleep(narration.seconds * 1000 + 650)]);
  } catch (err) {
    throw new Error(`scene ${scene.id}: ${err.message}`);
  }
  timeline.push({ scene, narration, start: start - t0, end: Date.now() / 1000 - t0 });
}
await sleep(1800);
const t1 = Date.now() / 1000;
await cdp.send('Page.stopScreencast').catch(() => {});
await browser.close();
await Promise.all([server.close(), site.close(), momo.close(), controller.shutdown({ timeoutMs: 2000 })]);
log(`recorded ${(t1 - t0).toFixed(1)} s, ${frames.length} frames`);

// ---- 5. encode ----
mkdirSync(OUT, { recursive: true });
const concat = ['ffconcat version 1.0'];
const usable = frames.filter((f) => f.t <= t1);
usable.forEach((f, i) => {
  const from = Math.max(t0, i === 0 ? t0 : f.t);
  const to = i + 1 < usable.length ? Math.max(from + 0.001, usable[i + 1].t) : t1;
  concat.push(`file '${f.file}'`, `duration ${(to - from).toFixed(4)}`);
});
concat.push(`file '${usable.at(-1).file}'`);
writeFileSync(path.join(WORK, 'frames.txt'), concat.join('\n'));

// The narration track: every clip placed where its scene starts.
const total = Math.ceil((t1 - t0) * RATE);
const mix = new Int16Array(total);
for (const { narration, start } of timeline) {
  if (!narration.file) continue;
  const pcm = run('ffmpeg', ['-v', 'error', '-i', narration.file, '-f', 's16le', '-ac', '1', '-ar', String(RATE), '-']);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const offset = Math.round(start * RATE);
  for (let i = 0; i < samples.length && offset + i < total; i++) {
    mix[offset + i] = Math.max(-32768, Math.min(32767, mix[offset + i] + samples[i]));
  }
}
const wav = Buffer.alloc(44);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + mix.byteLength, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(mix.byteLength, 40);
writeFileSync(path.join(WORK, 'narration.wav'), Buffer.concat([wav, Buffer.from(mix.buffer)]));

const mp4 = path.join(OUT, `${NAME}.mp4`);
log('encoding…');
run(
  'ffmpeg',
  [
    '-y', '-v', 'error',
    '-f', 'concat', '-safe', '0', '-i', path.join(WORK, 'frames.txt'),
    '-i', path.join(WORK, 'narration.wav'),
    '-map', '0:v', '-map', '1:a',
    '-vf', `scale=${W * SCALE}:${H * SCALE}:flags=lanczos,format=yuv420p`,
    '-r', '30', '-fps_mode', 'cfr',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', opts.crf, '-tune', 'animation', '-g', '150',
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1', '-ar', String(RATE),
    '-movflags', '+faststart',
    mp4,
  ],
  { stdio: 'inherit' },
);
run('ffmpeg', ['-y', '-v', 'error', '-ss', '2', '-i', mp4, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '4', path.join(OUT, 'poster.jpg')]);

// ---- 6. captions, chapters, transcript ----
const stamp = (s) => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};
const cues = [];
for (const { scene, narration, start } of timeline) {
  const text = scene.text ?? scene.say;
  const parts = [];
  for (let sentence of text.match(/[^.!?]+[.!?]+["”']?/g)?.map((s) => s.trim()) ?? [text]) {
    while (sentence.length > 96) {
      const cut = sentence.lastIndexOf(', ', 84);
      if (cut < 30) break;
      parts.push(sentence.slice(0, cut + 1));
      sentence = sentence.slice(cut + 2);
    }
    parts.push(sentence);
  }
  const chars = parts.reduce((n, p) => n + p.length, 0);
  let t = start + 0.05;
  for (const part of parts) {
    const span = (narration.seconds * part.length) / chars;
    cues.push({ start: t, end: t + span, text: part });
    t += span;
  }
}
writeFileSync(
  path.join(OUT, `${NAME}.vtt`),
  ['WEBVTT', '', ...cues.flatMap((c, i) => [String(i + 1), `${stamp(c.start)} --> ${stamp(c.end)}`, c.text, ''])].join('\n'),
);
const chapters = [];
for (const { scene, start } of timeline) if (chapters.at(-1)?.title !== scene.chapter) chapters.push({ title: scene.chapter, start: Math.round(start * 10) / 10 });
const size = statSync(mp4).size;
writeFileSync(
  path.join(OUT, 'tutorial.json'),
  JSON.stringify(
    {
      video: `${NAME}.mp4`,
      captions: `${NAME}.vtt`,
      poster: 'poster.jpg',
      duration: Math.round((t1 - t0) * 10) / 10,
      size,
      voice: recorded === voices.length ? 'recorded' : recorded ? 'recorded and generated' : voices[0].source,
      generated: new Date().toISOString(),
      chapters,
      transcript: timeline.map(({ scene, start }) => ({ chapter: scene.chapter, start: Math.round(start * 10) / 10, text: scene.text ?? scene.say })),
    },
    null,
    2,
  ) + '\n',
);
if (!opts.keep) rmSync(WORK, { recursive: true, force: true });
else log(`work folder kept: ${WORK}`);
log(`done: site/assets/video/${NAME}.mp4 (${(size / 1_048_576).toFixed(1)} MB, ${Math.floor((t1 - t0) / 60)}:${String(Math.round((t1 - t0) % 60)).padStart(2, '0')}), ${cues.length} captions, ${chapters.length} chapters`);
process.exit(0);
