package com.wekor.reactnativewifi

import android.annotation.SuppressLint
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiConfiguration
import android.net.wifi.WifiInfo
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.PatternMatcher
import androidx.annotation.RequiresApi

/** What `join` asks for, read from JS on the JS thread. */
data class JoinOptions(
  val ssid: String,
  val prefix: Boolean,
  val password: String,
  val security: String,
  val hidden: Boolean,
  val timeout: Double,
  val bindProcess: Boolean,
)

/**
 * Joining and leaving, on [WifiCentral]'s thread. One join at a time, as Android 10+ keeps one network request per
 * app: a new join replaces the last.
 *
 * Android 10+ asks the system for the network with a [WifiNetworkSpecifier]: the user picks it in a system sheet,
 * and the network serves the app alone, for as long as the app holds the request. Before Android 10, the app adds a
 * saved network and has the system switch to it.
 */
@SuppressLint("MissingPermission")
class WifiJoiner(private val central: WifiCentral, private val delegate: WifiDelegate) {
  private inner class Join(val id: Double, val options: JoinOptions, val reply: Reply) {
    var callback: ConnectivityManager.NetworkCallback? = null
    var network: Network? = null
    var ssid = options.ssid

    /** The saved network a join before Android 10 added, removed when it ends. */
    var addedNetworkId = -1
    var networkId = -1
    var joined = false
    val timeout = Runnable { fail(this, WifiException("timeout", "Did not join ${options.ssid} in time")) }
  }

  private var current: Join? = null

  private val connectivity get() = central.connectivity
  private val wifiManager get() = central.wifiManager

  /**
   * The network the app joined, while it is on it. Volatile: the prober reads it on its own threads, to connect
   * through the network the app's traffic goes to.
   */
  @Volatile
  var joinedNetwork: Network? = null
    private set

  fun join(id: Double, options: JoinOptions, reply: Reply) {
    current?.let { replace(it) }
    if (!wifiManager.isWifiEnabled) {
      @Suppress("DEPRECATION")
      if (Build.VERSION.SDK_INT >= 29 || !wifiManager.setWifiEnabled(true)) {
        throw WifiException("wifi-off", "Wi-Fi is off; on Android 10+ only the user can turn it on")
      }
    }
    val join = Join(id, options, reply)
    if (Build.VERSION.SDK_INT >= 29) requestSpecified(join) else addSaved(join)
    current = join
    if (options.timeout > 0) central.handler.postDelayed(join.timeout, options.timeout.toLong())
  }

  fun cancel(id: Double) {
    val join = current ?: return
    if (join.id == id && !join.joined) fail(join, WifiException("cancelled", "The join was cancelled"))
  }

  /** Leaves the join `id` if it is still on; its saved network, before Android 10, goes with it. */
  fun leave(id: Double) {
    val join = current ?: return
    if (join.id != id) return
    if (!join.joined) join.reply.reject(WifiException("cancelled", "Left before the join finished"))
    end(join)
  }

  /**
   * Leaves the current join if it went by one of `ssids`, or by any name when `ssids` is null. Before Android 10 also
   * removes the saved networks named `ssids`, which the system lets an app do only for networks it added.
   */
  fun forget(ssids: List<String>?) {
    current?.let { join ->
      if (ssids == null || join.options.ssid in ssids || join.ssid in ssids) {
        if (!join.joined) join.reply.reject(WifiException("cancelled", "Forgotten before the join finished"))
        end(join)
      }
    }
    if (Build.VERSION.SDK_INT < 29) ssids?.forEach(::removeSaved)
  }

  fun close() {
    current?.let { join ->
      join.reply.reject(WifiException("cancelled", "The module was torn down"))
      end(join)
    }
  }

  /** A newer join takes the place of `join`: a pending one is cancelled, a joined one is lost. */
  private fun replace(join: Join) {
    join.reply.reject(WifiException("cancelled", "A newer join replaced this one"))
    val wasJoined = join.joined
    end(join)
    if (wasJoined) delegate.joinLost(join.id, join.ssid)
  }

  private fun fail(join: Join, error: WifiException) {
    if (current !== join) return
    join.reply.reject(error)
    end(join)
  }

  private fun succeed(join: Join, network: Network) {
    central.handler.removeCallbacks(join.timeout)
    join.network = network
    join.joined = true
    joinedNetwork = network
    if (join.options.bindProcess) {
      central.releaseBind()
      connectivity.bindProcessToNetwork(network)
    }
    @Suppress("DEPRECATION")
    val info = wifiManager.connectionInfo?.takeIf { ssidOf(it.ssid) == join.ssid }
    val result =
      buildMap {
        put("ssid", join.ssid)
        bssidOf(info?.bssid)?.let { put("bssid", it) }
        putAll(addressesOf(connectivity.getLinkProperties(network)))
      }
    join.reply.resolve(result)
  }

  /** The phone left the joined network on its own. */
  private fun lose(join: Join) {
    end(join)
    delegate.joinLost(join.id, join.ssid)
  }

  /** Lets go of everything `join` holds: its request, the process binding, the saved network it added. */
  private fun end(join: Join) {
    central.handler.removeCallbacks(join.timeout)
    if (current === join) {
      current = null
      joinedNetwork = null
    }
    join.callback?.let { central.unregister(it) }
    join.callback = null
    val network = join.network
    if (network != null && connectivity.boundNetworkForProcess == network) connectivity.bindProcessToNetwork(null)
    if (join.addedNetworkId != -1) {
      @Suppress("DEPRECATION")
      wifiManager.removeNetwork(join.addedNetworkId)
      join.addedNetworkId = -1
    }
  }

