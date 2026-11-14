/** Expo's permission response, so the library works with Expo's permission helpers and hooks. */
export type PermissionResponse = {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  expires: 'never';
};

/** The Wi-Fi network the phone is on. Fields the platform does not report, or hides, are absent. */
export type WifiNetwork = {
  /**
   * Absent without the Wi-Fi permission (both platforms) or with location services off (Android): the system hides
   * it. On iOS a network the app joined with `joinNetwork` is always named.
   */
  ssid?: string;
  /** Uppercase, colon-separated. Hidden when `ssid` is. */
  bssid?: string;
  /** The phone's IPv4 address on the network. */
  ip?: string;
  /** Android: the IPv4 default gateway; on a device's own hotspot this is usually the device. */
  gateway?: string;
  /** Android: signal strength in dBm. */
  rssi?: number;
  /** Android: channel frequency in MHz. */
  frequency?: number;
  /** Android: link speed in Mbps. */
  linkSpeed?: number;
};

/** How a network authenticates: what `joinNetwork` and `addNetworkSuggestions` take. */
export type Security = 'open' | 'wep' | 'wpa2' | 'wpa3';

/** A device's service: what `waitFor` and `probe` connect to. */
export type Host = { host: string; port: number };

export type JoinNetworkOptions = {
  /** The network's name, or with `prefix` the start of it. */
  ssid: string;
  /** Joins any network whose name starts with `ssid`. Android 10+ and iOS. */
  prefix?: boolean;
  /** Omit for an open network. */
  password?: string;
  /**
   * `wpa2` (which also joins WPA and WPA2/WPA3 transition networks) when there is a password, else `open`. `wpa3`
   * is for WPA3-only networks; iOS joins them as `wpa2`. `wep` is iOS and Android 9 and earlier.
   */
  security?: Security;
  /** The network does not broadcast its name. Not with `prefix`. */
  hidden?: boolean;
  /**
   * Resolve only once this accepts a TCP connection: a hotspot comes up before the service behind it. Otherwise
   * the join rejects with `unreachable` and the phone leaves the network.
   */
  waitFor?: Host;
  /**
   * Milliseconds for all of it, the user's time with the system's prompt and `waitFor` included; `0` waits without
   * limit. Default: `configure({ timeouts: { join } })`, 30 s unless changed.
   */
  timeout?: number;
  /** Aborting rejects with `cancelled` and undoes the join: the network is left and the system forgets it. */
  signal?: AbortSignal;
  /**
   * Android: routes all of the app's traffic (fetch, WebSocket, images) through the network while the app is on it,
   * as a device's hotspot without internet needs: Android would otherwise keep using mobile data. Default `true`.
   * Leaving, or losing the network, routes it back. iOS ignores it.
   */
  bindProcess?: boolean;
  /**
   * iOS: the system forgets the network when the app is no longer in the foreground. Off by default: iOS then keeps
   * it until the app forgets it. Android ignores it: its joins end with the app anyway.
   */
  joinOnce?: boolean;
};

/** The network a `joinNetwork` put the phone on. */
export interface JoinedNetwork {
  /** The network's actual name; with `prefix`, the one the system picked when the platform reports it. */
  readonly ssid: string;
  readonly bssid?: string;
  /** The phone's IPv4 address on the network. */
  readonly ip?: string;
  /** Android: the IPv4 default gateway, usually the device whose hotspot this is. */
  readonly gateway?: string;
  /** Until `leave()`, or the phone leaves the network on its own. */
  readonly active: boolean;
  /**
   * Leaves the network and has the system forget it; the phone goes back to the network it would otherwise use.
   * Also after the network was lost: iOS keeps it configured until forgotten. Calling it again does nothing.
   */
  leave(): Promise<void>;
  /** Calls `listener` once when the phone leaves the network on its own, or a newer join replaces it. */
  onLost(listener: () => void): () => void;
}

/** A network a scan found (Android). */
export type ScannedNetwork = {
  /** Empty for a network that hides its name. */
  ssid: string;
  bssid: string;
  /** Signal strength in dBm. */
  rssi: number;
  /** Channel frequency in MHz. */
  frequency: number;
  band: '2.4GHz' | '5GHz' | '6GHz' | '60GHz' | 'unknown';
  /**
   * The strongest security the network offers. Join `wpa` and `wpa2` networks with `security: 'wpa2'`; `owe` and
   * `enterprise` networks cannot be joined with `joinNetwork`.
   */
  security: 'open' | 'owe' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'enterprise';
  /** The raw capabilities string, e.g. `[WPA2-PSK-CCMP][RSN-PSK-CCMP][ESS]`. */
  capabilities: string;
  /** When the network was last seen, in milliseconds since the epoch. */
  timestamp: number;
};

/** A network the system may join on its own, with the app's permission (Android 10+). */
export type NetworkSuggestion = {
  ssid: string;
  /** Omit for an open network. */
  password?: string;
  /** `wpa2` when there is a password, else `open`. */
  security?: Exclude<Security, 'wep'>;
  hidden?: boolean;
  /** The system joins the network only while the app runs. */
  appInteractionRequired?: boolean;
};

/** Milliseconds to wait, `0` without limit, and a signal that cancels the wait. */
export type WaitOptions = { timeout?: number; signal?: AbortSignal };

export type ConfigureOptions = {
  /** Defaults for each call's `timeout`, in milliseconds; `0` waits without limit. */
  timeouts?: {
    /** `joinNetwork`; 30 s. */
    join?: number;
    /** `probe`; 5 s. */
    probe?: number;
    /** `scanNetworks`; 15 s. */
    scan?: number;
    /** `bindProcessToWifi`; 10 s. */
    bind?: number;
  };
};
