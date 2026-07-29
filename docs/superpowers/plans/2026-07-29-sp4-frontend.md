# SP4 Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ChatGPT-szerű React streaming chat frontend (`apps/frontend`), ami a backend `POST /api/chat` (AI SDK v7 UI Message Stream) végpontját fogyasztja, forrásokat mutat, és DEBUG=true mellett engine-trace panelt jelenít meg.

**Architecture:** Nx React + Vite app, `@ai-sdk/react` `useChat` hookkal. Custom `DefaultChatTransport` a `UIMessage[]` → backend `{messages:{role,content}[]}` alakra lapításához (`prepareSendMessagesRequest`). A `data-trace` transient part az `onData` callbacken keresztül gyűlik fordulónkénti trace-állapotba (StatusIndicator + TracePanel); a `data-sources` a `message.parts`-ban perzisztál (citáció-chipek). Tailwind v4 + kézzel bemásolt shadcn/ui primitívek.

**Tech Stack:** React 19, Vite, `@ai-sdk/react` (v7), `ai` (v7.0.37, már telepítve), Tailwind CSS v4 (`@tailwindcss/vite`), shadcn/ui-stílusú komponensek (cva + `@radix-ui/react-slot`/`react-collapsible`), `react-markdown`, Vitest + React Testing Library.

## Global Constraints

- **TypeScript strict**; `kebab-case` fájlnevek; `interface` objektumokhoz, string-literál unió enum helyett; immutabilitás.
- **A backend kontraktusát NEM módosítjuk.** `POST /api/chat` body: `{ messages: { role: 'user'|'assistant', content: string }[] }` (lásd `apps/backend/src/lib/app.ts` `chatRequestSchema`).
- **A frontend csak `@plantbase/shared`-től függ** (típusok/DTO-k), a `@plantbase/core`-tól SOHA. Dependency-irány: frontend → shared.
- **UI-szöveg magyarul.** Commit/PR **angolul** (Conventional Commits).
- **Vite/bundler modul-feloldás:** a frontend-importok extension NÉLKÜL (`../lib/utils`, nem `../lib/utils.js`). Workspace-csomag: `@plantbase/shared`.
- **Product-kódban nincs `console.log`.** Tesztek: Vitest, hálózat/DB nélkül (a `@ai-sdk/react` mockolt vagy injektált).
- Minden commit végén: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Branch: `feat/sp4-frontend` (már létrehozva, a spec commitja rajta van). Minden task egy külön commit.

---

### Task 1: Nx React + Vite app scaffold

**Files:**

- Create: `apps/frontend/**` (a generátor hozza létre: `project.json`, `vite.config.ts`, `tsconfig*.json`, `src/main.tsx`, `src/app/app.tsx`, `index.html`)

**Interfaces:**

- Produces: az `apps/frontend` Nx-projekt `build`/`serve`/`test`/`typecheck` targetekkel; `src/main.tsx` React belépő.

- [ ] **Step 1: Scaffold az nx-generate skillel**

Invokáld a `nx-generate` skillt egy React alkalmazás létrehozásához a következő paraméterekkel (a skill oldja fel a pontos flageket az Nx 23-hoz — NE találgass flaget):

- generátor: `@nx/react:application`
- név/hely: `frontend`, `apps/frontend` alá (directory: `apps/frontend`)
- bundler: **vite**
- unit test runner: **vitest**
- e2e test runner: **none**
- routing: **false**
- style: **css**
- linter: a workspace alapértelmezettje (ha kér)

A generátor telepíti a `@nx/react` + `@nx/vite` pluginokat és a React függőségeket.

- [ ] **Step 2: Verifikáld a serve-et**

Run: `pnpm nx serve frontend`
Expected: Vite dev server elindul (pl. `http://localhost:4200`), a default oldal betölt. Állítsd le (Ctrl+C).

- [ ] **Step 3: Verifikáld a test + typecheck targeteket**

Run: `pnpm nx run-many -t test typecheck -p frontend`
Expected: mindkét target PASS (a generátor default smoke-tesztje zöld).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend package.json pnpm-lock.yaml nx.json tsconfig.base.json
git commit -m "chore(frontend): scaffold React + Vite Nx app

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Styling foundation — Tailwind v4 + shadcn primitívek + `cn`

**Files:**

- Modify: `apps/frontend/vite.config.ts` (Tailwind plugin + `/api` proxy)
- Create: `apps/frontend/src/styles.css`
- Modify: `apps/frontend/src/main.tsx` (import `./styles.css`)
- Create: `apps/frontend/src/lib/utils.ts`
- Create: `apps/frontend/src/components/ui/button.tsx`
- Create: `apps/frontend/src/components/ui/textarea.tsx`
- Create: `apps/frontend/src/components/ui/collapsible.tsx`

**Interfaces:**

- Produces: `cn(...inputs: ClassValue[]): string`; `Button` (props: variant `default|outline|ghost`, size `default|icon`, `asChild?`); `Textarea` (natív textarea propok); `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (Radix re-export).

- [ ] **Step 1: Telepítsd a függőségeket**

```bash
pnpm add -D -w tailwindcss @tailwindcss/vite
pnpm add -w clsx tailwind-merge class-variance-authority @radix-ui/react-slot @radix-ui/react-collapsible lucide-react
```

- [ ] **Step 2: Add a Tailwind plugint és a proxyt a `vite.config.ts`-hez**

A `plugins` tömbbe vedd fel a `tailwindcss()`-t (import a fájl tetején: `import tailwindcss from '@tailwindcss/vite';`). Egészítsd ki a `server` blokkot a backend-proxyval:

```ts
server: {
  port: 4200,
  host: 'localhost',
  proxy: {
    '/api': {
      target: 'http://localhost:3000',
      changeOrigin: true,
    },
  },
},
```

(A `server.port`/`host` értékeket a generátor már beállíthatta — csak a `proxy` blokkot add hozzá, a meglévő beállításokat ne törölд.)

- [ ] **Step 3: Hozd létre a `src/styles.css`-t (Tailwind v4 + shadcn tokenek)**

```css
@import 'tailwindcss';

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
}

