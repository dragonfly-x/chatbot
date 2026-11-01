const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 20 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const RATE_LIMIT = 12;
const RATE_WINDOW_MS = 60 * 1000;
const rateLimits = new Map();
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
]);
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ||
    `http://localhost:${PORT},http://127.0.0.1:${PORT}`)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return "Send between 1 and 20 chat messages.";
  }

  for (const message of messages) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > MAX_MESSAGE_LENGTH
    ) {
      return "Each message must have a valid role and contain 1 to 4000 characters.";
    }
  }

  if (messages[messages.length - 1].role !== "user") {
    return "The last message must be from the user.";
  }
  return null;
}

function checkRateLimit(req, res) {
  const now = Date.now();
  const ip = req.socket.remoteAddress || "unknown";
  const recentRequests = (rateLimits.get(ip) || []).filter(
    (timestamp) => now - timestamp < RATE_WINDOW_MS,
  );

  if (recentRequests.length >= RATE_LIMIT) {
    sendJson(res, 429, { error: "Too many messages. Please wait a minute and try again." });
    return false;
  }

  recentRequests.push(now);
  rateLimits.set(ip, recentRequests);
  return true;
}

async function handleChat(req, res) {
  if (!process.env.GROQ_API_KEY) {
    sendJson(res, 503, { error: "Chatbot is not configured. Set GROQ_API_KEY on the server." });
    return;
  }

  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) {
    sendJson(res, 403, { error: "Request origin is not allowed." });
    return;
  }

  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    sendJson(res, 415, { error: "Content-Type must be application/json." });
    return;
  }

  if (!checkRateLimit(req, res)) {
    return;
  }

  const body = await readJsonBody(req);
  const validationError = validateMessages(body?.messages);
  if (validationError) {
    sendJson(res, 400, { error: validationError });
    return;
  }

  const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: "You are a helpful chatbot. Answer the user's questions clearly and conversationally." },
        ...body.messages,
      ],
      max_tokens: 512,
    }),
  });

  let result;
  try {
    result = await groqResponse.json();
  } catch {
    sendJson(res, 502, { error: "Groq returned an unreadable response. Please try again." });
    return;
  }

  if (!groqResponse.ok) {
    const message = result.error?.message || `Groq request failed (${groqResponse.status}).`;
    sendJson(res, 502, { error: message });
    return;
  }

  const reply = result.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    sendJson(res, 502, { error: "Groq returned an empty response. Please try again." });
    return;
  }

  sendJson(res, 200, { reply });
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  try {
    if (req.method === "POST" && req.url === "/api/chat") {
      await handleChat(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed." });
      return;
    }

    const file = publicFiles.get(req.url);
    if (!file) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }

    const filePath = path.join(__dirname, file[0]);
    fs.readFile(filePath, (error, content) => {
      if (error) {
        console.error("Could not read requested file:", error);
        sendJson(res, 500, { error: "Could not load the requested page." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": file[1],
        "Cache-Control": "no-cache",
      });
      res.end(content);
    });
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 502;
    if (status === 502) {
      console.error("Chat request failed:", error);
    }
    sendJson(
      res,
      status,
      { error: status === 502 ? "Unable to contact Groq. Please try again." : error.message },
    );
  }
});

server.listen(PORT, () => {
  console.log(`Chatbot server listening at http://localhost:${PORT}`);
  if (!process.env.GROQ_API_KEY) {
    console.warn("GROQ_API_KEY is not set. Add it to .env to enable chat.");
  }
});
