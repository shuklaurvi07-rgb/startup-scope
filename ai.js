// Server-side AI proxy. Keys stay in Netlify environment variables, never in the browser.
// Uses Gemini if GEMINI_API_KEY is set, otherwise Anthropic if ANTHROPIC_API_KEY is set.
const MAX_PROMPT = 12000;
exports.handler = async (event) => {
  const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  let prompt;
  try { prompt = JSON.parse(event.body || '{}').prompt; } catch (e) { return json(400, { error: 'Bad request' }); }
  if (typeof prompt !== 'string' || !prompt.trim()) return json(400, { error: 'Missing prompt' });
  if (prompt.length > MAX_PROMPT) return json(413, { error: 'Prompt too long' });
  const gk = process.env.GEMINI_API_KEY_BA || process.env.GEMINI_API_KEY, ak = process.env.ANTHROPIC_API_KEY;
  if (!gk && !ak) return json(500, { error: 'Set GEMINI_API_KEY_BA (or GEMINI_API_KEY) or ANTHROPIC_API_KEY in Netlify environment variables, then redeploy.' });
  try {
    let r, d, text;
    if (gk) {
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': gk },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 900 } })
      });
      d = await r.json();
      text = ((d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map(p => p.text || '').join('\n');
    } else {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': ak, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
      });
      d = await r.json();
      text = (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    }
    if (!r.ok) return json(r.status === 429 ? 429 : 502, { error: (d.error && d.error.message) || 'AI provider error' });
    if (!text) return json(502, { error: 'The AI returned an empty answer. Try again.' });
    return json(200, { text });
  } catch (e) { return json(502, { error: 'Could not reach the AI provider' }); }
};
