import { checkTimeout, settings } from './config';
import { cancelled, WifiError, wrap } from './errors';
import { Listeners } from './listeners';
import native from './NativeReactNativeWifi';
import { cancellable } from './operations';
import { checkHost, connectTo, describeFailure } from './probe';
import { securityOf } from './security';
import type { JoinedNetwork, JoinNetworkOptions } from './types';

type NativeJoined = {
  ssid: string;
  bssid?: string;
  ip?: string;
  gateway?: string;
};

/** The joins still on, by id; native reports a loss by id. */
const live = new Map<number, Joined>();

class Joined implements JoinedNetwork {
  readonly ssid: string;
  readonly bssid?: string;
  readonly ip?: string;
  readonly gateway?: string;
  private on = true;
  private left = false;
  private readonly lostListeners = new Listeners<() => void>();

  constructor(
    readonly joinId: number,
    /** What the join asked for: the name, or with `prefix` its start. */
    readonly requested: string,
    { ssid, bssid, ip, gateway }: NativeJoined
  ) {
    this.ssid = ssid;
    this.bssid = bssid;
    this.ip = ip;
    this.gateway = gateway;
    live.set(joinId, this);
  }

  get active() {
    return this.on;
  }

  names() {
    return this.ssid === this.requested
      ? [this.ssid]
      : [this.requested, this.ssid];
  }

  async leave() {
    if (this.left) return;
    this.left = true;
    this.end();
    // Native spares the names a newer join of the same network goes by, pending or joined.
    await wrap(native.leaveNetwork(this.joinId, this.names()));
  }

  onLost(listener: () => void) {
    return this.on ? this.lostListeners.add(listener) : () => {};
  }

  /** The phone left the network on its own, or a newer join replaced this one. */
  lose() {
    if (!this.on) return;
    this.end();
    for (const listener of this.lostListeners.list()) listener();
    this.lostListeners.clear();
  }

  /** Forgotten through `forgetNetworks`: off, and nothing left to leave. */
  forgotten() {
    this.left = true;
    this.end();
  }

  matches(ssids: readonly string[]) {
    return this.names().some((name) => ssids.includes(name));
  }

  private end() {
    this.on = false;
    live.delete(this.joinId);
  }
}

native.onJoinLost((payload) => {
  live.get((payload as { joinId: number }).joinId)?.lose();
});

const validate = ({
  ssid,
  prefix,
  password,
  security,
  hidden,
  waitFor,
}: JoinNetworkOptions) => {
  if (!ssid) throw new WifiError('invalid-argument', 'The ssid is empty');
  // Before joining: a join undone over a typo would cost the user a prompt.
  if (waitFor) checkHost(waitFor.host, waitFor.port);
  if (prefix && hidden)
    throw new WifiError(
      'invalid-argument',
      'A hidden network cannot be joined by prefix'
    );
  securityOf({ password, security });
};

/**
 * Puts the phone on a network, typically a device's own hotspot, and resolves once it is on it with an address
 * and, on Android, routes the app's traffic there; with `waitFor`, also once the device accepts a connection. The
 * system asks the user first. A failure, a timeout or an abort leaves the phone where it was. A newer join
 * replaces an earlier one.
 */
export const joinNetwork = async (
  options: JoinNetworkOptions
): Promise<JoinedNetwork> => {
  validate(options);
  const { ssid, password, waitFor, signal } = options;
  const timeout = checkTimeout(
    options.timeout ?? settings.timeouts.join,
    'timeout'
  );
  const deadline = timeout > 0 ? Date.now() + timeout : undefined;

  let joinId = 0;
  const result = (await cancellable(
    `Joining ${ssid}`,
    signal,
    (id) => {
      joinId = id;
      return native.joinNetwork(id, {
        ssid,
        prefix: options.prefix ?? false,
        password: password ?? '',
        security: securityOf(options),
        hidden: options.hidden ?? false,
        timeout,
        bindProcess: options.bindProcess ?? true,
        joinOnce: options.joinOnce ?? false,
      });
    },
    (id) => native.cancelJoin(id)
  )) as NativeJoined;
  const network = new Joined(joinId, ssid, result);
  if (!waitFor) return network;

  try {
    const remaining = deadline === undefined ? 0 : deadline - Date.now();
    if (deadline !== undefined && remaining <= 0)
      throw new WifiError(
        'timeout',
        `Joined ${network.ssid}, but no time was left to wait for ${waitFor.host}:${waitFor.port}`
      );
    const answer = await connectTo(
      waitFor.host,
      waitFor.port,
      remaining,
      signal
    );
    if (!answer.reachable)
      throw new WifiError(
        'unreachable',
        `Joined ${network.ssid}, but ${describeFailure(waitFor.host, waitFor.port, answer)}`
      );
    return network;
  } catch (error) {
    // Nothing of a failed join stays behind; the failure is what the caller hears about.
    await network.leave().catch(() => {});
    throw signal?.aborted ? cancelled(`Joining ${ssid}`) : error;
  }
};

/**
 * Leaves the networks the app joined and has the system forget them: those named in `ssids` (or joined by those
 * prefixes), or all. On iOS this reaches networks joined in earlier launches, which iOS keeps until forgotten.
 */
export const forgetNetworks = async (ssids?: string[]) => {
  for (const network of [...live.values()]) {
    if (!ssids || network.matches(ssids)) network.forgotten();
  }
  await wrap(native.forgetJoinedNetworks(ssids ? { ssids } : {}));
};
