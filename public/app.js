// Состояние
let repositories = [];

// ====== Вкладки ======
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
  });
});

// ====== Репозитории ======
async function loadRepos() {
  try {
    const res = await fetch('/api/config');
    const config = await res.json();
    repositories = config.repositories || [];
    renderRepos();
  } catch (err) {
    document.getElementById('repo-list').innerHTML = '<p class="empty">❌ Ошибка загрузки конфига</p>';
  }
}

function renderRepos() {
  const container = document.getElementById('repo-list');

  if (repositories.length === 0) {
    container.innerHTML = '<p class="empty">Нет репозиториев. Добавьте через форму выше.</p>';
    return;
  }

  container.innerHTML = repositories.map((repo, index) => {
    const name = repo.url.match(/\/([^/]+)\.git$/)?.[1] || repo.url;
    const displayUrl = repo.url.replace('.git', '');

    const enabled = repo.enabled !== false;
    const flags = [];
    if (repo.processed) flags.push('<span class="repo-flag processed">✅ Processed</span>');
    else if (enabled) flags.push('<span class="repo-flag pending">⏳ Pending</span>');
    else flags.push('<span class="repo-flag disabled">🔕 Disabled</span>');
    if (repo.skipIfReadmeExists) flags.push('<span class="repo-flag skip">Skip README</span>');
    if (repo.sanitize) flags.push('<span class="repo-flag sanitize">Sanitize</span>');
    if (repo.push) flags.push('<span class="repo-flag push">Push</span>');

    const resetBtn = repo.processed
      ? `<button class="btn-reset-repo" data-reset="${index}" title="Сбросить флаг обработки">🔄</button>`
      : '';
    const toggleBtn = `<button class="btn-toggle-repo" data-toggle="${index}" title="${enabled ? 'Отключить' : 'Включить'}">${enabled ? '🔕' : '🔔'}</button>`;

    return `
      <div class="repo-item" style="opacity:${enabled ? 1 : 0.5};">
        <div class="repo-info">
          <a href="${displayUrl}" target="_blank" class="repo-name">${name}</a>
          <span class="repo-url-muted" style="color: var(--text-muted); font-size: 0.8rem;">${displayUrl}</span>
          <div class="repo-flags">${flags.join('')}</div>
        </div>
        <div style="display:flex; gap:0.3rem;">
          ${toggleBtn}
          ${resetBtn}
          <button class="btn-delete-repo" data-index="${index}" title="Удалить">✕</button>
        </div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('.btn-delete-repo').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      await deleteRepo(index);
    });
  });

  // Кнопки сброса (processed → false)
  document.querySelectorAll('[data-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.reset, 10);
      const res = await fetch(`/api/repos/${index}/reset`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        repositories = data.repositories;
        renderRepos();
      }
    });
  });

  // Кнопки включить/отключить (toggle enabled)
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.toggle, 10);
      const res = await fetch(`/api/repos/${index}/toggle`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        repositories = data.repositories;
        renderRepos();
      }
    });
  });
}

async function deleteRepo(index) {
  try {
    const res = await fetch(`/api/repos/${index}`, { method: 'DELETE' });
    if (res.ok) {
      const data = await res.json();
      repositories = data.repositories;
      renderRepos();
    }
  } catch (err) {
    console.error('Ошибка удаления:', err);
  }
}

// ====== Форма добавления репозитория ======
document.getElementById('btn-add-repo').addEventListener('click', () => {
  document.getElementById('add-repo-form').classList.remove('hidden');
});

document.getElementById('btn-cancel-repo').addEventListener('click', () => {
  document.getElementById('add-repo-form').classList.add('hidden');
  document.getElementById('repo-url').value = '';
});

document.getElementById('btn-save-repo').addEventListener('click', async () => {
  const url = document.getElementById('repo-url').value.trim();
  if (!url) { alert('Введите URL репозитория'); return; }
  if (!url.endsWith('.git')) { alert('URL должен заканчиваться на .git'); return; }

  const repo = {
    url,
    branch: document.getElementById('repo-branch').value || 'main',
    skipIfReadmeExists: document.getElementById('repo-skip').checked,
    sanitize: document.getElementById('repo-sanitize').checked,
    push: document.getElementById('repo-push').checked,
  };

  try {
    const res = await fetch('/api/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repo),
    });

    if (res.ok) {
      const data = await res.json();
      repositories = data.repositories;
      renderRepos();
      document.getElementById('add-repo-form').classList.add('hidden');
      document.getElementById('repo-url').value = '';
    } else {
      const err = await res.json();
      alert(`Ошибка: ${err.error}`);
    }
  } catch (err) {
    alert(`Ошибка: ${err.message}`);
  }
});

// ====== Запуск обработки ======
document.getElementById('btn-process').addEventListener('click', async () => {
  const btn = document.getElementById('btn-process');
  btn.disabled = true;
  btn.textContent = '⏳ Обработка...';

  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.querySelector('[data-tab="logs"]').classList.add('active');
  document.getElementById('tab-logs').classList.add('active');

  try {
    const res = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sanitize: document.getElementById('opt-sanitize').checked,
        skipExisting: document.getElementById('opt-skip-existing').checked,
        autoPush: document.querySelector('input[name="push-mode"]:checked').value === 'auto',
        parallel: parseInt(document.getElementById('opt-parallel').value, 10) || 3,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      addLog(`❌ Ошибка: ${err.error}`);
    }
  } catch (err) {
    addLog(`❌ Ошибка: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '🚀 Запустить';
  }
});

