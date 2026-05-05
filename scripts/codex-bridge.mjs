import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HOST = process.env.BAIT_CODEX_HOST || "127.0.0.1";
const PORT = Number.parseInt(process.env.BAIT_CODEX_PORT || "17877", 10);
const BRIDGE_TOKEN = process.env.BAIT_CODEX_BRIDGE_TOKEN || "bait-local-codex";
const CODEX_BIN = process.env.BAIT_CODEX_BIN || "codex";
const CODEX_MODEL = process.env.BAIT_CODEX_MODEL || "gpt-5.2";
const CODEX_CWD = process.env.BAIT_CODEX_CWD || process.cwd();
const REQUEST_LIMIT_BYTES = Number.parseInt(process.env.BAIT_CODEX_REQUEST_LIMIT || "1048576", 10);
const CODEX_TIMEOUT_MS = Number.parseInt(process.env.BAIT_CODEX_TIMEOUT_MS || "120000", 10);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("http://127.0.0.1:") ||
    origin.startsWith("http://localhost:")
  );
}

function corsHeaders(origin) {
  const allowOrigin = isAllowedOrigin(origin) && origin ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function sendJson(res, status, data, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(data));
}

function sendError(res, status, message, origin) {
  sendJson(res, status, {
    error: {
      message,
      type: "bait_codex_bridge_error",
    },
  }, origin);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > REQUEST_LIMIT_BYTES) {
        reject(new Error("请求体太大"));
        req.destroy();
        return;
      }
      body += chunk.toString("utf8");
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("请求 JSON 格式无效"));
      }
    });

    req.on("error", reject);
  });
}

function hasValidToken(req) {
  if (!BRIDGE_TOKEN) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${BRIDGE_TOKEN}`;
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  return content
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildCodexPrompt(messages) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const transcript = normalizedMessages
    .map((message) => {
      const role = typeof message?.role === "string" ? message.role : "user";
      return `## ${role}\n${contentToText(message?.content).trim()}`;
    })
    .join("\n\n")
    .trim();

  return [
    "你正在作为掰 it Chrome 扩展的本机 Codex 桥接服务。",
    "严格执行最后一条用户请求；如果请求要求 JSON，只返回可解析 JSON，不要加 Markdown 代码块或额外说明。",
    transcript,
  ].filter(Boolean).join("\n\n");
}

async function runCodex(prompt, model) {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "bait-codex-bridge-"));
  const outputFile = path.join(tmpDir, "last-message.txt");

  const args = [
    "exec",
    "-",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputFile,
    "--color",
    "never",
    "--model",
    model,
    "--ephemeral",
  ];

  const stderrChunks = [];
  const child = spawn(CODEX_BIN, args, {
    cwd: CODEX_CWD,
    stdio: ["pipe", "ignore", "pipe"],
    env: {
      ...process.env,
      NO_COLOR: "1",
    },
  });

  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex CLI 调用超时（${Math.round(CODEX_TIMEOUT_MS / 1000)} 秒）`));
    }, CODEX_TIMEOUT_MS);

    child.stderr.on("data", (chunk) => {
      stderrChunks.push(chunk.toString("utf8"));
      if (stderrChunks.join("").length > 8000) {
        stderrChunks.splice(0, stderrChunks.length - 1);
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = stderrChunks.join("").trim();
      reject(new Error(stderr || `Codex CLI 退出码 ${code}`));
    });
  });

  child.stdin.end(prompt);

  try {
    await done;
    const content = await readFile(outputFile, "utf8");
    return content.trim();
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function handleChatCompletions(req, res, origin) {
  if (!hasValidToken(req)) {
    sendError(res, 401, "本机桥接 Token 不匹配", origin);
    return;
  }

  const body = await readRequestBody(req);
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : CODEX_MODEL;
  const prompt = buildCodexPrompt(body.messages);
  if (!prompt.trim()) {
    sendError(res, 400, "messages 不能为空", origin);
    return;
  }

  const content = await runCodex(prompt, model);

  sendJson(res, 200, {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  }, origin);
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";

  if (!isAllowedOrigin(origin)) {
    sendError(res, 403, "Origin 不允许", origin);
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        provider: "codex-cli",
        model: CODEX_MODEL,
        host: HOST,
        port: PORT,
      }, origin);
      return;
    }

    if (req.method === "GET" && req.url === "/v1/models") {
      if (!hasValidToken(req)) {
        sendError(res, 401, "本机桥接 Token 不匹配", origin);
        return;
      }
      sendJson(res, 200, {
        object: "list",
        data: [
          {
            id: CODEX_MODEL,
            object: "model",
            owned_by: "local-codex",
          },
        ],
      }, origin);
      return;
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      await handleChatCompletions(req, res, origin);
      return;
    }

    sendError(res, 404, "未找到接口", origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "桥接服务内部错误";
    sendError(res, 500, message.slice(0, 1000), origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Bai it Codex bridge is listening on http://${HOST}:${PORT}`);
  console.log(`Model: ${CODEX_MODEL}`);
  console.log("Use this only on your own machine. Do not expose this port to the internet.");
});
