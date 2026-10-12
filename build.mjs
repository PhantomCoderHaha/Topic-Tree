// Bundles the extension into dist/ (load that folder unpacked in brave://extensions).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", content: "src/content.ts", panel: "src/panel/main.ts", guide: "src/guide.ts", history: "src/history.ts" },
  outdir: "dist", bundle: true, format: "esm", target: "chrome116", sourcemap: "inline", logLevel: "warning",
});
// content scripts can't be ES modules: rebuild that one as a plain script
await build({ entryPoints: ["src/content.ts"], outfile: "dist/content.js", bundle: true, format: "iife",
              target: "chrome116", logLevel: "warning" });

// the manifest gets the public key so the extension id is fixed (the native host allow-lists it)
const manifest = JSON.parse(readFileSync("static/manifest.base.json", "utf8"));
manifest.key = JSON.parse(readFileSync("static/key.json", "utf8")).key;
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));
for (const f of readdirSync("static")) if (/\.(html|css|png)$/.test(f)) copyFileSync(`static/${f}`, `dist/${f}`);
// a preview page for design work outside the browser extension (uses the sample session)
copyFileSync("static/panel.html", "dist/preview.html");
console.log("built dist/");
