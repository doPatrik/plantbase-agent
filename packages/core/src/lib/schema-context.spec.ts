import { buildSystemPrompt } from './schema-context.js';

describe('buildSystemPrompt', () => {
  it('should always describe the Plantbase role', () => {
    expect(buildSystemPrompt({ databaseAvailable: false })).toContain('<role>');
    expect(buildSystemPrompt({ databaseAvailable: true })).toContain(
      'Plantbase',
    );
  });

  describe('when the database is not available (B2)', () => {
    const prompt = buildSystemPrompt({ databaseAvailable: false });

    it('should state that there is no database access', () => {
      expect(prompt).toMatch(/nem férsz hozzá az adatbázishoz/i);
    });

    it('should NOT mention the runSql tool or the SQL schema', () => {
      expect(prompt).not.toContain('runSql');
      expect(prompt).not.toContain('<schema>');
    });

    it('should NOT mention the listCategories tool', () => {
      expect(prompt).not.toContain('listCategories');
    });
  });

  describe('when the database is available (B3)', () => {
    const prompt = buildSystemPrompt({ databaseAvailable: true });

    it('should include the products schema and the runSql tool', () => {
      expect(prompt).toContain('<schema>');
      expect(prompt).toContain('products');
      expect(prompt).toContain('runSql');
    });

    it('should enforce SELECT-only in the rules', () => {
      expect(prompt).toContain('CSAK SELECT');
    });

    it('should describe the listCategories tool', () => {
      expect(prompt).toContain('listCategories');
    });

    it('should instruct to prefer listCategories over the static schema hint for categories', () => {
      expect(prompt).toMatch(/listCategories/);
      expect(prompt).toMatch(/emlékeztető|hint/i);
    });
  });
});
