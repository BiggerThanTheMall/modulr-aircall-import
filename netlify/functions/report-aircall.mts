import type { Config, Context } from "@netlify/functions";

const AIRCALL_BASE = "https://api.aircall.io/v1";
const ALLOWED_ORIGIN = "https://courtage.modulr.fr";
const INSIGHTS = new Set(["summary", "sentiments", "topics", "action_items", "transcription", "evaluations"]);
const ID_RE = /^\d{1,20}$/;

function headers() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: headers() });
}

function auth() {
  const id = Netlify.env.get("AIRCALL_API_ID") || "";
  const token = Netlify.env.get("AIRCALL_API_TOKEN") || "";
  if (!id || !token) throw new Error("AIRCALL_CONFIG");
  return `Basic ${btoa(`${id}:${token}`)}`;
}

async function aircall(path: string) {
  const response = await fetch(`${AIRCALL_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: auth(), Accept: "application/json" }
  });
  const text = await response.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { body = {}; }
  if (!response.ok) {
    const error: any = new Error("AIRCALL_UPSTREAM");
    error.status = response.status === 429 ? 429 : response.status === 404 ? 404 : 502;
    throw error;
  }
  return body;
}

function intParam(url: URL, name: string, min: number, max: number, fallback: number | null = null) {
  const raw = url.searchParams.get(name);
  if ((raw === null || raw === "") && fallback !== null) return fallback;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function timestampParam(url: URL, name: string) {
  const raw = url.searchParams.get(name);
  if (!raw || !/^\d{9,11}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function safeError(error: any) {
  if (error?.message === "AIRCALL_CONFIG") return json({ error: "Service Aircall indisponible" }, 503);
  if (error?.message === "AIRCALL_UPSTREAM") return json({ error: "Service Aircall indisponible" }, error?.status || 502);
  return json({ error: "Erreur serveur" }, 500);
}

export default async (req: Request, context: Context) => {
  const origin = req.headers.get("origin");
  if (origin !== ALLOWED_ORIGIN) return json({ error: "Origine non autorisée" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  if (req.method !== "GET") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const url = new URL(req.url);
    const route = String(context.params?.route || "");
    const id = context.params?.id ? String(context.params.id) : "";
    const insight = context.params?.insight ? String(context.params.insight) : "";

    if (route === "users") {
      const page = intParam(url, "page", 1, 250, 1);
      const perPage = intParam(url, "per_page", 1, 50, 50);
      if (page === null || perPage === null) return json({ error: "Paramètre invalide" }, 400);
      return json(await aircall(`/users?per_page=${perPage}&page=${page}`));
    }

    if (route === "calls" && !id) {
      const userId = url.searchParams.get("user_id") || "";
      if (!ID_RE.test(userId)) return json({ error: "Utilisateur invalide" }, 400);
      const from = timestampParam(url, "from");
      const to = timestampParam(url, "to");
      if (from === null || to === null || to < from || to - from > 172800) return json({ error: "Période invalide" }, 400);
      const page = intParam(url, "page", 1, 250, 1);
      const perPage = intParam(url, "per_page", 1, 50, 50);
      if (page === null || perPage === null) return json({ error: "Pagination invalide" }, 400);
      const order = url.searchParams.get("order") || "asc";
      if (order !== "asc" && order !== "desc") return json({ error: "Tri invalide" }, 400);
      const fetchContact = url.searchParams.get("fetch_contact");
      if (fetchContact !== null && fetchContact !== "true" && fetchContact !== "false") return json({ error: "Paramètre invalide" }, 400);
      const contact = fetchContact === "true" ? "&fetch_contact=true" : "";
      return json(await aircall(`/calls/search?user_id=${userId}&from=${from}&to=${to}&order=${order}&per_page=${perPage}&page=${page}${contact}`));
    }

    if (route === "calls" && id && insight) {
      if (!ID_RE.test(id) || !INSIGHTS.has(insight)) return json({ error: "Paramètre invalide" }, 400);
      return json(await aircall(`/calls/${id}/${insight}`));
    }

    return json({ error: "Endpoint inconnu" }, 404);
  } catch (error: any) {
    return safeError(error);
  }
};

export const config: Config = {
  path: [
    "/api/report/:route",
    "/api/report/:route/:id/:insight"
  ],
  method: ["GET", "OPTIONS"],
  rateLimit: {
    windowLimit: 120,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
