// macOS names an app in the menu bar, the Dock and ⌘-Tab, and draws its icon, from its bundle - in development the
// Electron.app in node_modules, which says Electron. This calls it turri and gives it turri's icon (build/icon.icns) and
// an identifier of its own - the Dock keeps the name it saw for com.github.Electron - then signs it again, ad hoc, since
// its Info.plist changed. Run after every install; it does nothing on other systems.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const ID = "dev.turri.app";

if (process.platform === "darwin") {
  const ROOT = join(import.meta.dirname, "..");
  const binary = createRequire(import.meta.url)("electron");
  const bundle = join(dirname(binary), "..", "..");
  const plist = join(bundle, "Contents", "Info.plist");
  const icon = join(bundle, "Contents", "Resources", "electron.icns");
  const ours = join(ROOT, "build", "icon.icns");
  const buddy = (command, file = plist) => execFileSync("/usr/libexec/PlistBuddy", ["-c", command, file], { encoding: "utf8" }).trim();
  // The helpers' identifiers follow the app's, as a packaged app has them: <id>.helper.
  const frameworks = join(bundle, "Contents", "Frameworks");
  const helpers = readdirSync(frameworks).filter((name) => name.endsWith(".app")).map((name) => join(frameworks, name, "Contents", "Info.plist"));
  const named =
    buddy("Print :CFBundleName") === "turri" &&
    buddy("Print :CFBundleDisplayName") === "turri" &&
    buddy("Print :CFBundleIdentifier") === ID &&
    helpers.every((helper) => buddy("Print :CFBundleIdentifier", helper) === `${ID}.helper`);
  const drawn = existsSync(icon) && readFileSync(icon).equals(readFileSync(ours));
  if (!named || !drawn) {
    buddy("Set :CFBundleName turri");
    buddy("Set :CFBundleDisplayName turri");
    buddy(`Set :CFBundleIdentifier ${ID}`);
    for (const helper of helpers) buddy(`Set :CFBundleIdentifier ${ID}.helper`, helper);
    copyFileSync(ours, icon);
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle], { stdio: "ignore" });
    // Finder and the Dock cache an app's name and icon: a newer bundle is read again.
    const now = new Date();
    utimesSync(bundle, now, now);
    execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", bundle]);
    console.log("Electron.app is turri now, with its icon.");
  }
}
