'use strict';
/* ═══════════════════════════════════════════════════════════════
   dashboard-community.js — Community view ported from standalone
   community/ page. IIFE-wrapped, ROOT-scoped, live-state integrated.
═══════════════════════════════════════════════════════════════ */
(function () {

let ROOT = null;
const byId = id => ROOT.getElementById(id);
const qs   = s  => ROOT.querySelector(s);
const qsa  = s  => ROOT.querySelectorAll(s);

const COMMUNITY_MARKUP = `<div class="sc-root-bar"><span class="dot" id="api-dot"></span><span id="api-label">checking API…</span></div>
<!-- ───────────────────────────────────────────────────────────── -->
  <!-- Community -->
  <!-- ───────────────────────────────────────────────────────────── -->

  <section id="screen-search" class="screen active">

    <h1>Community decks</h1>
    <p class="section-sub">
      Search and discover decks shared by the SCIMA community.
    </p>

    <!-- Search -->
    <div class="search-row">
      <input
        id="search-input"
        type="search"
        autocomplete="off"
        placeholder="Search decks…"
        maxlength="200"
      >

      <select id="search-sort" class="sc-select" style="width:auto;min-width:140px">
        <option value="relevance">Relevance</option>
        <option value="newest">Newest</option>
        <option value="popularity">Popularity</option>
      </select>

      <button class="btn btn-primary" id="search-btn">
        Search
      </button>
    </div>

    <!-- Search results -->
    <div id="search-results-section" style="display:none">
      <div
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          margin-bottom:12px;
        "
      >
        <h3 style="margin:0;font-size:14px" id="results-title">
          Search results
        </h3>

        <span
          id="results-count"
          style="font-size:11px;color:var(--muted)"
        ></span>
      </div>

      <div id="search-results" class="deck-grid"></div>

      <div
        id="search-empty"
        class="empty-state"
        style="display:none"
      >
        <div class="big-emoji">🔎</div>
        <div>No decks matched your search.</div>
      </div>
    </div>

    <!-- Popular -->
    <section id="popular-section">

      <div
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          margin-bottom:12px;
        "
      >
        <div>
          <h3 style="margin:0;font-size:15px">
            Most downloaded
          </h3>
          <p
            style="
              margin:3px 0 0;
              color:var(--muted);
              font-size:11px;
            "
          >
            The five most downloaded decks of all time
          </p>
        </div>
      </div>

      <div id="popular-grid" class="deck-grid"></div>

      <div
        id="popular-empty"
        class="empty-state"
        style="display:none"
      >
        <div class="big-emoji">📭</div>
        <div>No decks have been published yet.</div>
      </div>

    </section>

    <!-- Upload -->
    <section id="upload-panel">

      <h3>⬆ Upload a deck</h3>

      <p>
        Publish a SCIMA deck export to the community registry.
      </p>

      <!-- File -->
      <label class="sc-field-label" for="upload-file">
        Deck file
      </label>

      <div
        id="upload-dropzone"
        style="
          border:1px dashed var(--border);
          border-radius:10px;
          padding:18px;
          text-align:center;
          cursor:pointer;
          background:rgba(255,255,255,0.025);
          transition:border-color .15s,background .15s;
        "
      >
        <div
          id="upload-file-name"
          style="
            font-size:13px;
            font-weight:700;
            margin-bottom:4px;
          "
        >
          Drop a SCIMA JSON export here
        </div>

        <div
          style="
            color:var(--muted);
            font-size:11px;
          "
        >
          or click to choose a file
        </div>

        <input
          type="file"
          id="upload-file"
          accept=".json,application/json"
          hidden
        >
      </div>

      <!-- Extracted metadata preview -->
      <div
        id="upload-extracted"
        style="
          display:none;
          margin-top:12px;
          padding:12px;
          border-radius:10px;
          background:rgba(91,206,250,0.06);
          border:1px solid rgba(91,206,250,0.15);
        "
      >
        <div
          style="
            font-size:10px;
            color:var(--muted);
            text-transform:uppercase;
            letter-spacing:.05em;
            font-weight:700;
            margin-bottom:8px;
          "
        >
          Deck detected
        </div>

        <div
          id="upload-extracted-name"
          style="
            font-weight:800;
            font-size:14px;
          "
        ></div>

        <div
          id="upload-extracted-meta"
          style="
            margin-top:4px;
            color:var(--muted);
            font-size:11px;
          "
        ></div>
      </div>

      <!-- Description -->
      <label class="sc-field-label" for="upload-desc">
        Description
      </label>

      <textarea
        id="upload-desc"
        class="quiz-input-area"
        placeholder="A short description of this deck…"
        style="min-height:80px"
      ></textarea>

      <!-- Author -->
      <label class="sc-field-label" for="upload-author">
        Author
      </label>

      <input
        id="upload-author"
        class="sc-text-input"
        type="text"
        placeholder="Creator name (optional)"
        autocomplete="name"
      >

      <!-- Tags -->
      <label class="sc-field-label" for="upload-tag-input">
        Tags
      </label>

      <div
        id="tag-input-container"
        style="
          display:flex;
          flex-wrap:wrap;
          gap:6px;
          align-items:center;
          min-height:40px;
          padding:6px 8px;
          background:rgba(255,255,255,0.06);
          border:1px solid var(--border);
          border-radius:8px;
        "
      >
        <div
          id="upload-tags-list"
          style="
            display:flex;
            flex-wrap:wrap;
            gap:5px;
          "
        ></div>

        <input
          id="upload-tag-input"
          type="text"
          placeholder="Add a tag…"
          autocomplete="off"
          style="
            flex:1;
            min-width:100px;
            background:none;
            border:none;
            outline:none;
            color:var(--text);
            font:inherit;
            font-size:12px;
            padding:4px;
          "
        >
      </div>

      <div
        style="
          margin-top:4px;
          font-size:10px;
          color:var(--muted);
        "
      >
        Press Enter or comma to add a tag.
      </div>

      <!-- Subject / level -->
      <div class="field-row" style="margin-top:10px">

        <div style="flex:1;min-width:160px">
          <label class="sc-field-label" for="upload-subject">
            Subject
          </label>

          <select id="upload-subject" class="sc-select">
            <option value="">Select a subject</option>
            <option value="biology">Biology</option>
            <option value="chemistry">Chemistry</option>
            <option value="physics">Physics</option>
            <option value="mathematics">Mathematics</option>
            <option value="computer science">Computer Science</option>
            <option value="english">English</option>
            <option value="geography">Geography</option>
            <option value="history">History</option>
            <option value="languages">Languages</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style="flex:1;min-width:160px">
          <label class="sc-field-label" for="upload-level">
            Level
          </label>

          <select id="upload-level" class="sc-select">
            <option value="">Select a level</option>
            <option value="KS3">KS3</option>
            <option value="GCSE">GCSE</option>
            <option value="A Level">A Level</option>
            <option value="University">University</option>
          </select>
        </div>

      </div>

      <!-- Exam board -->
      <label class="sc-field-label" for="upload-exam-board">
        Exam Board
      </label>

      <select id="upload-exam-board" class="sc-select">
        <option value="">Not applicable</option>
        <option value="AQA">AQA</option>
        <option value="Edexcel">Edexcel</option>
        <option value="OCR">OCR</option>
        <option value="Eduqas">Eduqas</option>
        <option value="WJEC">WJEC</option>
        <option value="CCEA">CCEA</option>
        <option value="Cambridge">Cambridge</option>
        <option value="Other">Other</option>
      </select>

      <button
        class="btn btn-primary btn-sm"
        id="upload-btn"
        style="margin-top:16px"
      >
        Upload deck
      </button>

      <div id="upload-status"></div>

    </section>

  </section>


  <!-- ───────────────────────────────────────────────────────────── -->
  <!-- Deck detail -->
  <!-- ───────────────────────────────────────────────────────────── -->

  <section id="screen-deck" class="screen">

    <button
      class="btn btn-ghost btn-sm"
      id="back-to-search"
    >
      ← Back to decks
    </button>

    <div
      id="deck-detail"
      style="margin-top:16px"
    ></div>

  </section>`;

function buildCommunity() {
// SCIMA Study — Community Decks
// Standalone public community frontend.
// Uses only /api/v1 public endpoints.
// No extension storage and no study functionality.

// ─────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────

const API_BASE = window.SCIMA_API_BASE || '/api/v1';


// ─────────────────────────────────────────────────────────────────────
// Client-side limits
//
// These intentionally aren't exposed in the UI. They exist only to
// reject obviously invalid uploads before making a network request.
// They should mirror the backend schema limits.
// ─────────────────────────────────────────────────────────────────────

const LIMITS = {
  MAX_REQUEST_BODY_BYTES: 5 * 1024 * 1024,
  MAX_CARDS_PER_DECK: 5000,
  MAX_CARD_TEXT_BYTES: 100 * 1024,
  MAX_DECK_NAME_CHARS: 200,
  MAX_DESCRIPTION_BYTES: 25 * 1024,
  MAX_AUTHOR_CHARS: 200,
  MAX_TAGS: 30,
  MAX_TAG_CHARS: 50,
  MAX_SEARCH_QUERY_CHARS: 200,
};

function utf8Bytes(value) {
  return new TextEncoder().encode(String(value || '')).length;
}


// ─────────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = value;
    } else if (key.startsWith('on')) {
      node.addEventListener(key.slice(2), value);
    } else {
      node.setAttribute(key, value);
    }
  }

  for (const child of children.flat()) {
    if (child == null) continue;

    node.append(
      typeof child === 'string'
        ? document.createTextNode(child)
        : child
    );
  }

  return node;
}

