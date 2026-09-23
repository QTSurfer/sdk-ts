import { Centrifuge } from 'centrifuge';
import {
  getLive as apiGetLive,
  getLiveRunSignals as apiGetLiveRunSignals,
  listPublicLive as apiListPublicLive,
  mintLiveConnectionToken,
  startLive as apiStartLive,
  stopLive as apiStopLive,
  updateLive as apiUpdateLive,
  updateLiveParams as apiUpdateLiveParams,
  type LiveRun,
  type LiveRunCompact,
  type LiveParamsUpdateResult,
  type LiveSignal,
  type LiveSignalPage,
  type PublicLiveListResponse,
  type StartLiveRequest,
  type UpdateLiveParamsRequest,
  type UpdateLiveRequest,
} from '@qtsurfer/api-client';
import { QTSError } from './errors';
import { requestFailed } from './internal/requestError';

/** Default Centrifugo endpoint for the QTSurfer staging API. */
export const DEFAULT_LIVE_URL = 'wss://rt.qtsurfer.net/connection/websocket';

/** Callbacks for one live run's signal channel. */
export interface LiveConnectionOptions {
  /** Override the Centrifugo endpoint, for example in an integration test. */
  url?: string;
  /** Called for every signal published while the subscription is active. */
  onSignal: (signal: LiveSignal) => void;
  /** Called when Centrifugo reports an asynchronous transport error. */
  onError?: (error: unknown) => void;
}

/** Thrown when a recorded-signal cursor fell behind the server's retention window. */
export class LiveSignalCursorExpiredError extends QTSError {}

/** Start the compiled strategy's single live run. */
export async function startLive(strategyId: string, request: StartLiveRequest): Promise<LiveRun> {
  const { data, error, response } = await apiStartLive({ path: { strategyId }, body: request });
  if (error) throw requestFailed('start live call', error, response?.status);
  if (!data) throw new QTSError('Empty start-live response');
  return data;
}

/** Read a strategy's current live run. */
export async function getLive(strategyId: string): Promise<LiveRun> {
  const { data, error, response } = await apiGetLive({ path: { strategyId } });
  if (error) throw requestFailed('get live call', error, response?.status);
  if (!data) throw new QTSError('Empty get-live response');
  return data;
}

/** Stop a strategy's active live run. */
export async function stopLive(strategyId: string): Promise<LiveRun> {
  const { data, error, response } = await apiStopLive({ path: { strategyId } });
  if (error) throw requestFailed('stop live call', error, response?.status);
  if (!data) throw new QTSError('Empty stop-live response');
  return data;
}

/** List publicly visible live runs. */
export async function listPublicLive(query?: { cursor?: string; limit?: number }): Promise<PublicLiveListResponse> {
  const { data, error, response } = await apiListPublicLive({ query });
  if (error) throw requestFailed('list public live call', error, response?.status);
  if (!data) throw new QTSError('Empty public-live response');
  return data;
}

/** Change mutable run metadata such as visibility. */
export async function updateLive(runId: string, request: UpdateLiveRequest): Promise<LiveRunCompact> {
  const { data, error, response } = await apiUpdateLive({ path: { runId }, body: request });
  if (error) throw requestFailed('update live call', error, response?.status);
  if (!data) throw new QTSError('Empty update-live response');
  return data;
}

/** Update parameters through REST when a real-time connection is not needed. */
export async function updateLiveParams(
  runId: string,
  request: UpdateLiveParamsRequest,
): Promise<LiveParamsUpdateResult> {
  const { data, error, response } = await apiUpdateLiveParams({ path: { runId }, body: request });
  if (error) throw requestFailed('update live parameters call', error, response?.status);
  if (!data) throw new QTSError('Empty update-live-parameters response');
  return data;
}

/** Read retained signals, restarting without a cursor when it has expired. */
export async function getLiveSignals(
  runId: string,
  query?: { cursor?: string; instrument?: string; limit?: number; sinceMs?: number },
): Promise<LiveSignalPage> {
  const { data, error, response } = await apiGetLiveRunSignals({ path: { runId }, query });
  if (response?.status === 410) {
    throw new LiveSignalCursorExpiredError('Live signal cursor expired; restart without cursor from availableSinceMs.');
  }
  if (error) throw requestFailed('get live signals call', error, response?.status);
  if (!data) throw new QTSError('Empty live-signals response');
  return data;
}

/**
 * A managed connection to one Live Execution signal channel.
 *
 * The official Centrifugo client handles reconnects, pings and token-refresh
 * scheduling. This wrapper supplies fresh QTSurfer connection tokens and maps
 * the QTSurfer channel and RPC contracts to typed SDK methods.
 */
export class LiveConnection {
  private constructor(
    private readonly centrifuge: Centrifuge,
    private readonly runId: string,
  ) {}

  /** Connect and subscribe to `sig:<runId>`. */
  static async connect(runId: string, options: LiveConnectionOptions): Promise<LiveConnection> {
    const token = await mintToken();
    const centrifuge = new Centrifuge(options.url ?? DEFAULT_LIVE_URL, {
      token,
      getToken: mintToken,
    });
    centrifuge.on('error', (context) => options.onError?.(context));

    const subscription = centrifuge.newSubscription(`sig:${runId}`);
    subscription.on('publication', (context) => {
      options.onSignal(context.data as LiveSignal);
    });
    subscription.on('unsubscribed', (context) => options.onError?.(context));

    centrifuge.connect();
    await centrifuge.ready();
    subscription.subscribe();
    await subscription.ready();
    return new LiveConnection(centrifuge, runId);
  }

  /** Update this run's parameters through the `live.params` WebSocket RPC. */
  async updateParams(params: Record<string, string>): Promise<LiveParamsUpdateResult> {
    const result = await this.centrifuge.rpc('live.params', { runId: this.runId, params });
    return result.data as LiveParamsUpdateResult;
  }

  /** Stop reconnecting and close the WebSocket. */
  disconnect(): void {
    this.centrifuge.disconnect();
  }
}

async function mintToken(): Promise<string> {
  const { data, error, response } = await mintLiveConnectionToken();
  if (error) throw requestFailed('live connection-token call', error, response?.status);
  if (!data) throw new QTSError('Empty live connection-token response');
  return data.token;
}