:root {
  --background: hsl(0 0% 100%);
  --foreground: hsl(240 10% 3.9%);
  --card: hsl(0 0% 100%);
  --card-foreground: hsl(240 10% 3.9%);
  --primary: hsl(142 71% 29%);
  --primary-foreground: hsl(0 0% 98%);
  --muted: hsl(240 4.8% 95.9%);
  --muted-foreground: hsl(240 3.8% 46.1%);
  --accent: hsl(240 4.8% 95.9%);
  --accent-foreground: hsl(240 5.9% 10%);
  --border: hsl(240 5.9% 90%);
  --input: hsl(240 5.9% 90%);
  --ring: hsl(142 71% 29%);
  --destructive: hsl(0 84% 60%);
  --destructive-foreground: hsl(0 0% 98%);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: hsl(240 10% 3.9%);
    --foreground: hsl(0 0% 98%);
    --card: hsl(240 10% 5.9%);
    --card-foreground: hsl(0 0% 98%);
    --primary: hsl(142 60% 45%);
    --primary-foreground: hsl(240 10% 3.9%);
    --muted: hsl(240 3.7% 15.9%);
    --muted-foreground: hsl(240 5% 64.9%);
    --accent: hsl(240 3.7% 15.9%);
    --accent-foreground: hsl(0 0% 98%);
    --border: hsl(240 3.7% 15.9%);
    --input: hsl(240 3.7% 15.9%);
    --ring: hsl(142 60% 45%);
    --destructive: hsl(0 62% 50%);
    --destructive-foreground: hsl(0 0% 98%);
  }
}

body {
  @apply bg-background text-foreground;
}
```

- [ ] **Step 4: Importáld a stílust a `main.tsx`-ben**

A `src/main.tsx` tetején add hozzá: `import './styles.css';` (ha a generátor `app.css`/`styles.css` importot tett be, cseréld erre).

- [ ] **Step 5: Hozd létre a `cn` utilt (`src/lib/utils.ts`)**

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn class-merge util: feltételes osztályok + Tailwind-konfliktus feloldás. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 6: Hozd létre a `Button`-t (`src/components/ui/button.tsx`)**

```tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline:
          'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-9 px-4 py-2',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
```

- [ ] **Step 7: Hozd létre a `Textarea`-t (`src/components/ui/textarea.tsx`)**

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
```

- [ ] **Step 8: Hozd létre a `Collapsible`-t (`src/components/ui/collapsible.tsx`)**

```tsx
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger;
export const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent;
```

- [ ] **Step 9: Verifikáld a buildet + typecheck**

Run: `pnpm nx run-many -t typecheck build -p frontend`
Expected: PASS (a Tailwind v4 plugin lefordul, nincs típushiba).

- [ ] **Step 10: Commit**

```bash
git add apps/frontend package.json pnpm-lock.yaml
git commit -m "feat(frontend): Tailwind v4 + shadcn primitives (button, textarea, collapsible)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Message types + `toChatMessages` transform

**Files:**

- Create: `apps/frontend/src/lib/ui-message.ts`
- Create: `apps/frontend/src/lib/to-chat-messages.ts`
- Test: `apps/frontend/src/lib/to-chat-messages.spec.ts`

**Interfaces:**

- Consumes: `@plantbase/shared` — `TraceEvent`, `ChatRoute`, `SourceRef`, `ChatMessage`.
- Produces:
  - `type PlantbaseUIMessage = UIMessage<never, { trace: TraceEvent; sources: { route: ChatRoute; sources: SourceRef[] } }>`
  - `toChatMessages(messages: readonly PlantbaseUIMessage[]): ChatMessage[]`

- [ ] **Step 1: Verifikáld a shared-exportokat**

Run: `pnpm nx build shared` majd ellenőrizd, hogy a `@plantbase/shared` exportálja: `TraceEvent`, `ChatRoute`, `SourceRef`, `ChatMessage`.
Run: `grep -E "TraceEvent|ChatRoute|SourceRef|ChatMessage" packages/shared/src/index.ts`
Expected: mind a négy név szerepel (típus-export). Ha valamelyik hiányzik, add hozzá a `packages/shared/src/index.ts`-hez (`export type { ... }`), és külön commitold: `feat(shared): export SourceRef/ChatRoute for frontend`.

- [ ] **Step 2: Hozd létre a UIMessage-típust (`src/lib/ui-message.ts`)**

```ts
import type { UIMessage } from 'ai';
import type { TraceEvent, ChatRoute, SourceRef } from '@plantbase/shared';

/** A backend `data-sources` partjának payloadja. */
export interface SourcesData {
  readonly route: ChatRoute;
  readonly sources: readonly SourceRef[];
}

/**
 * A Plantbase chat UIMessage-típusa. A data partok:
 *  - `data-trace`  → part.data: TraceEvent  (transient; csak onData-ban)
 *  - `data-sources`→ part.data: SourcesData (perzisztens; message.parts-ban)
 */
export type PlantbaseUIMessage = UIMessage<
  never,
  {
    trace: TraceEvent;
    sources: SourcesData;
  }
>;
```

- [ ] **Step 3: Írd meg a bukó tesztet (`src/lib/to-chat-messages.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { toChatMessages } from './to-chat-messages';
import type { PlantbaseUIMessage } from './ui-message';

function msg(
  role: PlantbaseUIMessage['role'],
  parts: PlantbaseUIMessage['parts'],
): PlantbaseUIMessage {
  return { id: 'x', role, parts } as PlantbaseUIMessage;
}

