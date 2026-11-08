import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_KEY_RE, FILE_PATH_RE, FILE_PREFIX_RE, frameSize } from './api.js';

test('document keys match the editor and nothing else', () => {
  for (const ok of ['ms_projects', 'ms_shows', 'ms_seasons', 'ms_proj_abc123', 'ms_show_x9', 'ms_season_k2l']) {
    assert.ok(DOC_KEY_RE.test(ok), ok);
  }
  for (const bad of ['ms_theme', 'ms_proj_', 'ms_proj_ABC', 'lfs_settings', 'ms_proj_a/b', '../ms_shows']) {
    assert.ok(!DOC_KEY_RE.test(bad), bad);
  }
});

test('file paths are confined to a project, season or show', () => {
  assert.ok(FILE_PATH_RE.test('projects/abc123/media/clips/s1x2.mp4'));
  assert.ok(FILE_PATH_RE.test('seasons/q1/media/images/a9.png'));
  assert.ok(FILE_PATH_RE.test('projects/p1/media/music/bed.mp3'));
  assert.ok(!FILE_PATH_RE.test('projects/abc/media/clips/../x.mp4'));
  assert.ok(!FILE_PATH_RE.test('users/abc/media/clips/x.mp4'));
  assert.ok(!FILE_PATH_RE.test('projects/abc/media/secret/x.mp4'));
});

test('frame sizes follow the aspect ratio', () => {
  assert.deepEqual(frameSize('16:9', '1080p'), { width: 1920, height: 1080 });
  assert.deepEqual(frameSize('9:16', '720p'), { width: 720, height: 1280 });
  assert.deepEqual(frameSize('9:16', '480p'), { width: 480, height: 854 });
});

test('file prefixes allow the editor’s "<id>." lookups', () => {
  assert.ok(FILE_PREFIX_RE.test('projects/abc123/media/voices/s1x2.'));
  assert.ok(FILE_PREFIX_RE.test('projects/abc123/'));
  assert.ok(!FILE_PREFIX_RE.test('projects/'));
  assert.ok(!FILE_PREFIX_RE.test('users/abc/'));
});
