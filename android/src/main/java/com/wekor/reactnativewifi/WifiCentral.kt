package com.wekor.reactnativewifi

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSuggestion
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.PermissionAwareActivity

/** What the Wi-Fi thread reports to JS. */
interface WifiDelegate {
  fun networkChanged(network: Map<String, Any?>?)

  fun joinLost(joinId: Double, ssid: String)

  fun wifiEnabledChanged(enabled: Boolean)
}

/**
 * Everything but joining and probing, on one thread: permission, the current network and its updates, the Wi-Fi
 * switch, scans, suggestions and binding the process to Wi-Fi. State is read and written on [thread] only.
 */
@SuppressLint("MissingPermission")
class WifiCentral(private val context: ReactApplicationContext, private val delegate: WifiDelegate) {
  private val thread = HandlerThread("ReactNativeWifi").apply { start() }
  val handler = Handler(thread.looper)
  private val mainHandler = Handler(Looper.getMainLooper())

  val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  val joiner = WifiJoiner(this, delegate)
  val prober = WifiProber(this)

  fun post(block: () -> Unit) {
    handler.post(block)
  }

  /** Runs `block` on the thread, rejecting `reply` with what it throws. */
  fun run(reply: Reply, block: () -> Unit) {
    post {
      try {
        block()
      } catch (error: WifiException) {
        reply.reject(error)
      } catch (error: SecurityException) {
        reply.reject(WifiException("unauthorized", error.message ?: "Permission denied"))
      } catch (error: Exception) {
        reply.reject(WifiException("unknown", error.toString()))
      }
    }
  }

  fun close() {
    post {
      setNetworkUpdates(false)
      setWifiEnabledUpdates(false)
      finishScan(WifiException("cancelled", "The module was torn down"))
      joiner.close()
      prober.close()
      releaseBind()
      answerPermissionWaiters()
    }
    thread.quitSafely()
  }

  fun onHostResume() {
    // A permission or location services changed in Settings has no callback; the network JS holds may be stale.
    post { if (networkCallback != null) emitNetworkIfChanged() }
  }

  // Permission

  private fun granted(permission: String) = context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

