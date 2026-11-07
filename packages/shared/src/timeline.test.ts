import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clipAt, emptyTimeline, splitClip, timecode, timelineDuration, timelineSchema } from './timeline.js';

test('empty timeline is valid and zero length', () => {
  const t = emptyTimeline();
  assert.equal(timelineSchema.safeParse(t).success, true);
  assert.equal(timelineDuration(t), 0);
});

test('clipAt prefers the latest-starting clip', () => {
  const clips = [
    { id: 'a', start: 0, duration: 10 },
    { id: 'b', start: 5, duration: 2 },
  ];
  assert.equal(clipAt(clips, 6)?.id, 'b');
  assert.equal(clipAt(clips, 8)?.id, 'a');
  assert.equal(clipAt(clips, 10), undefined);
});

test('splitClip carries trimIn into the second half', () => {
  const res = splitClip({ id: 'a', start: 2, duration: 6, trimIn: 1 }, 5, 'b');
  assert.ok(res);
  const [first, second] = res;
  assert.equal(first.duration, 3);
  assert.equal(second.start, 5);
  assert.equal(second.duration, 3);
  assert.equal(second.trimIn, 4);
  assert.equal(splitClip({ id: 'a', start: 2, duration: 6 }, 2, 'b'), null);
});

test('timecode formats frames', () => {
  assert.equal(timecode(7.5, 24), '00:00:07:12');
  assert.equal(timecode(3661, 24), '01:01:01:00');
});

test('schema rejects negative starts', () => {
  const t = emptyTimeline();
  const bad = { ...t, text: [{ id: 'x', text: 'hi', start: -1, duration: 1, position: 'bottom', size: 56 }] };
  assert.equal(timelineSchema.safeParse(bad).success, false);
});
