import * as Wifi from '@wekor/react-native-wifi';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// The library on `globalThis.wifi`, for a debugger's console.
if (__DEV__) Object.assign(globalThis, { wifi: Wifi });

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Wi-Fi' }} />
      </Stack>
    </>
  );
}
