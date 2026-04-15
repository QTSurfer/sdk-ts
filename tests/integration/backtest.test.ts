import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { QTSurfer } from '../../src/index';

const token = process.env.JWT_API_TOKEN;
const baseUrl = process.env.QTSURFER_API_URL ?? 'https://api.staging.qtsurfer.com/v1';
const strategyPath =
  process.env.QTSURFER_TEST_STRATEGY ??
  resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/ForcedTradeStrategy.java');

const describeIfToken = token ? describe : describe.skip;
const verbose = process.env.QTSURFER_TEST_VERBOSE === '1' || process.env.QTSURFER_TEST_VERBOSE === 'true';
const log = (...args: unknown[]) => {
  if (verbose) console.log(...args);
};

function dayStartIso(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString();
}

async function loadStrategy(): Promise<string> {
  return readFile(strategyPath, 'utf8');
}

describeIfToken('integration: backtest BTC/USDT on binance (yesterday)', () => {
  it('completes compile → prepare → execute and returns a ResultMap', async () => {
    const qts = new QTSurfer({ baseUrl, token });
    const strategy = await loadStrategy();
    const from = dayStartIso(1); // yesterday 00:00 UTC
    const to = dayStartIso(0); // today 00:00 UTC (24h window)

    const stages: string[] = [];
    const result = await qts.backtest(
      {
        strategy,
        exchangeId: 'binance',
        instrument: 'BTC/USDT',
        from,
        to,
      },
      {
        onProgress: (p) => {
          const label = p.percent !== undefined ? `${p.stage} ${p.percent.toFixed(1)}%` : p.stage;
          log(`Progress: ${label}`);
          if (stages.at(-1) !== label) stages.push(label);
        },
        pollIntervalMs: 500,
        maxPollIntervalMs: 3000,
        timeoutMs: 5 * 60 * 1000,
      },
    );

    expect(result).toBeDefined();
    expect(result.strategyId).toBeTruthy();
    expect(result.instrument).toBe('BTC/USDT');
    expect(stages.some((s) => s.startsWith('compiling'))).toBe(true);
    expect(stages.some((s) => s.startsWith('preparing'))).toBe(true);
    expect(stages.some((s) => s.startsWith('executing'))).toBe(true);
    log('Result:', JSON.stringify(result, null, 2));
  });
});

if (!token) {
  // Emit a visible skip notice in CI logs
  // eslint-disable-next-line no-console
  console.log(
    '[integration] JWT_API_TOKEN not set — skipping integration suite. Run with `JWT_API_TOKEN=... npm run test:integration`',
  );
}
