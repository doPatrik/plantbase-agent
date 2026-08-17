import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App } from './app';

describe('App', () => {
  it('alapból a Chat nézetet mutatja', () => {
    render(<App />);
    expect(screen.getByPlaceholderText(/Kérdezz/i)).toBeInTheDocument();
  });

  it('a Költség-becslő gombra kattintva átvált a költség-becslő nézetre', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Költség-becslő/i }));
    expect(
      screen.getByRole('heading', { name: /Költség-becslő/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Küldés/i }),
    ).not.toBeInTheDocument();
  });

  it('vissza lehet váltani Chat nézetre', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Költség-becslő/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Chat$/i }));
    expect(screen.getByPlaceholderText(/Kérdezz/i)).toBeInTheDocument();
  });

  it('az Ügyfélchat gombra kattintva átvált az ügyfél-chatre', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Ügyfélchat/i }));
    expect(
      screen.getByRole('heading', {
        name: /Plantbase — kérdezz a növényedről/i,
      }),
    ).toBeInTheDocument();
  });

  it('a Support gombra kattintva átvált az eszkalációs nézetre', () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => [],
    })) as unknown as typeof fetch;
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^Support$/i }));
    expect(
      screen.getByRole('heading', { name: /Support — eszkalációs jegyek/i }),
    ).toBeInTheDocument();
  });
});
