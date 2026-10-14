import { handleError, json, misRequest, readJson, requireSameOrigin, sealSession, sessionCookie, validateSessionSecret, type Env, type UserInfo } from "../_lib/api";

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    requireSameOrigin(request);
    validateSessionSecret(env.SESSION_SECRET);
    const body = await readJson(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) return json({ error: "Enter your username and password." }, 400);

    const result = await misRequest("initial/auth", { username, password });
    const user = result.UserInfo as UserInfo | undefined;
    if (!user?.Token || !user.UaNo) return json({ error: result.Message || "Login failed. Check your credentials and try again." }, 401);

    const cookie = await sealSession(user, env.SESSION_SECRET);
    return json({ user: { name: user.UserName ?? "Student", regNo: user.RegNo ?? "", uaType: user.UaType ?? null } }, 200, {
      "set-cookie": sessionCookie(cookie, request),
    });
  } catch (error) {
    return handleError(error);
  }
}
