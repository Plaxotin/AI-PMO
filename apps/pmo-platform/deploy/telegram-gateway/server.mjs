import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

const port = Number(process.env.PORT || 3101);
const gatewaySecret = process.env.GATEWAY_SECRET || "";
const allowedMethods = new Set([
  "getMe",
  "setWebhook",
  "getWebhookInfo",
  "sendMessage",
  "editMessageText",
  "answerCallbackQuery",
]);

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function digest(value) {
  return createHmac("sha256", "aipmo-telegram-gateway").update(value).digest();
}

function authorized(value) {
  return Boolean(
    gatewaySecret &&
    value &&
    timingSafeEqual(digest(value), digest(gatewaySecret)),
  );
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Payload too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true, service: "aipmo-telegram-gateway" });
  }
  const match = req.url?.match(/^\/v1\/telegram\/([A-Za-z]+)$/);
  if (req.method !== "POST" || !match || !allowedMethods.has(match[1])) {
    return json(res, 404, { ok: false, error: "Not found" });
  }
  if (!authorized(req.headers["x-gateway-key"])) {
    return json(res, 401, { ok: false, error: "Unauthorized" });
  }

  try {
    const body = await readBody(req);
    const token = body.token;
    delete body.token;
    if (typeof token !== "string" || !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return json(res, 400, { ok: false, error: "Invalid bot token format" });
    }
    const upstream = await fetch(`https://api.telegram.org/bot${token}/${match[1]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(text);
  } catch {
    json(res, 502, { ok: false, error: "Telegram upstream unavailable" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Telegram gateway listening on 127.0.0.1:${port}`);
});
