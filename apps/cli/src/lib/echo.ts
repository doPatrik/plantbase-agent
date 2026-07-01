// B1 fázis — tiszta, tesztelhető echo-logika (LLM és DB nélkül).
// A CLI ezt használja: a beírt szöveget változatlanul visszaadja, és felismeri
// az interaktív mód kilépő parancsát.

/** Visszaadja a bemenetet változatlanul (echo). */
export function echo(input: string): string {
  return input;
}

/** Igaz, ha a sor az interaktív mód kilépő parancsa (`exit`, kis/nagybetűtől és
 * körülvevő szóköztől függetlenül). */
export function isExitCommand(input: string): boolean {
  return input.trim().toLowerCase() === 'exit';
}