  // Android 10+

  @RequiresApi(29)
  private fun requestSpecified(join: Join) {
    val options = join.options
    val specifier =
      try {
        WifiNetworkSpecifier.Builder().apply {
          if (options.prefix) {
            setSsidPattern(PatternMatcher(options.ssid, PatternMatcher.PATTERN_PREFIX))
          } else {
            setSsid(options.ssid)
          }
          when (options.security) {
            "open" -> {}
            "wpa2" -> setWpa2Passphrase(options.password)
            "wpa3" -> setWpa3Passphrase(options.password)
            else -> throw WifiException("unsupported", "Android 10+ cannot join a ${options.security} network")
          }
          if (options.hidden) setIsHiddenSsid(true)
        }.build()
      } catch (error: IllegalArgumentException) {
        throw WifiException("invalid-argument", error.message ?: "Invalid network options")
      } catch (error: IllegalStateException) {
        throw WifiException("invalid-argument", error.message ?: "Invalid network options")
      }
    val request =
      NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(specifier)
        .build()
    val events =
      object : NetworkEvents {
        override fun onAvailable(network: Network) {
          if (current === join && !join.joined) join.network = network
        }

        // Follows `onAvailable` at once, with the SSID a prefix matched (Android 12+, given the permission).
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
          if (current !== join || join.joined || network != join.network) return
          if (options.prefix) join.ssid = joinedSsid(capabilities) ?: join.ssid
          succeed(join, network)
        }

        // The user dismissed the sheet, or no matching network was in range.
        override fun onUnavailable() =
          fail(join, WifiException("not-found", "${options.ssid} was not found, or the user dismissed the prompt"))

        override fun onLost(network: Network) {
          if (current === join && join.joined && network == join.network) lose(join)
        }
      }
    val callback = callbackOf(true, central::post, events)
    join.callback = callback
    connectivity.requestNetwork(request, callback)
  }

  private fun joinedSsid(capabilities: NetworkCapabilities): String? {
    if (Build.VERSION.SDK_INT >= 31) {
      (capabilities.transportInfo as? WifiInfo)?.let { info -> ssidOf(info.ssid)?.let { return it } }
    }
    @Suppress("DEPRECATION")
    return ssidOf(wifiManager.connectionInfo?.ssid)
  }

  // Before Android 10

  @Suppress("DEPRECATION")
  private fun addSaved(join: Join) {
    val options = join.options
    if (options.prefix) throw WifiException("unsupported", "Joining by prefix needs Android 10")
    if (options.security == "wpa3") throw WifiException("unsupported", "Joining a WPA3 network needs Android 10")
    // The SSID of the network the phone is on, which tells that the switch happened, needs location.
    if (!central.hasLocationPermission()) {
      throw WifiException("unauthorized", "Joining before Android 10 needs the Wi-Fi permission")
    }
    val config =
      WifiConfiguration().apply {
        SSID = quoted(options.ssid)
        hiddenSSID = options.hidden
        when (options.security) {
          "open" -> allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
          "wep" -> {
            allowedKeyManagement.set(WifiConfiguration.KeyMgmt.NONE)
            allowedAuthAlgorithms.set(WifiConfiguration.AuthAlgorithm.OPEN)
            allowedAuthAlgorithms.set(WifiConfiguration.AuthAlgorithm.SHARED)
            // A hex key is given as is; an ASCII one quoted.
            wepKeys[0] = if (options.password.matches(HEX_WEP_KEY)) options.password else quoted(options.password)
            wepTxKeyIndex = 0
          }
          else -> {
            allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK)
            // A 64-digit hex key is the PSK itself; a passphrase is quoted.
            preSharedKey = if (options.password.matches(HEX_PSK)) options.password else quoted(options.password)
          }
        }
      }
    var networkId = wifiManager.addNetwork(config)
    if (networkId != -1) {
      join.addedNetworkId = networkId
    } else {
      // Another app saved this network, and only it may change it: join it as it is.
      networkId = wifiManager.configuredNetworks?.firstOrNull { it.SSID == config.SSID }?.networkId ?: -1
      if (networkId == -1) throw WifiException("join-failed", "Android refused to add ${options.ssid}")
    }
    join.networkId = networkId
    val events =
      object : NetworkEvents {
        override fun onAvailable(network: Network) = check(network)

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = check(network)

        override fun onLost(network: Network) {
          if (current === join && join.joined && network == join.network) lose(join)
        }

        private fun check(network: Network) {
          if (current !== join || join.joined) return
          val info = wifiManager.connectionInfo ?: return
          if (ssidOf(info.ssid) == options.ssid) succeed(join, network)
        }
      }
    val request =
      NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
    val callback = callbackOf(false, central::post, events)
    join.callback = callback
    connectivity.registerNetworkCallback(request, callback)
    if (!wifiManager.enableNetwork(networkId, true) || !wifiManager.reconnect()) {
      end(join)
      throw WifiException("join-failed", "Android refused to switch to ${options.ssid}")
    }
  }

  @Suppress("DEPRECATION")
  private fun removeSaved(ssid: String) {
    val saved = wifiManager.configuredNetworks?.filter { it.SSID == quoted(ssid) } ?: return
    // Only networks this app added can be removed; others are left as they are.
    for (network in saved) wifiManager.removeNetwork(network.networkId)
  }

  companion object {
    private val HEX_PSK = Regex("[0-9A-Fa-f]{64}")
    private val HEX_WEP_KEY = Regex("[0-9A-Fa-f]{10}|[0-9A-Fa-f]{26}|[0-9A-Fa-f]{32}")
  }
}
