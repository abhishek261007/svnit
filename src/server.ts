import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL = "https://mis.svnit.ac.in/svnitstudentdiary/api/v2/";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT ?? 3000);
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const PUBLIC_DIR = resolve(fileURLToPath(new URL("../public/", import.meta.url)));

type UserInfo = {
  Token: string;
  UaNo: string;
  UaType?: number;
  RegNo?: string;
  UserName?: string;
};

type MisResponse = {
  Message?: string;
  UserInfo?: UserInfo;
  StudentCourses?: Array<Record<string, unknown>>;
  AttendanceDetails?: Array<Record<string, unknown>>;
  AttendanceBySubject?: Array<Record<string, unknown>>;
  StudInfo?: Record<string, unknown>;
  [key: string]: unknown;
};

type Session = { user: UserInfo; expiresAt: number };
const sessions = new Map<string, Session>();

function sendJson(res: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(JSON.stringify(value));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let data = "";
  for await (const chunk of req) {
    data += chunk.toString();
    if (data.length > 16_384) throw new Error("Request body is too large.");
  }
  const parsed: unknown = JSON.parse(data || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

async function misRequest(path: string, fields: Record<string, string>, user?: UserInfo): Promise<MisResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(new URL(path, BASE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(user ? { token: user.Token, id: user.UaNo, uatype: String(user.UaType ?? "") } : {}),
      },
      body: new URLSearchParams(fields),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`MIS returned HTTP ${response.status}.`);
    try {
      return JSON.parse(text) as MisResponse;
    } catch {
      throw new Error("MIS returned an unexpected response.");
    }
  } finally {
    clearTimeout(timer);
  }
}

function sessionFor(req: IncomingMessage): { id: string; session: Session } | undefined {
  const cookie = req.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith("sid="));
  const id = cookie?.slice(4);
  const session = id ? sessions.get(id) : undefined;
  if (!id || !session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id, session };
}

function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}`) throw new Error("Request origin not allowed.");
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!new Set(["index.html", "app.js", "styles.css"]).has(relative)) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }
  try {
    const content = await readFile(resolve(PUBLIC_DIR, relative));
    const contentType = extname(relative) === ".html" ? "text/html; charset=utf-8" : extname(relative) === ".css" ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8";
    res.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-cache",
      "content-security-policy": "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found." });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/app.js" || url.pathname === "/styles.css")) {
      await serveStatic(url.pathname, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/session") {
      const found = sessionFor(req);
      if (!found) {
        sendJson(res, 401, { error: "Not signed in." });
        return;
      }
      const user = found.session.user;
      sendJson(res, 200, { user: { name: user.UserName ?? "Student", regNo: user.RegNo ?? "", uaType: user.UaType ?? null } });
      return;
    }
    if (req.method !== "POST" || !url.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "Not found." });
      return;
    }
    assertSameOrigin(req);

    if (url.pathname === "/api/login") {
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!username || !password) {
        sendJson(res, 400, { error: "Enter your username and password." });
        return;
      }
      const result = await misRequest("initial/auth", { username, password });
      const user = result.UserInfo;
      if (!user?.Token || !user.UaNo) {
        sendJson(res, 401, { error: result.Message || "Login failed. Check your credentials and try again." });
        return;
      }
      const id = randomBytes(32).toString("hex");
      sessions.set(id, { user, expiresAt: Date.now() + SESSION_TTL_MS });
      sendJson(res, 200, { user: { name: user.UserName ?? "Student", regNo: user.RegNo ?? "", uaType: user.UaType ?? null } }, {
        "set-cookie": `sid=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
      });
      return;
    }

    const found = sessionFor(req);
    if (!found) {
      sendJson(res, 401, { error: "Your session expired. Please sign in again." }, { "set-cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      return;
    }
    const user = found.session.user;
    const regNo = user.RegNo || user.UaNo;

    if (url.pathname === "/api/logout") {
      sessions.delete(found.id);
      sendJson(res, 200, { ok: true }, { "set-cookie": "sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
      return;
    }
    if (url.pathname === "/api/courses") {
      const result = await misRequest("attendance/course", { id: regNo }, user);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === "/api/attendance/summary") {
      const result = await misRequest("attendance/att", { id: regNo }, user);
      sendJson(res, 200, result);
      return;
    }
    if (url.pathname === "/api/attendance/subject") {
      const body = await readJson(req);
      const courseNo = typeof body.courseNo === "string" ? body.courseNo : "";
      if (!courseNo || !/^[\w-]{1,32}$/.test(courseNo)) {
        sendJson(res, 400, { error: "Select a valid course." });
        return;
      }
      const result = await misRequest("attendance/attsub", { id: regNo, sub: courseNo }, user);
      sendJson(res, 200, result);
      return;
    }
    sendJson(res, 404, { error: "Not found." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    const status = message.includes("origin") ? 403 : message.includes("Request body") || message.includes("Expected a JSON") ? 400 : 502;
    sendJson(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SVNIT Attendance is running at http://${HOST}:${PORT}`);
  console.log("Keep this terminal open while using the app. Press Ctrl+C to stop.");
});
