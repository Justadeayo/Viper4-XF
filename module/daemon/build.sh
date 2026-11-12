#!/bin/sh
# Builds module/viperd.dex from ViperDaemon.java using the Android SDK.
# Needs ANDROID_HOME (or ANDROID_SDK_ROOT) with a platform and build-tools.
set -e

HERE=$(cd "$(dirname "$0")" && pwd)
MODULE_DIR=$(dirname "$HERE")/module
SDK="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"

[ -n "$SDK" ] || { echo "Set ANDROID_HOME to your Android SDK" >&2; exit 1; }

PLATFORM=$(ls -d "$SDK"/platforms/android-* 2>/dev/null | sort -V | tail -1)
BUILD_TOOLS=$(ls -d "$SDK"/build-tools/* 2>/dev/null | sort -V | tail -1)
[ -n "$PLATFORM" ] || { echo "No Android platform in $SDK/platforms" >&2; exit 1; }
[ -n "$BUILD_TOOLS" ] || { echo "No build-tools in $SDK/build-tools" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

javac --release 8 -cp "$PLATFORM/android.jar" -d "$TMP" "$HERE/ViperDaemon.java"
"$BUILD_TOOLS/d8" --lib "$PLATFORM/android.jar" --output "$TMP" "$TMP"/ViperDaemon.class
cp "$TMP/classes.dex" "$MODULE_DIR/viperd.dex"
echo "Built $MODULE_DIR/viperd.dex"
