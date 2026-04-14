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

function yesterdayIso(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function loadStrategy(): Promise<string> {
  return readFile(strategyPath, 'utf8');
}

describeIfToken('integration: backtest BTC/USDT on binance (yesterday)', () => {
  it('completes compile → prepare → execute and returns a ResultMap', async () => {
    const qts = new QTSurfer({ baseUrl, token });
    const strategy = await loadStrategy();
    const day = yesterdayIso();

    const stages: string[] = [];
    const result = await qts.backtest(
      {
        strategy,
        exchangeId: 'binance',
        instrument: 'BTC/USDT',
        from: day,
        to: day,
      },
      {
        onProgress: (p) => {
          const label = p.percent !== undefined ? `${p.stage} ${p.percent.toFixed(1)}%` : p.stage;
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
  });
});

if (!token) {
  // Emit a visible skip notice in CI logs
  // eslint-disable-next-line no-console
  console.log(
    '[integration] JWT_API_TOKEN not set — skipping integration suite. Run with `JWT_API_TOKEN=... npm run test:integration`',
  );
}
