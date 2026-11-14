import { useCallback, useEffect, useRef, useState } from 'react';
import { wrap } from './errors';
import native from './NativeReactNativeWifi';
import { refreshCurrentWifiNetwork } from './network';
import type { PermissionResponse } from './types';

type NativePermission = Pick<PermissionResponse, 'status' | 'canAskAgain'>;

export const responseOf = ({
  status,
  canAskAgain,
}: NativePermission): PermissionResponse => ({
  status,
  granted: status === 'granted',
  canAskAgain,
  expires: 'never',
});

/**
 * Whether the app may read the name of the network the phone is on, and scan: precise location on both platforms,
 * and on Android 13+ also Nearby Wi-Fi devices as far as the app declares them.
 */
export const getWifiPermission = async () =>
  responseOf((await wrap(native.getWifiPermission())) as NativePermission);

/** Prompts for the Wi-Fi permission when the user can still be asked; else resolves with the current response. */
export const requestWifiPermission = async () => {
  const response = responseOf(
    (await wrap(native.requestWifiPermission())) as NativePermission
  );
  // A grant reveals the SSID without the network changing, which no system callback reports.
  if (response.granted) refreshCurrentWifiNetwork();
  return response;
};

/**
 * The Wi-Fi permission as React state, with the same options and `[status, request, get]` result as Expo's
 * permission hooks such as `useCameraPermissions()`.
 */
export function useWifiPermission(options?: {
  get?: boolean;
  request?: boolean;
}) {
  const isMounted = useRef(true);
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const { get = true, request = false } = options ?? {};

  const getPermissionStatus = useCallback(async () => {
    const response = await getWifiPermission();
    if (isMounted.current) setPermission(response);
    return response;
  }, []);

  const requestPermissionStatus = useCallback(async () => {
    const response = await requestWifiPermission();
    if (isMounted.current) setPermission(response);
    return response;
  }, []);

  useEffect(() => {
    // The hook's own calls have no caller to reject to; `permission` stays null.
    const report = (error: unknown) =>
      console.warn('[react-native-wifi] useWifiPermission', error);
    if (request) requestPermissionStatus().catch(report);
    if (!request && get) getPermissionStatus().catch(report);
  }, [get, request, requestPermissionStatus, getPermissionStatus]);

  // A response can arrive after the component unmounted.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return [permission, requestPermissionStatus, getPermissionStatus] as const;
}
