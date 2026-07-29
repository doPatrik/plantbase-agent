import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CostEstimatorView } from './cost-estimator-view';
import type { CostEstimate } from '@plantbase/shared';

const estimate: CostEstimate = {
  query: 'Hogyan öntözzem a pozsgást?',
  route: 'knowledge',
  stages: [
    {
      stage: 'router',
      model: 'claude-haiku-4-5',
      inputTokens: 1_000_000,
      outputTokens: 0,
    },
    {
      stage: 'answer',
      model: 'claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 1_000_000,
    },
  ],
  defaultPrices: {
    'claude-haiku-4-5': { inputPerM: 1, outputPerM: 5 },
    'claude-sonnet-4-6': { inputPerM: 3, outputPerM: 15 },
  },
};

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => estimate,
  })) as unknown as typeof fetch;
});

describe('CostEstimatorView', () => {
  it('Becslés gombra a /api/debug/cost-ot hívja és táblázatot renderel', async () => {
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'Hogyan öntözzem a pozsgást?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));

    await waitFor(() => expect(screen.getByText('router')).toBeInTheDocument());
    expect(fetch).toHaveBeenCalledWith(
      '/api/debug/cost',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(screen.getByText('answer')).toBeInTheDocument();
    // router: 1M input * $1/1M = $1.00
    expect(screen.getByText('1.000000 USD')).toBeInTheDocument();
  });

  it('az ár-mező szerkesztésére élőben újraszámol', async () => {
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'kérdés' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));
    await waitFor(() => expect(screen.getByText('router')).toBeInTheDocument());

    const inputPriceFields = screen.getAllByLabelText(/input \$\/1M/i);
    fireEvent.change(inputPriceFields[0], { target: { value: '2' } });

    // router: 1M input * $2/1M = $2.00 (a végösszeg is frissül: 2 + 15 = 17)
    await waitFor(() =>
      expect(screen.getByText('17.000000 USD')).toBeInTheDocument(),
    );
  });

  it('hibaüzenetet mutat, ha a hívás elbukik', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: 'OPENAI_API_KEY hiányzik vagy üres.' }),
    })) as unknown as typeof fetch;
    render(<CostEstimatorView />);
    fireEvent.change(screen.getByPlaceholderText(/Kérdezz/i), {
      target: { value: 'kérdés' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Becslés/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/OPENAI_API_KEY/),
    );
  });
});
