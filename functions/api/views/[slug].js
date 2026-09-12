// GET  /api/views/<slug>  -> 讀取次數
// POST /api/views/<slug>  -> 累加 1 次並回傳
// 儲存：Cloudflare Workers KV（binding 名稱 VIEWS，見 wrangler.toml）
// 不需要註冊第三方帳號，也不需要任何 API 金鑰。

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function onRequest(context) {
  const { env, params, request } = context;

  const slug = String(params.slug || '');
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(slug)) {
    return json({ error: 'invalid slug' }, 400);
  }

  // KV 尚未綁定時不要讓頁面壞掉，回 null 讓前端顯示「—」
  if (!env.VIEWS) return json({ slug, views: null, error: 'KV binding "VIEWS" not configured' });

  const key = `views:${slug}`;

  try {
    const current = parseInt((await env.VIEWS.get(key)) || '0', 10) || 0;

    if (request.method === 'POST') {
      const next = current + 1;
      await env.VIEWS.put(key, String(next));
      return json({ slug, views: next });
    }

    return json({ slug, views: current });
  } catch (err) {
    return json({ slug, views: null, error: 'kv error' }, 500);
  }
}
