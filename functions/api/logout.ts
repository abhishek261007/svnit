import { clearSessionCookie, handleError, json, requireSameOrigin } from "../_lib/api";

export async function onRequestPost({ request }: { request: Request }): Promise<Response> {
  try {
    requireSameOrigin(request);
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(request) });
  } catch (error) {
    return handleError(error);
  }
}
