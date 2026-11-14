import { checkTimeout, settings } from './config';
import { WifiError } from './errors';
import native from './NativeReactNativeWifi';
import { cancellable } from './operations';
import type { WaitOptions } from './types';

/** Why the last attempt to connect failed, as native reports it. */
type Cause = 'refused' | 'timeout' | 'no-route' | 'unresolved';

/** What native found: `reachable` is its name for the answer. */
type Outcome =
  | { reachable: true }
  | { reachable: false; cause: Cause; vpn: boolean };

const CAUSES: Record<Cause, string> = {
  refused:
    'the connection was refused: the device is there, its service is not up',
  timeout: 'nothing answered',
  'no-route': 'there was no route to it',
  unresolved: 'its name did not resolve',
};

export const checkHost = (host: string, port: number) => {
  if (!host) throw new WifiError('invalid-argument', 'The host is empty');
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new WifiError('invalid-argument', `${port} is not a TCP port`);
};

/** Connects to `host:port` until it accepts, or the timeout passes; `timeout` `0` waits without limit. */
export const connectTo = async (
  host: string,
  port: number,
  timeout: number,
  signal: AbortSignal | undefined
): Promise<Outcome> => {
  checkHost(host, port);
  checkTimeout(timeout, 'timeout');
  return (await cancellable(
    `Connecting to ${host}:${port}`,
    signal,
    (id) => native.reachable(id, host, port, timeout),
    (id) => native.cancelReachable(id)
  )) as Outcome;
};

/** What a failed probe means to someone reading logs. */
export const describeFailure = (
  host: string,
  port: number,
  { cause, vpn }: Extract<Outcome, { reachable: false }>
) =>
  `${host}:${port} did not accept a connection: ${CAUSES[cause] ?? cause}${vpn ? '; a VPN carried the attempt' : ''}`;

/**
 * Whether `host` accepts a TCP connection on `port` within the timeout: what tells that a device is up on the
 * network the phone is on. Resolves `true` as soon as it does, `false` once the timeout passes. Rejects with
 * `local-network-denied` on iOS when the app may not reach the local network, and `cancelled`.
 */
export const probe = async (
  host: string,
  port: number,
  options?: WaitOptions
): Promise<boolean> =>
  (
    await connectTo(
      host,
      port,
      options?.timeout ?? settings.timeouts.probe,
      options?.signal
    )
  ).reachable;
