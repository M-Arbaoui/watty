/* ═══════════════════════════════════════════════
   /api/mood.js — Vercel Serverless Function
   Proxies Gemini API calls so the key never
   reaches the browser. Reads GEMINI_API_KEY from
   Vercel environment variables (set in dashboard).
   ═══════════════════════════════════════════════ */

export default async function handler(req, res) {
  // CORS — restrict to your own domain in production if you want it tighter
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  const { mood } = req.body || {};
  if (!mood || typeof mood !== 'string') {
    return res.status(400).json({ error: 'Missing "mood" string in request body' });
  }

  const prompt = `You are a movie/TV recommendation engine. Extract TMDB discover params from this mood description: "${mood}"

Reply ONLY with valid JSON, no markdown, no backticks, no explanation.
Schema: { "type":"movie"|"tv"|"both", "genres":[ids], "sort_by":"popularity.desc"|"vote_average.desc", "vote_average_gte":number, "vote_count_gte":number, "decade_start":number, "decade_end":number, "summary":"1 sentence of what you understood" }
Genre IDs: action=28,adventure=12,animation=16,comedy=35,crime=80,documentary=99,drama=18,fantasy=14,horror=27,mystery=9648,romance=10749,sci-fi=878,thriller=53,war=10752,western=37`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return res.status(502).json({ error: 'Gemini API error', detail: errText });
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = text.replace(/```json|```/g, '').trim();

    let params;
    try {
      params = JSON.parse(cleaned);
    } catch (_) {
      return res.status(502).json({ error: 'Gemini returned invalid JSON', raw: cleaned });
    }

    return res.status(200).json(params);
  } catch (err) {
    return res.status(500).json({ error: 'Server error', detail: String(err) });
  }
}
