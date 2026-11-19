#!/bin/sh
# Builds local/story/Story Transcribe.app (on-device speech to text for the story page). Run from this folder.
set -e
APP="../local/story/Story Transcribe.app"
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS"
cat > "$APP/Contents/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.ohd.story-transcribe</string>
<key>CFBundleName</key><string>Story Transcribe</string>
<key>CFBundleExecutable</key><string>transcribe</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>NSSpeechRecognitionUsageDescription</key><string>Turns Erica's story recordings into text on this Mac. The audio stays on this Mac.</string>
</dict></plist>
PL
swiftc -O transcribe.swift -o "$APP/Contents/MacOS/transcribe"
codesign --force --sign - "$APP"
echo "built $APP"
