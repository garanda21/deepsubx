import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSRT, stringifySRT } from '../server/utils/srt.js';

test('parses blocks with multi-line text', () => {
  const subs = parseSRT('1\n00:00:01,000 --> 00:00:02,000\nHello\nthere\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');

  assert.deepEqual(subs, [
    { id: 1, startTime: '00:00:01,000', endTime: '00:00:02,000', text: 'Hello\nthere' },
    { id: 2, startTime: '00:00:03,000', endTime: '00:00:04,000', text: 'Bye' },
  ]);
});

test('keeps a block with empty text without swallowing the next one', () => {
  const subs = parseSRT('1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nBye\n');

  assert.equal(subs.length, 2);
  assert.equal(subs[0].text, '');
  assert.deepEqual(subs[1], { id: 2, startTime: '00:00:03,000', endTime: '00:00:04,000', text: 'Bye' });
});

test('handles CRLF line endings, a BOM and extra blank lines', () => {
  const subs = parseSRT('﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n\r\n\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nYo\r\n');

  assert.deepEqual(subs.map(s => [s.id, s.text]), [[1, 'Hi'], [2, 'Yo']]);
});

test('removes invisible characters from text', () => {
  const [sub] = parseSRT('1\n00:00:01,000 --> 00:00:02,000\nso­ft​ space\n');

  assert.equal(sub.text, 'soft space');
});

test('round-trips through stringifySRT', () => {
  const content = '1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\n\n\n3\n00:00:05,000 --> 00:00:06,000\n<i>Bye</i>\n';

  assert.deepEqual(parseSRT(stringifySRT(parseSRT(content))), parseSRT(content));
});
