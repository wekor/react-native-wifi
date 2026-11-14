package com.wekor.reactnativewifi

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class WifiPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WifiModule.NAME) WifiModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      WifiModule.NAME to
        ReactModuleInfo(
          name = WifiModule.NAME,
          className = WifiModule::class.java.name,
          canOverrideExistingModule = false,
          needsEagerInit = false,
          isCxxModule = false,
          isTurboModule = true,
        )
    )
  }
}
