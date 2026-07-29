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
