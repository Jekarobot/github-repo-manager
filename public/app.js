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

    const flags = [];
    if (repo.skipIfReadmeExists) flags.push('<span class="repo-flag skip">Skip README</span>');
    if (repo.sanitize) flags.push('<span class="repo-flag sanitize">Sanitize</span>');
    if (repo.push) flags.push('<span class="repo-flag push">Push</span>');

    return `
      <div class="repo-item">
        <div class="repo-info">
          <a href="${displayUrl}" target="_blank" class="repo-name">${name}</a>
          <span class="repo-url-muted" style="color: var(--text-muted); font-size: 0.8rem;">${displayUrl}</span>
          <div class="repo-flags">${flags.join('')}</div>
        </div>
        <button class="btn-delete-repo" data-index="${index}" title="Удалить">✕</button>
      </div>
    `;
  }).join('');

  // Обработчики удаления
  document.querySelectorAll('.btn-delete-repo').forEach(btn => {
    btn.addEventListener('click', async () => {
      const index = parseInt(btn.dataset.index, 10);
      await deleteRepo(index);
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

// Форма добавления репозитория
document.getElementById('btn-add-repo').addEventListener('click', () => {
  document.getElementById('add-repo-form').classList.remove('hidden');
});

document.getElementById('btn-cancel-repo').addEventListener('click', () => {
  document.getElementById('add-repo-form').classList.add('hidden');
  document.getElementById('repo-url').value = '';
});

document.getElementById('btn-save-repo').addEventListener('click', async () => {
  const url = document.getElementById('repo-url').value.trim();
  if (!url) {
    alert('Введите URL репозитория');
    return;
  }

  if (!url.endsWith('.git')) {
    alert('URL должен заканчиваться на .git');
    return;
  }

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

  // Переключаемся на вкладку логов
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

// ====== Логи (SSE) ======
const logOutput = document.getElementById('log-output');
let eventSource = null;

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/logs');

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        addLog(data.message);
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
    } catch {
      // ignore malformed data
    }
  };

  eventSource.onerror = () => {
    // Автопереподключение через 3 секунды
    setTimeout(connectSSE, 3000);
  };
}

function addLog(message) {
  // Убираем hint если есть
  const hint = logOutput.querySelector('.log-hint');
  if (hint) hint.remove();

  logOutput.appendChild(document.createTextNode(message + '\n'));
  logOutput.scrollTop = logOutput.scrollHeight;
}

document.getElementById('btn-clear-logs').addEventListener('click', () => {
  logOutput.innerHTML = '<span class="log-hint">Логи очищены</span>';
});

// ====== Настройки (ключи API) ======
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();

    const deepseekInput = document.getElementById('settings-deepseek-key');
    const githubInput = document.getElementById('settings-github-token');
    const deepseekStatus = document.getElementById('settings-deepseek-status');
    const githubStatus = document.getElementById('settings-github-status');

    // Показываем маскированные значения в placeholder
    if (data.hasDeepSeekKey) {
      deepseekInput.placeholder = data.deepseekApiKey;
      deepseekInput.classList.add('has-value');
      deepseekStatus.textContent = '✅ Ключ установлен';
      deepseekStatus.style.color = 'var(--success)';
    } else {
      deepseekStatus.textContent = '❌ Ключ не установлен';
      deepseekStatus.style.color = 'var(--danger)';
    }

    if (data.hasGithubToken) {
      githubInput.placeholder = data.githubToken;
      githubInput.classList.add('has-value');
      githubStatus.textContent = '✅ Токен установлен';
      githubStatus.style.color = 'var(--success)';
    } else {
      githubStatus.textContent = '○ Не установлен (опционально)';
      githubStatus.style.color = 'var(--text-muted)';
    }
  } catch (err) {
    console.error('Ошибка загрузки настроек:', err);
  }
}

// Toggle показа/скрытия пароля
function setupToggle(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);

  btn.addEventListener('mousedown', () => {
    input.type = 'text';
    btn.textContent = '🙈 Скрыть';
  });

  btn.addEventListener('mouseup', () => {
    input.type = 'password';
    btn.textContent = '👁️ Показать';
  });

  btn.addEventListener('mouseleave', () => {
    input.type = 'password';
    btn.textContent = '👁️ Показать';
  });
}

setupToggle('settings-deepseek-key', 'btn-toggle-deepseek');
setupToggle('settings-github-token', 'btn-toggle-github');

document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const btn = document.getElementById('btn-save-settings');
  btn.disabled = true;
  btn.textContent = '⏳ Сохранение...';

  const deepseekKey = document.getElementById('settings-deepseek-key').value.trim();
  const githubToken = document.getElementById('settings-github-token').value.trim();

  // Разрешаем сохранить пустой ключ (если хотят удалить) или частичное обновление
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deepseekApiKey: deepseekKey,
        githubToken: githubToken,
      }),
    });

    if (res.ok) {
      // Показываем уведомление
      const statusEl = document.getElementById('settings-status');
      statusEl.className = 'card';
      statusEl.innerHTML = '<p style="color: var(--success);">✅ Настройки сохранены</p>';
      statusEl.classList.remove('hidden');

      // Очищаем поля
      document.getElementById('settings-deepseek-key').value = '';
      document.getElementById('settings-github-token').value = '';

      // Перезагружаем статусы
      await loadSettings();

      // Скрываем уведомление через 3 секунды
      setTimeout(() => {
        statusEl.classList.add('hidden');
      }, 3000);
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

// ====== Инициализация ======
loadRepos();
loadSettings();
connectSSE();
