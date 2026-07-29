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