function btn(label, variant = 'primary', options = {}) {
  const button = el(
    'button',
    {
      class: `btn btn-${variant}${options.small ? ' btn-sm' : ''}${options.full ? ' btn-full' : ''}`,
    },
    label
  );

  if (options.disabled) {
    button.disabled = true;
  }

  if (options.onclick) {
    button.addEventListener('click', options.onclick);
  }

  return button;
}

function mkTag(label) {
  return el(
    'span',
    { class: 'tag' },
    label
  );
}


// ─────────────────────────────────────────────────────────────────────
// API error handling
// ─────────────────────────────────────────────────────────────────────

async function throwForStatus(response, fallback) {
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');

    const detail = await response
      .json()
      .catch(() => ({}));

    throw new Error(
      detail.detail ||
      `Too many requests${retryAfter ? ` — try again in ${retryAfter}s` : ''}.`
    );
  }

  const detail = await response
    .json()
    .catch(() => ({}));

  let message = fallback;

  if (detail?.detail) {
    if (typeof detail.detail === 'string') {
      message = detail.detail;
    } else {
      message = JSON.stringify(detail.detail);
    }
  }

  throw new Error(message);
}


// ─────────────────────────────────────────────────────────────────────
// API client
// ─────────────────────────────────────────────────────────────────────

const api = {

  async health() {
    const response = await fetch(`${API_BASE}/health`);

    if (!response.ok) {
      await throwForStatus(response, 'API health check failed.');
    }

    return response.json();
  },


  async listDecks(params = {}) {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        query.set(key, value);
      }
    }

    const suffix = query.toString()
      ? `?${query.toString()}`
      : '';

    const response = await fetch(
      `${API_BASE}/decks${suffix}`
    );

    if (!response.ok) {
      await throwForStatus(response, 'Could not load decks.');
    }

    return response.json();
  },


  async search(query, params = {}) {
    if (query.length > LIMITS.MAX_SEARCH_QUERY_CHARS) {
      throw new Error('Search query is too long.');
    }

    const searchParams = new URLSearchParams({
      q: query,
    });

    for (const [key, value] of Object.entries(params)) {
      if (
        value !== undefined &&
        value !== null &&
        value !== ''
      ) {
        searchParams.set(key, value);
      }
    }

    const response = await fetch(
      `${API_BASE}/search?${searchParams.toString()}`
    );

    if (!response.ok) {
      await throwForStatus(response, 'Search failed.');
    }

    return response.json();
  },


  async getDeck(id) {
    const response = await fetch(
      `${API_BASE}/decks/${encodeURIComponent(id)}`
    );

    if (!response.ok) {
      await throwForStatus(response, 'Deck not found.');
    }

    return response.json();
  },


  async exportDeck(id) {
    const response = await fetch(
      `${API_BASE}/decks/${encodeURIComponent(id)}/export`
    );

    if (!response.ok) {
      await throwForStatus(response, 'Could not download deck.');
    }

    return response.json();
  },


  async createDeck(body) {
    const serialized = JSON.stringify(body);

    if (
      utf8Bytes(serialized) >
      LIMITS.MAX_REQUEST_BODY_BYTES
    ) {
      throw new Error('This deck is too large to upload.');
    }

    const response = await fetch(
      `${API_BASE}/decks`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: serialized,
      }
    );

    if (!response.ok) {
      await throwForStatus(response, 'Upload failed.');
    }

    return response.json();
  },

};


