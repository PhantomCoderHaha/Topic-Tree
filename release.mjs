// Builds release/Topic-Tree-v<version>.zip: the ready-to-load extension plus the optional
// disk-saving host. Nobody installing it needs Node or a build step.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("static/manifest.base.json", "utf8"));
const name = `Topic-Tree-v${version}`;
const stage = `release/${name}`;

execFileSync(process.execPath, ["build.mjs"], { stdio: "inherit" });
rmSync("release", { recursive: true, force: true });
mkdirSync(`${stage}/native-host`, { recursive: true });
cpSync("dist", `${stage}/extension`, { recursive: true });
rmSync(`${stage}/extension/preview.html`); // design-time preview only
for (const f of ["topic_tree_host.py", "install-host.ps1"]) cpSync(`native-host/${f}`, `${stage}/native-host/${f}`);
cpSync("LICENSE", `${stage}/LICENSE`);
writeFileSync(`${stage}/INSTALL.txt`, `Topic Tree ${version}

1. Open brave://extensions (or chrome://extensions) and turn on "Developer mode" (top right).
2. Click "Load unpacked" and choose the "extension" folder inside this folder.
   Keep this folder somewhere permanent: the browser loads the extension from it.
3. Pin the Topic Tree icon (puzzle piece in the toolbar), click it, and press ? for the guide.

OPTIONAL: save every session to disk (needs Python 3, https://www.python.org/downloads/)
   Right-click native-host\\install-host.ps1 > "Run with PowerShell", then reload the extension.
   Without Python, everything else works.

Licence: PolyForm Noncommercial 1.0.0 (see LICENSE). Personal, non-commercial use only.
`.replace(/\n/g, "\r\n"));

const zip = `release/${name}.zip`;
execFileSync("powershell", ["-NoProfile", "-Command",
  `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
if (!existsSync(zip)) throw new Error("zip was not created");
console.log(`built ${zip}`);
