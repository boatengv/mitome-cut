import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyTimeline } from '@mitome/shared';
import { buildRenderPlan, type RenderMedia } from './render.js';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const opts = { workDir: '/tmp/w', fontPath: '/f.ttf', outPath: '/tmp/out.mp4' };
const settings = { width: 1280, height: 720, fps: 24, format: 'mp4' as const };

test('gaps and unready scenes become black segments', () => {
  const t = emptyTimeline();
  t.video.push({ id: '1', assetId: A, name: 'one', start: 1, duration: 2, trimIn: 0 });
  t.video.push({ id: '2', assetId: null, name: 'todo', start: 3, duration: 2, trimIn: 0 });
  const media = new Map<string, RenderMedia>([[A, { path: '/a.mp4', hasVideo: true, hasAudio: false, isImage: false }]]);
  const plan = buildRenderPlan(t, media, settings, opts);
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
  assert.equal(plan.durationSec, 5);
  assert.match(graph, /concat=n=3:v=1:a=0/); // black, clip, black
  assert.equal((graph.match(/color=c=black/g) ?? []).length, 2);
  assert.match(graph, /anullsrc/); // no audio sources at all
});

test('audio clips are delayed and mixed; text is burned in', () => {
  const t = emptyTimeline();
  t.video.push({ id: '1', assetId: A, name: 'one', start: 0, duration: 4, trimIn: 1 });
  t.audio.push({ id: 'a', assetId: B, name: 'vo', start: 0.5, duration: 3, trimIn: 0, volume: 0.8, fade: true });
  t.text.push({ id: 't', text: 'Hello', start: 1, duration: 2, position: 'bottom', size: 56 });
  const media = new Map<string, RenderMedia>([
    [A, { path: '/a.mp4', hasVideo: true, hasAudio: true, isImage: false }],
    [B, { path: '/b.wav', hasVideo: false, hasAudio: true, isImage: false }],
  ]);
  const plan = buildRenderPlan(t, media, settings, opts);
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
  assert.match(graph, /amix=inputs=2/);
  assert.match(graph, /adelay=500\|500/);
  assert.match(graph, /enable='between\(t,1,3\)'/);
  assert.deepEqual(plan.files, [{ path: '/tmp/w/text-0.txt', content: 'Hello' }]);
  // trimIn is applied as an input seek
  assert.equal(plan.args[plan.args.indexOf('-ss') + 1], '1');
});

test('gif output drops audio and builds a palette', () => {
  const t = emptyTimeline();
  t.text.push({ id: 't', text: 'Only text', start: 0, duration: 2, position: 'center', size: 56 });
  const plan = buildRenderPlan(t, new Map(), { ...settings, format: 'gif' }, { ...opts, outPath: '/tmp/o.gif' });
  const graph = plan.args[plan.args.indexOf('-filter_complex') + 1]!;
  assert.match(graph, /palettegen/);
  assert.doesNotMatch(graph, /aout/);
});

test('empty timeline is rejected', () => {
  assert.throws(() => buildRenderPlan(emptyTimeline(), new Map(), settings, opts), /empty/);
});