// ====== Модальное окно подтверждения пуша (с очередью) ======
let pushConfirmQueue = [];
let pushConfirmVisible = false;

function showNextPushConfirm() {
  if (pushConfirmQueue.length === 0 || pushConfirmVisible) return;

  const item = pushConfirmQueue.shift();
  pushConfirmVisible = true;

  const modal = document.getElementById('push-confirm-modal');
  modal.classList.remove('hidden');
  document.getElementById('push-confirm-repo').textContent = item.repoName;
  document.getElementById('push-confirm-readme').textContent = item.readmeContent;
}

async function closePushConfirm(action) {
  pushConfirmVisible = false;
  document.getElementById('push-confirm-modal').classList.add('hidden');

  await fetch('/api/confirm-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });

  showNextPushConfirm();
}

document.getElementById('btn-push-confirm-yes').addEventListener('click', () => closePushConfirm('push'));
document.getElementById('btn-push-confirm-no').addEventListener('click', () => closePushConfirm('skip'));

// ====== Логи (SSE) ======
const logOutput = document.getElementById('log-output');
let eventSource = null;

function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/logs');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        addLog(data.message);
      } else if (data.type === 'confirm-push') {
        addLog(`\n📤 Запрос подтверждения пуша для ${data.repoName}...`);
        pushConfirmQueue.push({ repoName: data.repoName, readmeContent: data.readmeContent });
        showNextPushConfirm();
      } else if (data.type === 'start') {
        addLog(`\n🚀 Запуск обработки (${data.total} репозиториев)...`);
        addLog(`   Параметры: ${JSON.stringify(data.options)}`);
        addLog('─'.repeat(60));
      } else if (data.type === 'complete') {
        addLog('\n' + '='.repeat(60));
        addLog('✅ ОБРАБОТКА ЗАВЕРШЕНА');
        data.results.forEach(r => {
          const status = [];
          if (r.success) {
            if (r.readmeGenerated) status.push('📄 README');
            if (r.sanitized) status.push('🧹 Sanitized');
            if (r.pushed) status.push('📤 Pushed');
            if (status.length === 0) status.push('✅ Ok');
            addLog(`   • ${r.repository}: ${status.join(', ')}`);
          } else {
            addLog(`   ❌ ${r.repository}: ${r.error}`);
          }
        });
        addLog('='.repeat(60));
      } else if (data.type === 'error') {
        addLog(`\n❌ ОШИБКА: ${data.error}`);
      }
    } catch { /* ignore */ }
  };

  eventSource.onerror = () => {
    setTimeout(connectSSE, 3000);
  };
}

function addLog(message) {
  const hint = logOutput.querySelector('.log-hint');
  if (hint) hint.remove();
  logOutput.appendChild(document.createTextNode(message + '\n'));
  logOutput.scrollTop = logOutput.scrollHeight;
}

document.getElementById('btn-clear-logs').addEventListener('click', () => {
  logOutput.innerHTML = '<span class="log-hint">Логи очищены</span>';
});

// ====== Настройки (ключи API + git identity) ======
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();

    // DeepSeek
    const deepseekInput = document.getElementById('settings-deepseek-key');
    const deepseekStatus = document.getElementById('settings-deepseek-status');
    if (data.hasDeepSeekKey) {
      deepseekInput.placeholder = data.deepseekApiKey;
      deepseekStatus.textContent = '✅ Ключ установлен';
      deepseekStatus.style.color = 'var(--success)';
    } else {
      deepseekStatus.textContent = '❌ Ключ не установлен';
      deepseekStatus.style.color = 'var(--danger)';
    }

    // GitHub
    const githubInput = document.getElementById('settings-github-token');
    const githubStatus = document.getElementById('settings-github-status');
    if (data.hasGithubToken) {
      githubInput.placeholder = data.githubToken;
      githubStatus.textContent = '✅ Токен установлен';
      githubStatus.style.color = 'var(--success)';
    } else {
      githubStatus.textContent = '○ Не установлен (опционально)';
      githubStatus.style.color = 'var(--text-muted)';
    }

    // Git identity
    document.getElementById('settings-git-name').value = data.gitUserName || 'gh-manager';
    document.getElementById('settings-git-email').value = data.gitUserEmail || 'gh-manager@local';
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
}

