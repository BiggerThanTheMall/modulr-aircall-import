import type { Config, Context } from "@netlify/functions";

const AIRCALL_BASE = "https://api.aircall.io/v1";
const ALLOWED_ORIGIN = "https://courtage.modulr.fr";
const MAX_PHONES = 10;
const MAX_HOURS = 168;
const PHONE_RAW_MAX = 32;
const PHONE_DIGITS_MIN = 8;
const PHONE_DIGITS_MAX = 15;
const CALL_ID_RE = /^\d{1,20}$/;

function corsHeaders() {
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
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() });
}

function rejectOrigin(origin: string | null) {
  return origin !== ALLOWED_ORIGIN;
}

function basicAuth() {
  const id = Netlify.env.get("AIRCALL_API_ID") || "";
  const token = Netlify.env.get("AIRCALL_API_TOKEN") || "";
  if (!id || !token) throw new Error("AIRCALL_CONFIG");
  return `Basic ${btoa(`${id}:${token}`)}`;
}

function safeUpstreamStatus(status: number) {
  if (status === 401 || status === 403) return 502;
  if (status === 404) return 404;
  if (status === 429) return 429;
  return status >= 400 && status < 500 ? 502 : 503;
}

async function aircall(path: string) {
  const response = await fetch(`${AIRCALL_BASE}${path}`, {
    method: "GET",
    headers: { Authorization: basicAuth(), Accept: "application/json" }
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!response.ok) {
    const error: any = new Error("AIRCALL_UPSTREAM");
    error.status = safeUpstreamStatus(response.status);
    throw error;
  }
  return data;
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isValidRawPhone(value: string) {
  if (!value || value.length > PHONE_RAW_MAX) return false;
  if (!/^[+\d\s().-]+$/.test(value)) return false;
  const d = digits(value);
  return d.length >= PHONE_DIGITS_MIN && d.length <= PHONE_DIGITS_MAX;
}

function parsePhones(raw: string | null) {
  if (!raw) return null;
  const parts = raw.split(",").map(v => v.trim()).filter(Boolean);
  if (!parts.length || parts.length > MAX_PHONES) return null;
  if (parts.some(v => !isValidRawPhone(v))) return null;
  return [...new Set(parts.map(v => digits(v)))];
}

function parseHours(raw: string | null) {
  const value = raw === null || raw === "" ? 48 : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_HOURS) return null;
  return value;
}

function equivalents(value: unknown) {
  const d = digits(value);
  const set = new Set<string>();
  if (d) set.add(d);
  if (d.startsWith("0") && d.length >= 9) set.add(`33${d.slice(1)}`);
  if (d.startsWith("33") && d.length >= 11) set.add(`0${d.slice(2)}`);
  return set;
}

function phoneMatches(raw: unknown, phones: string[]) {
  const candidates = equivalents(raw);
  return phones.some(phone => [...equivalents(phone)].some(value => candidates.has(value)));
}

function compact(call: any) {
  return {
    id: call.id,
    direction: call.direction,
    status: call.status,
    started_at: call.started_at,
    answered_at: call.answered_at,
    ended_at: call.ended_at,
    duration: call.duration,
    raw_digits: call.raw_digits,
    missed_call_reason: call.missed_call_reason || null,
    user: call.user ? { id: call.user.id, name: call.user.name } : null,
    number: call.number ? { id: call.number.id, name: call.number.name, digits: call.number.digits } : null,
    tags: Array.isArray(call.tags) ? call.tags : []
  };
}

async function optionalInsight(callId: string, endpoint: string) {
  try {
    return await aircall(`/calls/${callId}/${endpoint}`);
  } catch {
    return null;
  }
}

function browserError(error: any) {
  if (error?.message === "AIRCALL_CONFIG") return json({ error: "Service Aircall indisponible" }, 503);
  if (error?.message === "AIRCALL_UPSTREAM") return json({ error: "Service Aircall indisponible" }, error?.status || 503);
  return json({ error: "Erreur serveur" }, 500);
}

export default async (req: Request, context: Context) => {
  const origin = req.headers.get("origin");

  // Contrôle serveur obligatoire : Origin absent, falsifié ou différent = refus.
  if (rejectOrigin(origin)) return json({ error: "Origine non autorisée" }, 403);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "GET") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const url = new URL(req.url);
    const callId = context.params?.id ? String(context.params.id) : "";

    if (callId) {
      if (!CALL_ID_RE.test(callId)) return json({ error: "Identifiant d'appel invalide" }, 400);

      const data = await aircall(`/calls/${callId}`);
      const call = data.call || data;
      const [summary, sentiments, topics, actionItems, transcription, evaluation] = await Promise.all([
        optionalInsight(callId, "summary"),
        optionalInsight(callId, "sentiments"),
        optionalInsight(callId, "topics"),
        optionalInsight(callId, "action_items"),
        optionalInsight(callId, "transcription"),
        optionalInsight(callId, "evaluations")
      ]);

      return json({
        call: compact(call),
        insights: { summary, sentiments, topics, action_items: actionItems, transcription },
        evaluation
      });
    }

    const phones = parsePhones(url.searchParams.get("phones"));
    if (!phones) return json({ error: "Numéro de téléphone invalide" }, 400);

    const hours = parseHours(url.searchParams.get("hours"));
    if (hours === null) return json({ error: "Période invalide" }, 400);

    const from = Math.floor((Date.now() - hours * 3_600_000) / 1000);
    const matches: any[] = [];
    let page = 1;
    let next = true;

    while (next && page <= 5) {
      const data = await aircall(`/calls?from=${from}&per_page=50&page=${page}&order=desc`);
      const calls = Array.isArray(data.calls) ? data.calls : [];
      for (const call of calls) {
        if (phoneMatches(call.raw_digits, phones)) matches.push(compact(call));
      }
      next = Boolean(data.meta?.next_page_link) && calls.length > 0;
      page += 1;
    }

    const calls = [...new Map(matches.map(call => [String(call.id), call])).values()]
      .sort((a: any, b: any) => Number(b.started_at || 0) - Number(a.started_at || 0));

    return json({ calls });
  } catch (error: any) {
    return browserError(error);
  }
};

export const config: Config = {
  path: ["/api/calls", "/api/calls/:id"],
  method: ["GET", "OPTIONS"],
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ["ip", "domain"]
  }
};
