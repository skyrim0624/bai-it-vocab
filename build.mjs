import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "fs";

const isWatch = process.argv.includes("--watch");

const common = {
  bundle: true,
  outdir: "dist",
  minify: !isWatch,
  sourcemap: isWatch,
};

/**
 * 将静态文件（manifest、HTML、icons）复制到 dist/
 * Chrome 加载 dist/ 作为扩展根目录
 */
function copyStaticFiles() {
  // manifest.json
  cpSync("manifest.json", "dist/manifest.json");

  // HTML 文件
  cpSync("popup.html", "dist/popup.html");
  cpSync("options.html", "dist/options.html");

  // CSS 文件
  cpSync("options.css", "dist/options.css");

  // 图标
  mkdirSync("dist/icons", { recursive: true });
  cpSync("icons", "dist/icons", { recursive: true });

  // 词库数据：不打进 content.js，按需作为扩展资源加载，降低每个页面的基础内存。
  mkdirSync("dist/data", { recursive: true });
  cpSync("data", "dist/data", { recursive: true });
}

// Background Service Worker — ESM（MV3 要求 type: module）
const backgroundBuild = esbuild.build({
  ...common,
  entryPoints: { background: "src/background/index.ts" },
  format: "esm",
});

// Content Script / Popup / Options — IIFE（不支持 ESM）
const contentBuild = esbuild.build({
  ...common,
  entryPoints: {
    content: "src/content/index.ts",
    popup: "src/popup/index.ts",
    options: "src/options/index.tsx",
  },
  format: "iife",
  jsx: "automatic",
  jsxImportSource: "react",
});

if (isWatch) {
  const [bgCtx, contentCtx] = await Promise.all([
    esbuild.context({
      ...common,
      entryPoints: { background: "src/background/index.ts" },
      format: "esm",
    }),
    esbuild.context({
      ...common,
      entryPoints: {
        content: "src/content/index.ts",
        popup: "src/popup/index.ts",
        options: "src/options/index.tsx",
      },
      format: "iife",
      jsx: "automatic",
      jsxImportSource: "react",
    }),
  ]);
  copyStaticFiles();
  await Promise.all([bgCtx.watch(), contentCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([backgroundBuild, contentBuild]);
  copyStaticFiles();
  console.log("Build complete.");
}
