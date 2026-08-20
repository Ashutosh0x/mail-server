# Building and running the Android app

## Requirements

| Thing | Version | Note |
|---|---|---|
| JDK | 17–21 | AGP 8.7.3 accepts either. Verified on Microsoft OpenJDK 21.0.9 |
| Android SDK | Platform 35 or 36 | `compileSdk` is 35 |
| Build tools | 34.0.0+ | |
| Gradle | 8.11.1 | Pinned by the wrapper; do not run a system `gradle` |

## First-time setup

`apps/android/local.properties` must point at the SDK:

```properties
sdk.dir=C:/Android/sdk
```

It is untracked, because the path is per-machine.

### JAVA_HOME must point at a JDK that exists

This is the most common failure and it does not look like what it is. Gradle
reports:

```
ERROR: JAVA_HOME is set to an invalid directory: …
```

A stale `JAVA_HOME` — from a Coursier or SDKMAN cache that has since been
cleaned, for instance — makes every Gradle invocation fail before it does any
work. `java -version` succeeding proves nothing: that resolves through `PATH`,
which Gradle does not use.

```bash
# bash
export JAVA_HOME="C:/Program Files/Microsoft/jdk-21.0.9.10-hotspot"

# PowerShell
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.9.10-hotspot"
```

To make it permanent for this project only, put it in
`apps/android/gradle.properties` as `org.gradle.java.home` — but note that file
is tracked, so a machine-specific path belongs in `~/.gradle/gradle.properties`
instead.

## Build

```bash
cd apps/android
./gradlew :app:assembleDebug          # → app/build/outputs/apk/debug/app-debug.apk
./gradlew :app:testDebugUnitTest      # unit tests
./gradlew :app:installDebug           # to a connected device or emulator
```

## Pointing the app at a server

The base URL is a build-time property, per build type, in `gradle.properties`:

```properties
MAILSERVER_BASE_URL_DEBUG=http://10.0.2.2:3000/
MAILSERVER_BASE_URL_RELEASE=
```

`10.0.2.2` is the **emulator's** route to the host machine's localhost. It is
meaningless on a physical phone.

Override without editing a tracked file:

```bash
./gradlew :app:assembleDebug -PMAILSERVER_BASE_URL_DEBUG=http://192.168.0.103:3000/
```

## Running on a physical phone

Four things must all be true, and three of them fail silently.

### 1. The phone must be in developer mode with USB debugging on

Settings → About phone → tap **Build number** seven times, then Settings →
System → Developer options → **USB debugging**.

Plug in over USB and accept the *Allow USB debugging?* prompt on the phone —
`adb devices` shows `unauthorized` until you do, which looks like a broken cable.

```bash
adb devices -l          # expect: <serial>  device  model:…
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell monkey -p com.mailserver.android.debug -c android.intent.category.LAUNCHER 1
```

Note the **`.debug` suffix**: `applicationId` is `com.mailserver.android` but
debug builds append `applicationIdSuffix = ".debug"`, so the installed package
is `com.mailserver.android.debug`. Launching `com.mailserver.android` reports
`Activity class … does not exist`, which reads like a manifest bug and is not
one.

### 2. Phone and host must be on the same network

The phone reaches the dev server by the host's LAN address, so both must be on
the same Wi-Fi — and that network must not have client isolation enabled, which
many guest and public networks do.

Find the host address:

```bash
ipconfig | grep -A6 -i "Wireless LAN adapter Wi-Fi" | grep IPv4
```

Use the **Wi-Fi** adapter's address. A machine with Hyper-V, VirtualBox or WSL
has several `192.168.*` addresses on virtual adapters — `192.168.56.1` is
VirtualBox's host-only network and is not reachable from a phone.

### 3. The dev server must listen on all interfaces

```bash
netstat -ano | grep ':3000 '     # want 0.0.0.0:3000, not 127.0.0.1:3000
```

Next's `next dev` binds `0.0.0.0` by default. If it is bound to loopback, pass
`-H 0.0.0.0`.

Windows Firewall must also allow inbound connections to the Node process. The
first `next dev` run normally raises a prompt; if it was dismissed, no rule
exists and the phone's connection is dropped without any log line on either
side. Verify from the host itself first:

```bash
curl -o /dev/null -w "%{http_code}\n" http://192.168.0.103:3000/api/config
```

A `200` there proves the server is listening but not that the firewall permits
*remote* connections — a browser on the phone at the same URL is the real test,
and it is worth doing before blaming the app.

### 4. Cleartext must be permitted

Debug builds permit it via `src/debug/res/xml/network_security_config.xml`.
Release builds do not, deliberately — see the comment in that file and in
`src/main/res/xml/network_security_config.xml`.

Symptom when this is wrong: every request fails instantly with a
`CLEARTEXT communication … not permitted` in logcat, surfacing in the app as
"Cannot reach the server."

### Watching what the app is doing

```bash
adb logcat --pid=$(adb shell pidof com.mailserver.android.debug)
```

The OkHttp interceptor logs at `BASIC` in debug builds — method, URL, status and
timing. It is **never** raised to `BODY`, in any build: that would put message
contents, recipient addresses and the session cookie into logcat, which is
readable by anyone with the phone plugged in.

### Release builds must be HTTPS

There is deliberately no default for `MAILSERVER_BASE_URL_RELEASE`.

The session cookie is issued with `secure` set when `NODE_ENV=production`, so a
plain-HTTP production build cannot authenticate at all — the cookie is set and
then never sent back. Failing the build is better than shipping an app that
silently cannot log in.

## Running the server it talks to

```bash
# repo root
npm install
npm run dev          # apps/web on :3000
```

The Android app is a **client of the existing Mail Server**. It has no backend
of its own and no local mail store; every list, count and action resolves to
`apps/web/app/api/*`. See `api-integration.md` for the contracts.

## Cleaning up

The configuration cache is on. If a build behaves as though it is ignoring a
change to `gradle.properties`:

```bash
./gradlew --stop
rm -rf .gradle app/build
```

An `hs_err_pid*.log` in `apps/android/` is a JVM crash dump, usually from Gradle
running out of native memory on a machine under load. It is safe to delete;
lower `org.gradle.jvmargs` or turn off `org.gradle.parallel` if it recurs.
