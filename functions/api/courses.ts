import { handleError, json, misRequest, openSession, type Env } from "../_lib/api";

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    const user = await openSession(request, env.SESSION_SECRET);
    if (!user) return json({ error: "Your session expired. Please sign in again." }, 401);
    return json(await misRequest("attendance/course", { id: user.RegNo || user.UaNo }, user));
  } catch (error) {
    return handleError(error);
  }
}
