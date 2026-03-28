import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from '../../src/renderer/lib/message-markdown';

describe('message markdown parser', () => {
  it('parses GitHub-style tables into a structured block', () => {
    const blocks = parseMarkdownBlocks([
      'Intro paragraph.',
      '',
      '| Layer | Winner |',
      '| --- | --- |',
      '| Provenance | 0ctx |',
      '| Review | CQ |'
    ].join('\n'));

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: 'paragraph',
      text: 'Intro paragraph.'
    });
    expect(blocks[1]).toMatchObject({
      kind: 'table',
      headers: ['Layer', 'Winner'],
      rows: [
        ['Provenance', '0ctx'],
        ['Review', 'CQ']
      ]
    });
  });

  it('preserves paragraph line breaks inside a single markdown block', () => {
    const blocks = parseMarkdownBlocks('First line\nSecond line');
    expect(blocks).toMatchObject([
      {
        kind: 'paragraph',
        text: 'First line\nSecond line'
      }
    ]);
  });
});
