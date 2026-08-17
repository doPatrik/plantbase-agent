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
  stop: ReturnType<typeof vi.fn>;
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
      stop: vi.fn(),
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

  it('streaming státuszban a reset gomb le van tiltva', () => {
    fake.status = 'streaming';
    render(<ChatView />);
    expect(
      screen.getByRole('button', { name: /Új beszélgetés/ }),
    ).toBeDisabled();
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

  it('customer variant esetén ügyfél-copy-t mutat', () => {
    render(<ChatView variant="customer" />);
    expect(
      screen.getByRole('heading', {
        name: /Plantbase — kérdezz a növényedről/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/Milyen növényt vegyek/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Új kérdés/i }),
    ).toBeInTheDocument();
  });

  it('customer variant: streaming közben NEM jelenik meg a StatusIndicator', () => {
    fake.status = 'streaming';
    render(<ChatView variant="customer" />);
    expect(
      screen.queryByText(
        /Gondolkodom…|keresése|Reranking|generálása|Útvonal|Hipotetikus|Ellenőrzés/,
      ),
    ).not.toBeInTheDocument();
  });

  it('customer variant: onData(data-trace) → onFinish után SEM jelenik meg az engine trace', () => {
    const { rerender } = render(<ChatView variant="customer" />);
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
    rerender(<ChatView variant="customer" />);
    expect(screen.queryByText(/engine trace/)).not.toBeInTheDocument();
  });

  it('internal (alapértelmezett) variant a megszokott copy-t mutatja', () => {
    render(<ChatView />);
    expect(
      screen.getByRole('heading', { name: /^Plantbase$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Új beszélgetés/i }),
    ).toBeInTheDocument();
  });
});