// ─────────────────────────────────────────────────────────────────────
// Dashboard bridge
// ─────────────────────────────────────────────────────────────────────
// The dashboard (study.scima-net.com/dashboard/) and this community app
// share an origin, so decks can be added straight into the dashboard's
// localStorage-backed state (key `mf_state`) without any API involved.
// Mirrors the subject list from src/shared/shared.js — kept small and
// local rather than loading the whole dashboard bundle here.
const SUBJECTS = {
  englishLanguage: { name: 'English Language', defaultColor: '#1B3A6B' },
  englishLiterature: { name: 'English Literature', defaultColor: '#5FA820' },
  mathematics: { name: 'Mathematics', defaultColor: '#E07B00' },
  furtherMathematics: { name: 'Further Mathematics', defaultColor: '#C93A2A' },
  biology: { name: 'Biology', defaultColor: '#27AE60' },
  chemistry: { name: 'Chemistry', defaultColor: '#00ACC1' },
  physics: { name: 'Physics', defaultColor: '#D32F2F' },
  computerScience: { name: 'Computer Science', defaultColor: '#7B5EA7' },
  economics: { name: 'Economics', defaultColor: '#C8960A' },
  french: { name: 'French', defaultColor: '#C2185B' },
  geography: { name: 'Geography', defaultColor: '#7B1FA2' },
  music: { name: 'Music', defaultColor: '#C5A800' },
  misc: { name: 'Miscellaneous', defaultColor: '#AAAAAA' },
};
const DEFAULT_SUBJECT_KEY = 'misc';

