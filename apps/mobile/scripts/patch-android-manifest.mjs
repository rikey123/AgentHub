import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve("android/app/src/main/AndroidManifest.xml");
let manifest = readFileSync(manifestPath, "utf8");

if (!manifest.includes("android:usesCleartextTraffic=")) {
  manifest = manifest.replace(
    /android:supportsRtl="true"\s*/u,
    'android:supportsRtl="true"\n        android:usesCleartextTraffic="true"\n        '
  );
}

if (!manifest.includes("android.permission.CAMERA")) {
  manifest = manifest.replace(
    /(\s*<uses-permission android:name="android\.permission\.INTERNET" \/>\s*)/u,
    '$1    <uses-permission android:name="android.permission.CAMERA" />\n'
  );
}

writeFileSync(manifestPath, manifest, "utf8");
