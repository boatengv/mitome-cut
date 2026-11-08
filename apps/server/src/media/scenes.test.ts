import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioPlan, captionEvents, captionsAss, planTimings, xfadeName, type SceneInput } from './scenes.js';

const scene = (o: Partial<SceneInput>): SceneInput => ({
  index: 0, label: '', prompt: '', vo: '', kind: 'slate', clipDur: 0, trimIn: 0, trimOut: null, dur: 6, voDur: 0, transition: 'cut', tdur: 0.5, ...o,
});

test('a voiceover longer than the clip extends the scene and creates a hold', () => {
  const t = planTimings([
    scene({ kind: 'video', clipDur: 5, trimIn: 1 }), // 4 s of clip
    scene({ kind: 'video', clipDur: 3, voDur: 4.5 }), // VO 4.5 + 0.25 > 3
    scene({ dur: 2 }), // slate
  ]);
  assert.deepEqual(t[0], { t0: 0, len: 4, clipLen: 4, holdLen: 0 });
  assert.deepEqual(t[1], { t0: 4, len: 4.75, clipLen: 3, holdLen: 1.75 });
  assert.deepEqual(t[2], { t0: 8.75, len: 2, clipLen: 2, holdLen: 0 });
});

test('trim out shortens the clip', () => {
  const [t] = planTimings([scene({ kind: 'video', clipDur: 10, trimIn: 2, trimOut: 5 })]);
  assert.equal(t!.clipLen, 3);
});

test('transitions map to xfade names; cut has none', () => {
  assert.equal(xfadeName('cut'), null);
  assert.equal(xfadeName('fade'), 'fade');
  assert.equal(xfadeName('black'), 'fadeblack');
  assert.equal(xfadeName('zoom'), 'zoomin');
});

test('captions reveal words and restart every ten words', () => {
  const words = Array.from({ length: 12 }, (_, i) => `w${i + 1}`).join(' ');
  const scenes = [scene({ vo: words, dur: 6 })];
  const ev = captionEvents(scenes, planTimings(scenes));
  assert.equal(ev.length, 12);
  assert.equal(ev[0]!.text, 'w1');
  assert.equal(ev[9]!.text, 'w1 w2 w3 w4 w5 w6 w7 w8 w9 w10');
  assert.equal(ev[10]!.text, 'w11');
  assert.equal(ev[11]!.end, 6);
  const ass = captionsAss(ev, 720, 1280);
  assert.match(ass, /PlayResY: 1280/);
  assert.match(ass, /Dialogue: 0,0:00:00\.20,/);
});

test('captions strip ASS override braces', () => {
  const scenes = [scene({ vo: 'hello {\\b1}world', dur: 2 })];
  const ass = captionsAss(captionEvents(scenes, planTimings(scenes)), 1280, 720);
  assert.doesNotMatch(ass, /\{/);
});

test('music ducks under foreground audio with a sidechain', () => {
  const p = audioPlan({ foreground: [{ path: '/vo.mp3', at: 1.5 }], music: { path: '/m.mp3', volume: 0.25, duck: true }, total: 10 });
  assert.match(p.filter, /adelay=1500\|1500/);
  assert.match(p.filter, /sidechaincompress/);
  assert.ok(p.inputs.includes('-stream_loop'));
  assert.match(p.filter, /atrim=duration=10\[aout\]/);
});

test('silent projects still get an audio track', () => {
  const p = audioPlan({ foreground: [], music: null, total: 3 });
  assert.match(p.filter, /anullsrc/);
  assert.equal(p.inputs.length, 0);
});
