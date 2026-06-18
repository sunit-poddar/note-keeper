import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { marked } from 'marked';

// Configure marked with syntax-highlighted code blocks.
// Handles both marked v12 token-object API and the older positional-string API,
// since esm.sh builds may call the renderer either way.
marked.use({
  renderer: {
    code(tokenOrCode, infostring) {
      const isToken = tokenOrCode !== null && typeof tokenOrCode === 'object';
      const rawText = isToken ? tokenOrCode.text : tokenOrCode;
      const rawLang = isToken ? tokenOrCode.lang : infostring;
      const text     = typeof rawText === 'string' ? rawText : '';
      const language = (typeof rawLang === 'string' ? rawLang : '')
                         .split(/[=\s]/)[0].toLowerCase().trim();

      const hljs = window.hljs;  // lazy — never cached at module init
      if (!hljs || !text) {
        return `<pre><code>${text}</code></pre>`;
      }
      try {
        const result = (language && hljs.getLanguage(language))
          ? hljs.highlight(text, { language })
          : hljs.highlightAuto(text);
        const highlighted = typeof result?.value === 'string' ? result.value : text;
        const cls = language ? ` language-${language}` : '';
        return `<pre><code class="hljs${cls}">${highlighted}</code></pre>`;
      } catch {
        return `<pre><code>${text}</code></pre>`;
      }
    },
  },
});

// ── Custom light theme for CodeMirror (GitHub Primer palette) ─────────────
const nkLight = EditorView.theme({
  '&': { color: '#1f2328', backgroundColor: '#ffffff' },
  '.cm-content': { caretColor: '#0969da' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#0969da' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    background: '#c8e1ff',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(9,105,218,0.04)' },
  '.cm-gutters': {
    backgroundColor: '#f6f8fa',
    color: '#8c959f',
    border: 'none',
    borderRight: '1px solid #d0d7de',
  },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(9,105,218,0.06)' },
  '.cm-lineNumbers .cm-gutterElement': { color: '#8c959f', paddingRight: '10px' },
}, { dark: false });

// ── State ──────────────────────────────────────────────────────────────────
const appState = {
  notes: [],
  currentNoteId: null,
  saveTimer: null,
  allNotes: [],   // unfiltered, for search
};

// ── Theme management ───────────────────────────────────────────────────────
const themeCompartment = new Compartment();

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}

function editorThemeExtension() {
  return currentTheme() === 'dark' ? oneDark : nkLight;
}

function applyEditorTheme() {
  if (cmView) {
    cmView.dispatch({ effects: themeCompartment.reconfigure(editorThemeExtension()) });
  }
}

function updateThemeIcons(theme) {
  const sun = document.getElementById('icon-sun');
  const moon = document.getElementById('icon-moon');
  if (theme === 'dark') {
    sun.style.display = 'none';
    moon.style.display = '';
  } else {
    sun.style.display = '';
    moon.style.display = 'none';
  }
}

function applyHljsTheme(theme) {
  const light = document.getElementById('hljs-light');
  const dark  = document.getElementById('hljs-dark');
  if (light) light.disabled = (theme === 'dark');
  if (dark)  dark.disabled  = (theme === 'light');
}

// Apply icons and hljs theme immediately on boot
updateThemeIcons(currentTheme());
applyHljsTheme(currentTheme());

document.getElementById('btn-theme').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('nk-theme', next);
  updateThemeIcons(next);
  applyEditorTheme();
  applyHljsTheme(next);
  renderPreview(); // re-render so existing code blocks repaint with new theme
});

// ── CSRF / fetch ───────────────────────────────────────────────────────────
const csrfToken = document.getElementById('csrf-token').value;

function apiFetch(url, options = {}) {
  const headers = { 'X-CSRFToken': csrfToken, ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  return fetch(url, { ...options, headers });
}

// ── Save status ────────────────────────────────────────────────────────────
const statusEl = document.getElementById('save-status');

function setSaveStatus(s) {
  statusEl.className = s;
  if (s === 'saving') statusEl.textContent = 'Saving…';
  else if (s === 'saved') statusEl.textContent = 'Saved';
  else if (s === 'error') statusEl.textContent = 'Error';
  else statusEl.textContent = '';
}

// ── Sidebar / note list ────────────────────────────────────────────────────
const noteListEl = document.getElementById('note-list');

function renderSidebar(notes) {
  const list = notes || appState.notes;
  noteListEl.innerHTML = '';
  for (const note of list) {
    const li = document.createElement('li');
    li.dataset.id = note.id;
    li.textContent = note.title || 'Untitled';
    if (note.id === appState.currentNoteId) li.classList.add('active');
    li.addEventListener('click', () => selectNote(note.id));
    noteListEl.appendChild(li);
  }
}

function highlightSidebarItem(id) {
  for (const li of noteListEl.querySelectorAll('li')) {
    li.classList.toggle('active', parseInt(li.dataset.id) === id);
  }
}

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('note-search').addEventListener('input', e => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderSidebar(appState.notes);
    return;
  }
  const filtered = appState.notes.filter(n => (n.title || '').toLowerCase().includes(q));
  renderSidebar(filtered);
});

