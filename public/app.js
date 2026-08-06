const state = { results: [], query: null };
const $ = (selector) => document.querySelector(selector);

function showAuthenticated(authenticated) {
  $("#loginView").hidden = authenticated;
  $("#appView").hidden = !authenticated;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Une erreur est survenue.");
  return payload;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderResults(payload) {
  state.results = payload.results;
  state.query = payload.query;
  const withEmail = state.results.filter((item) => item.email_principal).length;
  const priority = state.results.filter((item) => item.priorite === "Très prioritaire").length;
  const average = state.results.length
    ? Math.round(state.results.reduce((sum, item) => sum + item.score_prospect, 0) / state.results.length)
    : 0;

  $("#resultsTitle").textContent = `${payload.count} résultats · ${payload.query.keyword} à ${payload.query.location}`;
  $("#metricCompanies").textContent = payload.count;
  $("#metricEmails").textContent = withEmail;
  $("#metricPriority").textContent = priority;
  $("#metricScore").textContent = `${average}/100`;
  $("#resultsBody").innerHTML = state.results.map((item) => `
    <tr>
      <td>
        <strong>${escapeHtml(item.nom)}</strong>
        <small>${escapeHtml(item.adresse)}</small>
        ${item.site_web ? `<small><a href="${escapeHtml(item.site_web)}" target="_blank" rel="noreferrer">Voir le site</a></small>` : ""}
      </td>
      <td>
        <strong>${escapeHtml(item.email_principal || "Aucun email trouvé")}</strong>
        <small>${escapeHtml(item.telephone || "Téléphone non publié")} · ${item.nb_emails} email(s)</small>
      </td>
      <td>
        <strong>${escapeHtml(item.type_structure)}</strong>
        <small>${escapeHtml(item.reseau)}</small>
      </td>
      <td>
        <span class="score">${item.score_prospect}</span>
        <small>${escapeHtml(item.raison_score)}</small>
      </td>
      <td>
        <span class="priority ${item.priorite === "Très prioritaire" ? "high" : ""}">${escapeHtml(item.priorite)}</span>
        <small>${escapeHtml(item.action_recommandee)}</small>
      </td>
    </tr>
  `).join("");
  $("#results").hidden = false;
  $("#results").scrollIntoView({ behavior: "smooth", block: "start" });
}

function setProgress(percent, title, detail) {
  $("#progressTitle").textContent = title;
  $("#progressDetail").textContent = detail;
  $("#progressBar").style.width = `${Math.max(4, Math.min(100, percent))}%`;
}

async function enrichInBatches(places) {
  const batchSize = 10;
  const results = [];
  for (let start = 0; start < places.length; start += batchSize) {
    const batch = places.slice(start, start + batchSize);
    const payload = await api("/api/enrich", {
      method: "POST",
      body: JSON.stringify({ places: batch })
    });
    results.push(...payload.results);
    const completed = Math.min(start + batch.length, places.length);
    setProgress(
      15 + Math.round((completed / places.length) * 85),
      `Enrichissement ${completed}/${places.length}`,
      "Analyse des sites, nettoyage des emails et calcul des scores."
    );
  }
  return results;
}

function campaignRows() {
  return state.results.flatMap((item) =>
    (item.emails.length ? item.emails : [""]).map((email) => ({
      nom_entreprise: item.nom,
      email,
      telephone: item.telephone,
      ville: item.ville_recherchee,
      activite: item.keyword,
      score_prospect: item.score_prospect,
      priorite: item.priorite,
      reseau: item.reseau,
      site_web: item.site_web,
      action_recommandee: item.action_recommandee
    }))
  ).filter((row) => row.email);
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function download(content, filename, type) {
  const blob = new Blob(["\ufeff", content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeFilename() {
  return `${state.query.keyword}_${state.query.location}`.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase();
}

function exportCsv() {
  const rows = campaignRows();
  if (!rows.length) return alert("Aucun email exploitable dans cette recherche.");
  const headers = Object.keys(rows[0]);
  const csv = [headers.map(csvValue).join(";"), ...rows.map((row) => headers.map((key) => csvValue(row[key])).join(";"))].join("\r\n");
  download(csv, `${safeFilename()}_emailing.csv`, "text/csv;charset=utf-8");
}

function exportExcel() {
  const rows = campaignRows();
  if (!rows.length) return alert("Aucun email exploitable dans cette recherche.");
  const headers = Object.keys(rows[0]);
  const cell = (value) => `<Cell><Data ss:Type="String">${escapeHtml(value)}</Data></Cell>`;
  const xml = `<?xml version="1.0"?>
  <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Worksheet ss:Name="Campagne emailing"><Table>
      <Row>${headers.map(cell).join("")}</Row>
      ${rows.map((row) => `<Row>${headers.map((key) => cell(row[key])).join("")}</Row>`).join("")}
    </Table></Worksheet>
  </Workbook>`;
  download(xml, `${safeFilename()}_emailing.xls`, "application/vnd.ms-excel");
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginError").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
    $("#password").value = "";
    showAuthenticated(true);
  } catch (error) {
    $("#loginError").textContent = error.message;
  }
});

$("#searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#searchError").textContent = "";
  $("#progress").hidden = false;
  $("#searchButton").disabled = true;
  setProgress(4, "Recherche Google Places…", "Récupération des pages et suppression des doublons.");
  try {
    const searchPayload = await api("/api/search", {
      method: "POST",
      body: JSON.stringify({
        keyword: $("#keyword").value,
        location: $("#location").value,
        limit: Number($("#resultLimit").value)
      })
    });
    if (!searchPayload.places.length) {
      throw new Error("Aucun prospect trouvé pour cette recherche.");
    }
    setProgress(
      15,
      `${searchPayload.count} prospects trouvés`,
      "Démarrage de l’enrichissement par lots sécurisés."
    );
    const results = await enrichInBatches(searchPayload.places);
    results.sort((a, b) => b.score_prospect - a.score_prospect);
    renderResults({
      query: searchPayload.query,
      count: results.length,
      results
    });
  } catch (error) {
    $("#searchError").textContent = error.message;
    if (error.message.includes("Session")) showAuthenticated(false);
  } finally {
    $("#progress").hidden = true;
    $("#searchButton").disabled = false;
  }
});

$("#logoutButton").addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  showAuthenticated(false);
});
$("#exportCsv").addEventListener("click", exportCsv);
$("#exportExcel").addEventListener("click", exportExcel);
$("#resultLimit").addEventListener("change", () => {
  const limit = Number($("#resultLimit").value);
  $("#volumeHint").textContent =
    `${Math.ceil(limit / 20)} page(s) Google maximum · enrichissement par lots de 10`;
});

api("/api/me").then(({ authenticated }) => showAuthenticated(authenticated)).catch(() => showAuthenticated(false));