function dashUid(p = 'id') { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// Inside the dashboard this module talks to the LIVE state object and
// scheduleSave() (both globals from dashboard-core.js) rather than rewriting
// the mf_state localStorage blob behind the dashboard's back.
const dashboardStore = {
  load() { return { decks: state.decks, folders: state.folders, settings: state.settings }; },
  save() { scheduleSave(); },
  addDeckToDashboard(deckExport, deck, subjectKey, folderId) {
    const cards = (deckExport.deck.cards || []).map(c => ({ ...c, id: c.id || dashUid('c') }));
    const d = {
      id: dashUid('d'),
      name: deckExport.deck.name || deck.name,
      emoji: deckExport.deck.emoji || '📖',
      image: deckExport.deck.image || null,
      subject: subjectKey || DEFAULT_SUBJECT_KEY,
      folderId: folderId || null,
      color: 'var(--blue)',
      cards,
    };
    state.decks.push(d);
    scheduleSave();
    if (typeof renderSidebar === 'function') renderSidebar();
    return d;
  },
  createFolder(name, subjectKey, parentId) {
    const folder = { id: dashUid('f'), name, subjectKey: subjectKey || DEFAULT_SUBJECT_KEY, parentId: parentId || null };
    state.folders.push(folder);
    scheduleSave();
    return folder;
  },
};
;


// ── Modal shell (minimal, ported look from dashboard's openModal) ────
function openModal(title, buildBody) {
  const overlay = el('div', { class: 'sc-modal-overlay', onclick: e => { if (e.target === overlay) closeModal(); } });
  const box = el('div', { class: 'sc-modal-box' },
    el('div', { class: 'sc-modal-header' },
      el('h3', { class: 'sc-modal-title' }, title),
      el('button', { class: 'sc-modal-close', onclick: () => closeModal() }, '✕'),
    ),
    el('div', { class: 'sc-modal-body' }),
  );
  overlay.appendChild(box);
  ROOT.appendChild(overlay);
  buildBody(box.querySelector('.sc-modal-body'));
  ROOT.classList.add('sc-modal-open');
}
function closeModal() {
  qsa('.sc-modal-overlay').forEach(o => o.remove());
  ROOT.classList.remove('sc-modal-open');
}

// ── Add Deck (to dashboard) modal ─────────────────────────────────────
function openAddDeckModal(deck) {
  openModal(`Add "${deck.name}" to dashboard`, body => {
    const mf = dashboardStore.load();
    const folders = Array.isArray(mf.folders) ? mf.folders : [];
    const status = el('div', { class: 'sc-modal-status' });

    const subjectLabel = el('label', { class: 'sc-field-label' }, 'Subject');
    const subjectSel = el('select', { class: 'sc-select' });
    Object.entries(SUBJECTS).forEach(([key, s]) => {
      const opt = el('option', { value: key }, s.name);
      if (key === (deck.subject && SUBJECTS[deck.subject] ? deck.subject : DEFAULT_SUBJECT_KEY)) opt.selected = true;
      subjectSel.appendChild(opt);
    });

    const folderLabel = el('label', { class: 'sc-field-label' }, 'Folder (optional)');
    const folderSel = el('select', { class: 'sc-select' });

    function renderFolderOptions() {
      const sk = subjectSel.value;
      folderSel.innerHTML = '';
      folderSel.appendChild(el('option', { value: '' }, '— No folder (top level) —'));
      folders.filter(f => f.subjectKey === sk).forEach(f => {
        folderSel.appendChild(el('option', { value: f.id }, f.name));
      });
      folderSel.appendChild(el('option', { value: '__new__' }, '+ New folder…'));
    }
    renderFolderOptions();
    subjectSel.addEventListener('change', renderFolderOptions);

    const newFolderInput = el('input', { type: 'text', class: 'sc-text-input', placeholder: 'New folder name', style: 'display:none;margin-top:8px' });
    folderSel.addEventListener('change', () => {
      newFolderInput.style.display = folderSel.value === '__new__' ? '' : 'none';
    });

    const addBtn = btn('Add to dashboard', 'primary', { full: true });
    addBtn.addEventListener('click', async () => {
      status.className = 'sc-modal-status'; status.textContent = '';
      addBtn.disabled = true;
      try {
        const subjectKey = subjectSel.value || DEFAULT_SUBJECT_KEY;
        let folderId = folderSel.value || null;
        if (folderId === '__new__') {
          const name = newFolderInput.value.trim();
          if (!name) { newFolderInput.focus(); throw new Error('Enter a name for the new folder.'); }
          const folder = dashboardStore.createFolder(name, subjectKey, null);
          folderId = folder.id;
        }
        // Fetch the full deck export. This intentionally counts as a
        // download — /api/v1/decks/{id}/export is the only endpoint that
        // returns card data, and it increments the deck's download
        // counter on every call, same as "Download to device". That's by
        // design here: adding a deck to your dashboard is a real use of
        // it, so it should count toward the deck's popularity like any
        // other download. api.getDeck() only returns the metadata
        // summary (no cards), so it can't be used here regardless.
        const full = await api.exportDeck(deck.id);
        dashboardStore.addDeckToDashboard(full, deck, subjectKey, folderId);
        status.className = 'sc-modal-status ok'; status.textContent = `Added to ${SUBJECTS[subjectKey]?.name || subjectKey} ✓`;
        setTimeout(() => closeModal(), 900);
      } catch (e) {
        status.className = 'sc-modal-status err'; status.textContent = e.message;
      } finally {
        addBtn.disabled = false;
      }
    });

    body.append(
      subjectLabel, subjectSel,
      folderLabel, folderSel,
      newFolderInput,
      el('div', { style: 'margin-top:16px' }, addBtn),
      status,
    );
  });
}


// ─────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────

const cState = {
  currentDeck: null,

  popularLoaded: false,

  search: {
    query: '',
    sort: 'relevance',
  },

  upload: {
    parsed: null,
    tags: [],
  },
};


// ─────────────────────────────────────────────────────────────────────
// Screen navigation
// ─────────────────────────────────────────────────────────────────────

function showScreen(name) {
  document
    .querySelectorAll('.screen')
    .forEach(screen => {
      screen.classList.toggle(
        'active',
        screen.id === `screen-${name}`
      );
    });

  window.scrollTo({
    top: 0,
    behavior: 'smooth',
  });
}

document
  .getElementById('back-to-search')
  .addEventListener('click', () => {
    showScreen('search');
  });


// ─────────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderRichText(value) {
  if (value == null || value === '') {
    return '';
  }

  const katexAvailable =
    typeof katex !== 'undefined';

  const decode = text =>
    text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const renderMath = (expression, display) => {
    const raw = decode(expression);

    if (!katexAvailable) {
      return escapeHtml(
        display
          ? `$$${raw}$$`
          : `$${raw}$`
      );
    }

    try {
      return katex.renderToString(
        raw,
        {
          throwOnError: false,
          displayMode: display,
        }
      );
    } catch {
      return escapeHtml(
        display
          ? `$$${raw}$$`
          : `$${raw}$`
      );
    }
  };

  let text = escapeHtml(String(value));

  text = text.replace(
    /\$\$([\s\S]+?)\$\$/g,
    (_, expression) =>
      renderMath(expression, true)
  );

  text = text.replace(
    /\$([^$\n]+?)\$/g,
    (_, expression) =>
      renderMath(expression, false)
  );

  text = text.replace(
    /\*\*([\s\S]+?)\*\*/g,
    '<strong>$1</strong>'
  );

  text = text.replace(
    /__([\s\S]+?)__/g,
    '<u>$1</u>'
  );

  text = text.replace(
    /(^|[^*])\*([^*\n]+?)\*(?!\*)/g,
    '$1<em>$2</em>'
  );

  text = text.replace(
    /\n/g,
    '<br>'
  );

  return text;
}

function setRichText(node, value) {
  node.innerHTML = renderRichText(value);
  return node;
}

function formatDate(value) {
  if (!value) return 'Unknown';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleDateString(
    undefined,
    {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }
  );
}


// ─────────────────────────────────────────────────────────────────────
// Deck rendering
// ─────────────────────────────────────────────────────────────────────

function deckTags(deck) {
  const tags = [];

  if (deck.subject) {
    tags.push(
      mkTag(deck.subject)
    );
  }

  if (deck.level) {
    tags.push(
      mkTag(deck.level)
    );
  }

  if (deck.examBoard) {
    tags.push(
      mkTag(deck.examBoard)
    );
  }

  for (const tag of deck.tags || []) {
    if (tags.length >= 5) break;

    tags.push(
      mkTag(tag)
    );
  }

  return tags;
}


function makeDeckCard(deck) {
  const card = el(
    'div',
    { class: 'deck-card' },

    el(
      'div',
      { class: 'deck-emoji' },
      deck.emoji || '📖'
    ),

    el(
      'div',
      { class: 'deck-name' },
      deck.name || 'Untitled deck'
    ),

    el(
      'div',
      { class: 'deck-desc' },
      deck.description || 'No description provided.'
    ),

    el(
      'div',
      { class: 'deck-meta' },

      el(
        'span',
        {},
        `${deck.cardCount ?? 0} cards`
      ),

      el(
        'span',
        {},
        `⬇ ${deck.downloads ?? 0}`
      )
    ),

    el(
      'div',
      { class: 'deck-tags' },
      deckTags(deck)
    )
  );

  card.addEventListener(
    'click',
    () => openDeck(deck.id)
  );

  return card;
}


function renderDeckGrid(
  container,
  items,
  emptyElement
) {
  container.innerHTML = '';

  if (!items?.length) {
    emptyElement.style.display = '';
    return;
  }

  emptyElement.style.display = 'none';

  for (const deck of items) {
    container.appendChild(
      makeDeckCard(deck)
    );
  }
}


// ─────────────────────────────────────────────────────────────────────
// Popular decks
// ─────────────────────────────────────────────────────────────────────

