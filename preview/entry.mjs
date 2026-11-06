import {createPreviewAPI} from './api.mjs';

const app = document.querySelector('#app');

try {
  const response = await fetch(new URL('./fixtures.json', import.meta.url), {cache: 'no-store'});
  if (!response.ok) throw new Error('The sample workspace could not be loaded. Please refresh this page.');
  const fixtures = await response.json();
  let storage;
  try { storage = window.localStorage; } catch { /* The adapter can use this tab's memory. */ }
  const preview = createPreviewAPI({fixtures, storage});
  window.voqroPreview = preview;
  document.documentElement.dataset.voqroPreview = 'true';

  const banner = document.createElement('section');
  banner.className = 'preview-banner';
  banner.setAttribute('aria-label', 'Interactive product preview');
  const copy = document.createElement('div');
  copy.className = 'preview-banner-copy';
  const title = document.createElement('strong');
  title.textContent = 'Voqro · Interactive preview';
  const detail = document.createElement('span');
  detail.textContent = 'Sample data saved only in this browser. No real posts, payments or messages.';
  copy.append(title, detail);
  const actions = document.createElement('div');
  actions.className = 'preview-banner-actions';
  const workspace = document.createElement('button');
  workspace.type = 'button';
  workspace.dataset.action = 'login';
  workspace.textContent = 'Try a workspace';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'preview-reset';
  reset.textContent = 'Reset demo';
  reset.addEventListener('click', () => {
    preview.reset();
    window.location.reload();
  });
  actions.append(workspace, reset);
  banner.append(copy, actions);
  document.body.prepend(banner);
  const resize = () => document.documentElement.style.setProperty('--preview-banner-height', `${banner.getBoundingClientRect().height}px`);
  new ResizeObserver(resize).observe(banner);
  resize();

  function refreshStorageNotice() {
    detail.textContent = preview.status().persistence === 'memory'
      ? 'Sample data stays in this tab until reload. No real posts, payments or messages.'
      : 'Sample data saved only in this browser. No real posts, payments or messages.';
  }
  const request = preview.request.bind(preview);
  preview.request = async (...args) => {
    try { return await request(...args); } finally { refreshStorageNotice(); }
  };
  refreshStorageNotice();

  // Direct file links do not pass through the application's JSON API helper.
  // Avoid navigating away to a nonexistent backend in this static preview.
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return;
    event.preventDefault();
    const notice = document.querySelector('#toast');
    notice.textContent = 'File downloads need a connected workspace. This preview keeps sample records in your browser.';
    notice.classList.add('visible');
    clearTimeout(window.toastTimer);
    window.toastTimer = setTimeout(() => notice.classList.remove('visible'), 5000);
  }, true);

  await import('/app.js');
} catch (error) {
  const message = document.createElement('div');
  message.className = 'preview-error';
  const title = document.createElement('h1');
  title.textContent = 'Let’s get your preview ready.';
  const text = document.createElement('p');
  text.textContent = error.message || 'The sample workspace could not be loaded. Please refresh this page.';
  const retry = document.createElement('button');
  retry.textContent = 'Reload preview';
  retry.addEventListener('click', () => location.reload());
  message.append(title, text, retry);
  app.replaceChildren(message);
}
