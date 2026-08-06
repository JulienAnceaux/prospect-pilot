import { requireAuth } from "./_lib/auth.mjs";

const EMAIL_PATTERN = /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+/g;
const NETWORKS = {
  ORPI: ["orpi"],
  Foncia: ["foncia"],
  "Century 21": ["century 21", "century21"],
  "Guy Hoquet": ["guy hoquet"],
  "Laforêt": ["laforet", "laforêt"],
  Citya: ["citya"],
  Nestenn: ["nestenn"],
  Arthurimmo: ["arthurimmo", "arthur immo"],
  "Human Immobilier": ["human immobilier"],
  BARNES: ["barnes"]
};
const BAD_EMAIL_MARKERS = [
  "example", "bootstrap", "jquery", "sentry", "webpack", "localhost",
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", "noreply", "no-reply",
  "module-shims", "leaflet", "markercluster"
];
const EMAIL_PRIORITY = [
  "direction", "directeur", "commercial", "contact", "agence",
  "transaction", "vente", "accueil", "info", "gestion", "location"
];

function cleanText(value, max = 300) {
  return String(value || "").trim().slice(0, max);
}

function normalizePlace(place) {
  return {
    place_id: cleanText(place?.place_id, 160),
    nom: cleanText(place?.nom, 160),
    adresse: cleanText(place?.adresse, 300),
    ville_recherchee: cleanText(place?.ville_recherchee, 80),
    keyword: cleanText(place?.keyword, 80),
    telephone: cleanText(place?.telephone, 60),
    site_web: cleanText(place?.site_web, 500),
    note_google: Number(place?.note_google || 0),
    nombre_avis: Number(place?.nombre_avis || 0),
    google_maps_url: cleanText(place?.google_maps_url, 500)
  };
}

function isSafePublicUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname !== "localhost"
      && hostname !== "::1"
      && !/^127\./.test(hostname)
      && !/^10\./.test(hostname)
      && !/^192\.168\./.test(hostname)
      && !/^169\.254\./.test(hostname)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  } catch {
    return false;
  }
}

function validEmail(email) {
  const normalized = email.toLowerCase().replace(/[.,;:]+$/, "");
  return normalized.includes("@")
    && !BAD_EMAIL_MARKERS.some((marker) => normalized.includes(marker));
}

function emailScore(email) {
  const prefix = email.split("@")[0].toLowerCase();
  const index = EMAIL_PRIORITY.findIndex((item) => prefix.startsWith(item));
  if (index >= 0) return 100 - index * 4;
  if (/^(dpo|rgpd|privacy|recrutement|support|webmaster)/.test(prefix)) return 10;
  return 55;
}

async function fetchText(url, timeoutMs = 4500) {
  if (!isSafePublicUrl(url)) return "";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 ProspectPilot/1.1" }
    });
    if (!response.ok) return "";
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html")) return "";
    return (await response.text()).slice(0, 220_000);
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichWebsite(site) {
  if (!isSafePublicUrl(site)) return { emails: [], roles: [] };
  const base = new URL(site);
  const urls = ["", "contact", "mentions-legales"].map((path) =>
    path ? new URL(path, `${base.origin}/`).toString() : site
  );
  const pages = await Promise.all(urls.map((url) => fetchText(url)));
  const combined = pages.join(" ");
  const emails = [...new Set((combined.match(EMAIL_PATTERN) || [])
    .map((email) => email.toLowerCase().replace(/[.,;:]+$/, ""))
    .filter(validEmail))]
    .sort((a, b) => emailScore(b) - emailScore(a))
    .slice(0, 12);
  const lower = combined.toLowerCase();
  const roles = [
    "directeur", "directrice", "responsable", "gérant", "gérante",
    "président", "fondatrice", "fondateur"
  ].filter((role) => lower.includes(role));
  return { emails, roles: [...new Set(roles)] };
}

function detectNetwork(place, emails) {
  const haystack = `${place.nom} ${place.site_web} ${emails.join(" ")}`.toLowerCase();
  for (const [network, markers] of Object.entries(NETWORKS)) {
    if (markers.some((marker) => haystack.includes(marker))) return network;
  }
  return "Indépendant / non identifié";
}

function scoreProspect(place, enrichment, network) {
  let score = 0;
  const reasons = [];
  if (network === "Indépendant / non identifié") {
    score += 25;
    reasons.push("structure indépendante probable");
  }
  if (enrichment.emails.length) {
    score += 25;
    reasons.push("email exploitable");
  }
  if (place.site_web) {
    score += 10;
    reasons.push("site web");
  }
  if (place.nombre_avis >= 100) {
    score += 15;
    reasons.push("forte présence locale");
  } else if (place.nombre_avis >= 30) {
    score += 10;
    reasons.push("présence locale");
  }
  if (place.note_google >= 4.5) {
    score += 10;
    reasons.push("bonne note");
  }
  if (enrichment.roles.length) {
    score += 10;
    reasons.push("décideur potentiel détecté");
  }
  return { score: Math.min(score, 100), reasons };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return output;
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const submitted = Array.isArray(req.body?.places) ? req.body.places : [];
  if (!submitted.length || submitted.length > 10) {
    return res.status(400).json({ error: "Envoyez entre 1 et 10 prospects par lot." });
  }

  const places = submitted.map(normalizePlace);
  const results = await mapWithConcurrency(places, 5, async (place) => {
    const enrichment = await enrichWebsite(place.site_web);
    const reseau = detectNetwork(place, enrichment.emails);
    const scoring = scoreProspect(place, enrichment, reseau);
    return {
      ...place,
      emails: enrichment.emails,
      email_principal: enrichment.emails[0] || "",
      nb_emails: enrichment.emails.length,
      roles_detectes: enrichment.roles,
      reseau,
      type_structure: reseau === "Indépendant / non identifié" ? "Indépendant probable" : "Réseau",
      score_prospect: scoring.score,
      raison_score: scoring.reasons.join(" · "),
      priorite: scoring.score >= 75 ? "Très prioritaire" : scoring.score >= 55 ? "Prioritaire" : "À vérifier",
      action_recommandee: enrichment.emails.length
        ? "Préparer une campagne personnalisée"
        : "Compléter le contact"
    };
  });

  return res.status(200).json({ count: results.length, results });
}