async function loadPopularDecks() {
  const grid =
    byId('popular-grid');

  const empty =
    byId('popular-empty');

  try {
    const response = await api.listDecks({
      sort: 'popularity',
      limit: 5,
      offset: 0,
    });

    renderDeckGrid(
      grid,
      response.items || [],
      empty
    );

    cState.popularLoaded = true;

  } catch (error) {
    grid.innerHTML = '';

    empty.style.display = '';

    empty.querySelector('div:nth-child(2)')
      .textContent =
      'Could not load community decks.';
  }
}


// ─────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────

async function runSearch() {
  const input =
    byId('search-input');

  const sort =
    byId('search-sort').value;

  const query =
    input.value.trim();

  const resultsSection =
    byId(
      'search-results-section'
    );

  const results =
    byId('search-results');

  const empty =
    byId('search-empty');

  const count =
    byId('results-count');

  const title =
    byId('results-title');

  if (!query) {
    resultsSection.style.display = 'none';
    byId(
      'popular-section'
    ).style.display = '';

    return;
  }

  if (
    query.length >
    LIMITS.MAX_SEARCH_QUERY_CHARS
  ) {
    showUploadStatus(
      null,
      'Search query is too long.',
      true
    );
    return;
  }

  const searchButton =
    byId('search-btn');

  if (searchButton.disabled) {
    return;
  }

  searchButton.disabled = true;
  searchButton.textContent = 'Searching…';

  try {
    const response = await api.search(
      query,
      {
        sort,
        limit: 50,
        offset: 0,
      }
    );

    const items =
      response.items || [];

    resultsSection.style.display = '';

    byId(
      'popular-section'
    ).style.display = 'none';

    title.textContent =
      sort === 'relevance'
        ? 'Search results'
        : sort === 'newest'
          ? 'Newest matches'
          : 'Most popular matches';

    if (typeof response.total === 'number') {
      count.textContent =
        `${response.total} result${response.total === 1 ? '' : 's'}`;
    } else {
      count.textContent =
        `${items.length} result${items.length === 1 ? '' : 's'}`;
    }

    renderDeckGrid(
      results,
      items,
      empty
    );

    cState.search.query = query;
    cState.search.sort = sort;

  } catch (error) {
    resultsSection.style.display = '';

    results.innerHTML = '';

    empty.style.display = '';

    empty.querySelector('div:nth-child(2)')
      .textContent =
      error.message || 'Search failed.';
  } finally {
    searchButton.disabled = false;
    searchButton.textContent = 'Search';
  }
}

document
  .getElementById('search-btn')
  .addEventListener(
    'click',
    runSearch
  );

document
  .getElementById('search-sort')
  .addEventListener(
    'change',
    () => {
      if (
        document
          .getElementById('search-input')
          .value
          .trim()
      ) {
        runSearch();
      }
    }
  );

document
  .getElementById('search-input')
  .addEventListener(
    'keydown',
    event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runSearch();
      }
    }
  );


// ─────────────────────────────────────────────────────────────────────
// Upload helpers
// ─────────────────────────────────────────────────────────────────────

function uploadError(message) {
  const error = new Error(message);
  error.uploadValidation = true;
  return error;
}


function validateUpload(
  parsed,
  meta
) {
  const problems = [];

  if (
    !parsed ||
    typeof parsed !== 'object'
  ) {
    problems.push(
      'The selected file is not a valid SCIMA export.'
    );

    return problems;
  }

  if (
    !parsed.deck ||
    typeof parsed.deck !== 'object' ||
    !Array.isArray(parsed.deck.cards)
  ) {
    problems.push(
      'The selected file is not a recognized SCIMA deck export.'
    );

    return problems;
  }

  const deck = parsed.deck;

  if (
    typeof deck.name !== 'string' ||
    !deck.name.trim()
  ) {
    problems.push(
      'The deck does not contain a valid name.'
    );
  }

  if (
    deck.name &&
    deck.name.length >
    LIMITS.MAX_DECK_NAME_CHARS
  ) {
    problems.push(
      'The deck name is too long.'
    );
  }

  if (
    deck.cards.length >
    LIMITS.MAX_CARDS_PER_DECK
  ) {
    problems.push(
      'This deck contains too many cards.'
    );
  }

  for (
    let index = 0;
    index < deck.cards.length;
    index++
  ) {
    const card = deck.cards[index];

    if (
      !card ||
      typeof card !== 'object'
    ) {
      problems.push(
        `Card ${index + 1} is invalid.`
      );
      break;
    }

    for (
      const field of [
        'front',
        'back',
        'hint',
      ]
    ) {
      if (
        typeof card[field] === 'string' &&
        utf8Bytes(card[field]) >
        LIMITS.MAX_CARD_TEXT_BYTES
      ) {
        problems.push(
          `One or more cards contain too much text.`
        );
        break;
      }
    }

    if (problems.length) {
      break;
    }
  }

  if (
    utf8Bytes(meta.description) >
    LIMITS.MAX_DESCRIPTION_BYTES
  ) {
    problems.push(
      'The description is too long.'
    );
  }

  if (
    meta.author.length >
    LIMITS.MAX_AUTHOR_CHARS
  ) {
    problems.push(
      'The author name is too long.'
    );
  }

  if (
    meta.tags.length >
    LIMITS.MAX_TAGS
  ) {
    problems.push(
      'Too many tags were added.'
    );
  }

  for (const tag of meta.tags) {
    if (
      tag.length >
      LIMITS.MAX_TAG_CHARS
    ) {
      problems.push(
        'One or more tags are too long.'
      );
      break;
    }
  }

  return problems;
}


// ─────────────────────────────────────────────────────────────────────
// Sanitise uploaded deck
//
// Images are deliberately stripped before the request is constructed.
// This prevents front/back image payloads from being stored server-side.
// ─────────────────────────────────────────────────────────────────────

function sanitiseDeck(deck) {
  const cleanDeck = {
    ...deck,
    cards: deck.cards.map(card => ({
      ...card,

      // Don't retain potentially large embedded image data.
      frontImage: null,
      backImage: null,
    })),
  };

  return cleanDeck;
}


