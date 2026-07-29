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
