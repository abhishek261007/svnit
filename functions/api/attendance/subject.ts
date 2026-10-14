import { handleError, json, misRequest, openSession, readJson, requireSameOrigin, type Env } from "../../_lib/api";

export async function onRequestPost({ request, env }: { request: Request; env: Env }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const user = await openSession(request, env.SESSION_SECRET);
    if (!user) return json({ error: "Your session expired. Please sign in again." }, 401);
    const body = await readJson(request);
    const courseNo = typeof body.courseNo === "string" ? body.courseNo : "";
    if (!/^[\w-]{1,32}$/.test(courseNo)) return json({ error: "Select a valid course." }, 400);
    return json(await misRequest("attendance/attsub", { id: user.RegNo || user.UaNo, sub: courseNo }, user));
  } catch (error) {
    return handleError(error);
  }
}
