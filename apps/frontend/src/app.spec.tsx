import { describe, it, expect } from 'vitest';
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
});
