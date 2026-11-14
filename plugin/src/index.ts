import { type ConfigPlugin, createRunOncePlugin } from 'expo/config-plugins';
import { withAndroidWifi } from './withAndroid';
import { withIosWifi } from './withIos';

/** Options for the `@wekor/react-native-wifi` config plugin. */
export interface WifiPluginProps {
  /**
   * The `NSLocationWhenInUseUsageDescription` text, which `requestWifiPermission()` prompts with on iOS before it
   * reveals the SSID of the network the phone is on; `false` leaves it unset. A generic message by default.
   */
  locationPermission?: string | false;
  /**
   * The `NSLocalNetworkUsageDescription` text, which iOS shows before the app reaches devices on the local network;
   * also lists the Bonjour service `requestLocalNetworkPermission()` uses in `NSBonjourServices`, keeping the app's
   * own entries. `false` leaves both unset. A generic message by default.
   */
  localNetworkPermission?: string | false;
  /**
   * Adds the Hotspot Configuration entitlement, which `joinNetwork` needs on iOS; on by default. Enable the capability
   * for the App ID too.
   */
  hotspotConfiguration?: boolean;
  /**
   * Adds the Access Wi-Fi Information entitlement, which reading the SSID needs on iOS; on by default. Enable the
   * capability for the App ID too.
   */
  wifiInfo?: boolean;
  /**
   * Declares location on Android (`ACCESS_FINE_LOCATION` with `ACCESS_COARSE_LOCATION`, which Android 12+ asks
   * for together), which reading the SSID needs on every version and scanning before Android 13; on by default.
   */
  androidLocation?: boolean;
  /**
   * Declares `NEARBY_WIFI_DEVICES` with `usesPermissionFlags="neverForLocation"`, which scanning needs on Android
   * 13+; on by default. Off, it is declared without the flag, for apps that derive location from scan results.
   */
  neverForLocation?: boolean;
}

const withWifi: ConfigPlugin<WifiPluginProps> = (config, props = {}) => {
  config = withIosWifi(config, props);
  config = withAndroidWifi(config, props);
  return config;
};

export default createRunOncePlugin(withWifi, '@wekor/react-native-wifi');
