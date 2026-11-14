package com.wekor.reactnativewifi

import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * The spec's surface: reads JS arguments into Kotlin types here, on the JS thread, and hands the work to
 * [WifiCentral]'s thread.
 */
@ReactModule(name = WifiModule.NAME)
class WifiModule(reactContext: ReactApplicationContext) :
  NativeReactNativeWifiSpec(reactContext), LifecycleEventListener {

  private val delegate =
    object : WifiDelegate {
      override fun networkChanged(network: Map<String, Any?>?) =
        emitOnCurrentWifiNetworkChange(writableMapOf(mapOf("network" to network)))

      override fun joinLost(joinId: Double, ssid: String) =
        emitOnJoinLost(writableMapOf(mapOf("joinId" to joinId, "ssid" to ssid)))

      override fun wifiEnabledChanged(enabled: Boolean) =
        emitOnWifiEnabledChange(writableMapOf(mapOf("enabled" to enabled)))
    }

  private val central = WifiCentral(reactContext, delegate)

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun invalidate() {
    reactApplicationContext.removeLifecycleEventListener(this)
    central.close()
    super.invalidate()
  }

  override fun onHostResume() = central.onHostResume()

  override fun onHostPause() {}

  override fun onHostDestroy() {}

  private fun run(promise: Promise, block: (Reply) -> Unit) {
    val reply = Reply(promise)
    central.run(reply) { block(reply) }
  }

  /** Runs `block` and resolves with nothing once it returns. */
  private fun runThenResolve(promise: Promise, block: () -> Unit) =
    run(promise) {
      block()
      it.resolve()
    }

  // Permissions

  override fun getWifiPermission(promise: Promise) = run(promise) { it.resolve(central.permissionResponse()) }

  override fun requestWifiPermission(promise: Promise) = run(promise) { central.requestWifiPermission(it) }

  // Android has no local network permission; JS answers for it without asking.
  override fun requestLocalNetworkPermission(requestId: Double, timeout: Double, promise: Promise) =
    promise.resolve(writableMapOf(mapOf("status" to "granted", "canAskAgain" to false)))

  override fun cancelLocalNetworkPermissionRequest(requestId: Double) {}

  // The current network

  override fun getCurrentWifiNetwork(promise: Promise) =
    run(promise) { it.resolve(mapOf("network" to central.currentNetwork())) }

  override fun setNetworkUpdates(enabled: Boolean) = central.post { central.setNetworkUpdates(enabled) }

  // Joining

  override fun joinNetwork(joinId: Double, options: ReadableMap, promise: Promise) {
    val join =
      JoinOptions(
        ssid = options.getString("ssid") ?: "",
        prefix = options.getBoolean("prefix"),
        password = options.getString("password") ?: "",
        security = options.getString("security") ?: "open",
        hidden = options.getBoolean("hidden"),
        timeout = options.getDouble("timeout"),
        bindProcess = options.getBoolean("bindProcess"),
      )
    run(promise) { central.joiner.join(joinId, join, it) }
  }

  override fun cancelJoin(joinId: Double) = central.post { central.joiner.cancel(joinId) }

  // Android forgets a join's network as it leaves it: the names are for iOS.
  override fun leaveNetwork(joinId: Double, ssids: ReadableArray, promise: Promise) =
    runThenResolve(promise) { central.joiner.leave(joinId) }

  override fun forgetJoinedNetworks(options: ReadableMap, promise: Promise) {
    val ssids = options.stringList("ssids")
    runThenResolve(promise) { central.joiner.forget(ssids) }
  }

  // Reaching devices

  override fun reachable(probeId: Double, host: String, port: Double, timeout: Double, promise: Promise) =
    central.prober.start(probeId, host, port.toInt(), timeout, Reply(promise))

  override fun cancelReachable(probeId: Double) = central.prober.cancel(probeId)

  override fun bindProcessToWifi(requireInternet: Boolean, timeout: Double, promise: Promise) =
    run(promise) { central.bindProcessToWifi(requireInternet, timeout, it) }

  override fun unbindProcess(promise: Promise) = runThenResolve(promise) { central.unbindProcess() }

  // Android only

  override fun scanNetworks(timeout: Double, promise: Promise) = run(promise) { central.scanNetworks(timeout, it) }

  override fun getLastScanResults(promise: Promise) =
    run(promise) {
      central.checkScanPermission()
      it.resolve(central.lastScanResults())
    }

  override fun addNetworkSuggestions(options: ReadableMap, promise: Promise) {
    val suggestions =
      options.getArray("suggestions")?.toArrayList()?.map {
        @Suppress("UNCHECKED_CAST")
        it as Map<String, Any?>
      } ?: emptyList()
    runThenResolve(promise) { central.addNetworkSuggestions(suggestions) }
  }

  override fun removeNetworkSuggestions(options: ReadableMap, promise: Promise) {
    val ssids = options.stringList("ssids")
    runThenResolve(promise) { central.removeNetworkSuggestions(ssids) }
  }

  override fun isWifiEnabled(promise: Promise) = run(promise) { it.resolve(central.wifiManager.isWifiEnabled) }

  override fun setWifiEnabledUpdates(enabled: Boolean) = central.post { central.setWifiEnabledUpdates(enabled) }

  override fun openWifiSettings(promise: Promise) = runThenResolve(promise) { central.openWifiSettings() }

  /** The strings at `key`, or null when JS left it out. */
  private fun ReadableMap.stringList(key: String): List<String>? =
    if (hasKey(key)) getArray(key)?.toArrayList()?.map { it as String } else null

  companion object {
    const val NAME = "ReactNativeWifi"
  }
}
