import {
  type ConfigPlugin,
  type InfoPlist,
  withEntitlementsPlist,
  withInfoPlist,
} from 'expo/config-plugins';
import type { WifiPluginProps } from './index';

/** The entitlements plist as the mod hands it over. */
type Entitlements = Parameters<
  Parameters<typeof withEntitlementsPlist>[1]
>[0]['modResults'];

const DEFAULT_LOCATION_MESSAGE =
  'This app needs location access to show the Wi-Fi network your phone is connected to.';
// iOS titles the prompt itself; the description says what for.
const DEFAULT_LOCAL_NETWORK_MESSAGE =
  'This app needs local network access to communicate with your devices.';

/** What `requestLocalNetworkPermission()` advertises and browses for, as `@wekor/react-native-local-network-permission` does. */
export const LOCAL_NETWORK_SERVICE = '_preflight_check._tcp';

/**
 * A usage description as Expo's own plugins set one: the text given wins; without one, a text already there (the
 * app's, or another plugin's such as expo-location's) stays, else the default. `false` leaves the key alone.
 */
const usageDescription = (
  given: string | false | undefined,
  current: unknown,
  fallback: string
) => (given === false ? current : (given ?? current ?? fallback));

export function setWifiInfoPlist(
  infoPlist: InfoPlist,
  { locationPermission, localNetworkPermission }: WifiPluginProps
): InfoPlist {
  if (locationPermission !== false)
    infoPlist.NSLocationWhenInUseUsageDescription = usageDescription(
      locationPermission,
      infoPlist.NSLocationWhenInUseUsageDescription,
      DEFAULT_LOCATION_MESSAGE
    ) as string;
  if (localNetworkPermission !== false) {
    infoPlist.NSLocalNetworkUsageDescription = usageDescription(
      localNetworkPermission,
      infoPlist.NSLocalNetworkUsageDescription,
      DEFAULT_LOCAL_NETWORK_MESSAGE
    ) as string;
    const services = new Set<string>(
      (infoPlist.NSBonjourServices as string[] | undefined) ?? []
    );
    services.add(LOCAL_NETWORK_SERVICE);
    infoPlist.NSBonjourServices = [...services];
  }
  return infoPlist;
}

export function setWifiEntitlements(
  entitlements: Entitlements,
  { hotspotConfiguration = true, wifiInfo = true }: WifiPluginProps
): Entitlements {
  if (hotspotConfiguration)
    entitlements['com.apple.developer.networking.HotspotConfiguration'] = true;
  if (wifiInfo) entitlements['com.apple.developer.networking.wifi-info'] = true;
  return entitlements;
}

export const withIosWifi: ConfigPlugin<WifiPluginProps> = (config, props) => {
  config = withInfoPlist(config, (config) => {
    config.modResults = setWifiInfoPlist(config.modResults, props);
    return config;
  });
  return withEntitlementsPlist(config, (config) => {
    config.modResults = setWifiEntitlements(config.modResults, props);
    return config;
  });
};
