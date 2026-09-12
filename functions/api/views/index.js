// GET /api/views?slugs=a,b,c -> { counts: { a: 1, b: 2, c: 0 } }
// 首頁卡片批次讀取用，只讀不寫。

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const VALID = /^[a-z0-9][a-z0-9-]{0,119}$/;
const MAX_SLUGS = 100;

export async function onRequest(context) {
  const { env, request } = context;

  const url = new URL(request.url);
  const slugs = (url.searchParams.get('slugs') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VALID.test(s))
    .slice(0, MAX_SLUGS);

  if (!slugs.length) return json({ counts: {} });
  if (!env.VIEWS) return json({ counts: {}, error: 'KV binding "VIEWS" not configured' });

  try {
    const values = await Promise.all(slugs.map((s) => env.VIEWS.get(`views:${s}`)));
    const counts = {};
    slugs.forEach((s, i) => {
      counts[s] = parseInt(values[i] || '0', 10) || 0;
    });
    return json({ counts });
  } catch (err) {
    return json({ counts: {}, error: 'kv error' }, 500);
  }
}