  /** The manifest's permissions; asking for one it lacks is denied without a prompt. */
  private val declared: Set<String> by lazy {
    val info =
      if (Build.VERSION.SDK_INT >= 33) {
        context.packageManager.getPackageInfo(
          context.packageName,
          PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()),
        )
      } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
      }
    info.requestedPermissions?.toSet() ?: emptySet()
  }

  /** What `granted` means: precise location, and Nearby Wi-Fi devices on Android 13+, as far as declared. */
  private val required: List<String> by lazy {
    buildList {
      add(Manifest.permission.ACCESS_FINE_LOCATION)
      if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
    }.filter { it in declared }
  }

  /** What is asked for: Android 12+ ignores a request for precise location without approximate. */
  private val requested: Array<String> by lazy {
    val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
    (required + listOfNotNull(coarse.takeIf { it in declared })).toTypedArray()
  }

  fun hasPermission() = required.isNotEmpty() && required.all(::granted)

  fun hasLocationPermission() = granted(Manifest.permission.ACCESS_FINE_LOCATION)

  /** Scanning needs Nearby Wi-Fi devices on Android 13+, else precise location with location services on. */
  fun checkScanPermission() {
    if (Build.VERSION.SDK_INT >= 33 && granted(Manifest.permission.NEARBY_WIFI_DEVICES)) return
    if (!hasLocationPermission()) {
      throw WifiException("unauthorized", "Scanning needs the Wi-Fi permission (precise location before Android 13)")
    }
    if (!isLocationEnabled()) throw WifiException("location-off", "Location services are off; Android hides Wi-Fi networks")
  }

  fun isLocationEnabled(): Boolean {
    val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled
    @Suppress("DEPRECATION")
    return Settings.Secure.getInt(context.contentResolver, Settings.Secure.LOCATION_MODE, Settings.Secure.LOCATION_MODE_OFF) !=
      Settings.Secure.LOCATION_MODE_OFF
  }

  private val preferences
    get() = context.getSharedPreferences("com.wekor.reactnativewifi", Context.MODE_PRIVATE)

  private val permissionWaiters = ArrayList<Reply>()

  /**
   * Expo's `PermissionResponse`. Android cannot tell a permission never asked for from a denied one, so whether
   * the app asked is remembered; after a denial, the system shows the prompt again only while it would show a
   * rationale.
   */
  fun permissionResponse(): Map<String, Any?> {
    if (required.isEmpty()) return mapOf("status" to "denied", "canAskAgain" to false)
    val status =
      when {
        hasPermission() -> "granted"
        preferences.getBoolean(PERMISSION_REQUESTED_KEY, false) -> "denied"
        else -> "undetermined"
      }
    val activity = context.currentActivity
    val canAskAgain =
      status != "denied" || activity == null ||
        required.any { !granted(it) && activity.shouldShowRequestPermissionRationale(it) }
    return mapOf("status" to status, "canAskAgain" to canAskAgain)
  }

  fun requestWifiPermission(reply: Reply) {
    val current = permissionResponse()
    if (hasPermission() || current["canAskAgain"] == false) return reply.resolve(current)
    val activity =
      context.currentActivity as? PermissionAwareActivity
        ?: throw WifiException("unknown", "No activity to ask for permission from")
    permissionWaiters.add(reply)
    // A second request would replace the first one's listener; it shares the prompt already showing instead.
    if (permissionWaiters.size > 1) return
    mainHandler.post {
      try {
        if ((activity as? Activity)?.let { it.isFinishing || it.isDestroyed } == true) {
          post { answerPermissionWaiters() }
        } else {
          activity.requestPermissions(requested, PERMISSION_REQUEST_CODE) { requestCode, _, _ ->
            if (requestCode != PERMISSION_REQUEST_CODE) return@requestPermissions false
            post {
              preferences.edit().putBoolean(PERMISSION_REQUESTED_KEY, true).apply()
              answerPermissionWaiters()
            }
            true
          }
        }
      } catch (error: Exception) {
        post {
          val waiters = permissionWaiters.toList()
          permissionWaiters.clear()
          for (waiter in waiters) waiter.reject(WifiException("unknown", "Could not ask for permission: $error"))
        }
      }
    }
  }

  private fun answerPermissionWaiters() {
    if (permissionWaiters.isEmpty()) return
    val response = permissionResponse()
    val waiters = permissionWaiters.toList()
    permissionWaiters.clear()
    for (waiter in waiters) waiter.resolve(response)
  }

  // The current network

  /** A VPN reports the transports of the networks under it too, Wi-Fi among them: it is not the Wi-Fi network. */
  private fun isWifi(network: Network): Boolean {
    val capabilities = connectivity.getNetworkCapabilities(network) ?: return false
    return capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) &&
      !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)
  }

  /**
   * The network the system's Wi-Fi is on: the default network when that is Wi-Fi, else a Wi-Fi network other than
   * one a join holds for the app alone, else that one (which Android 10 and 11 put in the system's place).
   */
  private fun systemWifiNetwork(): Network? {
    connectivity.activeNetwork?.takeIf(::isWifi)?.let { return it }
    @Suppress("DEPRECATION") // The one call that lists networks without registering a callback.
    val wifi = connectivity.allNetworks.filter(::isWifi)
    val joined = joiner.joinedNetwork
    return wifi.firstOrNull { it != joined } ?: wifi.firstOrNull()
  }

  /**
   * `WifiInfo` from `WifiManager` is deprecated on Android 12+ in favour of a network callback's, but it is the
   * one source that answers at once, and it still reports the system's network (with its SSID, given the
   * permission) on every version.
   */
  @Suppress("DEPRECATION")
  fun currentNetwork(): Map<String, Any?>? {
    val network = systemWifiNetwork() ?: return null
    val info = wifiManager.connectionInfo
    return buildMap {
      if (info != null) {
        ssidOf(info.ssid)?.let { put("ssid", it) }
        bssidOf(info.bssid)?.let { put("bssid", it) }
        // Android's "invalid" values.
        if (info.rssi > -127) put("rssi", info.rssi)
        if (info.frequency > 0) put("frequency", info.frequency)
        if (info.linkSpeed > 0) put("linkSpeed", info.linkSpeed)
      }
      putAll(addressesOf(connectivity.getLinkProperties(network)))
    }
  }

  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  /** The identity of the network last emitted; null when none was. */
  private var lastNetworkKey: String? = null

  fun setNetworkUpdates(enabled: Boolean) {
    if (!enabled) {
      networkCallback?.let { unregister(it) }
      networkCallback = null
      lastNetworkKey = null
      return
    }
    if (networkCallback == null) {
      val events =
        object : NetworkEvents {
          override fun onAvailable(network: Network) = emitNetworkIfChanged()

          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = emitNetworkIfChanged()

          override fun onLinkPropertiesChanged(network: Network, link: android.net.LinkProperties) = emitNetworkIfChanged()

          override fun onLost(network: Network) = emitNetworkIfChanged()
        }
      // Without INTERNET, so a device's hotspot counts too.
      val request =
        NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          .build()
      val callback = callbackOf(false, ::post, events)
      connectivity.registerNetworkCallback(request, callback)
      networkCallback = callback
    }
    emitNetworkIfChanged()
  }

  /** Emits the current network unless it is the one last emitted; signal and speed alone are no change. */
  private fun emitNetworkIfChanged() {
    if (networkCallback == null) return
    val network = currentNetwork()
    val key = network?.let { listOf(it["ssid"], it["bssid"], it["ip"], it["gateway"]).joinToString("|") } ?: "none"
    if (key == lastNetworkKey) return
    lastNetworkKey = key
    delegate.networkChanged(network)
  }

  fun unregister(callback: ConnectivityManager.NetworkCallback) {
    try {
      connectivity.unregisterNetworkCallback(callback)
    } catch (_: IllegalArgumentException) {
      // Already released by the system, as after `onUnavailable`.
    }
  }

  // The Wi-Fi switch

  private var wifiEnabledReceiver: BroadcastReceiver? = null
  private var lastWifiEnabled: Boolean? = null

  fun setWifiEnabledUpdates(enabled: Boolean) {
    if (!enabled) {
      wifiEnabledReceiver?.let { unregisterReceiver(it) }
      wifiEnabledReceiver = null
      lastWifiEnabled = null
      return
    }
    if (wifiEnabledReceiver != null) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          val state = intent.getIntExtra(WifiManager.EXTRA_WIFI_STATE, WifiManager.WIFI_STATE_UNKNOWN)
          val enabled =
            when (state) {
              WifiManager.WIFI_STATE_ENABLED -> true
              WifiManager.WIFI_STATE_DISABLED -> false
              else -> return
            }
          if (enabled == lastWifiEnabled) return
          lastWifiEnabled = enabled
          delegate.wifiEnabledChanged(enabled)
        }
      }
    lastWifiEnabled = wifiManager.isWifiEnabled
    registerReceiver(receiver, IntentFilter(WifiManager.WIFI_STATE_CHANGED_ACTION))
    wifiEnabledReceiver = receiver
  }

  /** Delivered on the Wi-Fi thread. System broadcasts reach a receiver that is not exported. */
  fun registerReceiver(receiver: BroadcastReceiver, filter: IntentFilter) {
    if (Build.VERSION.SDK_INT >= 33) {
      context.registerReceiver(receiver, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
    } else {
      context.registerReceiver(receiver, filter, null, handler)
    }
  }

  fun unregisterReceiver(receiver: BroadcastReceiver) {
    try {
      context.unregisterReceiver(receiver)
    } catch (_: IllegalArgumentException) {}
  }

  fun openWifiSettings() {
    val action = if (Build.VERSION.SDK_INT >= 29) Settings.Panel.ACTION_WIFI else Settings.ACTION_WIFI_SETTINGS
    val activity = context.currentActivity
    val intent = Intent(action)
    if (activity != null) {
      activity.startActivity(intent)
    } else {
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  // Scanning

  private val scanWaiters = ArrayList<Reply>()
  private var scanReceiver: BroadcastReceiver? = null
  private val scanTimeout = Runnable { finishScan(WifiException("timeout", "The scan did not finish in time")) }

  @Suppress("DEPRECATION") // `startScan` is deprecated without a replacement; it still scans, throttled.
  fun scanNetworks(timeout: Double, reply: Reply) {
    checkScanPermission()
    if (!wifiManager.isWifiEnabled) throw WifiException("wifi-off", "Wi-Fi is off")
    scanWaiters.add(reply)
    if (scanWaiters.size > 1) return
    val receiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          if (intent.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false)) {
            finishScan(null)
          } else {
            finishScan(WifiException("scan-failed", "The scan produced no new results"))
          }
        }
      }
    registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
    scanReceiver = receiver
    if (!wifiManager.startScan()) {
      return finishScan(
        WifiException("scan-throttled", "Android allows 4 scans in 2 minutes; getLastScanResults() has the last ones"),
      )
    }
    if (timeout > 0) handler.postDelayed(scanTimeout, timeout.toLong())
  }

  private fun finishScan(error: WifiException?) {
    handler.removeCallbacks(scanTimeout)
    scanReceiver?.let { unregisterReceiver(it) }
    scanReceiver = null
    if (scanWaiters.isEmpty()) return
    val waiters = scanWaiters.toList()
    scanWaiters.clear()
    if (error != null) {
      for (waiter in waiters) waiter.reject(error)
      return
    }
    val result =
      try {
        lastScanResults()
      } catch (error: SecurityException) {
        for (waiter in waiters) waiter.reject(WifiException("unauthorized", error.message ?: "Permission denied"))
        return
      }
    for (waiter in waiters) waiter.resolve(result)
  }

  fun lastScanResults(): Map<String, Any?> = mapOf("networks" to wifiManager.scanResults.map(::scanResultOf))

  // Suggestions

  /** The suggestions made in this launch, by SSID: Android 10 cannot list them, and removing one takes the object. */
  private val suggestions = HashMap<String, Any>()

  fun addNetworkSuggestions(list: List<Map<String, Any?>>) {
    if (Build.VERSION.SDK_INT < 29) throw WifiException("unsupported", "Network suggestions need Android 10")
    val built =
      list.map { options ->
        val ssid = options["ssid"] as String
        val password = options["password"] as String
        val builder = WifiNetworkSuggestion.Builder().setSsid(ssid)
        when (val security = options["security"] as String) {
          "open" -> {}
          "wpa2" -> builder.setWpa2Passphrase(password)
          "wpa3" -> builder.setWpa3Passphrase(password)
          else -> throw WifiException("unsupported", "Android cannot suggest a $security network")
        }
        if (options["hidden"] == true) builder.setIsHiddenSsid(true)
        if (options["appInteractionRequired"] == true) builder.setIsAppInteractionRequired(true)
        val suggestion =
          try {
            builder.build()
          } catch (error: IllegalStateException) {
            throw WifiException("invalid-argument", error.message ?: "Invalid suggestion for $ssid")
          } catch (error: IllegalArgumentException) {
            throw WifiException("invalid-argument", error.message ?: "Invalid suggestion for $ssid")
          }
        ssid to suggestion
      }
    // Suggesting a network again replaces it: Android 10 refuses a changed duplicate.
    val replaced = existingSuggestions(built.map { it.first })
    if (replaced.isNotEmpty()) wifiManager.removeNetworkSuggestions(replaced)
    val status = wifiManager.addNetworkSuggestions(built.map { it.second })
    when (status) {
      WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS, WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_DUPLICATE -> {
        for ((ssid, suggestion) in built) suggestions[ssid] = suggestion
      }
      WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_APP_DISALLOWED ->
        throw WifiException("unauthorized", "The user disallowed the app's suggestions", status)
      WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_ADD_EXCEEDS_MAX_PER_APP ->
        throw WifiException("join-failed", "The app has as many suggestions as Android allows", status)
      else -> throw WifiException("join-failed", "Android refused the suggestions (status $status)", status)
    }
  }

  fun removeNetworkSuggestions(ssids: List<String>?) {
    if (Build.VERSION.SDK_INT < 29) throw WifiException("unsupported", "Network suggestions need Android 10")
    // An empty list removes every suggestion the app made.
    val removed = if (ssids == null) emptyList() else existingSuggestions(ssids)
    if (ssids != null && removed.isEmpty()) return
    val status = wifiManager.removeNetworkSuggestions(removed)
    if (ssids == null) suggestions.clear() else ssids.forEach(suggestions::remove)
    if (status != WifiManager.STATUS_NETWORK_SUGGESTIONS_SUCCESS &&
      status != WifiManager.STATUS_NETWORK_SUGGESTIONS_ERROR_REMOVE_INVALID
    ) {
      throw WifiException("join-failed", "Android refused to remove the suggestions (status $status)", status)
    }
  }

  /** The app's current suggestions for `ssids`: from the system on Android 11+, which also knows earlier launches'. */
  private fun existingSuggestions(ssids: List<String>): List<WifiNetworkSuggestion> {
    if (Build.VERSION.SDK_INT >= 30) {
      return wifiManager.networkSuggestions.filter { ssidOf(it.ssid) in ssids }
    }
    return ssids.mapNotNull { suggestions[it] as? WifiNetworkSuggestion }
  }

  // Binding the process

  /** The request that keeps the network the process is bound to; null when it is bound to a joined network or none. */
  private var bindCallback: ConnectivityManager.NetworkCallback? = null
  private var bindNetwork: Network? = null
  private var bindReply: Reply? = null
  private val bindTimeout =
    Runnable {
      bindReply?.reject(WifiException("timeout", "No Wi-Fi network came up in time"))
      releaseBind()
    }

  fun bindProcessToWifi(requireInternet: Boolean, timeout: Double, reply: Reply) {
    joiner.joinedNetwork?.let { network ->
      releaseBind()
      connectivity.bindProcessToNetwork(network)
      return reply.resolve()
    }
    releaseBind()
    val request =
      NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).apply {
        if (!requireInternet) removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      }.build()
    // Events from a callback a newer bind replaced are dropped.
    var callback: ConnectivityManager.NetworkCallback? = null
    val events =
      object : NetworkEvents {
        override fun onAvailable(network: Network) {
          if (bindCallback !== callback) return
          handler.removeCallbacks(bindTimeout)
          bindNetwork = network
          connectivity.bindProcessToNetwork(network)
          bindReply?.resolve()
          bindReply = null
        }

        override fun onLost(network: Network) {
          // Bound to a network that is gone, the app would have no network at all.
          if (bindCallback === callback && network == bindNetwork) releaseBind()
        }
      }
    callback = callbackOf(false, ::post, events)
    bindCallback = callback
    bindReply = reply
    connectivity.requestNetwork(request, callback)
    if (timeout > 0) handler.postDelayed(bindTimeout, timeout.toLong())
  }

  /** Unbinds the process from the network `bindProcessToWifi` bound it to, and lets that network go. */
  fun releaseBind() {
    handler.removeCallbacks(bindTimeout)
    bindReply?.reject(WifiException("cancelled", "Replaced by a newer bind or an unbind"))
    bindReply = null
    val callback = bindCallback ?: return
    bindCallback = null
    if (bindNetwork != null && connectivity.boundNetworkForProcess == bindNetwork) connectivity.bindProcessToNetwork(null)
    bindNetwork = null
    unregister(callback)
  }

  fun unbindProcess() {
    releaseBind()
    connectivity.bindProcessToNetwork(null)
  }

  companion object {
    private const val PERMISSION_REQUEST_CODE = 0x57f1
    private const val PERMISSION_REQUESTED_KEY = "permissionRequested"
  }
}
