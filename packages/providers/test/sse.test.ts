import { describe, expect, it } from 'vitest';

import { ServerSentEventDecoder } from '../src/index.js';

describe('ServerSentEventDecoder', () => {
  it('decodes comments, ignored fields, multi-line data, and CRLF', () => {
    const decoder = new ServerSentEventDecoder();

    expect(decoder.push(': keep-alive\r')).toEqual([]);
    expect(
      decoder.push('\nevent: message\r\ndata: first\r\ndata:second\r\n\r\n'),
    ).toEqual(['first\nsecond']);
    expect(decoder.finish()).toEqual([]);
  });

  it('handles lone CR separators and fields without values', () => {
    const decoder = new ServerSentEventDecoder();

    expect(decoder.push('id: ignored\rdata\r\r')).toEqual([]);
    expect(decoder.finish()).toEqual(['']);
  });

  it('flushes a final event without a trailing blank line', () => {
    const decoder = new ServerSentEventDecoder();

    expect(decoder.push('\ndata: final')).toEqual([]);
    expect(decoder.finish()).toEqual(['final']);
  });
});
