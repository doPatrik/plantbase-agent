import {
  buildAgentTools,
  createListCategoriesTool,
  createRunSqlTool,
} from './agent-tools.js';

describe('buildAgentTools', () => {
  const deps = { runSql: async () => [], listCategories: async () => [] };

  it('should expose the runSql and listCategories tool definitions', () => {
    const names = buildAgentTools(deps).map((tool) => tool.definition.name);
    expect(names).toEqual(['runSql', 'listCategories']);
  });

  it('should give every tool a name, description and object input schema', () => {
    for (const tool of buildAgentTools(deps)) {
      expect(tool.definition.name).toBeTruthy();
      expect(tool.definition.description).toBeTruthy();
      expect(tool.definition.input_schema.type).toBe('object');
    }
  });
});

describe('createRunSqlTool', () => {
  it('should run the query and return the rows as a JSON string', async () => {
    const seen: string[] = [];
    const tool = createRunSqlTool(async (query) => {
      seen.push(query);
      return [{ name: 'Kentia', price: '18900' }];
    });
    const content = await tool.run({
      query: 'SELECT name, price FROM products',
    });
    expect(seen).toEqual(['SELECT name, price FROM products']);
    expect(JSON.parse(content)).toEqual([{ name: 'Kentia', price: '18900' }]);
  });

  it('should throw a clear error on invalid input (missing query)', async () => {
    const tool = createRunSqlTool(async () => []);
    await expect(tool.run({})).rejects.toThrow(/Érvénytelen runSql input/i);
  });

  it('should wrap a failing query as an SQL hiba error', async () => {
    const tool = createRunSqlTool(async () => {
      throw new Error('Csak SELECT engedélyezett.');
    });
    await expect(
      tool.run({ query: 'UPDATE products SET price = 0' }),
    ).rejects.toThrow(/SQL hiba/);
  });
});

describe('createListCategoriesTool', () => {
  it('should return the categories as a JSON string', async () => {
    let called = 0;
    const tool = createListCategoriesTool(async () => {
      called++;
      return ['fűszer', 'kaktusz'];
    });
    const content = await tool.run({});
    expect(called).toBe(1);
    expect(JSON.parse(content)).toEqual(['fűszer', 'kaktusz']);
  });
});
