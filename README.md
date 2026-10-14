# SVNIT Attendance

A local TypeScript web app for logging in to SVNIT MIS and viewing attendance. The routes and response fields were reconstructed from the SVNIT Student Diary APK. It provides a course-wise summary and date-wise class history for each subject.

## Start locally

Requires Node.js 20 or newer. From this folder:

```sh
npm install
npm run typecheck
npm start
```

Open <http://127.0.0.1:3000> in your browser. Keep the terminal running while using it; press Ctrl+C to stop. You can set another port with `PORT=3001 npm start`.

## Privacy and limitations

The server binds only to `127.0.0.1`. The password is sent to the MIS API over HTTPS and is not written to disk. The API token is kept in server memory for the active session and cleared on sign-out or server shutdown. This app only makes read-only attendance requests; it does not store or change attendance data.

This is an unofficial local client, based on the currently observed app API. The MIS server may change its routes, fields, or access rules.
