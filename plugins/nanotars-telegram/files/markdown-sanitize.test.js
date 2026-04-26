// Run with: node --test plugins/nanotars-telegram/files/markdown-sanitize.test.js
//
// Ported from nanoclaw v2 src/channels/telegram-markdown-sanitize.test.ts.
// Uses node:test (built into Node 18+) so no test infrastructure is required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeTelegramLegacyMarkdown } from './markdown-sanitize.js';

describe('sanitizeTelegramLegacyMarkdown', () => {
  it('downgrades CommonMark **bold** to legacy *bold*', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('**Host path**'), '*Host path*');
  });

  it('downgrades CommonMark __bold__ to legacy _italic_', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('__label__'), '_label_');
  });

  it('leaves balanced legacy *bold* and _italic_ alone', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('a *b* c _d_ e'), 'a *b* c _d_ e');
  });

  it('preserves inline code spans untouched', () => {
    const input = 'see `file_name.py` and `**not bold**` here';
    assert.equal(sanitizeTelegramLegacyMarkdown(input), input);
  });

  it('preserves fenced code blocks untouched', () => {
    const input = '```\nfoo_bar **baz**\n```';
    assert.equal(sanitizeTelegramLegacyMarkdown(input), input);
  });

  it('strips formatting chars on odd delimiter count (unbalanced *)', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('a * b *c*'), 'a  b c');
  });

  it('strips formatting chars on odd delimiter count (unbalanced _)', () => {
    assert.equal(
      sanitizeTelegramLegacyMarkdown('file_name has _one italic_'),
      'filename has one italic',
    );
  });

  it('strips brackets when unbalanced', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('see [docs here'), 'see docs here');
  });

  it('leaves matched brackets (e.g. links) alone when counts balance', () => {
    const input = 'see [docs](https://example.com) for more';
    assert.equal(sanitizeTelegramLegacyMarkdown(input), input);
  });

  it('fixes the real failing message', () => {
    const input =
      'Sure! What do you want to mount, and where should it appear inside the container?\n\n' +
      '- **Host path** (on your machine): e.g. `~/projects/webapp`\n' +
      '- **Container path**: e.g. `workspace/webapp`\n' +
      '- **Read-only or read-write?**';
    const out = sanitizeTelegramLegacyMarkdown(input);
    assert.ok(!out.includes('**'), 'should not contain raw CommonMark bold');
    assert.ok(out.includes('*Host path*'), 'should contain legacy *bold*');
    assert.ok(out.includes('`~/projects/webapp`'), 'should preserve code span');
    assert.equal((out.match(/\*/g) ?? []).length % 2, 0, 'asterisks should be balanced');
  });

  it('is a no-op on empty string', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown(''), '');
  });

  it('replaces dash list bullets with • so the adapter does not re-emit `*` markers', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('- one\n- two'), '• one\n• two');
  });

  it('preserves indented list structure', () => {
    assert.equal(sanitizeTelegramLegacyMarkdown('  - nested'), '  • nested');
  });

  it('flattens Markdown horizontal rules (---, ***, ___)', () => {
    const input = 'before\n---\n***\n___\nafter';
    assert.equal(
      sanitizeTelegramLegacyMarkdown(input),
      'before\n⎯⎯⎯\n⎯⎯⎯\n⎯⎯⎯\nafter',
    );
  });

  it('leaves horizontal rules inside code blocks alone', () => {
    const input = '```\n---\n```';
    assert.equal(sanitizeTelegramLegacyMarkdown(input), input);
  });
});
