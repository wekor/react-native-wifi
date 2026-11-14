import {
  type CodegenTypes,
  type TurboModule,
  TurboModuleRegistry,
} from 'react-native';

/**
 * Every promise rejects with an `Error` whose `code` is a `WifiErrorCode` and whose `userInfo.nativeCode`, when
 * present, is the platform's own code. Results are wrapped in objects (`{ network }`, `{ networks }`) so codegen
 * sees one shape on both platforms. Operations JS can cancel take an id it allocates.
 *
 * JS calls the methods only one platform implements only on that platform (see `platform.android.ts` and
 * `localNetwork.ios.ts`); the other platform rejects them with `unsupported`.
 */
export interface Spec extends TurboModule {
  getWifiPermission(): Promise<CodegenTypes.UnsafeObject>;
  requestWifiPermission(): Promise<CodegenTypes.UnsafeObject>;
  /** iOS. Requests at once share one probe, which stops when the last of them settles. */
  requestLocalNetworkPermission(
    requestId: CodegenTypes.Double,
    timeout: CodegenTypes.Double
  ): Promise<CodegenTypes.UnsafeObject>;
  cancelLocalNetworkPermissionRequest(requestId: CodegenTypes.Double): void;

  /** `{ network }`: the network the system's Wi-Fi is on, `null` when it is on none. */
  getCurrentWifiNetwork(): Promise<CodegenTypes.UnsafeObject>;
  /**
   * Starts or stops `onCurrentWifiNetworkChange`. Starting (again) emits the current network if it differs from the
   * last one emitted, so JS calls it once more after a permission grant reveals the SSID.
   */
  setNetworkUpdates(enabled: boolean): void;

  /** Answers with `{ ssid, bssid?, ip?, gateway? }` once the phone is on the network with an address. */
  joinNetwork(
    joinId: CodegenTypes.Double,
    options: CodegenTypes.UnsafeObject
  ): Promise<CodegenTypes.UnsafeObject>;
  /** Rejects a pending join with `cancelled` and undoes it; nothing once it has settled. */
  cancelJoin(joinId: CodegenTypes.Double): void;
  /** Leaves the join `joinId` if it is still on; on iOS also forgets `ssids` (its requested and actual names). */
  leaveNetwork(joinId: CodegenTypes.Double, ssids: string[]): Promise<void>;
  /** `{ ssids? }`: without `ssids`, every network the app joined. */
  forgetJoinedNetworks(options: CodegenTypes.UnsafeObject): Promise<void>;

  /**
   * Whether `host` accepts a TCP connection on `port` within `timeout` (`0`: no limit): `{ reachable: true }`, or
   * `{ reachable: false, cause, vpn }` with the last attempt's cause. Rejects with `local-network-denied` (iOS) and
   * `cancelled`.
   */
  reachable(
    probeId: CodegenTypes.Double,
    host: string,
    port: CodegenTypes.Double,
    timeout: CodegenTypes.Double
  ): Promise<CodegenTypes.UnsafeObject>;
  cancelReachable(probeId: CodegenTypes.Double): void;

  /** iOS resolves both at once: it routes traffic for the Wi-Fi network's addresses there already. */
  bindProcessToWifi(
    requireInternet: boolean,
    timeout: CodegenTypes.Double
  ): Promise<void>;
  unbindProcess(): Promise<void>;

  // Android only.
  /** `{ networks }` from a scan this call starts. */
  scanNetworks(
    timeout: CodegenTypes.Double
  ): Promise<CodegenTypes.UnsafeObject>;
  /** `{ networks }` from the system's last scan, by anyone. */
  getLastScanResults(): Promise<CodegenTypes.UnsafeObject>;
  /** `{ suggestions: [...] }`. */
  addNetworkSuggestions(options: CodegenTypes.UnsafeObject): Promise<void>;
  /** `{ ssids? }`: without `ssids`, every suggestion the app made. */
  removeNetworkSuggestions(options: CodegenTypes.UnsafeObject): Promise<void>;
  isWifiEnabled(): Promise<boolean>;
  setWifiEnabledUpdates(enabled: boolean): void;
  openWifiSettings(): Promise<void>;

  /** `{ network }`, as `getCurrentWifiNetwork` answers. */
  readonly onCurrentWifiNetworkChange: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** `{ joinId, ssid }`: a joined network went away, or a newer join replaced it. */
  readonly onJoinLost: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
  /** `{ enabled }`; Android only. */
  readonly onWifiEnabledChange: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('ReactNativeWifi');
