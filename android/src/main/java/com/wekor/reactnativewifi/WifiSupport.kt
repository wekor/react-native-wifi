package com.wekor.reactnativewifi

import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.wifi.ScanResult
import android.os.Build
import android.os.SystemClock
import androidx.annotation.RequiresApi
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.net.Inet4Address
import java.util.concurrent.atomic.AtomicBoolean

/** A `WifiError` as JS receives it: `code` is a `WifiErrorCode`. */
class WifiException(val code: String, message: String, val nativeCode: Int? = null) : Exception(message)

/** A promise that settles once: later answers (a late callback after a timeout, say) are dropped. */
class Reply(private val promise: Promise) {
  private val settled = AtomicBoolean(false)

  fun resolve(value: Any? = null) {
    if (settled.compareAndSet(false, true)) promise.resolve(jsValueOf(value))
  }

  fun reject(error: WifiException) {
    if (!settled.compareAndSet(false, true)) return
    val userInfo = Arguments.createMap()
    error.nativeCode?.let { userInfo.putInt("nativeCode", it) }
    promise.reject(error.code, error.message, userInfo)
  }
}

/** Kotlin maps, lists and primitives as the values a promise or event carries to JS. */
fun jsValueOf(value: Any?): Any? =
  when (value) {
    is Map<*, *> -> writableMapOf(value)
    is List<*> -> writableArrayOf(value)
    else -> value
  }

fun writableMapOf(map: Map<*, *>): WritableMap {
  val out = Arguments.createMap()
  for ((key, value) in map) {
    val name = key as String
    when (value) {
      null -> out.putNull(name)
      is String -> out.putString(name, value)
      is Boolean -> out.putBoolean(name, value)
      is Int -> out.putInt(name, value)
      is Long -> out.putDouble(name, value.toDouble())
      is Number -> out.putDouble(name, value.toDouble())
      is Map<*, *> -> out.putMap(name, writableMapOf(value))
      is List<*> -> out.putArray(name, writableArrayOf(value))
      else -> out.putString(name, value.toString())
    }
  }
  return out
}

fun writableArrayOf(list: List<*>): WritableArray {
  val out = Arguments.createArray()
  for (value in list) {
    when (value) {
      null -> out.pushNull()
      is String -> out.pushString(value)
      is Boolean -> out.pushBoolean(value)
      is Int -> out.pushInt(value)
      is Long -> out.pushDouble(value.toDouble())
      is Number -> out.pushDouble(value.toDouble())
      is Map<*, *> -> out.pushMap(writableMapOf(value))
      is List<*> -> out.pushArray(writableArrayOf(value))
      else -> out.pushString(value.toString())
    }
  }
  return out
}

/** What `WifiInfo.getSSID()` reports when it has no name to give: not connected, or the name is hidden. */
const val UNKNOWN_SSID = "<unknown ssid>"

/** What `WifiInfo.getBSSID()` reports when the address is hidden. */
const val HIDDEN_BSSID = "02:00:00:00:00:00"

/** An SSID as Android reports it (quoted when it is UTF-8, bare hex otherwise) as the name, or null if hidden. */
fun ssidOf(raw: String?): String? {
  if (raw == null || raw == UNKNOWN_SSID) return null
  val name = if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) raw.substring(1, raw.length - 1) else raw
  return name.ifEmpty { null }
}

fun bssidOf(raw: String?): String? = raw?.takeUnless { it == HIDDEN_BSSID }?.uppercase()

fun quoted(value: String) = "\"$value\""

/** The phone's IPv4 address and default gateway on a network. */
fun addressesOf(link: LinkProperties?): Map<String, Any?> {
  if (link == null) return emptyMap()
  val ip = link.linkAddresses.map { it.address }.firstOrNull { it is Inet4Address }?.hostAddress
  val gateway = link.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress
  return mapOf("ip" to ip, "gateway" to gateway).filterValues { it != null }
}

fun bandOf(frequency: Int) =
  when (frequency) {
    in 2400..2500 -> "2.4GHz"
    in 4900..5900 -> "5GHz"
    in 5925..7125 -> "6GHz"
    in 58000..71000 -> "60GHz"
    else -> "unknown"
  }

/** The strongest security a scan result's capabilities offer, as `ScannedNetwork.security` names it. */
fun securityOf(capabilities: String) =
  when {
    "EAP" in capabilities -> "enterprise"
    "SAE" in capabilities && "PSK" !in capabilities -> "wpa3"
    "PSK" in capabilities -> if ("RSN" in capabilities || "WPA2" in capabilities) "wpa2" else "wpa"
    "OWE" in capabilities -> "owe"
    "WEP" in capabilities -> "wep"
    else -> "open"
  }

@Suppress("DEPRECATION") // `SSID` is the name as a String; its replacement, `wifiSsid`, is API 33.
fun scanResultOf(result: ScanResult): Map<String, Any?> {
  // `timestamp` is microseconds since boot.
  val bootTime = System.currentTimeMillis() - SystemClock.elapsedRealtime()
  return mapOf(
    "ssid" to (result.SSID ?: ""),
    "bssid" to (result.BSSID ?: "").uppercase(),
    "rssi" to result.level,
    "frequency" to result.frequency,
    "band" to bandOf(result.frequency),
    "security" to securityOf(result.capabilities ?: ""),
    "capabilities" to (result.capabilities ?: ""),
    "timestamp" to (bootTime + result.timestamp / 1000).toDouble(),
  )
}

/** What a network callback reports, posted to the Wi-Fi thread by [callbackOf]. */
interface NetworkEvents {
  fun onAvailable(network: Network) {}

  fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {}

  fun onLinkPropertiesChanged(network: Network, link: LinkProperties) {}

  fun onLost(network: Network) {}

  fun onUnavailable() {}
}

/**
 * A network callback that hands each event to `events` through `post`. With `includeLocation` on Android 12+, the
 * capabilities carry the `WifiInfo` with its SSID, which Android otherwise redacts.
 */
fun callbackOf(includeLocation: Boolean, post: (() -> Unit) -> Unit, events: NetworkEvents): ConnectivityManager.NetworkCallback =
  if (includeLocation && Build.VERSION.SDK_INT >= 31) LocationCallback(post, events) else PlainCallback(post, events)

private class PlainCallback(private val post: (() -> Unit) -> Unit, private val events: NetworkEvents) :
  ConnectivityManager.NetworkCallback() {
  override fun onAvailable(network: Network) = post { events.onAvailable(network) }

  override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
    post { events.onCapabilitiesChanged(network, capabilities) }

  override fun onLinkPropertiesChanged(network: Network, link: LinkProperties) =
    post { events.onLinkPropertiesChanged(network, link) }

  override fun onLost(network: Network) = post { events.onLost(network) }

  override fun onUnavailable() = post { events.onUnavailable() }
}

@RequiresApi(31)
private class LocationCallback(private val post: (() -> Unit) -> Unit, private val events: NetworkEvents) :
  ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
  override fun onAvailable(network: Network) = post { events.onAvailable(network) }

  override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) =
    post { events.onCapabilitiesChanged(network, capabilities) }

  override fun onLinkPropertiesChanged(network: Network, link: LinkProperties) =
    post { events.onLinkPropertiesChanged(network, link) }

  override fun onLost(network: Network) = post { events.onLost(network) }

  override fun onUnavailable() = post { events.onUnavailable() }
}
