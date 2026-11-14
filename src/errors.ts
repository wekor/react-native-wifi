export type WifiErrorCode =
  /** iOS: the user declined the system's prompt to join. */
  | 'user-denied'
  /** Android: the network was not in range, or the user dismissed the system's sheet. */
  | 'not-found'
  /** The phone joined, but nothing accepted a connection on `waitFor` in time; the message names the last cause. */
  | 'unreachable'
  /** iOS: the app may not reach the local network; only Settings changes that. */
  | 'local-network-denied'
  /** The permission the call needs was not granted. */
  | 'unauthorized'
  /** Android: location services are off, so the system hides Wi-Fi networks. */
  | 'location-off'
  /** Android: Wi-Fi is off and the app may not turn it on (Android 10+). */
  | 'wifi-off'
  /** Not possible on this platform or OS version: an Android-only function on iOS, or `prefix` before Android 10. */
  | 'unsupported'
  /** The timeout passed. */
  | 'timeout'
  /** The caller aborted, or a newer call replaced this one. */
  | 'cancelled'
  /** iOS: the app is in the background, where the system refuses to join. */
  | 'not-permitted'
  /** An option the library or the system rejects, such as a passphrase of the wrong length. */
  | 'invalid-argument'
  /** Android: the system throttles scans (4 in 2 minutes in the foreground since Android 9). */
  | 'scan-throttled'
  /** Android: the scan ran but produced no new results. */
  | 'scan-failed'
  /** The system could not join or route; `nativeCode` says more. */
  | 'join-failed'
  | 'unknown';

/** The one error type the library rejects with; switch on `code`, which is the same on both platforms. */
export class WifiError extends Error {
  readonly code: WifiErrorCode;
  /** The platform's own code, such as an `NEHotspotConfigurationError` or a network suggestion status. */
  readonly nativeCode?: number;

  constructor(
    code: WifiErrorCode,
    message: string,
    native?: { nativeCode?: number }
  ) {
    super(message);
    this.name = 'WifiError';
    this.code = code;
    this.nativeCode = native?.nativeCode;
  }
}

export const isWifiError = (
  error: unknown,
  code?: WifiErrorCode
): error is WifiError =>
  error instanceof WifiError && (code === undefined || error.code === code);

/** A native promise rejection as a `WifiError`; anything else becomes one with code `unknown`. */
export const toWifiError = (error: unknown): WifiError => {
  if (error instanceof WifiError) return error;
  if (error && typeof error === 'object' && 'code' in error) {
    const { code, message, userInfo } = error as {
      code: unknown;
      message?: unknown;
      userInfo?: { nativeCode?: unknown } | null;
    };
    const nativeCode = userInfo?.nativeCode;
    return new WifiError(
      typeof code === 'string' ? (code as WifiErrorCode) : 'unknown',
      String(message ?? code),
      { nativeCode: typeof nativeCode === 'number' ? nativeCode : undefined }
    );
  }
  return new WifiError(
    'unknown',
    error instanceof Error ? error.message : String(error)
  );
};

/** `promise`, rejecting with a `WifiError`. */
export const wrap = async <T>(promise: Promise<T>): Promise<T> => {
  try {
    return await promise;
  } catch (error) {
    throw toWifiError(error);
  }
};

export const cancelled = (what: string) =>
  new WifiError('cancelled', `${what} was aborted`);
