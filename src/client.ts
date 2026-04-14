import { client as apiClient } from '@qtsurfer/api-client';
import {
  backtest,
  type BacktestOptions,
  type BacktestRequest,
  type BacktestResult,
} from './workflows/backtest';

export interface QTSurferOptions {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export class QTSurfer {
  constructor(options: QTSurferOptions) {
    apiClient.setConfig({
      baseUrl: options.baseUrl,
      ...(options.token
        ? { headers: { Authorization: `Bearer ${options.token}` } }
        : {}),
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  backtest(req: BacktestRequest, opts?: BacktestOptions): Promise<BacktestResult> {
    return backtest(req, opts);
  }

  // Future surface:
  //   strategies: { compile, status, list }
  //   instruments: { list, get } with TTL cache
  //   jobs: { cancel, stream, result }
}
