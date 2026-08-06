import { clearSessionCookie } from "./_lib/auth.mjs";

export default async function handler(req, res) {
  res.setHeader("Set-Cookie", clearSessionCookie());
  return res.status(200).json({ ok: true });
}
