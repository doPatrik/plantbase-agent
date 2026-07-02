import { assertSelectOnly, listCategories } from './runsql.js';

describe('assertSelectOnly', () => {
  it('should allow a simple SELECT', () => {
    expect(() =>
      assertSelectOnly('SELECT * FROM products LIMIT 10'),
    ).not.toThrow();
  });

  it('should allow a WITH ... SELECT (CTE) query', () => {
    expect(() =>
      assertSelectOnly('WITH t AS (SELECT id FROM products) SELECT * FROM t'),
    ).not.toThrow();
  });

  it('should allow a single trailing semicolon', () => {
    expect(() => assertSelectOnly('SELECT 1;')).not.toThrow();
  });

  it('should reject INSERT / UPDATE / DELETE', () => {
    expect(() =>
      assertSelectOnly("INSERT INTO products (name) VALUES ('x')"),
    ).toThrow();
    expect(() => assertSelectOnly('UPDATE products SET price = 0')).toThrow();
    expect(() => assertSelectOnly('DELETE FROM products')).toThrow();
  });

  it('should reject DDL', () => {
    expect(() => assertSelectOnly('DROP TABLE products')).toThrow();
    expect(() =>
      assertSelectOnly('ALTER TABLE products ADD COLUMN x int'),
    ).toThrow();
    expect(() => assertSelectOnly('TRUNCATE products')).toThrow();
  });

  it('should reject stacked statements (SQL injection style)', () => {
    expect(() => assertSelectOnly('SELECT 1; DROP TABLE products')).toThrow(
      /egyetlen/i,
    );
  });

  it('should reject a data-modifying CTE', () => {
    expect(() =>
      assertSelectOnly(
        'WITH d AS (DELETE FROM products RETURNING *) SELECT * FROM d',
      ),
    ).toThrow();
  });

  it('should reject an empty query', () => {
    expect(() => assertSelectOnly('   ')).toThrow();
  });
});

describe('listCategories', () => {
  it('should run the fixed DISTINCT category query ordered by category', async () => {
    const calls: string[] = [];
    await listCategories({
      runSql: async (query) => {
        calls.push(query);
        return [];
      },
    });
    expect(calls).toEqual([
      'SELECT DISTINCT category FROM products ORDER BY category',
    ]);
  });

  it('should map result rows to a plain string array of category names', async () => {
    const result = await listCategories({
      runSql: async () => [
        { category: 'fűszer' },
        { category: 'kaktusz' },
        { category: 'pozsgás' },
      ],
    });
    expect(result).toEqual(['fűszer', 'kaktusz', 'pozsgás']);
  });

  it('should pass the read-only connectionString through to runSql', async () => {
    let received: string | undefined;
    await listCategories({
      connectionString: 'postgres://ro@localhost/plantbase_ro',
      runSql: async (_query, options) => {
        received = options?.connectionString;
        return [];
      },
    });
    expect(received).toBe('postgres://ro@localhost/plantbase_ro');
  });
});
