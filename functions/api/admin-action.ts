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

function ghHeaders(token: string) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'ren-blog-admin',
    'x-github-api-version': '2022-11-28',
  };
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
    headers: ghHeaders(token),
    body: JSON.stringify({ ref, inputs }),
  });

  if (!res.ok) {
    const message =
      res.status === 401 ? 'GITHUB_ACTIONS_TOKEN が無効または期限切れです。Cloudflare の環境変数を確認してください。' :
      res.status === 403 ? 'GITHUB_ACTIONS_TOKEN の権限が不足しています。Actions: Write 権限が必要です。' :
      res.status === 404 ? `ワークフロー "${workflow}" が見つかりません。リポジトリ名またはワークフローファイル名を確認してください。` :
      res.status === 422 ? 'リクエストが不正です。slug または ref を確認してください。' :
      `GitHub API エラー (${res.status})`;
    return { ok: false, status: res.status, message };
  }

  return { ok: true, status: res.status, message: 'workflow dispatched' };
}

async function getFile(env: Env, filePath: string) {
  const token = env.GITHUB_ACTIONS_TOKEN;
  if (!token) return { ok: false, message: 'GITHUB_ACTIONS_TOKEN is not configured.' };

  const repo = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    headers: ghHeaders(token),
  });

  if (!res.ok) {
    const msg =
      res.status === 401 ? 'GITHUB_ACTIONS_TOKEN が無効です。' :
      res.status === 403 ? 'GITHUB_ACTIONS_TOKEN に contents: read 権限が必要です。' :
      res.status === 404 ? `ファイルが見つかりません: ${filePath}` :
      `GitHub API エラー (${res.status})`;
    return { ok: false, message: msg };
  }

  const data = await res.json() as { content: string; sha: string };
  return { ok: true, content: data.content, sha: data.sha };
}

async function commitFile(env: Env, filePath: string, content: string, sha: string, message: string) {
  const token = env.GITHUB_ACTIONS_TOKEN;
  if (!token) return { ok: false, message: 'GITHUB_ACTIONS_TOKEN is not configured.' };

  const repo = env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY;
  const branch = env.GITHUB_BRANCH || DEFAULT_BRANCH;

  const body: Record<string, string> = { message, content, branch };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, {
    method: 'PUT',
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    const msg =
      res.status === 401 ? 'GITHUB_ACTIONS_TOKEN が無効です。' :
      res.status === 403 ? 'GITHUB_ACTIONS_TOKEN に contents: write 権限が必要です。' :
      res.status === 409 ? 'コンフリクトが発生しました。ページを再読み込みして再度お試しください。' :
      `GitHub API エラー (${res.status}): ${text.slice(0, 200)}`;
    return { ok: false, message: msg };
  }

  return { ok: true };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const adminToken = request.headers.get('x-admin-token') || '';
  if (!env.ADMIN_ACTION_TOKEN || adminToken !== env.ADMIN_ACTION_TOKEN) {
    return json({ ok: false, message: 'Unauthorized' }, 401);
  }

  let payload: Record<string, unknown>;
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

  if (payload.action === 'get_file') {
    const filePath = String(payload.path || '').trim();
    if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
      return json({ ok: false, message: 'Invalid path' }, 400);
    }
    const result = await getFile(env, filePath);
    return json(result, result.ok ? 200 : 500);
  }

  if (payload.action === 'commit_file') {
    const filePath = String(payload.path || '').trim();
    const content = String(payload.content || '').trim();
    const sha = String(payload.sha || '').trim();
    const message = String(payload.message || 'Update article via admin CMS').trim();
    if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
      return json({ ok: false, message: 'Invalid path' }, 400);
    }
    if (!content || !sha) {
      return json({ ok: false, message: 'content と sha は必須です' }, 400);
    }
    const result = await commitFile(env, filePath, content, sha, message);
    return json(result, result.ok ? 200 : 500);
  }

  if (payload.action === 'upload_image') {
    const slug = String(payload.slug || '').trim();
    const filename = String(payload.filename || '').trim();
    const content = String(payload.content || '').trim();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !/^[a-zA-Z0-9._-]+$/.test(filename)) {
      return json({ ok: false, message: 'Invalid slug or filename' }, 400);
    }
    if (!content) {
      return json({ ok: false, message: 'content は必須です' }, 400);
    }
    const filePath = `public/images/articles/${slug}/${filename}`;
    const result = await commitFile(env, filePath, content, '', `Add image: ${slug}/${filename}`);
    return json({ ...result, url: `/images/articles/${slug}/${filename}` }, result.ok ? 200 : 500);
  }

  return json({ ok: false, message: 'Unknown action' }, 400);
};