// ─────────────────────────────────────────────────────────────────────
// Tags
// ─────────────────────────────────────────────────────────────────────

function renderUploadTags() {
  const container =
    byId(
      'upload-tags-list'
    );

  container.innerHTML = '';

  cState.upload.tags.forEach(
    (tag, index) => {
      const remove = el(
        'button',
        {
          type: 'button',
          title: 'Remove tag',
          style: `
            border:none;
            background:none;
            color:inherit;
            cursor:pointer;
            padding:0 0 0 3px;
            font:inherit;
          `,
        },
        '×'
      );

      remove.addEventListener(
        'click',
        () => {
          cState.upload.tags.splice(
            index,
            1
          );

          renderUploadTags();
        }
      );

      const tagNode = el(
        'span',
        {
          class: 'tag',
          style: `
            background:rgba(var(--blue-rgb),0.12);
            color:var(--blue);
            border:1px solid rgba(var(--blue-rgb),0.2);
          `,
        },
        tag,
        remove
      );

      container.appendChild(
        tagNode
      );
    }
  );
}


function addUploadTag(raw) {
  const tag =
    String(raw || '')
      .trim()
      .replace(/,$/, '')
      .trim();

  if (!tag) {
    return;
  }

  if (
    cState.upload.tags.some(
      existing =>
        existing.toLowerCase() ===
        tag.toLowerCase()
    )
  ) {
    return;
  }

  if (
    cState.upload.tags.length >=
    LIMITS.MAX_TAGS
  ) {
    return;
  }

  if (
    tag.length >
    LIMITS.MAX_TAG_CHARS
  ) {
    return;
  }

  cState.upload.tags.push(tag);

  renderUploadTags();
}


const tagInput =
  byId(
    'upload-tag-input'
  );

tagInput.addEventListener(
  'keydown',
  event => {
    if (
      event.key === 'Enter' ||
      event.key === ','
    ) {
      event.preventDefault();

      addUploadTag(
        tagInput.value
      );

      tagInput.value = '';
    }

    if (
      event.key === 'Backspace' &&
      !tagInput.value &&
      cState.upload.tags.length
    ) {
      cState.upload.tags.pop();
      renderUploadTags();
    }
  }
);

tagInput.addEventListener(
  'blur',
  () => {
    if (tagInput.value.trim()) {
      addUploadTag(
        tagInput.value
      );

      tagInput.value = '';
    }
  }
);


// ─────────────────────────────────────────────────────────────────────
// Upload status
// ─────────────────────────────────────────────────────────────────────

function showUploadStatus(
  message,
  text,
  error = false
) {
  const status =
    byId(
      'upload-status'
    );

  if (!status) {
    return;
  }

  status.className =
    error ? 'err' : 'ok';

  status.textContent =
    text || message || '';
}


// ─────────────────────────────────────────────────────────────────────
// File handling
// ─────────────────────────────────────────────────────────────────────

async function processUploadFile(file) {
  if (!file) {
    return;
  }

  showUploadStatus(
    null,
    '',
    false
  );

  const fileName =
    byId(
      'upload-file-name'
    );

  fileName.textContent =
    file.name;

  try {
    const text =
      await file.text();

    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw uploadError(
        'Could not parse the selected file as JSON.'
      );
    }

    /*
     * Three-schema check (shared/scima-schema.js, loaded from the
     * dashboard): accept stamped envelopes and every recognized legacy
     * generation, normalize skeletal short-key cards (f/b/h/t) to long
     * keys, and reject anything unrecognized instead of guessing. The
     * typeof guard keeps uploads working if the module failed to load,
     * falling back to the original shape check.
     */
    if (typeof scimaClassify === 'function') {
      const cls = scimaClassify(parsed);
      const normDeck = scimaToFullDeck(parsed);

      if (
        !cls ||
        !normDeck ||
        (cls.kind !== 'deck' && cls.kind !== 'cards')
      ) {
        throw uploadError(
          'The selected file is not a recognized SCIMA deck export.'
        );
      }

      // A bare/skeletal card list is wrapped into a share deck envelope so
      // everything downstream (validateUpload, sanitiseDeck, the request
      // body) sees one canonical shape. Header-less card lists carry no
      // deck name — fall back to the file's base name.
      if (typeof normDeck.name !== 'string' || !normDeck.name.trim()) {
        normDeck.name = file.name.replace(/\.[^.]+$/, '') || 'Imported deck';
      }

      parsed = cls.kind === 'cards'
        ? scimaStamp(
          {
            version: 2,
            exportedAt: new Date().toISOString(),
            deck: normDeck,
            citedSources: [],
          },
          'share',
          'deck'
        )
        : { ...parsed, deck: normDeck };
    } else if (
      !parsed ||
      !parsed.deck ||
      !Array.isArray(
        parsed.deck.cards
      )
    ) {
      throw uploadError(
        'The selected file is not a recognized SCIMA deck export.'
      );
    }

    const deck =
      parsed.deck;

    const meta = {
      description:
        byId(
          'upload-desc'
        ).value,

      author:
        byId(
          'upload-author'
        ).value.trim(),

      tags:
        [...cState.upload.tags],
    };

    const problems =
      validateUpload(
        parsed,
        meta
      );

    if (problems.length) {
      throw uploadError(
        problems.join(' ')
      );
    }

    cState.upload.parsed =
      parsed;

    const extracted =
      byId(
        'upload-extracted'
      );

    extracted.style.display =
      '';

    byId(
      'upload-extracted-name'
    ).textContent =
      deck.name;

    byId(
      'upload-extracted-meta'
    ).textContent =
      [
        `${deck.cards.length} cards`,
        deck.id
          ? `source ID ${deck.id}`
          : 'no source ID',
        parsed.version != null
          ? `export v${parsed.version}`
          : 'unknown export version',
        parsed.exportedAt
          ? `exported ${formatDate(parsed.exportedAt)}`
          : 'unknown export date',
      ].join(' · ');

    showUploadStatus(
      null,
      'Deck ready to upload.',
      false
    );

  } catch (error) {
    cState.upload.parsed =
      null;

    byId(
      'upload-extracted'
    ).style.display =
      'none';

    showUploadStatus(
      null,
      error.message ||
        'Could not read this deck.',
      true
    );
  }
}


