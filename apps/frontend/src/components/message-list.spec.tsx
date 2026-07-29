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
