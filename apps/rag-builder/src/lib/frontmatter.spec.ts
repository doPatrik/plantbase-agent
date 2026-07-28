import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from './frontmatter.js';

const doc = (fm: string, body = 'Body text.') => `---\n${fm}\n---\n${body}`;

describe('parseFrontmatter', () => {
  it('parses title, category and source, and returns the body', () => {
    const raw = doc(
      'title: Snake Plant Care\ncategory: plants-101\nsource: https://x.test/a',
    );
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe('Snake Plant Care');
    expect(parsed.category).toBe('plants-101');
    expect(parsed.source_url).toBe('https://x.test/a');
    expect(parsed.body).toBe('Body text.');
  });

  it('keeps colons in the value (splits on the first colon only)', () => {
    const raw = doc(
      'title: Bug Off: All About Mealybugs\ncategory: plants-101',
    );
    const parsed = parseFrontmatter(raw);
    expect(parsed.title).toBe('Bug Off: All About Mealybugs');
    expect(parsed.source_url).toBeNull();
  });

  it('throws when a required field is missing', () => {
    const raw = doc('category: plants-101');
    expect(() => parseFrontmatter(raw)).toThrow(/title/i);
  });

  it('throws when there is no frontmatter block', () => {
    expect(() => parseFrontmatter('# No frontmatter here')).toThrow(
      /frontmatter/i,
    );
  });
});