const fileInput =
  byId(
    'upload-file'
  );

const dropzone =
  byId(
    'upload-dropzone'
  );


dropzone.addEventListener(
  'click',
  () => fileInput.click()
);


fileInput.addEventListener(
  'change',
  () => {
    processUploadFile(
      fileInput.files[0]
    );
  }
);


dropzone.addEventListener(
  'dragover',
  event => {
    event.preventDefault();

    dropzone.style.borderColor =
      'rgba(var(--blue-rgb),0.6)';

    dropzone.style.background =
      'rgba(var(--blue-rgb),0.06)';
  }
);


dropzone.addEventListener(
  'dragleave',
  () => {
    dropzone.style.borderColor =
      '';

    dropzone.style.background =
      '';
  }
);


dropzone.addEventListener(
  'drop',
  event => {
    event.preventDefault();

    dropzone.style.borderColor =
      '';

    dropzone.style.background =
      '';

    const file =
      event.dataTransfer.files[0];

    if (!file) {
      return;
    }

    /*
     * Assigning to input.files isn't required for the upload logic,
     * but doing it when DataTransfer is available keeps the file picker
     * and drag/drop paths behaving identically.
     */
    try {
      const transfer =
        new DataTransfer();

      transfer.items.add(file);

      fileInput.files =
        transfer.files;
    } catch {
      // Browser doesn't expose DataTransfer construction.
    }

    processUploadFile(file);
  }
);


// ─────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────

document
  .getElementById('upload-btn')
  .addEventListener(
    'click',
    async () => {
      const button =
        byId(
          'upload-btn'
        );

      if (button.disabled) {
        return;
      }

      if (!cState.upload.parsed) {
        showUploadStatus(
          null,
          'Choose a valid SCIMA deck export first.',
          true
        );

        return;
      }

      /*
       * Flush a tag currently sitting in the input before constructing
       * the request.
       */
      if (tagInput.value.trim()) {
        addUploadTag(
          tagInput.value
        );

        tagInput.value = '';
      }

      const description =
        byId(
          'upload-desc'
        ).value;

      const author =
        byId(
          'upload-author'
        ).value.trim();

      const subject =
        byId(
          'upload-subject'
        ).value;

      const level =
        byId(
          'upload-level'
        ).value;

      const examBoard =
        byId(
          'upload-exam-board'
        ).value;

      const meta = {
        description,
        author,
        tags: [...cState.upload.tags],
      };

      const problems =
        validateUpload(
          cState.upload.parsed,
          meta
        );

      if (problems.length) {
        showUploadStatus(
          null,
          problems.join(' '),
          true
        );

        return;
      }

      button.disabled = true;
      button.textContent = 'Uploading…';

      showUploadStatus(
        null,
        '',
        false
      );

      try {
        /*
         * Make a fresh object rather than modifying the user's parsed
         * export in place.
         */
        const cleanDeck =
          sanitiseDeck(
            cState.upload.parsed.deck
          );

        /*
         * Keep the original export metadata, while adding the public
         * registry metadata required by DeckUploadRequest.
         */
        const body = {
          version:
            cState.upload.parsed.version,

          exportedAt:
            cState.upload.parsed.exportedAt,

          deck: {
            ...cleanDeck,

            subject,
            level,
            examBoard,
          },

          citedSources:
            Array.isArray(
              cState.upload.parsed.citedSources
            )
              ? cState.upload.parsed.citedSources
              : [],

          meta: {
            description,
            author,
            tags: [...cState.upload.tags],
          },
        };

        /*
         * Stamp the share/deck envelope so the backend stores an
         * interchange-format payload. Guarded: the backend fills the
         * envelope in itself if this module failed to load.
         */
        const created =
          await api.createDeck(
            typeof scimaStamp === 'function'
              ? scimaStamp(body, 'share', 'deck')
              : body
          );

        showUploadStatus(
          null,
          `Uploaded ✓ "${created.name}"`,
          false
        );

        resetUploadForm();

        /*
         * Refresh the popular list because a newly uploaded deck could
         * now be part of the registry. It won't normally enter the top
         * five immediately, but keeping the UI authoritative is cheap.
         */
        await loadPopularDecks();

      } catch (error) {
        showUploadStatus(
          null,
          `Upload failed: ${error.message}`,
          true
        );
      } finally {
        button.disabled = false;
        button.textContent =
          'Upload deck';
      }
    }
  );


function resetUploadForm() {
  cState.upload.parsed = null;
  cState.upload.tags = [];

  fileInput.value = '';

  byId(
    'upload-file-name'
  ).textContent =
    'Drop a SCIMA JSON export here';

  byId(
    'upload-extracted'
  ).style.display =
    'none';

  byId(
    'upload-desc'
  ).value = '';

  byId(
    'upload-author'
  ).value = '';

  byId(
    'upload-subject'
  ).value = '';

  byId(
    'upload-level'
  ).value = '';

  byId(
    'upload-exam-board'
  ).value = '';

  tagInput.value = '';

  renderUploadTags();
}


// ─────────────────────────────────────────────────────────────────────
// Deck detail
// ─────────────────────────────────────────────────────────────────────

async function openDeck(id) {
  const container =
    byId(
      'deck-detail'
    );

  container.innerHTML = '';

  container.append(
    el(
      'div',
      {
        style: `
          text-align:center;
          color:var(--muted);
          padding:50px 0;
        `,
      },
      'Loading deck…'
    )
  );

  showScreen('deck');

  try {
    const deck =
      await api.getDeck(id);

    cState.currentDeck =
      deck;

    renderDeckDetail(deck);

  } catch (error) {
    container.innerHTML = '';

    container.append(
      el(
        'div',
        {
          class: 'empty-state',
        },

        el(
          'div',
          { class: 'big-emoji' },
          '⚠️'
        ),

        el(
          'div',
          {},
          error.message
        ),

        btn(
          'Back to decks',
          'ghost',
          {
            small: true,
            onclick: () =>
              showScreen('search'),
          }
        )
      )
    );
  }
}


