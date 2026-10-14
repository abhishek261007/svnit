import { handleError, json, openSession, type Env } from "../_lib/api";

export async function onRequestGet({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    const user = await openSession(request, env.SESSION_SECRET);
    if (!user) return json({ error: "Not signed in." }, 401);
    return json({ user: { name: user.UserName ?? "Student", regNo: user.RegNo ?? "", uaType: user.UaType ?? null } });
  } catch (error) {
    return handleError(error);
  }
}