// ── CodeMirror setup ───────────────────────────────────────────────────────
let cmView = null;

function initEditor() {
  cmView = new EditorView({
    state: EditorState.create({
      doc: '',
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([
          {
            key: 'Shift-Tab',
            run: () => {
              document.getElementById('note-title').focus();
              return true;
            },
          },
          { key: 'Tab', run: insertTab },
          { key: 'Mod-b', run: () => { applyFormat('bold'); return true; } },
          { key: 'Mod-i', run: () => { applyFormat('italic'); return true; } },
          { key: 'Mod-k', run: () => { applyFormat('link'); return true; } },
          { key: 'Mod-Shift-x', run: () => { applyFormat('strike'); return true; } },
          { key: 'Mod-Shift-c', run: () => { applyFormat('codeblock'); return true; } },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        markdown(),
        themeCompartment.of(editorThemeExtension()),
        EditorView.updateListener.of(update => {
          if (update.docChanged) onEditorChange();
        }),
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-focused': { outline: 'none' },
        }),
      ],
    }),
    parent: document.getElementById('codemirror-container'),
  });
}

function setEditorContent(text) {
  cmView.dispatch({
    changes: { from: 0, to: cmView.state.doc.length, insert: text },
  });
}

// ── Tab: title → editor, Shift+Tab: editor → title ────────────────────────
document.getElementById('note-title').addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    cmView.focus();
  }
});

// ── Preview ────────────────────────────────────────────────────────────────
const previewEl = document.getElementById('preview-content');

function renderPreview() {
  const src = cmView.state.doc.toString();
  previewEl.innerHTML = marked.parse(src);
}

// ── Editor/empty state toggling ────────────────────────────────────────────
const editorPaneEl = document.getElementById('editor-pane');
const previewPaneEl = document.getElementById('preview-pane');
const dividerEl = document.getElementById('divider');
const emptyStateEl = document.getElementById('empty-state');

function showEditor(show) {
  editorPaneEl.style.display = show ? 'flex' : 'none';
  dividerEl.style.display = show ? '' : 'none';
  previewPaneEl.style.display = show ? 'flex' : 'none';
  emptyStateEl.style.display = show ? 'none' : 'flex';
}

// ── Auto-save ──────────────────────────────────────────────────────────────
const SAVE_DELAY = 1000;

function onEditorChange() {
  if (!appState.currentNoteId) return;
  renderPreview();
  scheduleSave();
}

function scheduleSave() {
  setSaveStatus('saving');
  clearTimeout(appState.saveTimer);
  appState.saveTimer = setTimeout(saveCurrentNote, SAVE_DELAY);
}

async function saveCurrentNote() {
  if (!appState.currentNoteId) return;
  const title = document.getElementById('note-title').value.trim() || 'Untitled';
  const text = cmView.state.doc.toString();
  try {
    const res = await apiFetch(`/api/notes/${appState.currentNoteId}/save/`, {
      method: 'POST',
      body: JSON.stringify({ title, text }),
    });
    if (!res.ok) throw new Error();
    setSaveStatus('saved');
    // Update + re-sort notes list by most recently edited
    const idx = appState.notes.findIndex(n => n.id === appState.currentNoteId);
    if (idx !== -1) {
      appState.notes[idx].title = title;
      if (idx > 0) {
        const [note] = appState.notes.splice(idx, 1);
        appState.notes.unshift(note);
      }
    }
    renderSidebar();
    highlightSidebarItem(appState.currentNoteId);
  } catch {
    setSaveStatus('error');
  }
}

// ── Title input handler ────────────────────────────────────────────────────
document.getElementById('note-title').addEventListener('input', () => {
  if (!appState.currentNoteId) return;
  scheduleSave();
});