function renderDeckDetail(deck) {
  const container =
    byId(
      'deck-detail'
    );

  container.innerHTML = '';

  const exportData =
    deck.export || null;

  const sourceDeck =
    exportData?.deck || null;

  const header =
    el(
      'div',
      {
        class: 'deck-detail-header',
      },

      el(
        'div',
        {
          class: 'deck-detail-emoji',
        },
        sourceDeck?.emoji || '📖'
      ),

      el(
        'div',
        {},

        el(
          'h2',
          {
            class: 'deck-detail-title',
          },
          deck.name ||
            'Untitled deck'
        ),

        el(
          'div',
          {
            class: 'section-sub',
            style: 'margin:0',
          },
          deck.description ||
            'No description provided.'
        ),

        el(
          'div',
          {
            style:
              'margin-top:8px;display:flex;gap:5px;flex-wrap:wrap',
          },
          deckTags(deck)
        )
      )
    );


  const stats =
    el(
      'div',
      {
        class: 'deck-detail-stats',
        style: 'flex-wrap:wrap',
      },

      statBox(
        deck.cardCount ?? '—',
        'Cards'
      ),

      statBox(
        deck.downloads ?? 0,
        'Downloads'
      ),

      statBox(
        deck.rating?.average != null
          ? Number(
              deck.rating.average
            ).toFixed(1)
          : '—',
        deck.rating?.count != null
          ? `${deck.rating.count} ratings`
          : 'Rating'
      ),

      statBox(
        deck.author || '—',
        'Author'
      )
    );


  const metadata =
    el(
      'div',
      {
        style: `
          margin:18px 0;
          padding:16px;
          background:var(--surface);
          border:1px solid var(--border);
          border-radius:var(--r-sm);
        `,
      },

      metadataRow(
        'Source deck ID',
        sourceDeck?.id
      ),

      metadataRow(
        'Export version',
        exportData?.version
      ),

      metadataRow(
        'Exported',
        exportData?.exportedAt
          ? formatDate(
              exportData.exportedAt
            )
          : null
      ),

      metadataRow(
        'Subject',
        deck.subject
      ),

      metadataRow(
        'Level',
        deck.level
      ),

      metadataRow(
        'Exam board',
        deck.examBoard
      )
    );


  const actions =
    el(
      'div',
      {
        style:
          'display:flex;gap:10px;flex-wrap:wrap',
      },

      (() => {
        const button =
          btn(
            '⬇ Download deck',
            'primary'
          );

        button.addEventListener(
          'click',
          () =>
            downloadDeck(
              deck,
              button
            )
        );

        return button;
      })(),

      (() => {
        const button =
          btn(
            '＋ Add to dashboard',
            'ghost'
          );

        button.addEventListener(
          'click',
          () =>
            openAddDeckModal(
              deck
            )
        );

        return button;
      })()
    );


  container.append(
    header,
    stats,
    metadata,
    actions
  );
}


function statBox(value, label) {
  return el(
    'div',
    {
      class: 'stat-box',
    },

    el(
      'div',
      {
        class: 'stat-num',
      },
      String(value)
    ),

    el(
      'div',
      {
        class: 'stat-lab',
      },
      label
    )
  );
}


function metadataRow(label, value) {
  return el(
    'div',
    {
      style: `
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding:5px 0;
        font-size:12px;
      `,
    },

    el(
      'span',
      {
        style:
          'color:var(--muted)',
      },
      label
    ),

    el(
      'span',
      {
        style:
          'text-align:right;font-weight:700;overflow-wrap:anywhere',
      },
      value == null || value === ''
        ? '—'
        : String(value)
    )
  );
}


// ─────────────────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────────────────

function safeFilename(value) {
  return String(value || 'deck')
    .trim()
    .replace(
      /[^a-z0-9\-_ ]/gi,
      ''
    )
    .replace(
      /\s+/g,
      '_'
    )
    .slice(0, 80) ||
    'deck';
}


function downloadFilename(deck) {
  const subject =
    safeFilename(
      deck.subject
    );

  const name =
    safeFilename(
      deck.name
    );

  return `${subject || 'misc'}__${name}.json`;
}


async function downloadDeck(deck, button) {
  if (button.disabled) {
    return;
  }

  button.disabled = true;
  button.textContent =
    'Downloading…';

  try {
    /*
     * This endpoint is the explicit public export endpoint. Unlike the
     * old frontend, no ?download=true behaviour is assumed.
     */
    const exported =
      await api.exportDeck(
        deck.id
      );

    const json =
      JSON.stringify(
        exported,
        null,
        2
      );

    const blob =
      new Blob(
        [json],
        {
          type:
            'application/json',
        }
      );

    const url =
      URL.createObjectURL(blob);

    const anchor =
      document.createElement('a');

    anchor.href = url;
    anchor.download =
      downloadFilename(deck);

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    /*
     * Give the browser a chance to start the download before revoking
     * the object URL.
     */
    setTimeout(
      () => URL.revokeObjectURL(url),
      1000
    );

  } catch (error) {
    alert(
      `Download failed: ${error.message}`
    );
  } finally {
    button.disabled = false;
    button.textContent =
      '⬇ Download deck';
  }
}


// ─────────────────────────────────────────────────────────────────────
// API status
// ─────────────────────────────────────────────────────────────────────

async function checkApiHealth() {
  const dot =
    byId(
      'api-dot'
    );

  const label =
    byId(
      'api-label'
    );

  dot.classList.remove('ok');

  try {
    const result =
      await api.health();

    if (
      result?.status !== 'ok'
    ) {
      throw new Error(
        'Unexpected health response'
      );
    }

    dot.classList.add('ok');

    label.textContent =
      `API connected (${API_BASE})`;

  } catch {
    label.textContent =
      `API unreachable at ${API_BASE}`;
  }
}


// ─────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────

async function init() {
  await checkApiHealth();
  await loadPopularDecks();
}

return init;

}

/** View entry point (dashboard-core.js viewRenderer → window.renderCommunity). */
window.renderCommunity = function (c) {
  c.classList.add('sc-root');
  c.innerHTML = COMMUNITY_MARKUP;
  ROOT = c;
  const start = buildCommunity();
  if (typeof start === 'function') start();
};

})();
