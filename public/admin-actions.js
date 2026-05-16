(function () {
  const tokenInput = document.querySelector('#admin-token');
  const saveTokenBtn = document.querySelector('#save-token');
  const statusEl = document.querySelector('#action-status');
  const slugInput = document.querySelector('#slug-input');
  const actionButtons = document.querySelectorAll('[data-admin-action]');

  function setStatus(message, isError) {
    if (!(statusEl instanceof HTMLElement)) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#991b1b' : '#15803d';
  }

  function getToken() {
    return tokenInput instanceof HTMLInputElement ? tokenInput.value.trim() : '';
  }

  function setBusy(isBusy) {
    actionButtons.forEach((button) => {
      if (button instanceof HTMLButtonElement) {
        button.disabled = isBusy;
      }
    });
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, message: text };
    }
  }

  const savedToken = window.sessionStorage.getItem('ren_blog_admin_token') || '';
  if (tokenInput instanceof HTMLInputElement) {
    tokenInput.value = savedToken;
  }

  if (saveTokenBtn instanceof HTMLButtonElement) {
    saveTokenBtn.addEventListener('click', () => {
      const token = getToken();
      window.sessionStorage.setItem('ren_blog_admin_token', token);
      setStatus('トークンを保存しました。', false);
    });
  }

  document.querySelectorAll('.slug-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (slugInput instanceof HTMLInputElement && chip instanceof HTMLElement) {
        slugInput.value = chip.dataset.slug || '';
      }
    });
  });

  async function runAction(action, slug) {
    const token = getToken();
    if (!token) {
      setStatus('管理トークンを入力してください。', true);
      return;
    }

    window.sessionStorage.setItem('ren_blog_admin_token', token);
    setBusy(true);
    setStatus(
      action === 'publish-draft'
        ? `「${slug}」の公開処理を開始しています...`
        : '下書き生成を開始しています...',
      false,
    );

    try {
      const response = await fetch('/api/admin-action', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ action, slug }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok || !data.ok) {
        throw new Error(data.message || `実行に失敗しました。HTTP ${response.status}`);
      }
      setStatus('GitHub Actions を起動しました。数分後に /admin/ を更新してください。', false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '実行に失敗しました', true);
    } finally {
      setBusy(false);
    }
  }

  actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!(button instanceof HTMLButtonElement)) return;

      const action = button.dataset.adminAction || '';
      if (action === 'generate-draft') {
        void runAction(action);
        return;
      }

      if (action === 'publish-draft') {
        const slug = slugInput instanceof HTMLInputElement ? slugInput.value.trim() : '';
        if (!slug) {
          setStatus('slug を入力してください。', true);
          return;
        }
        void runAction(action, slug);
        return;
      }

      setStatus('不明な操作です。', true);
    });
  });
})();
