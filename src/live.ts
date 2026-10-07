import { Centrifuge, type Subscription } from 'centrifuge';
import {
  getLive as apiGetLive,
  getLiveRun as apiGetLiveRun,
  getLiveRunPaper as apiGetLiveRunPaper,
  getLiveRunPaperEquity as apiGetLiveRunPaperEquity,
  getLiveRunSignals as apiGetLiveRunSignals,
  sendLiveCommand as apiSendLiveCommand,
  listPublicLive as apiListPublicLive,
  listLive as apiListLive,
  mintLiveConnectionToken,
  startLive as apiStartLive,
  stopLive as apiStopLive,
  updateLive as apiUpdateLive,
  updateLiveParams as apiUpdateLiveParams,
  rotateLiveStream as apiRotateLiveStream,
  revokeLiveStream as apiRevokeLiveStream,
  type LiveRun,
  type LiveRunDetail,
  type LiveRunWithStream,
  type LiveRunCompact,
  type LiveCommandResult,
  type LiveParamsUpdateResult,
  type LiveSignal,
  type LiveSignalPage,
  type LivePaper,
  type LivePaperEquityPage,
  type LiveStreamRevoked,
  type LiveStreamUrl,
  type LiveListResponse,
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
  /** Called for every signal published while subscribed; offset is present when history is enabled. */
  onSignal: (signal: LiveSignal, offset?: number) => void;
  /** Called when Centrifugo reports an asynchronous transport error. */
  onError?: (error: unknown) => void;
}

/** Thrown when a recorded-signal cursor fell behind the server's retention window. */
export class LiveSignalCursorExpiredError extends QTSError {}

/** Command text and optional strategy-defined values delivered to each execution. */
export interface LiveCommandRequest {
  command: string;
  properties?: Record<string, unknown>;
}

/** Position within the retained WebSocket signal stream. */
export interface LiveSignalHistoryPosition {
  offset: number;
  epoch: string;
}

/** One retained signal with the offset it carried when published. */
export interface LiveSignalHistoryEntry {
  data: LiveSignal;
  offset: number;
}

/** Retained sandbox signals and the channel's current stream position. */
export interface LiveSignalHistory extends LiveSignalHistoryPosition {
  publications: LiveSignalHistoryEntry[];
}

/** Options for reading the channel's retained sandbox signals. */
export interface LiveSignalHistoryOptions {
  /** Defaults to 300, the channel's maximum retention; zero reads only the position. */
  limit?: number;
  /** Return only signals after this position. */
  since?: LiveSignalHistoryPosition;
}

/** Start the compiled strategy's single live run. */
export async function startLive(strategyId: string, request: StartLiveRequest): Promise<LiveRunWithStream> {
  const { data, error, response } = await apiStartLive({ path: { strategyId }, body: request });
  if (error) throw requestFailed('start live call', error, response?.status);
  if (!data) throw new QTSError('Empty start-live response');
  return data;
}

/** Read a strategy's current live run. */
export async function getLive(strategyId: string): Promise<LiveRunWithStream> {
  const { data, error, response } = await apiGetLive({ path: { strategyId } });
  if (error) throw requestFailed('get live call', error, response?.status);
  if (!data) throw new QTSError('Empty get-live response');
  return data;
}

/** Read one of your live runs by its id, including its last-change time and latest counters. */
export async function getLiveRun(runId: string): Promise<LiveRunDetail> {
  const { data, error, response } = await apiGetLiveRun({ path: { runId } });
  if (error) throw requestFailed('get live run call', error, response?.status);
  if (!data) throw new QTSError('Empty get-live-run response');
  return data;
}

/** List live runs owned by the authenticated account. */
export async function listLive(query?: { cursor?: string; limit?: number }): Promise<LiveListResponse> {
  const { data, error, response } = await apiListLive({ query });
  if (error) throw requestFailed('list live call', error, response?.status);
  if (!data) throw new QTSError('Empty live-list response');
  return data;
}

/** Read paper-trading accounts and open positions for a run. */
export async function getLiveRunPaper(runId: string): Promise<LivePaper> {
  const { data, error, response } = await apiGetLiveRunPaper({ path: { runId } });
  if (error) throw requestFailed('get live paper call', error, response?.status);
  if (!data) throw new QTSError('Empty live-paper response');
  return data;
}

/** Read paginated paper-trading equity points for a run. */
export async function getLiveRunPaperEquity(
  runId: string,
  query?: { cursor?: string; currency?: string; limit?: number; sinceMs?: number },
): Promise<LivePaperEquityPage> {
  const { data, error, response } = await apiGetLiveRunPaperEquity({ path: { runId }, query });
  if (error) throw requestFailed('get live paper equity call', error, response?.status);
  if (!data) throw new QTSError('Empty live-paper-equity response');
  return data;
}

