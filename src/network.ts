import { useSyncExternalStore } from 'react';
import { wrap } from './errors';
import { Listeners } from './listeners';
import native from './NativeReactNativeWifi';
import type { WifiNetwork } from './types';

type NetworkPayload = { network?: WifiNetwork | null };

/** The last network native reported while updates run; `undefined` while they do not, or before the first. */
let current: WifiNetwork | null | undefined;
const listeners = new Listeners<(network: WifiNetwork | null) => void>();

native.onCurrentWifiNetworkChange((payload) => {
  if (listeners.size === 0) return;
  current = (payload as NetworkPayload).network ?? null;
  for (const listener of listeners.list()) listener(current);
});

/** The Wi-Fi network the phone is on, or `null` when it is on none. */
export const getCurrentNetwork = async (): Promise<WifiNetwork | null> =>
  ((await wrap(native.getCurrentWifiNetwork())) as NetworkPayload).network ??
  null;

/**
 * Calls `listener` with the current Wi-Fi network as soon as it is known, then whenever the phone joins, leaves or
 * switches networks or its address changes; `null` while it is on none. Returns the remover.
 */
export const onCurrentNetworkChange = (
  listener: (network: WifiNetwork | null) => void
) => {
  const remove = listeners.subscribe(
    listener,
    () => native.setNetworkUpdates(true),
    () => {
      native.setNetworkUpdates(false);
      current = undefined;
    }
  );
  if (listeners.size > 1 && current !== undefined) {
    const known = current;
    // Asynchronously, as the first listener hears from native.
    Promise.resolve().then(() => listener(known));
  }
  return remove;
};

/** Has native report the network again if it changed, as after a permission grant reveals its name. */
export const refreshCurrentWifiNetwork = () => {
  if (listeners.size > 0) native.setNetworkUpdates(true);
};

const getSnapshot = () => current;

/** The current Wi-Fi network as React state: `undefined` until known, `null` while the phone is on none. */
export const useCurrentNetwork = () =>
  useSyncExternalStore(onCurrentNetworkChange, getSnapshot);
