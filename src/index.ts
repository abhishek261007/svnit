import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const BASE_URL = "https://mis.svnit.ac.in/svnitstudentdiary/api/v2/";
const TIMEOUT_MS = 20_000;

type UserInfo = {
  Token?: string;
  UaNo?: string;
  UaType?: number;
  RegNo?: string;
  UserName?: string;
};

type ApiResponse = {
  Message?: string;
  Status?: string | number | boolean;
  UserInfo?: UserInfo;
  StudentCourses?: Array<Record<string, unknown>>;
  AttendanceDetails?: Array<Record<string, unknown>>;
  AttendanceBySubject?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

function promptHidden(label: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this in a terminal so the password can be entered without echoing.");
  }

  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
        } else if (char >= " ") {
          value += char;
        }
      }
    };
    stdin.on("data", onData);
  });
}

async function request(path: string, fields: Record<string, string>, authHeaders?: Record<string, string>): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(new URL(path, BASE_URL), {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(authHeaders ?? {}),
      },
      body: new URLSearchParams(fields),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    try {
      return JSON.parse(text) as ApiResponse;
    } catch {
      throw new Error(`${path} returned a non-JSON response: ${text.slice(0, 300)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function printJson(title: string, value: unknown): void {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const username = (await rl.question("MIS username: ")).trim();
    if (!username) throw new Error("Username cannot be empty.");
    const password = await promptHidden("MIS password (hidden): ");
    if (!password) throw new Error("Password cannot be empty.");

    console.log("\nSigning in…");
    const login = await request("initial/auth", { username, password });
    if (!login.UserInfo?.Token || !login.UserInfo.UaNo) {
      throw new Error(`Login did not return the expected account/token data. Server message: ${login.Message ?? "(none)"}`);
    }

    const user = login.UserInfo;
    console.log(`Signed in${user.UserName ? ` as ${user.UserName}` : ""}.`);
    const accountId = user.RegNo || user.UaNo;
    if (!accountId) throw new Error("Login response is missing the registration/account number.");
    const headers = {
      token: user.Token!,
      id: user.UaNo!,
      uatype: String(user.UaType ?? ""),
    };

    const choice = (await rl.question("Choose: [1] attendance summary  [2] course list  [3] attendance by subject: ")).trim();
    if (choice === "1") {
      const result = await request("attendance/att", { id: accountId }, headers);
      printJson("Attendance summary", result);
    } else if (choice === "2") {
      const result = await request("attendance/course", { id: accountId }, headers);
      printJson("Courses", result);
    } else if (choice === "3") {
      const courses = await request("attendance/course", { id: accountId }, headers);
      const list = Array.isArray(courses.StudentCourses) ? courses.StudentCourses : [];
      if (!list.length) {
        printJson("Course response", courses);
        return;
      }
      console.log("\nCourses:");
      list.forEach((course, index) => console.log(`${index + 1}. ${String(course.CourseName ?? course.CourseCode ?? "Course")} (course no. ${String(course.CourseNo ?? "?")})`));
      const index = Number((await rl.question("Course number from list: ")).trim()) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= list.length) throw new Error("Invalid course selection.");
      const courseNo = String(list[index]?.CourseNo ?? "");
      if (!courseNo) throw new Error("Selected course has no CourseNo.");
      const result = await request("attendance/attsub", { id: accountId, sub: courseNo }, headers);
      printJson("Attendance by subject", result);
    } else {
      throw new Error("Choose 1, 2, or 3.");
    }

    console.log("\nDone. Credentials and token were kept in memory only and were not written to disk.");
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nError: ${message}`);
  process.exitCode = 1;
});