/** Continue a paper-equity page while retaining its currency and size filters. */
export async function getNextLiveRunPaperEquity(
  runId: string,
  page: LivePaperEquityPage,
): Promise<LivePaperEquityPage | undefined> {
  const href = page._links?.next?.href;
  if (!href) return undefined;
  const params = new URL(href, 'https://api.qtsurfer.invalid').searchParams;
  const cursor = params.get('cursor');
  if (!cursor) throw new QTSError('Paper equity continuation link has no cursor');
  return getLiveRunPaperEquity(runId, {
    cursor,
    ...(params.has('currency') ? { currency: params.get('currency')! } : {}),
    ...(params.has('limit') ? { limit: Number(params.get('limit')) } : {}),
    ...(params.has('sinceMs') ? { sinceMs: Number(params.get('sinceMs')) } : {}),
  });
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

/** Rotate a running run's stream URL and retire the previous URL. */
export async function rotateLiveStream(runId: string): Promise<LiveStreamUrl> {
  const { data, error, response } = await apiRotateLiveStream({ path: { runId } });
  if (error) throw requestFailed('rotate live stream call', error, response?.status);
  if (!data) throw new QTSError('Empty rotate-live-stream response');
  return data;
}

/** Revoke a run's stream URL permanently; this does not stop the run. */
export async function revokeLiveStream(runId: string): Promise<LiveStreamRevoked> {
  const { data, error, response } = await apiRevokeLiveStream({ path: { runId } });
  if (error) throw requestFailed('revoke live stream call', error, response?.status);
  if (!data) throw new QTSError('Empty revoke-live-stream response');
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

/**
 * Deliver a transient command to every execution behind an owned live run.
 * A successful response means accepted for delivery, not handled by the
 * strategy. Commands are not persisted or idempotent; use parameters for
 * values that must survive execution restarts.
 */
export async function sendLiveCommand(
  runId: string,
  request: LiveCommandRequest,
): Promise<LiveCommandResult> {
  const { data, error, response } = await apiSendLiveCommand({ path: { runId }, body: request });
  if (error) throw requestFailed('send live command call', error, response?.status);
  if (!data) throw new QTSError('Empty send-live-command response');
  return data;
}

/**
 * Read a page of retained signals for a live run.
 *
 * Use the returned {@link LiveSignalPage}'s `_links.next.href` to obtain the
 * cursor for the next page. If the requested cursor is older than retention,
 * this throws
 * {@link LiveSignalCursorExpiredError}; resume without a cursor from the
 * earliest timestamp reported by the error.
 */
export async function getLiveSignals(
  runId: string,
  query?: { cursor?: string; instrument?: string; limit?: number; sinceMs?: number; type?: LiveSignal['type'] },
): Promise<LiveSignalPage> {
  const { data, error, response } = await apiGetLiveRunSignals({ path: { runId }, query });
  if (response?.status === 410) {
    throw new LiveSignalCursorExpiredError('Live signal cursor expired; restart without cursor from availableSinceMs.');
  }
  if (error) throw requestFailed('get live signals call', error, response?.status);
  if (!data) throw new QTSError('Empty live-signals response');
  return data;
}

/** Continue a retained-signal page without requiring callers to parse its HAL link. */
export async function getNextLiveSignals(
  runId: string,
  page: LiveSignalPage,
): Promise<LiveSignalPage | undefined> {
  const href = page._links?.next?.href;
  if (!href) return undefined;
  const cursor = new URL(href, 'https://api.qtsurfer.invalid').searchParams.get('cursor');
  if (!cursor) throw new QTSError('Live signal continuation link has no cursor');
  const params = new URL(href, 'https://api.qtsurfer.invalid').searchParams;
  return getLiveSignals(runId, {
    cursor,
    ...(params.has('instrument') ? { instrument: params.get('instrument')! } : {}),
    ...(params.has('limit') ? { limit: Number(params.get('limit')) } : {}),
    ...(params.has('sinceMs') ? { sinceMs: Number(params.get('sinceMs')) } : {}),
    ...(params.has('type') ? { type: params.get('type') as LiveSignal['type'] } : {}),
  });
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
    private readonly subscription: Subscription,
  ) {}

  /** Connect and subscribe to `sig:<runId>`. */
  static async connect(
    runId: string,
    options: LiveConnectionOptions,
    tokenProvider: () => Promise<string> = mintToken,
  ): Promise<LiveConnection> {
    const token = await tokenProvider();
    const centrifuge = new Centrifuge(options.url ?? DEFAULT_LIVE_URL, {
      token,
      getToken: tokenProvider,
    });
    centrifuge.on('error', (context) => options.onError?.(context));

    const subscription = centrifuge.newSubscription(`sig:${runId}`);
    subscription.on('publication', (context) => {
      options.onSignal(context.data as LiveSignal, context.offset);
    });
    subscription.on('unsubscribed', (context) => options.onError?.(context));

    centrifuge.connect();
    await centrifuge.ready();
    subscription.subscribe();
    await subscription.ready();
    return new LiveConnection(centrifuge, runId, subscription);
  }

  /**
   * Read the signals retained on this subscribed channel, oldest first.
   * Only sandbox signals are held (up to 300, until five minutes after the
   * last sandbox signal). Subscribing and reconnecting do not replay them.
   * A lost stream position rejects with Centrifugo error 112; retry without
   * `since`, and use REST `getLiveSignals()` for anything no longer retained.
   */
  async getSignalHistory(options: LiveSignalHistoryOptions = {}): Promise<LiveSignalHistory> {
    const result = await this.subscription.history({ limit: options.limit ?? 300, since: options.since });
    return {
      publications: result.publications.map((publication) => {
        if (publication.offset === undefined) {
          throw new QTSError('Live signal history publication has no offset');
        }
        return { data: publication.data as LiveSignal, offset: publication.offset };
      }),
      epoch: result.epoch,
      offset: result.offset,
    };
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
