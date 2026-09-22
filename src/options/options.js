import { sendRuntime } from '../runtime.js';

const $ = id => document.getElementById(id);
let settings = null;
let keyStatus = null;

function number(id, fallback = 0) {
  const value = Number($(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function flash(text, bad = false) {
  $('message').textContent = text;
  $('message').style.color = bad ? '#b33b3b' : '#16785f';
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { $('message').textContent = ''; }, 5000);
}

function renderKeyStatus() {
  const node = $('keyStatus');
  if (keyStatus?.configured) {
    node.className = 'status';
    node.textContent = `Chave configurada (${keyStatus.mode === 'local' ? 'salva neste navegador' : 'somente nesta sessão'}): ${keyStatus.masked}`;
  } else {
    node.className = 'status bad';
    node.textContent = 'Nenhuma API key configurada.';
  }
  $('keyMode').value = keyStatus?.mode || 'session';
}

function fillSettings() {
  $('model').value = settings.model || 'gpt-5.6-luna';
  $('automaticSuggestions').checked = settings.automaticSuggestions !== false;
  $('debounceSeconds').value = Math.round((settings.debounceMs || 5000) / 1000);
  $('maxAutomaticPrompts').value = settings.maxAutomaticPrompts || 3;
  $('defaultSummaryEnabled').checked = settings.defaultSummaryEnabled !== false;
  $('defaultSummaryMode').value = settings.defaultSummaryMode || 'manual';
  $('defaultSummaryEvery').value = settings.defaultSummaryEvery || 2;
  $('saveHistory').checked = settings.saveHistory !== false;
  $('retentionDays').value = String(settings.retentionDays ?? 90);
  $('dailyTokenLimit').value = settings.dailyTokenLimit ?? 100000;
  $('dailyAutomaticRequestLimit').value = settings.dailyAutomaticRequestLimit ?? 500;
  $('blockAutomaticAtLimit').checked = settings.blockAutomaticAtLimit !== false;
}

function collectSettings() {
  return {
    model: $('model').value.trim() || 'gpt-5.6-luna',
    automaticSuggestions: $('automaticSuggestions').checked,
    debounceMs: Math.max(2, Math.min(30, number('debounceSeconds', 5))) * 1000,
    maxAutomaticPrompts: Math.max(1, Math.min(20, number('maxAutomaticPrompts', 3))),
    defaultSummaryEnabled: $('defaultSummaryEnabled').checked,
    defaultSummaryMode: $('defaultSummaryMode').value,
    defaultSummaryEvery: Math.max(2, Math.min(50, number('defaultSummaryEvery', 2))),
    saveHistory: $('saveHistory').checked,
    retentionDays: Math.max(0, number('retentionDays', 90)),
    dailyTokenLimit: Math.max(0, number('dailyTokenLimit', 0)),
    dailyAutomaticRequestLimit: Math.max(0, number('dailyAutomaticRequestLimit', 0)),
    blockAutomaticAtLimit: $('blockAutomaticAtLimit').checked
  };
}

async function loadUsage() {
  const result = await sendRuntime('USAGE_STATS');
  if (!result.ok) return;
  const stats = result.stats;
  $('todayRequests').textContent = stats.today.requests.toLocaleString('pt-BR');
  $('todayTokens').textContent = stats.today.totalTokens.toLocaleString('pt-BR');
  $('monthRequests').textContent = stats.month.requests.toLocaleString('pt-BR');
  $('monthTokens').textContent = stats.month.totalTokens.toLocaleString('pt-BR');
}

async function init() {
  const result = await sendRuntime('SETTINGS_GET');
  if (!result.ok) {
    flash(result.message || 'Falha ao carregar configurações.', true);
    return;
  }
  settings = result.settings;
  keyStatus = result.keyStatus;
  fillSettings();
  renderKeyStatus();
  await loadUsage();
}

$('saveSettings').addEventListener('click', async () => {
  const result = await sendRuntime('SETTINGS_UPDATE', collectSettings());
  if (!result.ok) return flash(result.message || 'Falha ao salvar.', true);
  settings = result.settings;
  fillSettings();
  flash('Configurações salvas.');
});

$('saveKey').addEventListener('click', async () => {
  const apiKey = $('apiKey').value.trim();
  if (!apiKey) return flash('Informe a API key.', true);
  const result = await sendRuntime('API_KEY_SET', { apiKey, mode: $('keyMode').value });
  if (!result.ok) return flash(result.message || 'Falha ao salvar a chave.', true);
  $('apiKey').value = '';
  keyStatus = result.keyStatus;
  renderKeyStatus();
  flash('API key salva.');
});

$('testKey').addEventListener('click', async () => {
  $('testKey').disabled = true;
  try {
    const apiKey = $('apiKey').value.trim();
    const payload = apiKey ? { apiKey, mode: $('keyMode').value } : {};
    const result = await sendRuntime('API_KEY_TEST', payload);
    if (!result.ok) return flash(result.message || 'A conexão falhou.', true);
    $('apiKey').value = '';
    keyStatus = result.keyStatus;
    renderKeyStatus();
    flash('Conexão com a OpenAI funcionando.');
    await loadUsage();
  } finally {
    $('testKey').disabled = false;
  }
});

$('removeKey').addEventListener('click', async () => {
  if (!confirm('Remover a API key armazenada pela extensão?')) return;
  const result = await sendRuntime('API_KEY_REMOVE');
  if (!result.ok) return flash(result.message || 'Falha ao remover.', true);
  keyStatus = result.keyStatus;
  renderKeyStatus();
  flash('API key removida.');
});

$('refreshUsage').addEventListener('click', loadUsage);

$('clearHistory').addEventListener('click', async () => {
  if (!confirm('Apagar todo o histórico local observado?')) return;
  const result = await sendRuntime('DATA_CLEAR', { kind: 'history' });
  flash(result.ok ? 'Histórico local apagado.' : result.message, !result.ok);
});

$('clearSummaries').addEventListener('click', async () => {
  if (!confirm('Apagar todos os resumos locais?')) return;
  const result = await sendRuntime('DATA_CLEAR', { kind: 'summaries' });
  flash(result.ok ? 'Resumos apagados.' : result.message, !result.ok);
});

$('clearPrompts').addEventListener('click', async () => {
  if (!confirm('Apagar os prompts atuais e restaurar os modelos padrão?')) return;
  const result = await sendRuntime('DATA_CLEAR', { kind: 'prompts' });
  flash(result.ok ? 'Prompts padrão restaurados.' : result.message, !result.ok);
});

$('clearAll').addEventListener('click', async () => {
  if (!confirm('Isso apagará API key, prompts, histórico, resumos e uso local. Continuar?')) return;
  if (!confirm('Confirma a exclusão de TODOS os dados da extensão?')) return;
  const result = await sendRuntime('DATA_CLEAR', { kind: 'all' });
  if (!result.ok) return flash(result.message || 'Falha ao apagar.', true);
  flash('Todos os dados foram apagados.');
  await init();
});

init();