import express from 'express';

const app = express();
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 8787);
const AIRCALL_API_ID = process.env.AIRCALL_API_ID || '';
const AIRCALL_API_TOKEN = process.env.AIRCALL_API_TOKEN || '';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://courtage.modulr.fr';
const AIRCALL_BASE = 'https://api.aircall.io/v1';

const aiByCall = new Map();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function basicAuth() {
  if (!AIRCALL_API_ID || !AIRCALL_API_TOKEN) {
    throw new Error('AIRCALL_API_ID / AIRCALL_API_TOKEN manquants');
  }
  return `Basic ${Buffer.from(`${AIRCALL_API_ID}:${AIRCALL_API_TOKEN}`).toString('base64')}`;
}

async function aircall(path) {
  const response = await fetch(`${AIRCALL_BASE}${path}`, {
    headers: {
      Authorization: basicAuth(),
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data.message || `Aircall HTTP ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function equivalentPhones(value) {
  const d = digits(value);
  const set = new Set();
  if (d) set.add(d);
  if (d.startsWith('0') && d.length >= 9) set.add(`33${d.slice(1)}`);
  if (d.startsWith('33') && d.length >= 11) set.add(`0${d.slice(2)}`);
  return set;
}

function phoneMatches(rawDigits, phones) {
  const raw = equivalentPhones(rawDigits);
  for (const phone of phones) {
    const wanted = equivalentPhones(phone);
    for (const candidate of wanted) {
      if (raw.has(candidate)) return true;
    }
  }
  return false;
}

function compactCall(call) {
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
    user: call.user ? {
      id: call.user.id,
      name: call.user.name,
      email: call.user.email
    } : null,
    number: call.number ? {
      id: call.number.id,
      name: call.number.name,
      digits: call.number.digits
    } : null,
    tags: call.tags || []
  };
}

async function getEvaluation(callId) {
  try {
    return await aircall(`/calls/${encodeURIComponent(callId)}/evaluations`);
  } catch (error) {
    if (error.status === 404) return null;
    return { _error: error.message };
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'modulr-aircall-import' });
});

app.get('/api/calls', async (req, res) => {
  try {
    const phones = String(req.query.phones || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);

    if (!phones.length) {
      return res.status(400).json({ error: 'phones requis' });
    }

    const hours = Math.min(Math.max(Number(req.query.hours || 48), 1), 168);
    const from = Math.floor((Date.now() - hours * 3600_000) / 1000);

    let page = 1;
    let next = true;
    const matches = [];

    while (next && page <= 5) {
      const data = await aircall(`/calls?from=${from}&per_page=50&page=${page}&order=desc`);
      const calls = Array.isArray(data.calls) ? data.calls : [];
      for (const call of calls) {
        if (phoneMatches(call.raw_digits, phones)) matches.push(compactCall(call));
      }
      next = Boolean(data.meta?.next_page_link) && calls.length > 0;
      page += 1;
    }

    const unique = [...new Map(matches.map(call => [String(call.id), call])).values()]
      .sort((a, b) => Number(b.started_at || 0) - Number(a.started_at || 0));

    res.json({ calls: unique });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.get('/api/calls/:id', async (req, res) => {
  try {
    const callId = String(req.params.id);
    const data = await aircall(`/calls/${encodeURIComponent(callId)}`);
    const call = data.call || data;
    const evaluation = await getEvaluation(callId);
    const ai = aiByCall.get(callId) || {};

    res.json({
      call: compactCall(call),
      ai,
      evaluation,
      ai_status: Object.keys(ai).length ? 'available' : 'pending_or_unavailable'
    });
  } catch (error) {
    res.status(error.status || 500).json({
      error: error.message,
      details: error.details || null
    });
  }
});

app.post('/api/webhooks/aircall', (req, res) => {
  const payload = req.body || {};
  const event = payload.event || payload.type || 'unknown';
  const data = payload.data || {};
  const callId = data.call_id || data.call?.id || (event.startsWith('call.') ? data.id : null);

  if (callId) {
    const key = String(callId);
    const previous = aiByCall.get(key) || {};
    aiByCall.set(key, {
      ...previous,
      [event]: data,
      updated_at: Date.now()
    });
  }

  res.sendStatus(200);
});

app.listen(PORT, () => {
  console.log(`modulr-aircall-import listening on ${PORT}`);
});
