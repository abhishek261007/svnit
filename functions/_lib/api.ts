export interface Env {
  SESSION_SECRET: string;
}

export interface UserInfo {
  Token: string;
  UaNo: string;
  UaType?: number;
  RegNo?: string;
  UserName?: string;
}

export interface MisResponse {
  Message?: string;
  UserInfo?: UserInfo;
  [key: string]: unknown;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Request origin not allowed.");
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) throw new HttpError(413, "Request body is too large.");
  let raw: string;
  try {
    raw = await request.text();
    if (raw.length > 16_384) throw new HttpError(413, "Request body is too large.");
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Expected a JSON object.");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

export async function misRequest(path: string, fields: Record<string, string>, user?: UserInfo): Promise<MisResponse> {
  let response: Response;
  try {
    response = await fetch(`https://mis.svnit.ac.in/svnitstudentdiary/api/v2/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(user ? { token: user.Token, id: user.UaNo, uatype: String(user.UaType ?? "") } : {}),
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new HttpError(502, "Could not reach the SVNIT MIS server.");
  }

  if (!response.ok) throw new HttpError(502, `MIS returned HTTP ${response.status}.`);
  try {
    return await response.json() as MisResponse;
  } catch {
    throw new HttpError(502, "MIS returned an unexpected response.");
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64 + "=".repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new HttpError(500, "SESSION_SECRET must be at least 32 characters.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealSession(user: UserInfo, secret: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({ user, expiresAt: Date.now() + 4 * 60 * 60 * 1000 }));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await encryptionKey(secret), payload);
  const combined = new Uint8Array(nonce.length + encrypted.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(encrypted), nonce.length);
  return toBase64Url(combined);
}

export async function openSession(request: Request, secret: string): Promise<UserInfo | undefined> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)mis_session=([A-Za-z0-9_-]+)/.exec(cookieHeader);
  if (!match) return undefined;
  try {
    const packed = fromBase64Url(match[1]);
    if (packed.length <= 12) return undefined;
    const nonce = packed.slice(0, 12);
    const ciphertext = packed.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, await encryptionKey(secret), ciphertext);
    const session = JSON.parse(new TextDecoder().decode(plaintext)) as { user?: UserInfo; expiresAt?: number };
    if (!session.user?.Token || !session.user.UaNo || !session.expiresAt || session.expiresAt <= Date.now()) return undefined;
    return session.user;
  } catch {
    return undefined;
  }
}

export async function handleError(error: unknown): Promise<Response> {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  return json({ error: "Unexpected server error." }, 500);
}

export const SESSION_COOKIE = "mis_session";
export const SESSION_MAX_AGE = 4 * 60 * 60;
const secureAttribute = (request: Request): string => new URL(request.url).protocol === "https:" ? "; Secure" : "";
export const sessionCookie = (value: string, request: Request): string => `${SESSION_COOKIE}=${value}; HttpOnly${secureAttribute(request)}; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE}`;
export const clearSessionCookie = (request: Request): string => `${SESSION_COOKIE}=; HttpOnly${secureAttribute(request)}; SameSite=Strict; Path=/; Max-Age=0`;
