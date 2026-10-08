import { cleanup, render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { loadLabel, pounds } from './pound-display';
import { LocalDateTime } from './LocalDateTime';

afterEach(cleanup);

it.each([['0.000000', '0'], ['50.125000', '50.125'], ['50.000000', '50'],
  ['0.000001', '0.000001']])('formats %s without changing its stored/input spelling',
  (value, display) => {
    const measurement = { kind: 'externalLoad' as const, value, unit: 'lb' as const,
      convention: 'machinePlatesPerArm' as const, zeroMeaning: 'validZero' as const };
    expect(loadLabel(measurement)).toBe(`${display} lb plates added per arm`);
    expect(measurement.value).toBe(value);
    expect(pounds(value, 'lb')).toBe(value);
  });

it('renders UTC on the server, local time after mount and retains exact timestamps', () => {
  const value = '2026-10-08T13:45:00.000Z';
  const html = renderToString(<LocalDateTime value={value} />);
  expect(html).toContain(new Date(value).toUTCString());
  expect(new DOMParser().parseFromString(html, 'text/html')
    .querySelector('time')?.getAttribute('datetime')).toBe(value);
  const view = render(<LocalDateTime value={value} />);
  expect(screen.getByText(new Date(value).toLocaleString())).toHaveAttribute('datetime', value);
  const next = '2026-10-09T02:15:00.000Z';
  view.rerender(<LocalDateTime value={next} />);
  expect(screen.getByText(new Date(next).toLocaleString())).toHaveAttribute('datetime', next);
});