// ── Select note ────────────────────────────────────────────────────────────
async function selectNote(id) {
  if (appState.currentNoteId === id) return;

  // Flush pending save
  if (appState.currentNoteId && appState.saveTimer) {
    clearTimeout(appState.saveTimer);
    appState.saveTimer = null;
    await saveCurrentNote();
  }

  appState.currentNoteId = id;
  highlightSidebarItem(id);
  showEditor(true);
  setSaveStatus('');

  try {
    const res = await fetch(`/api/notes/${id}/`);
    if (!res.ok) throw new Error();
    const note = await res.json();
    document.getElementById('note-title').value = note.title;
    setEditorContent(note.text);
    renderPreview();
    setSaveStatus('saved');
  } catch {
    setSaveStatus('error');
  }
}

// ── Load notes list ────────────────────────────────────────────────────────
async function loadNoteList() {
  try {
    const res = await fetch('/api/notes/');
    if (!res.ok) throw new Error();
    const data = await res.json();
    appState.notes = data.notes;
    renderSidebar();
    if (appState.notes.length > 0) {
      await selectNote(appState.notes[0].id);
    } else {
      showEditor(false);
    }
  } catch {
    showEditor(false);
  }
}

// ── New note ───────────────────────────────────────────────────────────────
document.getElementById('btn-new-note').addEventListener('click', async () => {
  if (appState.currentNoteId && appState.saveTimer) {
    clearTimeout(appState.saveTimer);
    appState.saveTimer = null;
    await saveCurrentNote();
  }

  try {
    const res = await apiFetch('/api/notes/create/', { method: 'POST', body: '{}' });
    if (!res.ok) throw new Error();
    const note = await res.json();
    appState.notes.unshift({
      id: note.id, title: note.title,
      updated_at: note.updated_at, is_public: false, slug: null,
    });
    appState.currentNoteId = null; // force selectNote to run
    renderSidebar();
    await selectNote(note.id);
    const titleEl = document.getElementById('note-title');
    titleEl.focus();
    titleEl.select();
  } catch {
    setSaveStatus('error');
  }
});

// ── Delete note ────────────────────────────────────────────────────────────
document.getElementById('btn-delete').addEventListener('click', async () => {
  if (!appState.currentNoteId) return;
  if (!confirm('Delete this note? This cannot be undone.')) return;

  clearTimeout(appState.saveTimer);
  appState.saveTimer = null;

  try {
    await apiFetch(`/api/notes/${appState.currentNoteId}/delete/`, { method: 'POST' });
    appState.notes = appState.notes.filter(n => n.id !== appState.currentNoteId);
    appState.currentNoteId = null;
    renderSidebar();
    previewEl.innerHTML = '';
    document.getElementById('note-title').value = '';
    setEditorContent('');
    setSaveStatus('');

    if (appState.notes.length > 0) {
      await selectNote(appState.notes[0].id);
    } else {
      showEditor(false);
    }
  } catch {
    setSaveStatus('error');
  }
});

// ── Publish note ───────────────────────────────────────────────────────────
document.getElementById('btn-publish').addEventListener('click', async () => {
  if (!appState.currentNoteId) return;

  clearTimeout(appState.saveTimer);
  appState.saveTimer = null;
  await saveCurrentNote();

  try {
    const res = await apiFetch(`/api/notes/${appState.currentNoteId}/publish/`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      const url = `${window.location.origin}${data.public_url}`;
      prompt('Note published! Copy the link:', url);
    }
  } catch {
    setSaveStatus('error');
  }
});

// ── Export ─────────────────────────────────────────────────────────────────
function exportMd() {
  if (!appState.currentNoteId) return;
  const title = document.getElementById('note-title').value || 'Untitled';
  const text = cmView.state.doc.toString();
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })),
    download: `${title}.md`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportPdf() {
  if (!appState.currentNoteId) return;
  window.open(`/notes/${appState.currentNoteId}/print/`, '_blank');
}

document.getElementById('btn-export-md').addEventListener('click', exportMd);
document.getElementById('btn-export-pdf').addEventListener('click', exportPdf);

// ── Image upload ───────────────────────────────────────────────────────────
document.getElementById('btn-img-upload').addEventListener('click', () => {
  if (appState.currentNoteId) document.getElementById('img-file-input').click();
});

