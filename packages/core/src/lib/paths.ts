// Útvonal-segédek: a monorepo gyökerének megtalálása (find-up), hogy a naplók és
// a .env feloldása független legyen attól, melyik könyvtárból indítjuk a CLI-t.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Felfelé haladva megkeresi az első könyvtárat, amelyben a megadott marker fájl
 * megtalálható. Visszaadja a könyvtárat, vagy undefined-ot, ha nincs.
 */
export function findUp(
  marker: string,
  startDir: string = process.cwd(),
): string | undefined {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, marker))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined; // elértük a filerendszer gyökerét
    }
    dir = parent;
  }
}

/**
 * A monorepo gyökere: a legközelebbi, pnpm-workspace.yaml-t tartalmazó könyvtár
 * felfelé haladva; ha nem található, a megadott/aktuális könyvtár.
 */
export function resolveProjectRoot(startDir: string = process.cwd()): string {
  return findUp('pnpm-workspace.yaml', startDir) ?? startDir;
}
