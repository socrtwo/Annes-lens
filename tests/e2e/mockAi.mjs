// A mock OpenAI-compatible AI service for the e2e smoke test: chat with vision (canned answers chosen
// by the prompt), model listing, picture generation and masked edits (fixture PNGs). It records every
// request at GET /__requests so the test can check what the app sent.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export function startMockAi(port, fixtures) {
  const gen = readFileSync(`${fixtures}/gen.png`).toString('base64'), edit = readFileSync(`${fixtures}/edit.png`).toString('base64');
  const requests = [];
  const answer = (text) => {
    if (/single word OK/i.test(text)) return 'OK';
    if (/"keywords"/.test(text)) return '{"keywords": ["sunset", "beach", "sea"]}';
    if (/"alt"/.test(text)) return '{"alt": "A red square", "extended": "A plain red square on a white background."}';
    if (/bounding box/i.test(text)) return '{"x0": 0.25, "y0": 0.25, "x1": 0.75, "y1": 0.75, "found": true}';
    if (/"frames"/.test(text)) return '{"frames": [{"index": 1, "eyesOpen": true, "note": "all eyes open"}], "best": 1}';
    if (/"items"/.test(text)) return '{"items": [{"text": "Ausgang", "translation": "Exit"}]}';
    if (/Combine their answers|consensus/i.test(text)) return 'Combined: a red rectangle on a white background.';
    return 'A red rectangle on a white background.';
  };
  const server = createServer((req, res) => {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const json = (status, obj) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/__requests') return json(200, requests);
      if (req.url === '/v1/models') return json(200, { data: [{ id: 'mock-vision' }, { id: 'mock-image' }] });
      if (req.url === '/v1/chat/completions') {
        const b = JSON.parse(body.toString()); const last = b.messages[b.messages.length - 1];
        const text = Array.isArray(last.content) ? last.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') : String(last.content);
        const images = Array.isArray(last.content) ? last.content.filter((p) => p.type === 'image_url').length : 0;
        requests.push({ kind: 'chat', model: b.model, auth: req.headers.authorization, system: b.messages[0]?.role === 'system' ? b.messages[0].content.slice(0, 40) : '', text: text.slice(0, 120), images, json: !!b.response_format });
        return json(200, { choices: [{ message: { role: 'assistant', content: answer(text) } }] });
      }
      if (req.url === '/v1/images/generations') {
        const b = JSON.parse(body.toString()); requests.push({ kind: 'generate', model: b.model, prompt: b.prompt, n: b.n, size: b.size });
        return json(200, { data: new Array(b.n || 1).fill(0).map(() => ({ b64_json: gen })) });
      }
      if (req.url === '/v1/images/edits') {
        const s = body.toString('latin1'); requests.push({ kind: 'edit', hasMask: /name="mask"/.test(s), images: (s.match(/name="image(\[\])?"/g) || []).length, prompt: (s.match(/name="prompt"\r\n\r\n([^\r]*)/) || [])[1] || '' });
        return json(200, { data: [{ b64_json: edit }] });
      }
      json(404, { error: { message: `no route ${req.url}` } });
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, requests, close: () => server.close() })));
}
