import type { AuthTokenResponse } from '@qtsurfer/api-client';

/**
 * Pluggable token persistence interface.
 *
 * The SDK ships an {@link InMemoryTokenStore} by default. Adopters can
 * implement this contract to back tokens by browser `localStorage`, an
 * on-disk file, a secret manager, etc.
 *
 * The SDK calls {@link load} once per session-startup to seed a cached
 * token (if any), {@link save} after every successful `authenticate()` / refresh,
 * and {@link clear} when the session is explicitly invalidated.
 */
export interface TokenStore {
  /** Return the previously persisted token, or `null` if none. */
  load(): AuthTokenResponse | null | Promise<AuthTokenResponse | null>;
  /** Persist the token returned by `POST /v1/auth/token`. */
  save(token: AuthTokenResponse): void | Promise<void>;
  /** Drop any persisted token. */
  clear(): void | Promise<void>;
}

/**
 * Default {@link TokenStore} — holds the token in a single in-memory slot.
 * Lost on process exit. Sufficient for short-lived scripts and tests.
 */
export class InMemoryTokenStore implements TokenStore {
  private token: AuthTokenResponse | null = null;

  load(): AuthTokenResponse | null {
    return this.token;
  }

  save(token: AuthTokenResponse): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}
