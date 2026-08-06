import { isAuthenticated } from "./_lib/auth.mjs";

export default async function handler(req, res) {
  return res.status(200).json({ authenticated: isAuthenticated(req) });
}