describe('toChatMessages', () => {
  it('egyszerű user+assistant szöveget lapít', () => {
    const out = toChatMessages([
      msg('user', [{ type: 'text', text: 'Szia' }]),
      msg('assistant', [{ type: 'text', text: 'Üdv!' }]),
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'Szia' },
      { role: 'assistant', content: 'Üdv!' },
    ]);
  });

  it('több text partot összefűz', () => {
    const out = toChatMessages([
      msg('assistant', [
        { type: 'text', text: 'A' },
        { type: 'text', text: 'B' },
      ]),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: 'AB' }]);
  });

  it('a nem-text partokat elhagyja', () => {
    const out = toChatMessages([
      msg('assistant', [
        { type: 'text', text: 'Szöveg' },
        { type: 'data-sources', data: { route: 'knowledge', sources: [] } },
      ] as PlantbaseUIMessage['parts']),
    ]);
    expect(out).toEqual([{ role: 'assistant', content: 'Szöveg' }]);
  });

  it('a system role-t kiszűri', () => {
    const out = toChatMessages([
      msg('system' as PlantbaseUIMessage['role'], [
        { type: 'text', text: 'sys' },
      ]),
      msg('user', [{ type: 'text', text: 'Hello' }]),
    ]);
    expect(out).toEqual([{ role: 'user', content: 'Hello' }]);
  });
});
```

- [ ] **Step 4: Futtasd — bukjon**

Run: `pnpm nx test frontend -- to-chat-messages`
Expected: FAIL (`toChatMessages is not defined` / modul nem található).

- [ ] **Step 5: Implementáld (`src/lib/to-chat-messages.ts`)**

```ts
import type { ChatMessage } from '@plantbase/shared';
import type { PlantbaseUIMessage } from './ui-message';

/**
 * A useChat `UIMessage[]`-jét a backend `ChatMessage[]` kontraktusára lapítja:
 * csak user/assistant üzenetek, a content a text partok összefűzése.
 */
export function toChatMessages(
  messages: readonly PlantbaseUIMessage[],
): ChatMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    }));
}
```

- [ ] **Step 6: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- to-chat-messages`
Expected: PASS (mind a 4 teszt).

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/lib
git commit -m "feat(frontend): PlantbaseUIMessage type + toChatMessages transform

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `statusLabel` — trace → magyar stage-címke

**Files:**

- Create: `apps/frontend/src/lib/status-label.ts`
- Test: `apps/frontend/src/lib/status-label.spec.ts`

**Interfaces:**

- Consumes: `@plantbase/shared` — `TraceEvent`.
- Produces: `statusLabel(trace: readonly TraceEvent[]): string`

- [ ] **Step 1: Írd meg a bukó tesztet (`src/lib/status-label.spec.ts`)**

```ts
import { describe, it, expect } from 'vitest';
import { statusLabel } from './status-label';
import type { TraceEvent } from '@plantbase/shared';

describe('statusLabel', () => {
  it('üres trace → általános címke', () => {
    expect(statusLabel([])).toBe('Gondolkodom…');
  });

  it('a legutóbbi ismert stage címkéjét adja', () => {
    const trace: TraceEvent[] = [
      { type: 'router', route: 'knowledge', reasoning: '' },
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.6 },
    ];
    expect(statusLabel(trace)).toBe('Dokumentumok keresése…');
  });

  it('minden ismert stage-hez van magyar címke', () => {
    const cases: [TraceEvent['type'], string][] = [
      ['router', 'Útvonalválasztás…'],
      ['hyde', 'Hipotetikus válasz…'],
      ['retrieval', 'Dokumentumok keresése…'],
      ['rerank', 'Reranking…'],
      ['guardrail', 'Ellenőrzés…'],
      ['answer-start', 'Válasz generálása…'],
    ];
    for (const [type, label] of cases) {
      expect(statusLabel([{ type } as TraceEvent])).toBe(label);
    }
  });

  it('ismeretlen/nem-stage esemény után visszaesik az utolsó ismertre', () => {
    const trace: TraceEvent[] = [
      { type: 'rerank', inputCount: 8, outputCount: 4, degraded: false },
      {
        type: 'usage',
        stage: 'rerank',
        model: 'haiku',
        inputTokens: 1,
        outputTokens: 1,
      },
    ];
    expect(statusLabel(trace)).toBe('Reranking…');
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- status-label`
Expected: FAIL (modul nem található).

- [ ] **Step 3: Implementáld (`src/lib/status-label.ts`)**

```ts
import type { TraceEvent } from '@plantbase/shared';

const STAGE_LABELS: Record<string, string> = {
  router: 'Útvonalválasztás…',
  hyde: 'Hipotetikus válasz…',
  retrieval: 'Dokumentumok keresése…',
  rerank: 'Reranking…',
  guardrail: 'Ellenőrzés…',
  'answer-start': 'Válasz generálása…',
};

/**
 * A legutóbbi ismert pipeline-stage magyar loading-címkéje.
 * Üres trace vagy csak ismeretlen/mellékes esemény (usage/answer-delta/error)
 * esetén az általános „Gondolkodom…"-ot adja (ez a DEBUG=false eset is).
 */
export function statusLabel(trace: readonly TraceEvent[]): string {
  for (let i = trace.length - 1; i >= 0; i--) {
    const label = STAGE_LABELS[trace[i].type];
    if (label) return label;
  }
  return 'Gondolkodom…';
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- status-label`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib
git commit -m "feat(frontend): statusLabel trace-to-Hungarian-stage mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `StatusIndicator` komponens

**Files:**

- Create: `apps/frontend/src/components/status-indicator.tsx`
- Test: `apps/frontend/src/components/status-indicator.spec.tsx`

**Interfaces:**

