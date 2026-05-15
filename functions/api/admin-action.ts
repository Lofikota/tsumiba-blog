type Env = {
  ADMIN_ACTION_TOKEN?: string;
  GITHUB_ACTIONS_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_BRANCH?: string;
};

const DEFAULT_REPOSITORY = 'Lofikota/ren-blog-';
const DEFAULT_BRANCH = 'main';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function triggerWorkflow(env: Env, workflow: string, inputs?: Record<string, string>) {
  const token = env.GITHUB_ACTIONS_TOKEN;
  if (!token) {
    return { ok: false, status: 500, message: 'GITHUB_ACTIONS_TOKEN is not configured.' };
  }

  const repository = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const ref = env.GITHUB_BRANCH || DEFAULT_BRANCH;
  const res = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'ren-blog-admin',
      'x-github-api-version': '2022-11-28',
    },
    body: JSON.stringify({ ref, inputs }),
  });

  if (!res.ok) {
    const body = await res.text();
    return { ok: false, status: res.status, message: body || res.statusText };
  }

  return { ok: true, status: res.status, message: 'workflow dispatched' };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const adminToken = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_ACTION_TOKEN || adminToken !== env.ADMIN_ACTION_TOKEN) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  let payload: { action?: string; slug?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, message: 'Invalid JSON' }, 400);
  }

  if (payload.action === 'generate-draft') {
    const result = await triggerWorkflow(env, 'daily-article.yml');
    return json({ ...result, action: payload.action }, result.ok ? 200 : 500);
  }

  if (payload.action === 'publish-draft') {
    const slug = String(payload.slug || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return json({ ok: false, message: 'Invalid slug' }, 400);
    }
    const result = await triggerWorkflow(env, 'publish-draft.yml', { slug });
    return json({ ...result, action: payload.action, slug }, result.ok ? 200 : 500);
  }

  return json({ ok: false, message: 'Unknown action' }, 400);
};
