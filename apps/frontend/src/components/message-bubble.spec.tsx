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
