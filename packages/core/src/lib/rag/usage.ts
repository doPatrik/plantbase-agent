// Stage-usage kontraktus (SP5): minden LLM/embedding-hívó stage opcionálisan
// visszaadja, mennyi tokent használt (modell + input/output). A pipeline ezt
// trace-eseményként emittálja (mellékhaszon), a költség-becslő pedig
// stage-enként gyűjti (elsődleges cél).

export interface StageUsage {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}
