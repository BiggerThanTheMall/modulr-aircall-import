import type { Config } from "@netlify/functions";

const AIRCALL_BASE = "https://api.aircall.io/v1";
const ALLOWED_ORIGIN = "https://courtage.modulr.fr";

function cors(origin: string | null) {
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

function basicAuth() {
  const id = Netlify.env.get("AIRCALL_API_ID") || "";
  const token = Netlify.env.get("AIRCALL_API_TOKEN") || "";
  if (!id || !token) throw new Error("Configuration Aircall manquante côté Netlify");
  return `Basic ${btoa(`${id}:${token}`)}`;
}

async function aircall(path: string) {
  const response = await fetch(`${AIRCALL_BASE}${path}`, {
    headers: { Authorization: basicAuth(), Accept: "application/json" }
  });
  const text = await response.text();
  let data: any = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const error: any = new Error(data?.troubleshoot || data?.message || data?.error || `Aircall HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function digits(value: unknown) { return String(value || "").replace(/\D/g, ""); }
function equivalents(value: unknown) {
  const d = digits(value); const set = new Set<string>();
  if (d) set.add(d);
  if (d.startsWith("0") && d.length >= 9) set.add(`33${d.slice(1)}`);
  if (d.startsWith("33") && d.length >= 11) set.add(`0${d.slice(2)}`);
  return set;
}
function phoneMatches(raw: unknown, phones: string[]) {
  const a = equivalents(raw);
  return phones.some(p => [...equivalents(p)].some(x => a.has(x)));
}
function compact(call: any) {
  return {
    id: call.id, direction: call.direction, status: call.status,
    started_at: call.started_at, answered_at: call.answered_at, ended_at: call.ended_at,
    duration: call.duration, raw_digits: call.raw_digits,
    missed_call_reason: call.missed_call_reason || null,
    user: call.user ? { id: call.user.id, name: call.user.name } : null,
    number: call.number ? { id: call.number.id, name: call.number.name, digits: call.number.digits } : null,
    tags: call.tags || []
  };
}
async function optionalInsight(callId: string, endpoint: string) {
  try { return await aircall(`/calls/${encodeURIComponent(callId)}/${endpoint}`); }
  catch { return null; }
}

export default async (req: Request, context: any) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "GET") return json({ error: "Méthode non autorisée" }, 405, origin);
  if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origine non autorisée" }, 403, origin);

  try {
    const url = new URL(req.url);
    const callId = context.params?.id;
    if (callId) {
      const data = await aircall(`/calls/${encodeURIComponent(callId)}`);
      const call = data.call || data;
      const [summary, sentiments, topics, actionItems, transcription, evaluation] = await Promise.all([
        optionalInsight(callId, "summary"), optionalInsight(callId, "sentiments"), optionalInsight(callId, "topics"),
        optionalInsight(callId, "action_items"), optionalInsight(callId, "transcription"), optionalInsight(callId, "evaluations")
      ]);
      return json({ call: compact(call), insights: { summary, sentiments, topics, action_items: actionItems, transcription }, evaluation }, 200, origin);
    }

    const phones = (url.searchParams.get("phones") || "").split(",").map(v => v.trim()).filter(Boolean);
    if (!phones.length) return json({ error: "phones requis" }, 400, origin);
    const hours = Math.min(Math.max(Number(url.searchParams.get("hours") || 48), 1), 168);
    const from = Math.floor((Date.now() - hours * 3600000) / 1000);
    const matches: any[] = [];
    let page = 1, next = true;
    while (next && page <= 5) {
      const data = await aircall(`/calls?from=${from}&per_page=50&page=${page}&order=desc`);
      const calls = Array.isArray(data.calls) ? data.calls : [];
      for (const call of calls) if (phoneMatches(call.raw_digits, phones)) matches.push(compact(call));
      next = Boolean(data.meta?.next_page_link) && calls.length > 0; page++;
    }
    const calls = [...new Map(matches.map(c => [String(c.id), c])).values()]
      .sort((a: any, b: any) => Number(b.started_at || 0) - Number(a.started_at || 0));
    return json({ calls }, 200, origin);
  } catch (error: any) {
    return json({ error: error?.message || "Erreur serveur" }, error?.status || 500, origin);
  }
};

export const config: Config = {
  path: ["/api/calls", "/api/calls/:id"]
};
