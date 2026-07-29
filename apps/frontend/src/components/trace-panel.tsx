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
