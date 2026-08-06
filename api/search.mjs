import { requireAuth } from "./_lib/auth.mjs";

const GOOGLE_URL = "https://places.googleapis.com/v1/places:searchText";
const ALLOWED_LIMITS = new Set([20, 40, 60, 100]);

function cleanText(value, max = 80) {
  return String(value || "").trim().slice(0, max);
}

export default async function handler(req, res) {
  if (!requireAuth(req, res)) return;
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Méthode non autorisée." });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Clé Google Places non configurée côté serveur." });
  }

  const keyword = cleanText(req.body?.keyword, 60);
  const location = cleanText(req.body?.location, 60);
  const requestedLimit = Number(req.body?.limit || 20);
  const limit = ALLOWED_LIMITS.has(requestedLimit) ? requestedLimit : 20;
  if (keyword.length < 2 || location.length < 2) {
    return res.status(400).json({ error: "Renseignez un métier et une zone géographique." });
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": [
      "places.id", "places.displayName", "places.formattedAddress",
      "places.nationalPhoneNumber", "places.websiteUri", "places.rating",
      "places.userRatingCount", "places.googleMapsUri", "nextPageToken"
    ].join(",")
  };
  const baseBody = {
    textQuery: `${keyword} ${location} France`,
    languageCode: "fr",
    regionCode: "FR",
    pageSize: 20
  };
  const collected = [];
  let pageToken = "";

  while (collected.length < limit) {
    const googleResponse = await fetch(GOOGLE_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(pageToken ? { ...baseBody, pageToken } : baseBody)
    });
    if (!googleResponse.ok) {
      const detail = await googleResponse.text();
      return res.status(502).json({
        error: "Google Places a refusé la recherche.",
        detail: detail.slice(0, 300)
      });
    }

    const data = await googleResponse.json();
    collected.push(...(data.places || []));
    pageToken = data.nextPageToken || "";
    if (!pageToken || !(data.places || []).length) break;
  }

  const uniquePlaces = [...new Map(
    collected.filter((place) => place.id).map((place) => [place.id, place])
  ).values()].slice(0, limit);

  const places = uniquePlaces.map((place) => ({
    place_id: place.id || "",
    nom: place.displayName?.text || "",
    adresse: place.formattedAddress || "",
    ville_recherchee: location,
    keyword,
    telephone: place.nationalPhoneNumber || "",
    site_web: place.websiteUri || "",
    note_google: Number(place.rating || 0),
    nombre_avis: Number(place.userRatingCount || 0),
    google_maps_url: place.googleMapsUri || ""
  }));

  return res.status(200).json({
    query: { keyword, location, limit },
    generated_at: new Date().toISOString(),
    count: places.length,
    places
  });
}
