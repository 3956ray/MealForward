import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("./", import.meta.url),
  out = new URL("../public/mvp/", root);
await mkdir(out, { recursive: true });
const sources = (await readdir(root))
  .filter((x) => /\.(jsx|mjs|css|json|txt)$/.test(x))
  .sort();
const hash = createHash("sha256");
for (const file of sources)
  hash.update(file).update(await readFile(new URL(file, root)));
hash.update(await readFile(new URL("../../src/styles.css", root)));
const buildId = hash.digest("hex").slice(0, 20);
const result = await build({
  absWorkingDir: root.pathname,
  entryPoints: { app: "app.jsx", recipient: "recipient.jsx", product: "product.jsx", "product-recipient": "product-recipient.jsx" },
  outdir: out.pathname,
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  legalComments: "inline",
  entryNames: "[name]",
  outExtension: { ".js": ".mjs" },
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
});
for (const name of ["recipient", "product-recipient"]) {
const recipient = Object.entries(result.metafile.outputs).find(([k]) => k.endsWith("/" + name + ".mjs"))[1];
if (
  Object.keys(recipient.inputs).some((k) =>
    /wallet\.mjs|wagmi|guards\.mjs/.test(k),
  )
)
  throw Error("RECIPIENT_WALLET_DEPENDENCY");
}
for (const file of ["style.css", "THIRD_PARTY_NOTICES.txt"])
  await writeFile(new URL(file, out), await readFile(new URL(file, root)));
for (const page of ["setup", "merchant", "recipient"])
  await writeFile(
    new URL(page + ".html", out),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="mvp-build" content="${buildId}"><title>${page === "recipient" ? "领取餐券" : page === "merchant" ? "商家工作台" : "准备与发券"} · 留膳 mealforward</title><link rel="stylesheet" href="/mvp/style.css"></head><body><div id="root"></div><script type="module" src="/mvp/${page === "recipient" ? "recipient" : "app"}.mjs"></script></body></html>`,
  );
await writeFile(new URL("product-original.css", out), await readFile(new URL("../../src/styles.css", root)));
await writeFile(new URL("product.css", out), await readFile(new URL("product.css", root)));
for (const page of ["product", "product-recipient"])
  await writeFile(new URL(page + ".html", out), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="mvp-build" content="${buildId}"><title>留膳 mealforward · ${page === "product" ? "留一膳，待一人" : "安心领取"}</title><link rel="stylesheet" href="/mvp/product-original.css"><link rel="stylesheet" href="/mvp/product.css"></head><body><div id="root"></div><script type="module" src="/mvp/${page}.mjs"></script></body></html>`);
console.log("MVP static build", buildId);