document.getElementById('img-file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';  // reset so same file can be re-selected
  const formData = new FormData();
  formData.append('image', file);
  try {
    const res = await apiFetch('/api/images/upload/', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    const pos = cmView.state.selection.main.head;
    const alt = file.name.replace(/\.[^.]+$/, '');
    cmView.dispatch({ changes: { from: pos, insert: `![${alt}](${data.url})` } });
    cmView.focus();
  } catch (err) {
    setSaveStatus('error');
    alert(err.message || 'Image upload failed');
  }
});

// ── Shortcuts modal ────────────────────────────────────────────────────────
const shortcutsModal = document.getElementById('shortcuts-modal');

function toggleShortcuts(show) {
  shortcutsModal.style.display = show ? 'flex' : 'none';
}

document.getElementById('btn-shortcuts').addEventListener('click', () => toggleShortcuts(true));
document.getElementById('btn-close-shortcuts').addEventListener('click', () => toggleShortcuts(false));
shortcutsModal.addEventListener('click', e => {
  if (e.target === shortcutsModal) toggleShortcuts(false);
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 's') {
    e.preventDefault();
    if (appState.currentNoteId) {
      clearTimeout(appState.saveTimer);
      saveCurrentNote();
    }
  }
  if (mod && e.key === 'n') {
    e.preventDefault();
    document.getElementById('btn-new-note').click();
  }
  if (mod && e.shiftKey && e.key === 'Backspace') {
    e.preventDefault();
    document.getElementById('btn-delete').click();
  }
  if (mod && e.shiftKey && e.key === 'F') {
    e.preventDefault();
    document.getElementById('note-search').focus();
  }
  if (mod && e.shiftKey && e.key === 'E') {
    e.preventDefault();
    exportMd();
  }
  if (mod && e.shiftKey && e.key === 'P') {
    e.preventDefault();
    exportPdf();
  }
  if (mod && e.key === '/') {
    e.preventDefault();
    toggleShortcuts(shortcutsModal.style.display === 'none' || !shortcutsModal.style.display);
  }
  if (e.key === 'Escape' && shortcutsModal.style.display === 'flex') {
    toggleShortcuts(false);
  }
});

// ── Format toolbar ─────────────────────────────────────────────────────────
function applyFormat(fmt) {
  const state = cmView.state;
  const sel = state.selection.main;
  const selected = state.sliceDoc(sel.from, sel.to);
  let insert = '';
  let cursorAt = null;

  switch (fmt) {
    case 'bold':
      insert = `**${selected || 'bold text'}**`;
      cursorAt = selected ? sel.from + insert.length : sel.from + 2;
      break;
    case 'italic':
      insert = `*${selected || 'italic text'}*`;
      cursorAt = selected ? sel.from + insert.length : sel.from + 1;
      break;
    case 'strike':
      insert = `~~${selected || 'strikethrough'}~~`;
      cursorAt = selected ? sel.from + insert.length : sel.from + 2;
      break;
    case 'h1':
      insert = `# ${selected || 'Heading 1'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'h2':
      insert = `## ${selected || 'Heading 2'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'h3':
      insert = `### ${selected || 'Heading 3'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'code':
      insert = `\`${selected || 'code'}\``;
      cursorAt = selected ? sel.from + insert.length : sel.from + 1;
      break;
    case 'codeblock':
      insert = `\`\`\`\n${selected || 'code here'}\n\`\`\``;
      cursorAt = selected ? sel.from + insert.length : sel.from + 4;
      break;
    case 'quote':
      insert = `> ${selected || 'blockquote'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'ul':
      insert = `- ${selected || 'item'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'ol':
      insert = `1. ${selected || 'item'}`;
      cursorAt = sel.from + insert.length;
      break;
    case 'link':
      insert = selected ? `[${selected}](url)` : `[link text](url)`;
      cursorAt = sel.from + (selected ? selected.length + 3 : 12);
      break;
    case 'table':
      insert = `| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |`;
      cursorAt = sel.from + insert.length;
      break;
    case 'hr':
      insert = `\n---\n`;
      cursorAt = sel.from + insert.length;
      break;
    default:
      return;
  }

  cmView.dispatch({
    changes: { from: sel.from, to: sel.to, insert },
    selection: { anchor: cursorAt },
  });
  cmView.focus();
}

document.getElementById('format-toolbar').addEventListener('click', e => {
  const btn = e.target.closest('[data-fmt]');
  if (btn && appState.currentNoteId) applyFormat(btn.dataset.fmt);
});

// ── Boot ───────────────────────────────────────────────────────────────────
initEditor();
showEditor(false);  // start with empty state until notes load
loadNoteList();
