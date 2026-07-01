// Plantbase CLI — belépési pont.
// Egyelőre üres váz: jelzi, hogy a környezet áll. A tényleges parancsok
// (echo → LLM → runSql) a B fázisokban kerülnek be. A CLI stdout a termék
// felülete, ezért itt a közvetlen kiírás szándékos (nem debug-log).

function main(): void {
  console.log('Plantbase CLI — a környezet kész. A parancsok a következő fázisokban érkeznek.');
}

main();