// Toggle показа/скрытия пароля
function setupToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  btn.addEventListener('mousedown', () => { input.type = 'text'; btn.textContent = '🙈 Скрыть'; });
  btn.addEventListener('mouseup', () => { input.type = 'password'; btn.textContent = '👁️ Показать'; });
  btn.addEventListener('mouseleave', () => { input.type = 'password'; btn.textContent = '👁️ Показать'; });
}
setupToggle('settings-deepseek-key', 'btn-toggle-deepseek');
setupToggle('settings-github-token', 'btn-toggle-github');

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-settings');
  btn.disabled = true;
  btn.textContent = '⏳ Сохранение...';

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deepseekApiKey: document.getElementById('settings-deepseek-key').value.trim(),
        githubToken: document.getElementById('settings-github-token').value.trim(),
        gitUserName: document.getElementById('settings-git-name').value.trim(),
        gitUserEmail: document.getElementById('settings-git-email').value.trim(),
      }),
    });

    if (res.ok) {
      const statusEl = document.getElementById('settings-status');
      statusEl.className = 'card';
      statusEl.innerHTML = '<p style="color: var(--success);">✅ Настройки сохранены</p>';
      statusEl.classList.remove('hidden');

      document.getElementById('settings-deepseek-key').value = '';
      document.getElementById('settings-github-token').value = '';
      await loadSettings();
      setTimeout(() => statusEl.classList.add('hidden'), 3000);
    } else {
      const err = await res.json();
      alert(`Ошибка: ${err.error}`);
    }
  } catch (err) {
    alert(`Ошибка: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Сохранить';
  }
});

// ====== Импорт с GitHub ======
let fetchedRepos = [];
let selectedRepos = new Set();

document.getElementById('btn-import-section').addEventListener('click', () => {
  const section = document.getElementById('import-section');
  section.classList.toggle('hidden');
});

document.getElementById('btn-fetch-repos').addEventListener('click', async () => {
  const username = document.getElementById('import-username').value.trim();
  if (!username) { alert('Введите username'); return; }

  const btn = document.getElementById('btn-fetch-repos');
  btn.disabled = true;
  btn.textContent = '⏳ Загрузка...';

  try {
    const res = await fetch('/api/fetch-repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });

    if (!res.ok) {
      const err = await res.json();
      alert(`Ошибка: ${err.error}`);
      return;
    }

    const data = await res.json();
    fetchedRepos = data.repos;
    selectedRepos = new Set(fetchedRepos.filter(r => !r.fork).map(r => r.clone_url));

    document.getElementById('import-results').classList.remove('hidden');
    document.getElementById('import-count').textContent = `Найдено: ${fetchedRepos.length} репозиториев`;
    renderImportList();
  } catch (err) {
    alert(`Ошибка: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Загрузить';
  }
});

function renderImportList() {
  const sort = document.getElementById('import-sort')?.value || 'name';
  const list = document.getElementById('import-repos-list');

  const sorted = [...fetchedRepos].sort((a, b) => {
    if (sort === 'stars') return b.stars - a.stars;
    if (sort === 'language') return (a.language || '').localeCompare(b.language || '');
    return a.name.localeCompare(b.name);
  });

  list.innerHTML = sorted.map(repo => {
    const checked = selectedRepos.has(repo.clone_url) ? 'checked' : '';
    const desc = repo.description ? repo.description.substring(0, 80) : '';
    const langStyle = repo.language !== 'Unknown' ? `color:var(--accent)` : `color:var(--text-muted)`;

    return `
      <div class="repo-item" style="padding:0.6rem 0.8rem;">
        <label style="display:flex;align-items:center;gap:0.6rem;flex:1;cursor:pointer;">
          <input type="checkbox" class="import-checkbox" value="${repo.clone_url}" ${checked}>
          <span class="repo-name">${repo.name}</span>
          ${repo.fork ? '<span style="font-size:0.75rem;color:var(--text-muted);">(fork)</span>' : ''}
        </label>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <span style="${langStyle};font-size:0.8rem;">${repo.language}</span>
          <span style="color:var(--warning);font-size:0.75rem;">★ ${repo.stars}</span>
        </div>
      </div>
    `;
  }).join('');

  // Обработчик чекбоксов
  list.querySelectorAll('.import-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedRepos.add(cb.value);
      else selectedRepos.delete(cb.value);
    });
  });
}

document.getElementById('btn-select-all').addEventListener('click', () => {
  fetchedRepos.forEach(r => selectedRepos.add(r.clone_url));
  document.querySelectorAll('.import-checkbox').forEach(cb => cb.checked = true);
});

document.getElementById('btn-select-none').addEventListener('click', () => {
  selectedRepos.clear();
  document.querySelectorAll('.import-checkbox').forEach(cb => cb.checked = false);
});

document.getElementById('btn-import-selected').addEventListener('click', async () => {
  const urls = Array.from(selectedRepos);
  if (urls.length === 0) { alert('Выберите хотя бы один репозиторий'); return; }

  const res = await fetch('/api/repos/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ urls }),
  });

  if (res.ok) {
    const data = await res.json();
    repositories = data.repositories;
    renderRepos();
    document.getElementById('import-section').classList.add('hidden');
  } else {
    const err = await res.json();
    alert(`Ошибка: ${err.error}`);
  }
});

// ====== Инициализация ======
loadRepos();
loadSettings();
connectSSE();