- Consumes: `statusLabel` (Task 4), `@plantbase/shared` `TraceEvent`.
- Produces: `StatusIndicator` (props: `{ trace: readonly TraceEvent[] }`) — spinner + `statusLabel(trace)` szöveg.

- [ ] **Step 1: Írd meg a bukó tesztet (`src/components/status-indicator.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusIndicator } from './status-indicator';
import type { TraceEvent } from '@plantbase/shared';

describe('StatusIndicator', () => {
  it('üres trace → „Gondolkodom…"', () => {
    render(<StatusIndicator trace={[]} />);
    expect(screen.getByText('Gondolkodom…')).toBeInTheDocument();
  });

  it('retrieval trace → „Dokumentumok keresése…"', () => {
    const trace: TraceEvent[] = [
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.6 },
    ];
    render(<StatusIndicator trace={trace} />);
    expect(screen.getByText('Dokumentumok keresése…')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- status-indicator`
Expected: FAIL (modul nem található).

- [ ] **Step 3: Implementáld (`src/components/status-indicator.tsx`)**

```tsx
import { Loader2 } from 'lucide-react';
import type { TraceEvent } from '@plantbase/shared';
import { statusLabel } from '../lib/status-label';

interface StatusIndicatorProps {
  readonly trace: readonly TraceEvent[];
}

/** Élő loading-visszajelzés: spinner + a legutóbbi stage magyar címkéje. */
export function StatusIndicator({ trace }: StatusIndicatorProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{statusLabel(trace)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- status-indicator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/status-indicator.tsx apps/frontend/src/components/status-indicator.spec.tsx
git commit -m "feat(frontend): StatusIndicator (spinner + live stage label)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `Sources` komponens (citáció-chipek)

**Files:**

- Create: `apps/frontend/src/components/sources.tsx`
- Test: `apps/frontend/src/components/sources.spec.tsx`

**Interfaces:**

- Consumes: `@plantbase/shared` `SourceRef`.
- Produces: `Sources` (props: `{ sources: readonly SourceRef[] }`) — chip-lista; üres → `null`.

- [ ] **Step 1: Írd meg a bukó tesztet (`src/components/sources.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Sources } from './sources';
import type { SourceRef } from '@plantbase/shared';

