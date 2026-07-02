# Az agent-toolokat registry dispatcheli, nem if/else-lánc

A kézzel írt tool-use loopot (architektura.md 3. döntés: "látható mechanika, az alapoktól") eredetileg toolonkénti explicit `if/else if` ágakkal tartottuk átláthatónak. Amikor a `listCategories` (2. tool) után egyértelművé vált, hogy az ágankénti bővítés lineárisan növeli és rontja a loop kódját (5+ toolnál kezelhetetlen), áttértünk egy **tool-registryre**: minden tool egy `AgentTool` egység (Anthropic-definíció + `run` handler) az `agent-tools.ts`-ben, a loop pedig egy `name -> tool` `Map`-ből dispatch-el. Így a loop mérete állandó, új tool = egy sor a `buildAgentTools`-ban.

## Consequences

- A loop továbbra is kézzel írt (nem SDK `toolRunner`/agent-framework), tehát az architektura.md 3. döntés **szándéka** (látható mechanika) megmarad — csak a per-tool logika költözik a registrybe. A "látható a dispatch mechanikája" pedagógiai szempont enyhén gyengül, cserébe a tool-hozzáadás triviális és egységes lett.
- Az input-validáció (zod) és a hibaburkolás (pl. `SQL hiba: …`) tool-onként a `run` handlerbe került; a loop csak a dobott hibát kapja el és küldi vissza `is_error` tool_result-ként.
