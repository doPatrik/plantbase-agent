import { createCatalogTools } from './tools.js';

describe('createCatalogTools', () => {
  it('exposes catalogSql and listCategories with executable handlers', async () => {
    const tools = createCatalogTools({
      runSql: async (q) => [{ q }],
      listCategories: async () => ['kaktusz', 'pozsgás'],
    });
    expect(Object.keys(tools)).toContain('catalogSql');
    expect(Object.keys(tools)).toContain('listCategories');

    const sqlResult = await tools.catalogSql.execute!(
      { query: 'SELECT name FROM products LIMIT 1' },
      { toolCallId: 't1', messages: [], context: undefined },
    );
    expect(sqlResult).toContain('SELECT name FROM products LIMIT 1');

    const catResult = await tools.listCategories.execute!(
      {},
      { toolCallId: 't2', messages: [], context: undefined },
    );
    expect(catResult).toContain('kaktusz');
  });
});