describe('Sources', () => {
  it('üres forráslista → nem renderel', () => {
    const { container } = render(<Sources sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('URL-es forrás linkként jelenik meg', () => {
    const sources: SourceRef[] = [
      {
        title: 'Pozsgások gondozása',
        sourceUrl: 'https://example.com/pozsgas',
        sourcePath: 'pozsgas.md',
        headingPath: 'Öntözés',
      },
    ];
    render(<Sources sources={sources} />);
    const link = screen.getByRole('link', { name: /Pozsgások gondozása/ });
    expect(link).toHaveAttribute('href', 'https://example.com/pozsgas');
  });

  it('URL nélküli forrás sima chipként jelenik meg (nincs link)', () => {
    const sources: SourceRef[] = [
      {
        title: 'Kaktuszok',
        sourceUrl: null,
        sourcePath: 'kaktusz.md',
        headingPath: null,
      },
    ];
    render(<Sources sources={sources} />);
    expect(screen.getByText(/Kaktuszok/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- sources`
Expected: FAIL.

- [ ] **Step 3: Implementáld (`src/components/sources.tsx`)**

```tsx
import type { SourceRef } from '@plantbase/shared';

interface SourcesProps {
  readonly sources: readonly SourceRef[];
}

function label(s: SourceRef): string {
  return s.headingPath ? `${s.title} — ${s.headingPath}` : s.title;
}

/** A válasz forráshivatkozásai chipekként; URL esetén link. */
export function Sources({ sources }: SourcesProps) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <span className="text-xs text-muted-foreground">Források:</span>
      {sources.map((s, i) =>
        s.sourceUrl ? (
          <a
            key={i}
            href={s.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={s.sourcePath}
            className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs hover:bg-accent"
          >
            {label(s)}
          </a>
        ) : (
          <span
            key={i}
            title={s.sourcePath}
            className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs"
          >
            {label(s)}
          </span>
        ),
      )}
    </div>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- sources`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/sources.tsx apps/frontend/src/components/sources.spec.tsx
git commit -m "feat(frontend): Sources citation chips

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `TracePanel` komponens (összehajtható engine-trace)

**Files:**

- Create: `apps/frontend/src/components/trace-panel.tsx`
- Test: `apps/frontend/src/components/trace-panel.spec.tsx`

**Interfaces:**

- Consumes: `Collapsible*` (Task 2), `@plantbase/shared` `TraceEvent`.
- Produces:
  - `describeTrace(event: TraceEvent): { icon: string; label: string; detail: string }`
  - `TracePanel` (props: `{ trace: readonly TraceEvent[] }`) — üres → `null`; egyébként Collapsible lista.

- [ ] **Step 1: Írd meg a bukó tesztet (`src/components/trace-panel.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TracePanel, describeTrace } from './trace-panel';
import type { TraceEvent } from '@plantbase/shared';

describe('describeTrace', () => {
  it('router eseményt leír', () => {
    const d = describeTrace({
      type: 'router',
      route: 'knowledge',
      reasoning: 'r',
    });
    expect(d.label).toContain('Router');
    expect(d.detail).toContain('knowledge');
  });

  it('retrieval eseményt leír a similarityvel', () => {
    const d = describeTrace({
      type: 'retrieval',
      topK: 8,
      resultCount: 5,
      maxSimilarity: 0.62,
    });
    expect(d.detail).toContain('0.62');
    expect(d.detail).toContain('5');
  });
});

describe('TracePanel', () => {
  it('üres trace → nem renderel', () => {
    const { container } = render(<TracePanel trace={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a stage-eket kilistázza', () => {
    const trace: TraceEvent[] = [
      { type: 'router', route: 'both', reasoning: 'mindkettő' },
      { type: 'retrieval', topK: 8, resultCount: 8, maxSimilarity: 0.7 },
      { type: 'rerank', inputCount: 8, outputCount: 4, degraded: false },
      {
        type: 'guardrail',
        grounded: true,
        maxSimilarity: 0.7,
        threshold: 0.35,
      },
    ];
    render(<TracePanel trace={trace} />);
    expect(screen.getByText(/Router/)).toBeInTheDocument();
    expect(screen.getByText(/Retrieval/)).toBeInTheDocument();
    expect(screen.getByText(/Rerank/)).toBeInTheDocument();
    expect(screen.getByText(/Guardrail/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- trace-panel`
Expected: FAIL.

- [ ] **Step 3: Implementáld (`src/components/trace-panel.tsx`)**

```tsx
import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TraceEvent } from '@plantbase/shared';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './ui/collapsible';

interface TraceDescription {
  readonly icon: string;
  readonly label: string;
  readonly detail: string;
}

/** Egy trace-esemény ember-olvasható leírása a panelhez. */
export function describeTrace(event: TraceEvent): TraceDescription {
  switch (event.type) {
    case 'router':
      return {
        icon: '🧭',
        label: 'Router',
        detail: `útvonal: ${event.route} — ${event.reasoning}`,
      };
    case 'hyde':
      return { icon: '📝', label: 'HyDE', detail: event.hydeDoc };
    case 'retrieval':
      return {
        icon: '🔎',
        label: 'Retrieval',
        detail: `topK=${event.topK}, találat=${event.resultCount}, maxSim=${event.maxSimilarity.toFixed(2)}`,
      };
    case 'rerank':
      return {
        icon: '📊',
        label: 'Rerank',
        detail: `${event.inputCount}→${event.outputCount}${event.degraded ? ' (degradált)' : ''}`,
      };
    case 'guardrail':
      return {
        icon: event.grounded ? '✅' : '⚠️',
        label: 'Guardrail',
        detail: `grounded=${event.grounded}, maxSim=${event.maxSimilarity.toFixed(2)}, küszöb=${event.threshold}`,
      };
    case 'answer-start':
      return { icon: '💬', label: 'Answer', detail: 'válasz-generálás indul' };
    case 'answer-delta':
      return { icon: '💬', label: 'Answer', detail: event.text };
    case 'usage':
      return {
        icon: '🔢',
        label: `Usage (${event.stage})`,
        detail: `${event.model}: in=${event.inputTokens}, out=${event.outputTokens}`,
      };
    case 'error':
      return {
        icon: '❌',
        label: `Error (${event.stage})`,
        detail: event.message,
      };
  }
}

interface TracePanelProps {
  readonly trace: readonly TraceEvent[];
}

/** Összehajtható engine-trace panel (csak ha van trace = DEBUG=true). */
export function TracePanel({ trace }: TracePanelProps) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        engine trace ({trace.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1 space-y-1 border-l border-border pl-3 text-xs">
          {trace.map((event, i) => {
            const d = describeTrace(event);
            return (
              <li key={i} className="flex gap-2">
                <span aria-hidden>{d.icon}</span>
                <span className="font-medium">{d.label}</span>
                <span className="text-muted-foreground break-all">
                  {d.detail}
                </span>
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- trace-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/trace-panel.tsx apps/frontend/src/components/trace-panel.spec.tsx
git commit -m "feat(frontend): collapsible TracePanel (engine-trace visualization)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `MessageBubble` komponens (Markdown + források + trace)

**Files:**

- Create: `apps/frontend/src/components/message-bubble.tsx`
- Test: `apps/frontend/src/components/message-bubble.spec.tsx`

**Interfaces:**

- Consumes: `PlantbaseUIMessage`, `SourcesData` (Task 3), `Sources` (Task 6), `TracePanel` (Task 7), `@plantbase/shared` `TraceEvent`.
- Produces: `MessageBubble` (props: `{ message: PlantbaseUIMessage; trace?: readonly TraceEvent[] }`).

- [ ] **Step 1: Telepítsd a markdown-rendert**

```bash
pnpm add -w react-markdown
```

- [ ] **Step 2: Írd meg a bukó tesztet (`src/components/message-bubble.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './message-bubble';
import type { PlantbaseUIMessage } from '../lib/ui-message';

function msg(
  role: PlantbaseUIMessage['role'],
  parts: PlantbaseUIMessage['parts'],
): PlantbaseUIMessage {
  return { id: 'm1', role, parts } as PlantbaseUIMessage;
}

describe('MessageBubble', () => {
  it('user üzenet szövegét megjeleníti', () => {
    render(
      <MessageBubble
        message={msg('user', [{ type: 'text', text: 'Kérdés?' }])}
      />,
    );
    expect(screen.getByText('Kérdés?')).toBeInTheDocument();
  });

  it('assistant markdown-listát renderel', () => {
    render(
      <MessageBubble
        message={msg('assistant', [{ type: 'text', text: '- egy\n- kettő' }])}
      />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('assistant forrás-chipeket mutat a data-sources partból', () => {
    const message = msg('assistant', [
      { type: 'text', text: 'Válasz' },
      {
        type: 'data-sources',
        data: {
          route: 'knowledge',
          sources: [
            {
              title: 'Cikk',
              sourceUrl: null,
              sourcePath: 'c.md',
              headingPath: null,
            },
          ],
        },
      },
    ] as PlantbaseUIMessage['parts']);
    render(<MessageBubble message={message} />);
    expect(screen.getByText(/Cikk/)).toBeInTheDocument();
  });

  it('assistant trace-panelt mutat, ha kap trace-t', () => {
    render(
      <MessageBubble
        message={msg('assistant', [{ type: 'text', text: 'Válasz' }])}
        trace={[{ type: 'router', route: 'knowledge', reasoning: 'r' }]}
      />,
    );
    expect(screen.getByText(/engine trace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Futtasd — bukjon**

Run: `pnpm nx test frontend -- message-bubble`
Expected: FAIL.

- [ ] **Step 4: Implementáld (`src/components/message-bubble.tsx`)**

```tsx
import Markdown from 'react-markdown';
import type { TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage, SourcesData } from '../lib/ui-message';
import { Sources } from './sources';
import { TracePanel } from './trace-panel';

interface MessageBubbleProps {
  readonly message: PlantbaseUIMessage;
  readonly trace?: readonly TraceEvent[];
}

function textOf(message: PlantbaseUIMessage): string {
  return message.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');
}

function sourcesOf(message: PlantbaseUIMessage): SourcesData | undefined {
  const part = message.parts.find((p) => p.type === 'data-sources');
  return part ? (part as { data: SourcesData }).data : undefined;
}

/** Egy chat-üzenet buborék: user = sima szöveg, assistant = markdown + források + trace. */
export function MessageBubble({ message, trace }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const text = textOf(message);
  const sources = sourcesOf(message);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{text}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <Markdown>{text}</Markdown>
          </div>
        )}
        {!isUser && sources && <Sources sources={sources.sources} />}
        {!isUser && trace && <TracePanel trace={trace} />}
      </div>
    </div>
  );
}
```

> Megjegyzés: a `prose` osztályok a `@tailwindcss/typography` nélkül csak no-opok — ez elfogadható (a markdown akkor is olvasható). Ha a reviewer kéri, külön follow-up telepítheti a typography plugint; NEM ennek a tasknak a scope-ja.

- [ ] **Step 5: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- message-bubble`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/message-bubble.tsx apps/frontend/src/components/message-bubble.spec.tsx package.json pnpm-lock.yaml
git commit -m "feat(frontend): MessageBubble (markdown + sources + trace)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `MessageList` komponens

**Files:**

- Create: `apps/frontend/src/components/message-list.tsx`
- Test: `apps/frontend/src/components/message-list.spec.tsx`

**Interfaces:**

- Consumes: `MessageBubble` (Task 8), `PlantbaseUIMessage`, `@plantbase/shared` `TraceEvent`.
- Produces: `MessageList` (props: `{ messages: readonly PlantbaseUIMessage[]; traces: Readonly<Record<string, TraceEvent[]>> }`) — üzenetenként `MessageBubble`, az assistant-üzenethez a `traces[message.id]`-t adja.

- [ ] **Step 1: Írd meg a bukó tesztet (`src/components/message-list.spec.tsx`)**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageList } from './message-list';
import type { PlantbaseUIMessage } from '../lib/ui-message';

describe('MessageList', () => {
  it('minden üzenetet kirenderel', () => {
    const messages = [
      { id: 'a', role: 'user', parts: [{ type: 'text', text: 'Kérdés' }] },
      { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'Válasz' }] },
    ] as PlantbaseUIMessage[];
    render(<MessageList messages={messages} traces={{}} />);
    expect(screen.getByText('Kérdés')).toBeInTheDocument();
    expect(screen.getByText('Válasz')).toBeInTheDocument();
  });

  it('az assistant-üzenethez a hozzá tartozó trace-t adja', () => {
    const messages = [
      { id: 'b', role: 'assistant', parts: [{ type: 'text', text: 'Válasz' }] },
    ] as PlantbaseUIMessage[];
    render(
      <MessageList
        messages={messages}
        traces={{ b: [{ type: 'router', route: 'knowledge', reasoning: 'r' }] }}
      />,
    );
    expect(screen.getByText(/engine trace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- message-list`
Expected: FAIL.

- [ ] **Step 3: Implementáld (`src/components/message-list.tsx`)**

```tsx
import type { TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage } from '../lib/ui-message';
import { MessageBubble } from './message-bubble';

interface MessageListProps {
  readonly messages: readonly PlantbaseUIMessage[];
  readonly traces: Readonly<Record<string, TraceEvent[]>>;
}

/** A beszélgetés üzenetlistája; az assistant-üzenetekhez trace-t köt id alapján. */
export function MessageList({ messages, traces }: MessageListProps) {
  return (
    <div className="flex flex-col gap-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          trace={traces[message.id]}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- message-list`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/message-list.tsx apps/frontend/src/components/message-list.spec.tsx
git commit -m "feat(frontend): MessageList (binds trace to assistant messages)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `ChatView` — useChat integráció (transport, trace-akkumuláció, error)

**Files:**

- Create: `apps/frontend/src/components/chat-view.tsx`
- Test: `apps/frontend/src/components/chat-view.spec.tsx`

**Interfaces:**

- Consumes: `useChat` (`@ai-sdk/react`), `DefaultChatTransport` (`ai`), `toChatMessages` (Task 3), `PlantbaseUIMessage` (Task 3), `MessageList` (Task 9), `StatusIndicator` (Task 5), `Button`/`Textarea` (Task 2), `@plantbase/shared` `TraceEvent`.
- Produces: `ChatView` (nincs prop) — a teljes chat-oldal.

A trace-akkumuláció logikája (a plan magja): a `data-trace` transient, ezért az `onData` callbacken gyűjtjük egy `useRef` bufferbe (+ `useState` a StatusIndicator élő frissítéséhez). Az `onFinish({ message })` a kész assistant-üzenet `id`-jéhez rendeli a buffert a `traces` map-ben. Új submitkor a buffer nullázódik.

- [ ] **Step 1: Írd meg a bukó tesztet (`src/components/chat-view.spec.tsx`)**

A `@ai-sdk/react`-et mockoljuk, hogy vezérelt `useChat`-visszatérést adjon, és elkapjuk az átadott opciókat (`onData`/`onFinish`) a trace-logika teszteléséhez — hálózat nélkül.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PlantbaseUIMessage } from '../lib/ui-message';

interface FakeChat {
  messages: PlantbaseUIMessage[];
  status: 'ready' | 'submitted' | 'streaming' | 'error';
  error?: Error;
  sendMessage: ReturnType<typeof vi.fn>;
  setMessages: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
}

let fake: FakeChat;
let capturedOptions: any;

vi.mock('@ai-sdk/react', () => ({
  useChat: (opts: unknown) => {
    capturedOptions = opts;
    return fake;
  },
}));

// A DefaultChatTransport-ot no-opként mockoljuk (a valós hálózatot nem hívjuk).
vi.mock('ai', () => ({
  DefaultChatTransport: class {
    constructor(public config: unknown) {}
  },
}));

import { ChatView } from './chat-view';

describe('ChatView', () => {
  beforeEach(() => {
    fake = {
      messages: [],
      status: 'ready',
      sendMessage: vi.fn(),
      setMessages: vi.fn(),
      regenerate: vi.fn(),
    };
    capturedOptions = undefined;
  });

  it('submit → sendMessage a beírt szöveggel', () => {
    render(<ChatView />);
    const input = screen.getByPlaceholderText(/Kérdezz/i);
    fireEvent.change(input, { target: { value: 'Hány pozsgás van?' } });
    fireEvent.submit(input.closest('form')!);
    expect(fake.sendMessage).toHaveBeenCalledWith({
      text: 'Hány pozsgás van?',
    });
  });

  it('streaming státuszban megjelenik a StatusIndicator', () => {
    fake.status = 'streaming';
    render(<ChatView />);
    expect(
      screen.getByText(
        /Gondolkodom…|keresése|Reranking|generálása|Útvonal|Hipotetikus|Ellenőrzés/,
      ),
    ).toBeInTheDocument();
  });

  it('error státuszban hibabanner jelenik meg', () => {
    fake.status = 'error';
    fake.error = new Error('Valami elromlott');
    render(<ChatView />);
    expect(screen.getByRole('alert')).toHaveTextContent('Valami elromlott');
  });

  it('onData(data-trace) → onFinish után a trace az üzenethez kötődik', () => {
    const { rerender } = render(<ChatView />);
    act(() => {
      capturedOptions.onData({
        type: 'data-trace',
        data: { type: 'router', route: 'knowledge', reasoning: 'r' },
      });
      capturedOptions.onFinish({
        message: {
          id: 'asszisztens-1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'Válasz' }],
        },
      });
    });
    fake.messages = [
      {
        id: 'asszisztens-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Válasz' }],
      },
    ] as PlantbaseUIMessage[];
    rerender(<ChatView />);
    expect(screen.getByText(/engine trace/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Futtasd — bukjon**

Run: `pnpm nx test frontend -- chat-view`
Expected: FAIL (modul nem található).

- [ ] **Step 3: Implementáld (`src/components/chat-view.tsx`)**

```tsx
import { useRef, useState, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { TraceEvent } from '@plantbase/shared';
import type { PlantbaseUIMessage } from '../lib/ui-message';
import { toChatMessages } from '../lib/to-chat-messages';
import { MessageList } from './message-list';
import { StatusIndicator } from './status-indicator';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

const transport = new DefaultChatTransport<PlantbaseUIMessage>({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ messages }) => ({
    body: { messages: toChatMessages(messages) },
  }),
});

/** A teljes chat-oldal: input, üzenetlista, élő státusz, hibabanner. */
export function ChatView() {
  const [input, setInput] = useState('');
  const [traces, setTraces] = useState<Record<string, TraceEvent[]>>({});
  const [liveTrace, setLiveTrace] = useState<TraceEvent[]>([]);
  const liveTraceRef = useRef<TraceEvent[]>([]);

  const { messages, sendMessage, status, error, setMessages } =
    useChat<PlantbaseUIMessage>({
      transport,
      onData: (dataPart) => {
        if (dataPart.type === 'data-trace') {
          liveTraceRef.current = [...liveTraceRef.current, dataPart.data];
          setLiveTrace(liveTraceRef.current);
        }
      },
      onFinish: ({ message }) => {
        const captured = liveTraceRef.current;
        if (captured.length > 0) {
          setTraces((prev) => ({ ...prev, [message.id]: captured }));
        }
      },
    });

  const busy = status === 'submitted' || status === 'streaming';

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    liveTraceRef.current = [];
    setLiveTrace([]);
    sendMessage({ text });
    setInput('');
  }

  function handleReset() {
    setMessages([]);
    setTraces({});
    liveTraceRef.current = [];
    setLiveTrace([]);
  }

  return (
    <div className="mx-auto flex h-screen max-w-3xl flex-col p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Plantbase</h1>
        <Button variant="ghost" size="default" onClick={handleReset}>
          Új beszélgetés
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} traces={traces} />
        {busy && (
          <div className="mt-4">
            <StatusIndicator trace={liveTrace} />
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
          placeholder="Kérdezz a növényekről…"
          disabled={busy}
          rows={2}
        />
        <Button type="submit" disabled={busy || input.trim() === ''}>
          Küldés
        </Button>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Futtasd — passzoljon**

Run: `pnpm nx test frontend -- chat-view`
Expected: PASS (mind a 4 teszt).

- [ ] **Step 5: Futtasd az összes frontend-tesztet + typecheck**

Run: `pnpm nx run-many -t test typecheck -p frontend`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/chat-view.tsx apps/frontend/src/components/chat-view.spec.tsx
git commit -m "feat(frontend): ChatView with useChat, transient trace accumulation, error banner

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: App-beépítés, live e2e verifikáció, dokumentáció

**Files:**

- Modify: `apps/frontend/src/main.tsx` (render `<ChatView />`)
- Delete/replace: `apps/frontend/src/app/app.tsx` + `nx-welcome` (a scaffold default)
- Modify: `CLAUDE.md` (frontend-parancsok), `docs/rag/roadmap.md` (SP4 státusz)

**Interfaces:**

- Consumes: `ChatView` (Task 10).
- Produces: futtatható frontend (`pnpm nx serve frontend`).

- [ ] **Step 1: Kösd be a `ChatView`-t a belépőbe**

A `src/main.tsx` rendereljen `<ChatView />`-t a `#root`-ba (StrictMode-ban). Töröld a scaffold `app/` mappáját és a `nx-welcome` komponenst, ha a generátor létrehozta. Példa `main.tsx`:

```tsx
import { StrictMode } from 'react';
import * as ReactDOM from 'react-dom/client';
import './styles.css';
import { ChatView } from './components/chat-view';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement,
);
root.render(
  <StrictMode>
    <ChatView />
  </StrictMode>,
);
```

- [ ] **Step 2: Verifikáld a buildet + a teljes teszt/typecheck-et**

Run: `pnpm nx run-many -t test typecheck build -p frontend`
Expected: PASS.

- [ ] **Step 3: Live e2e — DEBUG=true a backenddel**

Indítsd a stacket (két terminál vagy háttér):

```bash
# 1) backend DEBUG módban (valós DB + LLM kell)
DEBUG=true pnpm nx serve backend
# 2) frontend
pnpm nx serve frontend
```

Nyisd meg a `http://localhost:4200`-t, és ellenőrizd manuálisan (a superpowers:verification-before-completion szellemében — evidence, ne feltételezés):

- Tudás-kérdés (pl. „Hogyan gondozzam a pozsgásokat?") → streamel a válasz, alatta **források**, és az **engine trace** panel kinyitható (router→…→guardrail).
- Katalógus-kérdés (pl. „Mennyibe kerül a legolcsóbb pozsgás?") → streamel a válasz.
- Follow-up (pl. „És a locsolása?") → a history-tudatos válasz koherens.
- Streaming közben a **StatusIndicator** stage-címkéket vált (DEBUG=true).

Jegyezd fel a tényleges megfigyelést (mi jelent meg). Ha bármi nem streamel / a trace nem jön: állítsd meg és debuggolj (systematic-debugging), ne jelentsd késznek.

- [ ] **Step 4: Live e2e — DEBUG=false (általános spinner)**

Indítsd a backendet `DEBUG` nélkül (`pnpm nx serve backend`), a frontendet újra. Ellenőrizd: a válasz streamel, a StatusIndicator „Gondolkodom…"-ot mutat, és **nincs** trace-panel (data-trace nem érkezik). Rögzítsd a megfigyelést.

- [ ] **Step 5: Frissítsd a dokumentációt**

A `CLAUDE.md` „Gyakori parancsok" szekciójába vedd fel az SP4-et:

```bash
# Frontend (SP4: React + shadcn/ui streaming chat, DEBUG engine-trace panel):
pnpm nx serve frontend            # Vite dev server (4200), /api proxy → backend (3000)
#   Fusson a backend is: (DEBUG=true) pnpm nx serve backend
```

A `docs/rag/roadmap.md` SP4-szekcióját állítsd `✅ KÉSZ`-re a rövid összefoglalóval (React + Vite + Tailwind v4 + shadcn primitívek, useChat + custom transport, transient-trace akkumuláció, két mód, live e2e zöld).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/main.tsx CLAUDE.md docs/rag/roadmap.md
git rm -r --ignore-unmatch apps/frontend/src/app
git commit -m "feat(frontend): wire ChatView entrypoint; docs for SP4

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 7: Teljes workspace-verifikáció (a main zöld marad)**

Run: `pnpm nx run-many -t test typecheck build`
Expected: minden projekt PASS.

---

## Self-Review (a terv írója végezte)

**Spec-lefedettség:**

- Új Nx React+Vite app → Task 1. ✅
- Tailwind + shadcn/ui kész komponensek → Task 2. ✅
- Multi-turn + Reset → Task 10 (`ChatView`, teljes history a transportban, `handleReset`). ✅
- Wire-seam (`prepareSendMessagesRequest` + `toChatMessages`) → Task 3 + Task 10. ✅
- Források (`data-sources` → chipek) → Task 6 + Task 8. ✅
- Engine-trace panel (transient `data-trace` → `onData` → akkumuláció) → Task 7 + Task 10. ✅
- Két mód (DEBUG on/off) → `statusLabel` fallback (Task 4) + live e2e (Task 11 Step 3–4). ✅
- Error/loading (`status`, `onError`/`error`) → Task 5 + Task 10. ✅
- Tesztek (Vitest + RTL, hálózat nélkül) → minden komponens-task + Task 10 mockolt useChat. ✅

**Placeholder-scan:** nincs TBD/TODO; minden lépés valós kódot/parancsot tartalmaz. Az egyetlen tudatosan CLI-vezérelt lépés a scaffold (Task 1) az `nx-generate` skillen át — a „NEVER guess CLI flags" konvenció miatt szándékos, nem placeholder.

**Típus-konzisztencia:** `PlantbaseUIMessage`/`SourcesData` (Task 3) végig egységes; `toChatMessages`/`statusLabel`/`describeTrace` szignatúrák a fogyasztó taskokban egyeznek; a `traces: Record<string, TraceEvent[]>` alak Task 9-ben és Task 10-ben azonos; a `TraceEvent` mezők (Task 7 `describeTrace`) a shared `traceEventSchema`-val egyeznek (router.reasoning, retrieval.maxSimilarity, rerank.degraded, guardrail.grounded/threshold, usage.stage/model/tokens, error.stage/message).
