'use strict';
/* dashboard-library.js — the Library: PDF/EPUB/MOBI/HTML text extraction,
   the library view, source import/reader, bookmarks and annotations, and the
   in-reader Define/Create-card modals. The largest of the split files (was
   ~1,500 lines even before the split). Part of the dashboard-*.js split; see
   dashboard-core.js's header for the full rationale and load-order rules.

   SITE PORT NOTES: ported verbatim from the extension except for the same
   two seams dashboard-decks.js already crosses — every chrome.storage.local
   PDF-chunk read/write/delete now goes through blobStore.{setChunks,
   getChunks,deleteChunks}('pdf', id, ...) and every chrome.runtime.getURL()
   call (loading lib/pdf.min.js + lib/pdf.worker.min.js on demand) now goes
   through assetUrl() — see dashboard-blobstore.js. No other behavior
   changed. Requires lib/epub-parser.bundle.js, lib/mobi-parser.bundle.js,
   and lib/process-shim.js (a browser polyfill for the Node `process` global
   the epub parser's bundled path-resolution code expects) to be loaded
   before this file — see dashboard.html's script order. */

async function extractPDFText(file) {
  if(!window.pdfjsLib){
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=assetUrl('lib/pdf.min.js'); s.onload=res; s.onerror=rej; document.head.appendChild(s); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc=assetUrl('lib/pdf.worker.min.js');
  }
  const buf=await file.arrayBuffer();
  if(!buf || buf.byteLength === 0) throw new Error('File appears to be empty');
  let pdf;
  try { pdf=await window.pdfjsLib.getDocument({data:buf}).promise; }
  catch(e){ throw new Error('PDF could not be parsed: '+(e?.message||String(e)||'unknown error')); }
  let text='';
  for(let i=1;i<=pdf.numPages;i++){ const page=await pdf.getPage(i); const content=await page.getTextContent(); text+=content.items.map(x=>x.str).join(' ')+'\n'; }
  if(!text.trim()) throw new Error('No text could be extracted — this PDF may be scanned/image-only');
  return text.trim();
}

// Strip HTML tags and collapse whitespace for plain text extraction.
// NOTE: deliberately does NOT use .innerText. innerText is layout-derived (it only inserts
// line breaks for elements the browser has actually rendered as block-level), and a
// DOMParser-parsed document is never attached to the page / never laid out — so innerText
// on it degrades to ~textContent with no paragraph breaks at all, even when the source HTML
// has perfectly good <p> tags. Walking the DOM ourselves and inserting breaks around known
// block-level tags makes paragraph structure independent of rendering entirely.
const BLOCK_TAGS = new Set(['P','DIV','SECTION','ARTICLE','BLOCKQUOTE','H1','H2','H3','H4','H5','H6',
  'LI','UL','OL','TR','TABLE','THEAD','TBODY','HEADER','FOOTER','FIGURE','FIGCAPTION','PRE','HR','MAIN','ASIDE']);
function htmlToPlainText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,head').forEach(n=>n.remove());
  const root = doc.body || doc.documentElement;
  if(!root) return '';
  let out = '';
  (function walk(node){
    if(node.nodeType === 3){ out += node.textContent.replace(/\s+/g,' '); return; } // text node
    if(node.nodeType !== 1) return; // skip comments etc
    if(node.tagName === 'BR'){ out += '\n'; return; }
    const isBlock = BLOCK_TAGS.has(node.tagName);
    if(isBlock && out && !out.endsWith('\n')) out += '\n\n';
    for(const child of node.childNodes) walk(child);
    if(isBlock && out && !out.endsWith('\n')) out += '\n\n';
  })(root);
  return out.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').replace(/ {2,}/g,' ').trim();
}

// Concatenate {id,text} parts into one string while recording each part's [start,end)
// character offset in the final string — needed to turn a TOC (which only has hrefs/ids)
// into character ranges we can actually slice the extracted text with.
function buildTextWithOffsets(parts) {
  let text = ''; const offsets = {};
  for(const {id,text:t} of parts){
    const trimmed = (t||'').trim();
    if(!trimmed){ offsets[id] = {start:text.length, end:text.length}; continue; }
    if(text.length) text += '\n\n';
    const start = text.length;
    text += trimmed;
    offsets[id] = {start, end:text.length};
  }
  return {text, offsets};
}

// Flatten a nested TOC (EpubToc navPoints / MobiToc items) into a sorted, deduped
// {title,start,end,id}[] chapters array. resolveStart(item) must return a character offset
// (via the offsets map from buildTextWithOffsets) or null if it can't be resolved.
function chaptersFromToc(tocItems, resolveStart, totalLength) {
  const flat = [];
  (function walk(items){
    for(const item of items||[]){
      let start = null;
      try{ start = resolveStart(item); }catch(e){ /* unresolvable entry, skip */ }
      if(start != null) flat.push({title:(item.label||'').trim()||'Untitled', start});
      if(item.children?.length) walk(item.children);
    }
  })(tocItems);
  flat.sort((a,b)=>a.start-b.start);
  const deduped = [];
  for(const c of flat){ if(deduped.length && deduped[deduped.length-1].start===c.start) continue; deduped.push(c); }
  deduped.forEach((c,i)=>{ c.end = i+1<deduped.length ? deduped[i+1].start : totalLength; c.id = uid('ch'); });
  return deduped;
}

async function extractEPUBText(file) {
  // Uses @lingo-reader/epub-parser (bundled as epub-parser.bundle.js)
  // IMPORTANT: pass the native File object directly — the bundle reads it via its
  // own internal `new FileReader().readAsArrayBuffer(file)`, which requires an
  // actual Blob/File. Passing a pre-converted Uint8Array here throws
  // "FileReader.readAsArrayBuffer: Argument 1 does not implement interface Blob."
  if(!window.SCIMA_initEpubFile) throw new Error('EPUB parser not loaded');
  const epub = await window.SCIMA_initEpubFile(file);
  const spine = epub.getSpine(); // array of manifest items in reading order
  const parts = [];
  try {
    for (const item of spine) {
      try {
        const result = await epub.loadChapter(item.id); // returns { html, css }
        parts.push({ id: item.id, text: htmlToPlainText(result.html || ''), html: result.html || '' });
      } catch(e) { /* skip unreadable chapters */ }
    }
  } finally {}
  const { text, offsets } = buildTextWithOffsets(parts);

  // Chapters come from the EPUB's own table of contents (<navMap> in the .ncx, or EPUB3
  // nav doc) via getToc() — NOT from the spine, which is reading order only and has no
  // titles. NavPoint.id is already resolved to a manifest/spine id during parsing, so it
  // usually matches an offsets[] key directly; resolveHref(href) is a fallback for the
  // rare case that lookup didn't resolve (e.g. href pointed at something outside the
  // manifest map).
  let chapters = [];
  try {
    chapters = chaptersFromToc(epub.getToc(), item => {
      let off = offsets[item.id];
      if(!off){ const r = epub.resolveHref(item.href); if(r) off = offsets[r.id]; }
      return off ? off.start : null;
    }, text.length);
    // Annotate each chapter with which spine part it starts in and the offset within that part.
    // Used by the reader to scroll accurately to within-part positions.
    for (const ch of chapters) {
      let bestId = null, bestStart = -1;
      for (const [id, off] of Object.entries(offsets)) {
        if (off.start <= ch.start && off.start > bestStart) { bestId = id; bestStart = off.start; }
      }
      if (bestId) { ch.partId = bestId; ch.withinPartOffset = ch.start - bestStart; }
    }
  } catch(e) { /* malformed/missing toc — fall back to no chapters, content extraction still succeeds */ }

  // Convert blob: image URLs to persistent data: URLs so they survive storage
  const htmlChapters = await Promise.all(parts.map(async p => {
    const html = p.html ? await blobUrlsToDataUrls(p.html) : '';
    const imgMatches = (p.html || '').match(/blob:[^\s"')>]+/g) || [];
    const dataMatches = html.match(/data:image[^;]+;base64,[A-Za-z0-9+/]{10,}/g) || [];
    if (DEBUG && imgMatches.length) console.log(`[SCIMA epub] part ${p.id}: ${imgMatches.length} blob: imgs → ${dataMatches.length} non-empty data: URLs`);
    return { id: p.id, start: offsets[p.id]?.start ?? null, html };
  }));

  return { content: text, chapters, htmlChapters };
}

async function extractMOBIText(file) {
  // Uses @lingo-reader/mobi-parser (bundled as mobi-parser.bundle.js)
  // Supports both classic MOBI and KF8/AZW3
  if(!window.SCIMA_initMobiFile) throw new Error('MOBI parser not loaded');
  const buf = await file.arrayBuffer();
  const isKf8 = file.name.toLowerCase().endsWith('.azw3');
  const mobi = await (isKf8 ? window.SCIMA_initKf8File : window.SCIMA_initMobiFile)(new Uint8Array(buf));
  const chapters_ = mobi.getSpine(); // NOTE: despite the name, these are just pagebreak-delimited
  // text segments, not real chapters — most MOBI files split far more often than once per chapter.
  const parts = [];
  for (const ch of chapters_) {
    try {
      const result = mobi.loadChapter(ch.id); // returns { html, css }
      parts.push({ id: ch.id, text: htmlToPlainText(result.html || ''), html: result.html || '' });
    } catch(e) { /* skip */ }
  }
  const { text, offsets } = buildTextWithOffsets(parts);
  if (!text.trim()) throw new Error('Could not extract text from MOBI. Try converting to EPUB first.');

  // Real chapter titles live in the book's own NCX/guide-derived TOC via getToc() — a
  // separate structure from the pagebreak segments above. Each TOC entry's href is a
  // filepos (classic MOBI) or kindle:pos (KF8/AZW3) pointer; resolveHref() maps that back
  // to whichever pagebreak segment id contains it, which we then look up in offsets[].
  // Files with no embedded TOC (e.g. plain-text-only MOBIs) legitimately have no chapters —
  // that's correct behavior, not a bug, and getToc() returning [] handles it for free.
  let chapters = [];
  try {
    chapters = chaptersFromToc(mobi.getToc(), item => {
      const r = mobi.resolveHref(item.href);
      return (r && offsets[r.id]) ? offsets[r.id].start : null;
    }, text.length);
    for (const ch of chapters) {
      let bestId = null, bestStart = -1;
      for (const [id, off] of Object.entries(offsets)) {
        if (off.start <= ch.start && off.start > bestStart) { bestId = id; bestStart = off.start; }
      }
      if (bestId) { ch.partId = bestId; ch.withinPartOffset = ch.start - bestStart; }
    }
  } catch(e) { /* malformed/missing toc — fall back to no chapters, content extraction still succeeds */ }

  // Convert blob: image URLs to persistent data: URLs
  const htmlChapters = await Promise.all(parts.map(async p => ({
    id: p.id,
    start: offsets[p.id]?.start ?? null,
    html: p.html ? await blobUrlsToDataUrls(p.html) : '',
  })));

  return { content: text.trim(), chapters, htmlChapters };
}

async function extractFileText(file) {
  const name = file.name.toLowerCase();
  if(name.endsWith('.pdf'))               return { content: await extractPDFText(file), chapters: [] };
  if(name.endsWith('.epub'))              return await extractEPUBText(file);
  if(name.endsWith('.mobi')||name.endsWith('.azw3')) return await extractMOBIText(file);
  return { content: await file.text(), chapters: [] }; // .txt and others
}

function sourceTypeIcon(src) {
  const n = src.name?.toLowerCase() || '';
  if(n.endsWith('.epub')) return '📗';
  if(n.endsWith('.mobi')||n.endsWith('.azw3')) return '📱';
  if(src.type==='pdf'||n.endsWith('.pdf')) return '📄';
  return '📝';
}

/* ─────────────────────────────────────────────────────────────
   Library source subjects (dashboard-library.js)

   Sources have an OPTIONAL `subjectKey` (mirrors deck.subject/folder.subjectKey
   naming). Pre-existing sources (saved before this feature) simply don't have
   the field — every read site below treats a missing/falsy subjectKey as
   "auto-detect", so there's no migration script to run; the fallback IS the
   migration path.

   Auto-detection: a source has no first-class "subject" of its own — a subject
   is inferred by looking at which cards cite it (card.citation.sourceId), then
   at each citing card's deck.subject. A source cited by cards from several
   subjects gets a weight per subject (citation count), and the top-weighted
   subject is used wherever a single "effective" subject is needed (library
   badge, reading-time-by-subject analytics default bucket, etc).
───────────────────────────────────────────────────────────── */

/** {subjectKey: citingCardCount} for every subject that has at least one card
 *  citing this source. Cards with no deck (shouldn't normally happen) can't be
 *  reached via state.decks, so they're naturally excluded rather than crashing. */
function getSourceCitationWeights(sourceId) {
  const weights = {};
  state.decks.forEach(d => {
    const key = d.subject || DEFAULT_SUBJECT_KEY;
    d.cards.forEach(card => {
      if (card.citation?.sourceId === sourceId) weights[key] = (weights[key]||0) + 1;
    });
  });
  return weights;
}

/** Resolves the single subject a source should be shown/grouped under.
 *  Returns null if there's no explicit subjectKey AND no citations to infer
 *  from yet (nothing to show a badge for). Otherwise returns
 *  { key, inferred } — inferred:false for an explicit user override,
 *  inferred:true for a citation-weighted guess (ties broken by whichever
 *  subject's key sorts first, for stable rendering). */
function getSourceEffectiveSubject(source) {
  if (source.subjectKey) return { key: source.subjectKey, inferred: false };
  const weights = getSourceCitationWeights(source.id);
  const entries = Object.entries(weights);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { key: entries[0][0], inferred: true };
}

/** Splits a source's accumulated timeSpentSec across subjects.
 *  - Explicit subjectKey set → all the time goes to that one subject.
 *  - Otherwise → distributed proportionally by citation weight, e.g. a source
 *    cited by 7 Biology cards and 3 Chemistry cards attributes 70%/30% of its
 *    reading time to each.
 *  - No citations at all (nothing to weight by) → the time is bucketed under
 *    DEFAULT_SUBJECT_KEY rather than silently dropped from analytics totals.
 *  Returns {subjectKey: seconds}; omits the zero-time case entirely. */
function getSourceSubjectTimeBreakdown(source) {
  const totalSec = source.timeSpentSec || 0;
  if (!totalSec) return {};
  if (source.subjectKey) return { [source.subjectKey]: totalSec };
  const weights = getSourceCitationWeights(source.id);
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  if (!totalWeight) return { [DEFAULT_SUBJECT_KEY]: totalSec };
  const out = {};
  Object.entries(weights).forEach(([key, w]) => { out[key] = totalSec * (w / totalWeight); });
  return out;
}

/** Aggregates getSourceSubjectTimeBreakdown() across every source in the
 *  library — used by the Analytics "Reading Time by Subject" card. */
function getReadingTimeBySubject() {
  const totals = {};
  (state.sources || []).forEach(src => {
    Object.entries(getSourceSubjectTimeBreakdown(src)).forEach(([key, sec]) => {
      totals[key] = (totals[key] || 0) + sec;
    });
  });
  return totals;
}

/** Formats seconds as a compact reading-time label: '<1m', '42m', '1h 5m', '3h'. */
function fmtReadingTime(sec) {
  const mins = Math.round(sec / 60);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), rem = mins % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Modal for explicitly setting (or clearing, to fall back to auto-detect) a
 *  source's subject. Shows the current citation-weighted breakdown so the
 *  user can see what auto-detect would pick before overriding it. */
function openSourceSubjectModal(sourceId) {
  const src = state.sources.find(s => s.id === sourceId); if (!src) return;
  openModal('Subject: ' + src.name, body => {
    const weights = getSourceCitationWeights(sourceId);
    const inferredEntries = Object.entries(weights).sort((a, b) => b[1] - a[1]);

    const wrap = el('div', { class: 'field' }, el('label', {}, 'Subject'));
    const sel = el('select', { class: 'u-input' });
    sel.appendChild(el('option', { value: '', class: 'u-bg' }, '🔎 Auto-detect from citations'));
    Object.entries(getAllSubjects()).forEach(([key, s]) => {
      sel.appendChild(el('option', { value: key, class: 'u-bg' }, s.name));
    });
    sel.value = src.subjectKey || '';
    wrap.appendChild(sel);

    const inferBox = el('div', { style: 'font-size:12px;color:var(--muted);margin:2px 0 12px;line-height:1.5' },
      inferredEntries.length
        ? `Auto-detected from citations: ${inferredEntries.map(([k, n]) => `${getSubjectSafe(k).short||getSubjectSafe(k).name} (${n} card${n!==1?'s':''})`).join(', ')}`
        : 'No cards cite this source yet, so there\u2019s nothing to auto-detect from — it\u2019ll show as unassigned until you set one or add citations.'
    );

    body.append(wrap, inferBox, btn('Save', 'primary', { full: true, onclick: () => {
      src.subjectKey = sel.value || null;
      scheduleSave(); closeModal(); renderView('library');
      showToast(sel.value ? 'Subject set ✓' : 'Subject cleared — back to auto-detect');
    }}));
  });
}

function renderLibrary(c) {
  if(!state.libraryFolders) state.libraryFolders=[];
  const currentFolderId=state._libraryFolderNav||null;
  const currentFolder=currentFolderId?state.libraryFolders.find(f=>f.id===currentFolderId):null;
  const visibleSources=state.sources.filter(s=>(s.libraryFolderId||null)===currentFolderId);
  const childFolders=state.libraryFolders.filter(f=>(f.parentId||null)===currentFolderId);

  const breadcrumb=el('div',{style:'display:flex;align-items:center;gap:6px;margin-bottom:12px;font-size:12px;flex-wrap:wrap'});
  const crumbs=[];
  let cur=currentFolder;
  while(cur){crumbs.unshift(cur);cur=state.libraryFolders.find(f=>f.id===cur.parentId);}
  breadcrumb.appendChild(el('span',{style:`cursor:pointer;color:${currentFolderId?'var(--muted)':'var(--text)'};font-weight:${currentFolderId?400:700}`,onclick:()=>{state._libraryFolderNav=null;renderView('library');}},'\u{1F4D6} Library'));
  crumbs.forEach((f,i)=>{
    breadcrumb.appendChild(el('span',{style:'color:var(--muted)'},'>'));
    const isLast=i===crumbs.length-1;
    breadcrumb.appendChild(el('span',{style:`cursor:pointer;color:${isLast?'var(--text)':'var(--muted)'};font-weight:${isLast?700:400}`,onclick:()=>{state._libraryFolderNav=f.id;renderView('library');}},`\u{1F4C1} ${f.name}`));
  });

  const topBar=el('div',{style:'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'},
    el('div',{},el('div',{class:'section-title'},'\u{1F4D6} Library'),el('div',{class:'section-sub',style:'margin-bottom:0'},'Attach source texts to cards for citation context')),
    el('div',{style:'display:flex;gap:8px'},
      btn('\u{1F4C1} New Folder','ghost',{onclick:()=>openLibraryFolderModal(currentFolderId)}),
      btn('⬆ Import','ghost',{onclick:()=>openImportSourceModal(currentFolderId)}),
      btn('+ Add Source','primary',{onclick:()=>openAddSourceModal(currentFolderId)})
    )
  );
  c.append(topBar);
  if(crumbs.length) c.append(breadcrumb);

  if(!state.sources.length&&!state.libraryFolders.length){
    c.appendChild(el('div',{class:'empty-state',style:'padding-top:60px'},
      el('div',{class:'empty-icon'},'\u{1F4DA}'),el('div',{class:'empty-title'},'No source texts yet'),
      el('div',{class:'empty-sub'},'Add books, articles, or notes to cite in your flashcards.'),
      btn('Add First Source','primary',{onclick:()=>openAddSourceModal(null)})
    ));
    return;
  }
  const list=el('div',{});
  childFolders.forEach(folder=>{
    const folderSources=state.sources.filter(s=>{
      const ids=[folder.id,...getLibraryDescendantFolderIds(folder.id)];
      return ids.includes(s.libraryFolderId||'');
    });
    list.appendChild(el('div',{class:'card source-item',style:'margin-bottom:10px;cursor:pointer',onclick:()=>{state._libraryFolderNav=folder.id;renderView('library');}},
      el('div',{class:'source-icon',style:'font-size:20px'},'\u{1F4C1}'),
      el('div',{style:'flex:1;min-width:0'},
        el('div',{class:'source-name'},folder.name),
        el('div',{class:'source-meta'},`${folderSources.length} source${folderSources.length!==1?'s':''}`)
      ),
      el('div',{class:'source-actions'},
        btn('Rename','ghost',{small:true,onclick:e=>{e.stopPropagation();openLibraryFolderModal(folder.parentId||null,folder.id);}}),
        btn('Delete','danger',{small:true,onclick:e=>{
          e.stopPropagation();
          if(confirm('Delete folder "'+folder.name+'"? Sources inside will move to root.')){
            state.sources.forEach(s=>{if(s.libraryFolderId===folder.id)s.libraryFolderId=null;});
            state.libraryFolders=state.libraryFolders.filter(f=>f.id!==folder.id);
            scheduleSave();renderView('library');
          }
        }})
      )
    ));
  });
  const SOURCE_PAGE = 20;
  let srcPage = 0;

  function renderSourceBatch() {
    const batch = visibleSources.slice(srcPage * SOURCE_PAGE, (srcPage + 1) * SOURCE_PAGE);
    batch.forEach(src=>{
      const cited=state.decks.flatMap(d=>d.cards).filter(c=>c.citation?.sourceId===src.id).length;
      const effSubj = getSourceEffectiveSubject(src);
      const subjBadge = effSubj
        ? el('span',{
            class:'tag',
            title: effSubj.inferred ? 'Auto-detected subject (inferred from citations)' : 'Subject',
            style:`background:${getSubjectSafe(effSubj.key).color||'var(--blue)'};color:#fff;margin-left:6px;opacity:${effSubj.inferred?0.7:1}`
          }, (effSubj.inferred ? '~ ' : '') + (getSubjectSafe(effSubj.key).short || getSubjectSafe(effSubj.key).name))
        : null;
      const readingTimeLabel = src.timeSpentSec >= 60
        ? el('span',{style:'font-size:10px;color:var(--muted);margin-left:6px'},`⏱ ${fmtReadingTime(src.timeSpentSec)}`)
        : null;
      list.appendChild(el('div',{class:'card source-item',style:'margin-bottom:10px'},
        el('div',{class:'source-icon'},sourceTypeIcon(src)),
        el('div',{style:'flex:1;min-width:0'},
          el('div',{class:'source-name',style:'display:flex;align-items:center;flex-wrap:wrap;gap:2px'},src.name, subjBadge),
          el('div',{class:'source-meta',style:'display:flex;align-items:center;flex-wrap:wrap'},
            `${src.content.length.toLocaleString()} chars \u00b7 ${src.chapters?.length||0} chapter${(src.chapters?.length||0)!==1?'s':''} \u00b7 ${cited} card${cited!==1?'s':''} cited`,
            readingTimeLabel
          )
        ),
        el('div',{class:'source-actions'},
          btn('Read','ghost',{small:true,onclick:e=>{e.stopPropagation();openLibraryReader(src.id);}}),
          btn('Chapters','ghost',{small:true,onclick:e=>{e.stopPropagation();openChaptersModal(src.id);}}),
          btn('Subject','ghost',{small:true,title:'Set or clear the subject for this source',onclick:e=>{e.stopPropagation();openSourceSubjectModal(src.id);}}),
          btn('⬇ Export','ghost',{small:true,title:'Export source file + bookmarks',onclick:e=>{e.stopPropagation();exportSourceWithBookmarks(src.id);}}),
          btn('Move','ghost',{small:true,onclick:e=>{e.stopPropagation();openMoveSourceModal(src.id);}}),
          btn('Delete','danger',{small:true,onclick:e=>{
            e.stopPropagation();
            if(confirm('Delete "'+src.name+'"? Citations will be removed.')){
              state.decks.forEach(d=>d.cards.forEach(card=>{if(card.citation?.sourceId===src.id)card.citation=null;}));
              state.sources=state.sources.filter(s=>s.id!==src.id);
              // Clean up any stored PDF chunks
              blobStore.deleteChunks('pdf', src.id);
              // Clean up any stored HTML chapter chunks
              deleteHtmlChapters(src.id);
              scheduleSave();renderView('library');
            }
          }})
        )
      ));
    });
    srcPage++;
    // Remove old load-more if present
    const prev = list.querySelector('.src-load-more');
    if (prev) prev.remove();
    if (srcPage * SOURCE_PAGE < visibleSources.length) {
      const rem = visibleSources.length - srcPage * SOURCE_PAGE;
      list.appendChild(el('div',{class:'src-load-more',style:'text-align:center;margin:10px 0'},
        btn(`Load ${Math.min(SOURCE_PAGE,rem)} more sources`,'ghost',{onclick:renderSourceBatch})
      ));
    }
  }
  renderSourceBatch();
  if(!childFolders.length&&!visibleSources.length){
    list.appendChild(el('div',{class:'empty-state',style:'padding:40px 0'},
      el('div',{class:'empty-icon'},'\u{1F4C2}'),el('div',{class:'empty-title'},'Empty folder'),el('div',{class:'empty-sub'},'Add sources or subfolders here'),
      btn('+ Add Source','primary',{onclick:()=>openAddSourceModal(currentFolderId)})
    ));
  }
  c.append(list);
}

function getLibraryDescendantFolderIds(folderId){
  const children=(state.libraryFolders||[]).filter(f=>f.parentId===folderId).map(f=>f.id);
  return children.flatMap(id=>[id,...getLibraryDescendantFolderIds(id)]);
}
function openLibraryFolderModal(parentId,editId){
  const existing=editId?state.libraryFolders.find(f=>f.id===editId):null;
  openModal(existing?'Rename Folder':'New Library Folder',body=>{
    const nameField=createField('Folder Name','text','e.g. Set Texts, Biology Articles\u2026');
    if(existing)nameField.querySelector('input').value=existing.name;
    body.append(nameField,btn(existing?'Save':'Create Folder','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim();if(!name)return;
      if(existing){existing.name=name;}
      else{if(!state.libraryFolders)state.libraryFolders=[];state.libraryFolders.push({id:uid('lf'),name,parentId:parentId||null});}
      scheduleSave();closeModal();renderView('library');showToast(existing?'Folder renamed \u{1F4C1}':'Library folder created \u{1F4C1}');
    }}));
  });
}
function openMoveSourceModal(sourceId){
  const src=state.sources.find(s=>s.id===sourceId);if(!src)return;
  openModal('Move: '+src.name,body=>{
    const sel=el('select',{style:'width:100%;padding:9px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin-bottom:16px'});
    sel.appendChild(el('option',{value:'',class:'u-bg'},'\u{1F4DA} Library root'));
    (state.libraryFolders||[]).forEach(f=>{const o=el('option',{value:f.id,class:'u-bg'},'\u{1F4C1} '+f.name);if(f.id===src.libraryFolderId)o.selected=true;sel.appendChild(o);});
    body.append(sel,btn('Move','primary',{full:true,onclick:()=>{src.libraryFolderId=sel.value||null;scheduleSave();closeModal();renderView('library');showToast('Source moved \u{1F4C1}');}}));
  });
}
/**
 * Import a previously exported source: accepts the original file (.pdf/.txt/.epub/.mobi)
 * plus the companion modifications JSON, and restores bookmarks, auto-bookmark, and chapters.
 *
 * The modifications file is optional — dropping just the source file works like a normal Add Source.
 * If only the modifications file is dropped (no source file), we look for an existing source with
 * the same name and apply the modifications to it.
 */
function openImportSourceModal(defaultFolderId) {
  openModal('⬆ Import Source + Bookmarks', body => {
    // ── State ─────────────────────────────────────────────────────────────
    let _sourceFile = null;   // File object for the content file
    let _modsData   = null;   // Parsed modifications JSON object
    let _htmlData   = null;   // Parsed images JSON object (*-images.json)

    // ── Helper: status/error display ──────────────────────────────────────
    const statusEl = el('div', {style:'margin-top:10px;font-size:12px;display:none'});
    const errEl    = el('div', {class:'error-msg', style:'display:none'});
    function setStatus(msg, ok=true) {
      errEl.style.display='none';
      statusEl.className = ok ? 'success-badge' : '';
      statusEl.textContent = msg;
      statusEl.style.display = '';
    }
    function setErr(msg) {
      statusEl.style.display='none';
      errEl.textContent = msg;
      errEl.style.display = '';
    }

    // ── Name field (auto-filled from mods file) ────────────────────────────
    const nameField = createField('Title / Name','text','e.g. Of Mice and Men — Steinbeck');

    // ── Zip drop zone (primary) ───────────────────────────────────────────
    const zipZoneNameEl = el('div',{class:'pdf-zone-name',style:'font-size:13px;font-weight:700'},'Click to choose .zip export');
    const zipZone = el('label',{class:'pdf-zone',style:'margin-bottom:10px'},
      el('input',{type:'file',accept:'.zip',onchange: async e=>{
        const file = e.target.files?.[0]; if(!file) return;
        setStatus('⏳ Reading zip…', false);
        try {
          const buf = await file.arrayBuffer();
          const entries = fflate.unzipSync(new Uint8Array(buf));
          const dec = new TextDecoder();
          // Find each entry by name (zip may contain safeName.pdf/txt, modifications.json, images.json)
          for (const [name, bytes] of Object.entries(entries)) {
            const base = name.split('/').pop();
            if (base === 'modifications.json') {
              try {
                const parsed = JSON.parse(dec.decode(bytes));
                if (parsed.scima_source_export) _modsData = parsed;
              } catch(e) { console.warn('[SCIMA] zip import: modifications.json was present but failed to parse — annotations will not be restored:', e); }
            } else if (base === 'images.json') {
              try {
                const parsed = JSON.parse(dec.decode(bytes));
                if (parsed.scima_html_export) _htmlData = parsed;
              } catch(e) { console.warn('[SCIMA] zip import: images.json was present but failed to parse — highlighted images will not be restored:', e); }
            } else if (/\.(pdf|txt|epub|mobi)$/i.test(base)) {
              // Reconstruct as a File so extractFileText() can use it
              const mime = base.endsWith('.pdf') ? 'application/pdf' : 'text/plain';
              _sourceFile = new File([bytes], base, { type: mime });
            }
          }
          zipZoneNameEl.textContent = file.name;
          statusEl.style.display='none';
          updatePreview();
        } catch(err) {
          setErr('Could not read zip: ' + (err?.message || String(err)));
        }
      }}),
      el('div',{style:'font-size:36px'},'🗜'),
      zipZoneNameEl,
      el('div',{class:'u-muted-11'},'*-scima-export.zip')
    );

    // ── Manual / individual files (collapsible) ───────────────────────────
    const manualSection = el('div',{style:'display:none'});
    const manualToggle = el('button',{
      style:'background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0;margin-bottom:8px;text-decoration:underline;font-family:inherit',
      onclick:()=>{ const open = manualSection.style.display!=='none'; manualSection.style.display=open?'none':'block'; manualToggle.textContent=open?'▶ Or import individual files manually':'▼ Or import individual files manually'; }
    },'▶ Or import individual files manually');

    const srcZoneNameEl = el('div',{class:'pdf-zone-name',style:'font-size:13px;font-weight:700'},'Source file');
    const srcZone = el('label',{class:'pdf-zone'},
      el('input',{type:'file',accept:'.pdf,.txt,.epub,.mobi',onchange: e=>{
        const file = e.target.files?.[0]; if(!file) return;
        _sourceFile = file; srcZoneNameEl.textContent = file.name; updatePreview();
      }}),
      el('div',{style:'font-size:24px'},'📄'), srcZoneNameEl,
      el('div',{class:'u-muted-11'},'.txt .pdf .epub .mobi')
    );
    const modZoneNameEl = el('div',{class:'pdf-zone-name',style:'font-size:13px;font-weight:700'},'modifications.json');
    const modZone = el('label',{class:'pdf-zone'},
      el('input',{type:'file',accept:'.json',onchange: async e=>{
        const file = e.target.files?.[0]; if(!file) return;
        try { const p=JSON.parse(await file.text()); if(!p.scima_source_export){setErr('Not a modifications file');return;} _modsData=p; modZoneNameEl.textContent=file.name; updatePreview(); } catch(err){setErr('Bad modifications file');}
      }}),
      el('div',{style:'font-size:24px'},'🔖'), modZoneNameEl,
      el('div',{class:'u-muted-11'},'modifications.json')
    );
    const imgZoneNameEl = el('div',{class:'pdf-zone-name',style:'font-size:13px;font-weight:700'},'images.json (optional)');
    const imgZone = el('label',{class:'pdf-zone'},
      el('input',{type:'file',accept:'.json',onchange: async e=>{
        const file = e.target.files?.[0]; if(!file) return;
        try { const p=JSON.parse(await file.text()); if(!p.scima_html_export){setErr('Not an images file');return;} _htmlData=p; imgZoneNameEl.textContent=file.name; updatePreview(); } catch(err){setErr('Bad images file');}
      }}),
      el('div',{style:'font-size:24px'},'🖼'), imgZoneNameEl,
      el('div',{class:'u-muted-11'},'images.json')
    );
    manualSection.append(
      el('div',{style:'display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:4px'}, srcZone, modZone, imgZone)
    );

    // ── Preview of what will be restored ──────────────────────────────────
    const previewEl = el('div',{style:'display:none;font-size:12px;color:var(--muted);background:rgba(255,255,255,0.04);border-radius:8px;padding:10px 12px;margin-top:6px;line-height:1.7'});

    function updatePreview() {
      errEl.style.display='none'; statusEl.style.display='none'; previewEl.style.display='none';
      const lines = [];
      if(_modsData) {
        if(!nameField.querySelector('input').value.trim()) nameField.querySelector('input').value = _modsData.sourceName || '';
        const bmCount = (_modsData.bookmarks||[]).length;
        const chCount = (_modsData.chapters||[]).length;
        if(bmCount)  lines.push(`🔖 ${bmCount} bookmark${bmCount!==1?'s':''} will be restored`);
        if(chCount)  lines.push(`📑 ${chCount} chapter${chCount!==1?'s':''} will be restored`);
        if(_modsData.autoBookmark) lines.push('📍 Reading position will be restored');
        if(_htmlData) lines.push(`🖼 ${(_htmlData.htmlChapters||[]).length} HTML chapter(s) with images will be restored`);
        if(!_sourceFile && _modsData.sourceName) {
          const byHash = _modsData.contentHash ? state.sources.find(s=>s.contentHash===_modsData.contentHash) : null;
          const existing = byHash || state.sources.find(s=>s.name===_modsData.sourceName);
          if(existing) lines.push(`✅ Matched existing source "${escHtml(existing.name)}"${byHash?' (by content hash)':' (by name)'}`);
          else lines.push('⚠ No matching source found — also provide the source file');
        }
      }
      if(_sourceFile) lines.push(`📄 ${escHtml(_sourceFile.name)}`);
      if(_sourceFile && !_modsData) lines.push('ℹ No modifications file — source will be imported without bookmarks');
      if(lines.length) { previewEl.innerHTML = lines.map(l=>`<div>${l}</div>`).join(''); previewEl.style.display = ''; }
    }

    // ── Import button ──────────────────────────────────────────────────────
    const importBtn = btn('Import','primary',{full:true, onclick: async ()=>{
      const name = nameField.querySelector('input').value.trim()
                || _modsData?.sourceName
                || _sourceFile?.name
                || '';
      if(!name) { setErr('Enter a title'); return; }

      // Case A: no source file — apply mods to an existing source by hash then name
      if(!_sourceFile) {
        if(!_modsData) { setErr('Drop at least one file'); return; }
        const byHash = _modsData.contentHash
          ? state.sources.find(s=>s.contentHash===_modsData.contentHash)
          : null;
        const existing = byHash || state.sources.find(s=>s.name===name);
        if(!existing) { setErr(`No matching source found — drop the source file too`); return; }
        applyModifications(existing, _modsData);
        if(_htmlData?.htmlChapters?.length) {
          await saveHtmlChapters(existing.id, _htmlData.htmlChapters);
          existing.hasHtml = true;
        }
        scheduleSave(); closeModal(); renderView('library');
        showToast(`Bookmarks restored for "${existing.name}" 🔖`);
        return;
      }

      // Case B: source file provided — extract content then save
      setStatus('⏳ Extracting…', false);
      importBtn.disabled = true;
      try {
        const {content, chapters: extractedChapters, htmlChapters} = await extractFileText(_sourceFile);
        if(!content) { setErr('No text content could be extracted'); importBtn.disabled=false; return; }

        // Chapters: prefer the ones from the mods file (they carry IDs cited cards reference),
        // fall back to freshly extracted ones.
        const chapters = (_modsData?.chapters?.length ? _modsData.chapters : extractedChapters) || [];

        const newSrcId = uid('s');

        // PDF visual data
        let pdfDataUrl = null;
        if(_sourceFile.name.toLowerCase().endsWith('.pdf')) {
          const buf = await _sourceFile.arrayBuffer();
          const u8 = new Uint8Array(buf);
          let b64=''; const BCHUNK=8192;
          for(let i=0;i<u8.length;i+=BCHUNK) b64+=String.fromCharCode(...u8.subarray(i,i+BCHUNK));
          pdfDataUrl = 'data:application/pdf;base64,'+btoa(b64);
        }
        if(pdfDataUrl) await blobStore.setChunks('pdf', newSrcId, pdfDataUrl);
        const finalHtmlChapters = htmlChapters?.length ? htmlChapters : (_htmlData?.htmlChapters || null);
        if(finalHtmlChapters?.length) await saveHtmlChapters(newSrcId, finalHtmlChapters);

        const src = {
          id: newSrcId,
          name,
          type: pdfDataUrl ? 'pdf' : 'file',
          content,
          chapters,
          hasPdf: !!pdfDataUrl,
          hasHtml: !!(finalHtmlChapters?.length),
          libraryFolderId: defaultFolderId||null,
          bookmarks: [],
          autoBookmark: null,
          // subjectKey: explicit user override; null/undefined means "auto-detect from
          // citations" (see getSourceEffectiveSubject). timeSpentSec: accumulated active
          // reading time, see the reading-timer block in openLibraryReader.
          subjectKey: null,
          timeSpentSec: 0,
          charsRead: 0,
        };

        if(_modsData) applyModifications(src, _modsData);

        state.sources.push(src);
        hashContent(content).then(h=>{ if(h){ src.contentHash=h; scheduleSave(); } });
        scheduleSave(); closeModal(); renderView('library');
        const bmCount = (src.bookmarks||[]).length;
        showToast(`"${name}" imported${bmCount?` · ${bmCount} bookmark${bmCount!==1?'s':''} restored`:''} 📖`);
      } catch(err) {
        setErr('Import failed: '+(err?.message||String(err)));
        importBtn.disabled = false;
      }
    }});

    // ── Apply mods helper ──────────────────────────────────────────────────
    function applyModifications(src, mods) {
      if(Array.isArray(mods.bookmarks) && mods.bookmarks.length) {
        // Merge: keep any bookmarks already on the source, add new ones by id
        if(!src.bookmarks) src.bookmarks = [];
        const existingIds = new Set(src.bookmarks.map(b=>b.id));
        mods.bookmarks.forEach(bm=>{ if(!existingIds.has(bm.id)) src.bookmarks.push(bm); });
      }
      if(mods.autoBookmark && !src.autoBookmark) {
        src.autoBookmark = mods.autoBookmark;
      }
      // Restore chapters only if source doesn't already have them (freshly extracted chapters take priority)
      if(Array.isArray(mods.chapters) && mods.chapters.length && !(src.chapters?.length)) {
        src.chapters = mods.chapters;
      }
    }

    body.append(
      el('div',{style:'font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.5'},
        'Drop your SCIMA export zip to restore everything at once.'
      ),
      zipZone,
      manualToggle,
      manualSection,
      nameField,
      previewEl,
      statusEl, errEl,
      el('div',{style:'margin-top:12px'}),
      importBtn
    );
  });
}

function openAddSourceModal(defaultFolderId) {
  openModal('Add Source Text', body => {
    const nameField=createField('Title / Name','text','e.g. Of Mice and Men — Steinbeck');
    const typeWrap=el('div',{class:'field'},el('label',{},'Source Type'));
    const typeSel=el('select',{class:'u-input'});
    [['text','Plain text (paste below)'],['file','File (.txt, .pdf, .epub, .mobi)']].forEach(([v,l])=>typeSel.appendChild(el('option',{value:v,class:'u-bg'},l)));
    typeWrap.appendChild(typeSel);
    const contentWrap=el('div',{});

    function renderContentInput(){
      contentWrap.innerHTML='';
      if(typeSel.value==='text'){
        const tf=createField('Text Content','text','Paste the full text here…',true);
        tf.querySelector('textarea').rows=10; tf.querySelector('textarea').style.maxHeight='240px';
        contentWrap.appendChild(tf);
      } else {
        const statusEl=el('div',{style:'display:none'}), errEl=el('div',{class:'error-msg',style:'display:none'});
        const zone=el('label',{class:'pdf-zone'},
          el('input',{type:'file',accept:'.pdf,.txt,.epub,.mobi',onchange:async e=>{
            const file=e.target.files?.[0]; if(!file)return;
            zone.querySelector('.pdf-zone-name').textContent=file.name;
            statusEl.style.display='none'; errEl.style.display='none';
            statusEl.textContent='⏳ Extracting…'; statusEl.className=''; statusEl.style.display='';
            try{
              const {content, chapters, htmlChapters}=await extractFileText(file);
              zone._extractedText=content;
              zone._extractedChapters=chapters;
              zone._extractedHtmlChapters=htmlChapters||null;
              // For PDFs, also store a base64 data URL for visual rendering
              if(file.name.toLowerCase().endsWith('.pdf')){
                const buf2=await file.arrayBuffer();
                const u8=new Uint8Array(buf2);let b64='';const BCHUNK=8192;for(let _i=0;_i<u8.length;_i+=BCHUNK)b64+=String.fromCharCode(...u8.subarray(_i,_i+BCHUNK));b64=btoa(b64);
                zone._pdfDataUrl='data:application/pdf;base64,'+b64;
              }
              statusEl.textContent=`✓ Extracted ${content.length.toLocaleString()} characters${chapters.length?` · ${chapters.length} chapter${chapters.length!==1?'s':''} found`:''}`; statusEl.className='success-badge'; statusEl.style.display='';
            }catch(err){ statusEl.style.display='none'; errEl.textContent='Could not read file: '+(err?.message||String(err)); errEl.style.display=''; }
          }}),
          el('div',{style:'font-size:36px'},'📂'),el('div',{class:'pdf-zone-name',style:'font-size:13px;font-weight:700'},'Click to choose file'),
          el('div',{class:'u-muted-11'},'.txt · .pdf · .epub · .mobi')
        );
        contentWrap.append(zone,statusEl,errEl);
      }
    }
    typeSel.addEventListener('change',renderContentInput); renderContentInput();

    body.append(nameField,typeWrap,contentWrap,btn('Add Source','primary',{full:true,onclick:()=>{
      const name=nameField.querySelector('input').value.trim(); if(!name){ showToast('Enter a title'); return; }
      let content='', chapters=[], htmlChapters=null;
      if(typeSel.value==='text') content=contentWrap.querySelector('textarea')?.value.trim()||'';
      else {
        const zoneLabel=contentWrap.querySelector('label');
        content=zoneLabel?._extractedText||'';
        chapters=zoneLabel?._extractedChapters||[];
        htmlChapters=zoneLabel?._extractedHtmlChapters||null;
      }
      if(!content){ showToast('No content found'); return; }
      const zoneLabel2=contentWrap.querySelector('label');
      const pdfDataUrl=zoneLabel2?._pdfDataUrl||null;
      const newSrcId=uid('s');
      // Store PDF data via the blobStore chunk seam (chrome.storage.local chunks in the
      // extension, a single localStorage entry on the site — see dashboard-blobstore.js).
      if(pdfDataUrl) blobStore.setChunks('pdf', newSrcId, pdfDataUrl);
      if(htmlChapters) saveHtmlChapters(newSrcId, htmlChapters);
      const newSrc={id:newSrcId,name,type:typeSel.value,content,chapters,hasPdf:!!pdfDataUrl,hasHtml:!!(htmlChapters?.length),libraryFolderId:defaultFolderId||null,subjectKey:null,timeSpentSec:0,charsRead:0};
      state.sources.push(newSrc);
      hashContent(content).then(h=>{ if(h){ newSrc.contentHash=h; scheduleSave(); } });
      scheduleSave(); closeModal(); renderView('library'); showToast(`Source added: ${name} 📖`);
    }}));
  });
}

function openLibraryReader(sourceId) {
  const source=state.sources.find(s=>s.id===sourceId); if(!source)return;
  // Reader at z-index:900 so modal (1000+) renders on top
  const overlay=el('div',{id:'library-reader-overlay',style:`
    position:fixed;inset:0;z-index:900;background:var(--bg);display:flex;flex-direction:column;
    animation:fadeIn 0.2s ease;
  `});

  // The info button is fixed-position and sits above the reader's z-index, so it
  // has to be hidden explicitly while the reader is open (restored in closeReader).
  const infoBtn = document.getElementById('info-btn');
  if (infoBtn) infoBtn.style.display = 'none';

  let activeChapterId='';
  // Forward reference — the real renderText is defined inside the non-PDF branch below.
  // The chapter sidebar is built before that branch runs, so its click handlers call
  // this wrapper instead of capturing the not-yet-defined inner function directly.
  let renderText = () => {};

  // ── PDF state & helpers ───────────────────────────────────────────────────
  // Declared up front (rather than nested inside a later `if(IS_PDF)` block) so
  // the header's zoom controls and the selection/scroll logic further down can
  // all close over the same variables/functions regardless of where they're
  // wired up relative to where the canvases actually get built.
  const IS_PDF = !!(source.pdfDataUrl || source.hasPdf);

  // ── Reading-time tracker ─────────────────────────────────────────────────
  // Accumulates active view-time in `source.timeSpentSec` (persisted in state).
  // Pauses when the window loses focus or the user hides the tab; resumes on
  // focusin. closeReader() does a final flush so every last second is captured.
  let _readerTimerInterval = null;
  let _readerLastTick = null;
  function _startReadingTimer() {
    if (_readerTimerInterval) return;
    _readerLastTick = Date.now();
    _readerTimerInterval = setInterval(() => {
      const now = Date.now();
      source.timeSpentSec = (source.timeSpentSec || 0) + (now - _readerLastTick) / 1000;
      _readerLastTick = now;
    }, 1000);
  }
  function _pauseReadingTimer() {
    clearInterval(_readerTimerInterval);
    _readerTimerInterval = null;
    if (_readerLastTick) {
      source.timeSpentSec = (source.timeSpentSec || 0) + (Date.now() - _readerLastTick) / 1000;
      _readerLastTick = null;
    }
  }
  const _onReaderBlur  = () => _pauseReadingTimer();
  const _onReaderFocus = () => _startReadingTimer();
  window.addEventListener('blur',  _onReaderBlur);
  window.addEventListener('focus', _onReaderFocus);
  _startReadingTimer();

  const PDF_BASE_SCALE = 1.6;     // "100%" zoom — the default comfortable reading size
  const PDF_ZOOM_MIN = 0.5, PDF_ZOOM_MAX = 3, PDF_ZOOM_STEP = 0.2;
  let pdfZoom = 1;                // user zoom multiplier on top of PDF_BASE_SCALE
  let pdfDoc = null;
  let pdfRenderedPages = 0;
  const PDF_PAGE_BATCH = 3;       // render N pages at a time
  let pdfPageOffsets = {};        // pageNum -> char offset of that page's text within source.content
  let pdfPageTextLengths = {};    // pageNum -> length (chars) of that page's extracted text
  let pdfRunningOffset = 0;
  let pdfLoadingEl = null;
  let zoomLabel = null;

  // cssScale() is what the page *looks* like on screen (CSS px); effectiveRenderScale()
  // is what it's actually rasterised at — bumped by devicePixelRatio so default zoom is
  // crisp on hi-DPI screens, and re-derived on every zoom change so the canvas is always
  // re-rendered at real (vector-sourced) resolution instead of being CSS-stretched & blurry.
  function cssScale(){ return PDF_BASE_SCALE * pdfZoom; }
  function effectiveRenderScale(){ return cssScale() * (window.devicePixelRatio || 1); }

  async function ensurePdfJs() {
    if (!window.pdfjsLib) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = assetUrl('lib/pdf.min.js');
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = assetUrl('lib/pdf.worker.min.js');
    }
  }

  async function renderPdfPageCanvas(pageNum, wrap, canvas) {
    const page = await pdfDoc.getPage(pageNum);
    const cssViewport = page.getViewport({ scale: cssScale() });
    const renderViewport = page.getViewport({ scale: effectiveRenderScale() });
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = Math.floor(cssViewport.width) + 'px';
    canvas.style.height = Math.floor(cssViewport.height) + 'px';
    wrap.style.width = Math.floor(cssViewport.width) + 'px';
    wrap.style.height = Math.floor(cssViewport.height) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: renderViewport }).promise;
  }

  async function renderPdfPages(fromPage, toPage) {
    for (let pageNum = fromPage; pageNum <= toPage; pageNum++) {
      const page = await pdfDoc.getPage(pageNum);

      const wrap = el('div', { class:'pdf-page-wrap', 'data-page':String(pageNum) });
      wrap.appendChild(el('div',{class:'pdf-page-badge'},`${pageNum} / ${pdfDoc.numPages}`));
      const canvas = document.createElement('canvas');
      wrap.appendChild(canvas);
      textBody.appendChild(wrap);
      await renderPdfPageCanvas(pageNum, wrap, canvas);

      // Extract this page's text once and reuse it both for the sidebar and for the
      // char-offset map — built with the exact same join logic as extractPDFText()
      // (used to populate source.content on import) so offsets line up 1:1.
      const textContent = await page.getTextContent();
      const pageStr = textContent.items.map(x=>x.str).join(' ') + '\n';
      pdfPageOffsets[pageNum] = pdfRunningOffset;
      pdfPageTextLengths[pageNum] = pageStr.length;
      pdfRunningOffset += pageStr.length;

      if (pdfTextSidebar) {
        const pageSec = el('div', { class:'pdf-text-page', 'data-page':String(pageNum) });
        pageSec.appendChild(el('div', { class:'pdf-text-page-label' }, `Page ${pageNum}`));
        const contentEl = el('div', { class:'pdf-text-page-content' });
        contentEl.appendChild(document.createTextNode(pageStr));
        pageSec.appendChild(contentEl);
        pdfTextSidebar.appendChild(pageSec);
      }
    }
    pdfRenderedPages = toPage;
  }

  async function loadMorePdfPages() {
    const prevBtn = textBody.querySelector('.pdf-load-more');
    if (prevBtn) prevBtn.remove();
    const next = Math.min(pdfDoc.numPages, pdfRenderedPages + PDF_PAGE_BATCH);
    await renderPdfPages(pdfRenderedPages + 1, next);
    if (pdfLoadingEl) { pdfLoadingEl.remove(); pdfLoadingEl = null; }
    if (next < pdfDoc.numPages) {
      const rem = pdfDoc.numPages - next;
      const loadMoreBtn = el('div', { class: 'pdf-load-more' },
        el('button', { class:'pdf-load-more-btn', onclick: loadMorePdfPages },
          `Load ${Math.min(PDF_PAGE_BATCH, rem)} more pages (${rem} remaining)`)
      );
      textBody.appendChild(loadMoreBtn);
    }
  }

  // Instantly resize every already-rendered page's CSS box to the new zoom level (cheap —
  // just layout, the bitmap keeps stretching to fill it) so zooming feels immediate, then
  // debounce a real re-render at the new (vector-sourced) resolution so it sharpens up a
  // moment later instead of staying blurry — the same two-step trick desktop PDF readers use.
  function applyInstantPdfZoomCss() {
    if (!pdfDoc) return;
    textBody.querySelectorAll('.pdf-page-wrap').forEach(wrap => {
      const pageNum = parseInt(wrap.dataset.page, 10);
      const canvas = wrap.querySelector('canvas');
      if (!canvas) return;
      pdfDoc.getPage(pageNum).then(page => {
        const v = page.getViewport({ scale: cssScale() });
        wrap.style.width = Math.floor(v.width) + 'px';
        wrap.style.height = Math.floor(v.height) + 'px';
        canvas.style.width = Math.floor(v.width) + 'px';
        canvas.style.height = Math.floor(v.height) + 'px';
      });
    });
  }
  let pdfZoomRerenderTimer = null;
  async function rerenderPdfPagesAtCurrentZoom() {
    for (const wrap of Array.from(textBody.querySelectorAll('.pdf-page-wrap'))) {
      const pageNum = parseInt(wrap.dataset.page, 10);
      const canvas = wrap.querySelector('canvas');
      if (!canvas) continue;
      await renderPdfPageCanvas(pageNum, wrap, canvas);
    }
  }
  function setPdfZoom(z) {
    const clamped = Math.min(PDF_ZOOM_MAX, Math.max(PDF_ZOOM_MIN, z));
    if (Math.abs(clamped - pdfZoom) < 0.001) return;
    pdfZoom = clamped;
    if (zoomLabel) zoomLabel.textContent = Math.round(pdfZoom * 100) + '%';
    applyInstantPdfZoomCss();
    clearTimeout(pdfZoomRerenderTimer);
    pdfZoomRerenderTimer = setTimeout(rerenderPdfPagesAtCurrentZoom, 220);
  }

  // Scroll sync between the PDF canvas column and the extracted-text sidebar: find
  // which page is under a reference line near the top of whichever pane the user is
  // scrolling, then scroll the *other* pane so the same page sits at the same
  // fractional position. A syncing flag stops the two scroll listeners from feeding
  // back into each other.
  function pdfPageInfoAt(container, itemSelector) {
    const items = container.querySelectorAll(itemSelector);
    if (!items.length) return null;
    const contRect = container.getBoundingClientRect();
    const refY = contRect.top + contRect.height * 0.25;
    let best = null;
    for (const it of items) {
      const r = it.getBoundingClientRect();
      if (r.bottom >= refY) { best = it; break; }
    }
    if (!best) best = items[items.length - 1];
    const r = best.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (refY - r.top) / (r.height || 1)));
    return { page: parseInt(best.dataset.page, 10), frac };
  }
  function scrollContainerToPageFrac(container, itemSelector, page, frac) {
    if (!container) return;
    const target = container.querySelector(`${itemSelector}[data-page="${page}"]`);
    if (!target) return;
    const contRect = container.getBoundingClientRect();
    const tRect = target.getBoundingClientRect();
    const currentRefY = contRect.top + contRect.height * 0.25;
    const targetY = tRect.top + frac * tRect.height;
    container.scrollTop += (targetY - currentRefY);
  }
  function pdfPageForOffset(charStart) {
    let page = null;
    for (const p of Object.keys(pdfPageOffsets)) {
      const pn = parseInt(p, 10);
      if (pdfPageOffsets[pn] <= charStart) { if (page === null || pn > page) page = pn; }
    }
    return page;
  }
  let _pdfScrollSyncing = false;
  function setupPdfScrollSync() {
    if (!pdfTextSidebar) return;
    const sync = (from, to, fromSel, toSel) => {
      if (_pdfScrollSyncing) return;
      const info = pdfPageInfoAt(from, fromSel);
      if (!info) return;
      _pdfScrollSyncing = true;
      scrollContainerToPageFrac(to, toSel, info.page, info.frac);
      requestAnimationFrame(() => { _pdfScrollSyncing = false; });
    };
    textBody.addEventListener('scroll', () => sync(textBody, pdfTextSidebar, '.pdf-page-wrap', '.pdf-text-page'));
    pdfTextSidebar.addEventListener('scroll', () => sync(pdfTextSidebar, textBody, '.pdf-text-page', '.pdf-page-wrap'));
  }

  // Selection toolbar — sits above reader (z:950) but below modal (z:1000)
  const selectionToolbar=el('div',{id:'reader-sel-toolbar',style:`
    display:none;position:fixed;z-index:950;background:var(--surface2);border:1px solid var(--border);
    border-radius:10px;padding:8px 10px;gap:6px;box-shadow:0 8px 32px rgba(0,0,0,0.6);
    flex-direction:column;min-width:240px;
  `});

  const selInfo=el('div',{style:'font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'});

  // Citation placement toggle — front / back / neither
  const placements=[
    {value:'front', label:'📖 As front'},
    {value:'back',  label:'✏️ As back'},
    {value:'none',  label:'🔗 Ref only'},
  ];
  let citPlacement='front';
  const placementRow=el('div',{style:'display:flex;gap:4px'});
  function refreshPlacementBtns(){
    placementRow.querySelectorAll('button').forEach((b,i)=>{
      const active=placements[i].value===citPlacement;
      b.style.background=active?'rgba(var(--blue-rgb),0.2)':'rgba(255,255,255,0.05)';
      b.style.color=active?'var(--blue)':'var(--muted)';
      b.style.borderColor=active?'rgba(var(--blue-rgb),0.4)':'rgba(255,255,255,0.1)';
    });
  }
  placements.forEach(p=>{
    const pb=el('button',{
      title:p.title,
      style:'flex:1;padding:4px 6px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.05);color:var(--muted);cursor:pointer;font-size:10px;font-weight:700;font-family:inherit;white-space:nowrap;transition:all 0.12s;'
    },p.label);
    pb.addEventListener('click',()=>{ citPlacement=p.value; refreshPlacementBtns(); });
    placementRow.appendChild(pb);
  });
  refreshPlacementBtns();

  const createCardBtn=el('button',{style:'width:100%;padding:6px 10px;border-radius:7px;border:none;background:var(--grad);color:var(--on-gradient);cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;'},'🃏 Create Flashcard');
  const defineBtn=el('button',{style:'width:100%;padding:6px 10px;border-radius:7px;border:1px solid rgba(var(--blue-rgb),0.4);background:rgba(var(--blue-rgb),0.1);color:var(--blue);cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;'},'🔍 Define');
  // Highlight/annotate — txt/epub/mobi only (PDF text lives in canvas-rendered pages,
  // no reliable way to overlay a highlight span there, so this button is left off the
  // toolbar entirely for PDF sources rather than offered and silently doing nothing).
  const highlightBtn=el('button',{style:'width:100%;padding:6px 10px;border-radius:7px;border:1px solid rgba(251,146,60,0.4);background:rgba(251,146,60,0.12);color:#fb923c;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;'},'🖍 Highlight');
  selectionToolbar.append(selInfo, placementRow, createCardBtn, defineBtn);
  if(!IS_PDF) selectionToolbar.appendChild(highlightBtn);
  document.body.appendChild(selectionToolbar);

  // ── Bookmark system ──────────────────────────────────────────────────────
  // state.sources[i].bookmarks = [{id, charStart, charEnd, text, name, color, note, createdAt}]
  // state.sources[i].autoBookmark = {charStart, charEnd, scrollRatio}
  if(!source.bookmarks) source.bookmarks=[];
  const BM_COLORS=['#f87171','#fb923c','#facc15','#4ade80','#60a5fa','#c084fc','#f472b6'];
  // Word/Docs-style text-selection annotations reuse the exact same source.bookmarks[]
  // records as the older "jump to this spot" bookmarks (charStart===charEnd for those,
  // charEnd>charStart for a real highlighted range) — see bookmark system comment above.
  // Keeping one array means export/import, the sidebar panel, and edit/delete all just
  // work for annotations with no schema changes. ANNOT_DEFAULT_COLOR is only the *default*
  // for newly-created highlights; the same BM_COLORS palette remains user-changeable.
  const ANNOT_DEFAULT_COLOR='#fb923c'; // orange
  function rangeAnnotations(){ return (source.bookmarks||[]).filter(b=>b.charEnd>b.charStart); }

  function ensureAnnotCss(){
    if(document.getElementById('scima-annot-css')) return;
    const style=document.createElement('style');
    style.id='scima-annot-css';
    style.textContent=`
      .scima-annot{ --annot-color:${ANNOT_DEFAULT_COLOR}; border-bottom:2px solid var(--annot-color);
        background:color-mix(in srgb, var(--annot-color) 18%, transparent); border-radius:2px;
        padding:0 1px; cursor:pointer; transition:background 0.12s; }
      .scima-annot:hover{ background:color-mix(in srgb, var(--annot-color) 34%, transparent); }
      .annot-popover{ position:fixed; z-index:10000; width:240px; padding:12px;
        background:var(--surface2); border:1px solid var(--border); border-radius:var(--r-sm);
        box-shadow:0 0 24px var(--glow), 0 12px 32px rgba(0,0,0,0.55);
        display:flex; flex-direction:column; gap:8px;
        opacity:0; transform:translateY(-4px); transition:opacity 0.12s, transform 0.12s; }
      .annot-popover.open{ opacity:1; transform:translateY(0); }
    `;
    document.head.appendChild(style);
  }
  ensureAnnotCss();

  // Wraps the sub-ranges of a single (just-created, not-yet-inserted-content) text node
  // that fall inside any range-annotation, given the node's absolute char offset into
  // source.content. Used for the plain-text renderer, where offsets are exact.
  function wrapAnnotationsInTextNode(textNode, nodeAbsStart){
    const nodeLen=textNode.textContent.length;
    const nodeAbsEnd=nodeAbsStart+nodeLen;
    const hits=rangeAnnotations().filter(b=>b.charStart<nodeAbsEnd && b.charEnd>nodeAbsStart)
      .sort((a,b)=>a.charStart-b.charStart);
    if(!hits.length) return;
    const text=textNode.textContent;
    const frag=document.createDocumentFragment();
    let cursor=0;
    hits.forEach(bm=>{
      const localStart=Math.max(0, bm.charStart-nodeAbsStart);
      const localEnd=Math.min(nodeLen, bm.charEnd-nodeAbsStart);
      if(localStart<cursor) return; // overlapping annotations — keep it simple, first one wins
      if(localStart>cursor) frag.appendChild(document.createTextNode(text.slice(cursor,localStart)));
      const span=document.createElement('span');
      span.className='scima-annot';
      span.dataset.annId=bm.id;
      span.style.setProperty('--annot-color', bm.color||ANNOT_DEFAULT_COLOR);
      span.appendChild(document.createTextNode(text.slice(localStart,localEnd)));
      frag.appendChild(span);
      cursor=localEnd;
    });
    if(cursor<text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(frag);
  }

  // HTML (EPUB/MOBI) chapter rendering doesn't preserve exact char offsets against
  // source.content (the stored HTML keeps its own original whitespace/markup, while
  // offsets were computed from htmlToPlainText's collapsed/newline-normalised output —
  // see htmlToPlainText above). Rather than fight that drift, search for the
  // annotation's own captured excerpt text directly inside the rendered container and
  // wrap whatever DOM text nodes that match spans. Skips (leaves unhighlighted) if the
  // excerpt can't be found — safer than guessing wrong and highlighting the wrong text.
  function highlightTextInContainer(container, bm){
    const searchText=(bm.text||'').trim();
    if(!searchText) return;
    if(container.querySelector(`[data-ann-id="${bm.id}"]`)) return;
    const walker=document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes=[]; let concat='';
    let n;
    while((n=walker.nextNode())){
      nodes.push({node:n, start:concat.length, end:concat.length+n.textContent.length});
      concat+=n.textContent;
    }
    let idx=concat.indexOf(searchText);
    let matchLen=searchText.length;
    if(idx===-1){
      // Fallback: collapse whitespace runs on both sides. Only safe within a single
      // contiguous match (not remapping every node boundary) — good enough to recover
      // most near-misses caused by line-wrap whitespace differences.
      const normSearch=searchText.replace(/\s+/g,' ');
      const normConcat=concat.replace(/\s+/g,' ');
      const normIdx=normConcat.indexOf(normSearch);
      if(normIdx!==-1){ idx=normIdx; matchLen=normSearch.length; }
    }
    if(idx===-1) return;
    const rangeEnd=idx+matchLen;
    nodes.filter(({start,end})=>end>idx && start<rangeEnd).forEach(({node,start})=>{
      const text=node.textContent;
      const localStart=Math.max(0, idx-start);
      const localEnd=Math.min(text.length, rangeEnd-start);
      const frag=document.createDocumentFragment();
      if(localStart>0) frag.appendChild(document.createTextNode(text.slice(0,localStart)));
      const span=document.createElement('span');
      span.className='scima-annot';
      span.dataset.annId=bm.id;
      span.style.setProperty('--annot-color', bm.color||ANNOT_DEFAULT_COLOR);
      span.appendChild(document.createTextNode(text.slice(localStart,localEnd)));
      frag.appendChild(span);
      if(localEnd<text.length) frag.appendChild(document.createTextNode(text.slice(localEnd)));
      node.replaceWith(frag);
    });
  }

  // Loose pre-filter before the text search above — avoids searching every annotation
  // against every part. part.start is an exact plain-text offset; part length in the
  // *raw* HTML is only an upper bound on its plain-text length (markup inflates it), so
  // the window is intentionally generous rather than exact.
  function highlightAnnotationsInPart(partDiv, part){
    const anns=rangeAnnotations();
    if(!anns.length) return;
    const partStart=part.start!=null ? part.start : (_htmlPartOffsets && _htmlPartOffsets[part.id]!=null ? _htmlPartOffsets[part.id] : null);
    let candidates=anns;
    if(partStart!=null){
      const windowEnd=partStart+(part.html?part.html.length:Infinity)+2000;
      const windowStart=partStart-2000;
      candidates=anns.filter(b=>b.charStart<windowEnd && b.charEnd>windowStart);
    }
    candidates.forEach(bm=>highlightTextInContainer(partDiv, bm));
  }

  // ── Annotation hover popover (edit name/note/colour, or remove, without leaving the page) ──
  let annotPopoverEl=null, annotPopoverTimer=null, annotPopoverBmId=null;
  function closeAnnotPopover(){
    if(annotPopoverEl){ annotPopoverEl.remove(); annotPopoverEl=null; annotPopoverBmId=null; }
  }
  function scheduleCloseAnnotPopover(){ clearTimeout(annotPopoverTimer); annotPopoverTimer=setTimeout(closeAnnotPopover,260); }
  function cancelCloseAnnotPopover(){ clearTimeout(annotPopoverTimer); }

  function openAnnotPopover(span, bm){
    if(annotPopoverBmId===bm.id) return;
    closeAnnotPopover();
    annotPopoverBmId=bm.id;
    const inputStyle='width:100%;padding:6px 8px;border-radius:6px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:12px;font-family:inherit;outline:none;box-sizing:border-box;';
    const excerpt=el('div',{style:'font-size:11px;color:var(--muted);line-height:1.5;max-height:56px;overflow:hidden;font-style:italic'},
      `"${searchExcerpt(bm.text)}"`);
    const nameInput=el('input',{type:'text',placeholder:'Add a label…',style:inputStyle});
    nameInput.value=bm.name||'';
    const noteInput=el('textarea',{placeholder:'Add a note…',rows:'2',style:inputStyle+'resize:vertical;'});
    noteInput.value=bm.note||'';
    const colorRow=el('div',{style:'display:flex;gap:6px;'});
    function refreshColorRow(){
      Array.from(colorRow.children).forEach((d,i)=>{ d.style.borderColor=BM_COLORS[i]===bm.color?'var(--text)':'transparent'; });
    }
    BM_COLORS.forEach(c=>{
      const sw=el('div',{
        style:`width:18px;height:18px;border-radius:50%;background:${c};cursor:pointer;border:2px solid transparent;transition:border 0.1s`,
        onclick:()=>{ bm.color=c; span.style.setProperty('--annot-color', c); refreshColorRow(); scheduleSave(); }
      });
      colorRow.appendChild(sw);
    });
    refreshColorRow();
    const saveBtn=el('button',{
      style:'flex:1;padding:6px 8px;border-radius:6px;border:none;background:var(--grad);color:var(--on-gradient);cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;',
      onclick:()=>{ bm.name=nameInput.value.trim(); bm.note=noteInput.value.trim(); scheduleSave(); if(bmPanelOpen) renderBmPanel(); showToast('Annotation updated'); }
    },'Save');
    const removeBtn=el('button',{
      style:'flex:1;padding:6px 8px;border-radius:6px;border:1px solid rgba(248,113,113,0.4);background:rgba(248,113,113,0.1);color:#f87171;cursor:pointer;font-size:11px;font-weight:800;font-family:inherit;',
      onclick:()=>{
        source.bookmarks=source.bookmarks.filter(b=>b.id!==bm.id);
        scheduleSave(); closeAnnotPopover(); renderText(); if(bmPanelOpen) renderBmPanel();
        showToast('Annotation removed');
      }
    },'Remove');
    const pop=el('div',{class:'annot-popover'}, excerpt, nameInput, noteInput, colorRow,
      el('div',{style:'display:flex;gap:8px;margin-top:2px'}, saveBtn, removeBtn));
    document.body.appendChild(pop);
    const r=span.getBoundingClientRect();
    pop.style.left=Math.max(8,Math.min(window.innerWidth-256,r.left))+'px';
    pop.style.top=Math.min(window.innerHeight-260,r.bottom+8)+'px';
    requestAnimationFrame(()=>pop.classList.add('open'));
    pop.addEventListener('mouseenter',cancelCloseAnnotPopover);
    pop.addEventListener('mouseleave',scheduleCloseAnnotPopover);
    annotPopoverEl=pop;
  }
  function searchExcerpt(t){ t=t||''; return t.length>140?t.slice(0,140)+'…':t; }

  function getScrollRatio(){ return textBody.scrollTop/(textBody.scrollHeight-textBody.clientHeight||1); }

  function getCurrentCharPos(){
    // Use selected text range if available, else estimate from scroll
    if(currentSel && currentSel.text){
      return {charStart:currentSel.start, charEnd:currentSel.end, text:currentSel.text};
    }
    if(IS_PDF){
      const info=pdfPageInfoAt(textBody,'.pdf-page-wrap');
      let charStart=0;
      if(info && pdfPageOffsets[info.page]!=null){
        charStart=pdfPageOffsets[info.page]+Math.floor((pdfPageTextLengths[info.page]||0)*info.frac);
      }
      return {charStart, charEnd:charStart, text:''};
    }
    // Estimate center-of-viewport character position via caret from point
    const cx=textBody.getBoundingClientRect().left+textBody.clientWidth/2;
    const cy=textBody.getBoundingClientRect().top+textBody.clientHeight/2;
    let charStart=0;
    try{
      const r=document.caretRangeFromPoint(cx,cy);
      if(r && textBody.contains(r.startContainer)){
        charStart=getCharOffsetInTextBody(r.startContainer,r.startOffset);
        const chapOffset=activeChapterId?((source.chapters||[]).find(c=>c.id===activeChapterId)?.start||0):0;
        charStart+=chapOffset;
      } else {
        charStart=Math.floor((source.content||'').length*getScrollRatio());
      }
    } catch(e){ charStart=Math.floor((source.content||'').length*getScrollRatio()); }
    return {charStart, charEnd:charStart, text:''};
  }

  function scrollToChar(charStart){
    if(IS_PDF){
      const page=pdfPageForOffset(charStart);
      if(page==null) return; // page hasn't been rendered/measured yet
      const startOff=pdfPageOffsets[page]||0;
      const len=pdfPageTextLengths[page]||1;
      const frac=Math.min(1,Math.max(0,(charStart-startOff)/len));
      scrollContainerToPageFrac(textBody,'.pdf-page-wrap',page,frac);
      scrollContainerToPageFrac(pdfTextSidebar,'.pdf-text-page',page,frac);
      return;
    }
    const ratio=charStart/Math.max(1,(source.content||'').length);
    textBody.scrollTop=ratio*(textBody.scrollHeight-textBody.clientHeight);
  }

  function saveAutoBookmark(){
    source.autoBookmark={charStart:Math.floor((source.content||'').length*getScrollRatio()), scrollRatio:getScrollRatio(), savedAt:Date.now()};
    // Chars-read: track the high-water scroll ratio and derive chars seen.
    // This isn't perfect (rendered chars ≠ raw content chars for EPUB/PDF),
    // but it's a consistent, cheap proxy across all source types.
    const ratio = getScrollRatio();
    const contentLen = (source.content||'').length;
    if (contentLen > 0) {
      const charsSeenNow = Math.floor(contentLen * Math.min(1, ratio + 0.15)); // +15% for viewport height
      source.charsRead = Math.max(source.charsRead || 0, charsSeenNow);
    }
    scheduleSave();
  }

  // On open: restore position from auto-bookmark or furthest manual bookmark
  function restoreReadPosition(){
    const useManual=state.settings.bookmarkRestore==='manual';
    if(useManual && source.bookmarks.length){
      const furthest=source.bookmarks.reduce((a,b)=>a.charStart>b.charStart?a:b);
      setTimeout(()=>scrollToChar(furthest.charStart),120);
    } else if(source.autoBookmark){
      setTimeout(()=>scrollToChar(source.autoBookmark.charStart),120);
    }
  }

  // Bookmark panel state
  let bmPanelOpen=false;
  const bmPanel=el('div',{style:`
    position:absolute;top:0;right:0;width:280px;height:100%;background:var(--surface2);
    border-left:1px solid var(--border);display:flex;flex-direction:column;
    transform:translateX(100%);transition:transform 0.22s cubic-bezier(.4,0,.2,1);z-index:10;
  `});

  function renderBmPanel(){
    bmPanel.innerHTML='';
    const ph=el('div',{style:'padding:14px 14px 10px;border-bottom:1px solid var(--border);font-size:12px;font-weight:800;letter-spacing:0.04em;color:var(--muted);text-transform:uppercase;flex-shrink:0'},'Bookmarks');
    const list=el('div',{style:'flex:1;overflow-y:auto;padding:8px 8px'});

    if(!source.bookmarks.length){
      list.appendChild(el('div',{style:'color:var(--muted);font-size:12px;text-align:center;padding:32px 12px;line-height:1.6'},'No bookmarks yet.\nPress [+] to add one.'));
    } else {
      const sorted=[...source.bookmarks].sort((a,b)=>a.charStart-b.charStart);
      sorted.forEach(bm=>{
        const dot=el('div',{style:`width:10px;height:10px;border-radius:50%;background:${bm.color||'var(--blue)'};flex-shrink:0;margin-top:3px`});
        const nameEl=el('div',{style:'font-size:13px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},bm.name||'Bookmark');
        const noteEl=el('div',{style:'font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px'},bm.note||bm.text||'');
        const editBtn=el('button',{
          style:'flex-shrink:0;padding:3px 8px;border-radius:5px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:10px;font-weight:700;font-family:inherit',
          onclick:e=>{e.stopPropagation();openBmEditModal(bm);}
        },'Edit');
        const row=el('div',{
          style:'display:flex;align-items:flex-start;gap:8px;padding:8px 8px;border-radius:8px;cursor:pointer;margin-bottom:2px;transition:background 0.1s',
          onclick:()=>{ scrollToChar(bm.charStart); if(bmPanelOpen) toggleBmPanel(); }
        }, dot, el('div',{style:'flex:1;min-width:0'},nameEl,noteEl), editBtn);
        row.addEventListener('mouseenter',()=>row.style.background='rgba(255,255,255,0.05)');
        row.addEventListener('mouseleave',()=>row.style.background='transparent');
        list.appendChild(row);
      });
    }
    bmPanel.append(ph,list);
  }

  function toggleBmPanel(){
    bmPanelOpen=!bmPanelOpen;
    bmPanel.style.transform=bmPanelOpen?'translateX(0)':'translateX(100%)';
    hamburgerBtn.style.background=bmPanelOpen?'rgba(var(--blue-rgb),0.2)':'rgba(255,255,255,0.07)';
    hamburgerBtn.style.color=bmPanelOpen?'var(--blue)':'var(--text)';
    if(bmPanelOpen) renderBmPanel();
  }

  function openBmEditModal(bm){
    openModal('Edit Bookmark', body=>{
      const nameF=createField('Name','text',bm.name||'Bookmark');
      nameF.querySelector('input').value=bm.name||'';
      const noteF=createField('Note','text',bm.note||'');
      noteF.querySelector('input').value=bm.note||'';
      const colorRow=el('div',{style:'display:flex;gap:8px;flex-wrap:wrap;margin:8px 0'});
      BM_COLORS.forEach(c=>{
        const sw=el('div',{
          style:`width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid ${bm.color===c?'var(--text)':'transparent'};transition:border 0.1s`,
          onclick:()=>{ bm.color=c; colorRow.querySelectorAll('div').forEach((d,i)=>d.style.borderColor=BM_COLORS[i]===c?'var(--text)':'transparent'); }
        });
        colorRow.appendChild(sw);
      });
      const deleteBtn=btn('Delete Bookmark','danger',{full:true,onclick:()=>{
        source.bookmarks=source.bookmarks.filter(b=>b.id!==bm.id);
        scheduleSave(); closeModal(); renderBmPanel(); renderText();
      }});
      const saveBtn=btn('Save','primary',{full:true,onclick:()=>{
        bm.name=nameF.querySelector('input').value.trim()||'Bookmark';
        bm.note=noteF.querySelector('input').value.trim();
        scheduleSave(); closeModal(); renderBmPanel(); renderText();
      }});
      body.append(nameF,el('div',{style:'font-size:11px;color:var(--muted);margin:4px 0 2px'},'Colour'),colorRow,noteF,saveBtn,el('div',{style:'margin-top:8px'}),deleteBtn);
    });
  }

  function addBookmark(){
    const pos=getCurrentCharPos();
    const bm={id:uid('bm'),charStart:pos.charStart,charEnd:pos.charEnd,text:pos.text,name:'',color:BM_COLORS[source.bookmarks.length%BM_COLORS.length],note:'',createdAt:Date.now()};
    source.bookmarks.push(bm);
    scheduleSave();
    showToast('Bookmark added — tap Edit to name it 🔖');
    if(bmPanelOpen) renderBmPanel();
    else { toggleBmPanel(); }
  }

  // ── Editable source text ─────────────────────────────────────────────────
  // Only plain text — pasted (`type:'text'`) or an uploaded .txt (`type:'file'`, no
  // htmlChapters, no PDF) — is offered as editable. EPUB/MOBI (hasHtml) keep their
  // original formatting/images and are annotate-only; PDF is rendered from the
  // original binary and isn't editable at all.
  const isEditableSource = !IS_PDF && !source.hasHtml;
  let editMode=false, editArea=null;

  // Best-effort: after the text changes, try to relocate every existing bookmark/
  // annotation by its captured excerpt so highlights survive small edits elsewhere in
  // the source. If an annotation's exact text can no longer be found (the user edited
  // or deleted that passage), it's left with its old, now-stale offsets — it just won't
  // find a match to highlight next render, rather than highlighting the wrong text.
  function remapBookmarksAfterEdit(newContent){
    (source.bookmarks||[]).forEach(bm=>{
      if(bm.charEnd<=bm.charStart){ // point bookmark, not a text range
        bm.charStart=Math.min(bm.charStart, newContent.length);
        bm.charEnd=bm.charStart;
        return;
      }
      if(newContent.slice(bm.charStart, bm.charStart+bm.text.length)===bm.text) return; // still lines up
      const idx=bm.text?newContent.indexOf(bm.text):-1;
      if(idx!==-1){ bm.charStart=idx; bm.charEnd=idx+bm.text.length; }
    });
  }

  function enterEditMode(){
    editMode=true;
    closeAnnotPopover();
    selectionToolbar.style.display='none';
    textBody.innerHTML='';
    if(textBody._lazyObserver){ textBody._lazyObserver.disconnect(); textBody._lazyObserver=null; }
    editArea=el('div',{
      contenteditable:'true', spellcheck:'true',
      style:'max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.85;font-size:14px;color:var(--text);font-family:\'Georgia\',serif;box-sizing:border-box;width:100%;white-space:pre-wrap;outline:none;min-height:100%;cursor:text;caret-color:var(--text);'
    });
    editArea.textContent=source.content;
    textBody.appendChild(editArea);
    editArea.focus();
    editToggleBtn.style.display='none';
    editSaveBtn.style.display='';
    editCancelBtn.style.display='';
    quickAddBtn.style.display='none';
    hamburgerBtn.style.display='none';
  }

  function exitEditMode(save){
    if(save && editArea){
      const newContent=(editArea.innerText||'').replace(/\r\n/g,'\n');
      if(newContent!==source.content){
        remapBookmarksAfterEdit(newContent);
        source.content=newContent;
        source.contentHash=null; // stale — recomputed lazily below, same pattern as first export
        hashContent(newContent).then(h=>{ if(h){ source.contentHash=h; scheduleSave(); } });
        scheduleSave();
        showToast('Source updated ✓');
      }
    }
    editMode=false;
    closeReader();
    openLibraryReader(source.id);
  }

  // Header buttons
  const quickAddBtn=el('button',{
    title:'Add bookmark here',
    style:'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);width:34px;height:34px;cursor:pointer;font-size:16px;font-family:inherit;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0',
    onclick:addBookmark
  },'＋');
  const hamburgerBtn=el('button',{
    title:'Bookmarks',
    style:'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);width:34px;height:34px;cursor:pointer;font-size:15px;font-family:inherit;display:flex;align-items:center;justify-content:center;flex-shrink:0',
    onclick:toggleBmPanel
  },'☰');

  const editToggleBtn=el('button',{
    title:'Edit source text',
    style:`background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);padding:6px 10px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:700;display:${isEditableSource?'flex':'none'};align-items:center;gap:4px;flex-shrink:0`,
    onclick:()=>enterEditMode()
  },'✏️ Edit');
  const editSaveBtn=el('button',{
    style:'background:var(--grad);border:none;border-radius:8px;color:var(--on-gradient);padding:6px 10px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:800;display:none;align-items:center;gap:4px;flex-shrink:0',
    onclick:()=>exitEditMode(true)
  },'✓ Save');
  const editCancelBtn=el('button',{
    style:'background:transparent;border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--muted);padding:6px 10px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:700;display:none;align-items:center;gap:4px;flex-shrink:0',
    onclick:()=>exitEditMode(false)
  },'✕ Cancel');

  // Zoom controls — PDF only. Re-rasterises the current pages at the new resolution
  // (see setPdfZoom above) rather than just CSS-stretching the existing bitmaps.
  let zoomControls=null;
  if(IS_PDF){
    const zoomBtnStyle='background:transparent;border:none;color:var(--text);width:26px;height:26px;cursor:pointer;font-size:15px;font-family:inherit;font-weight:700;display:flex;align-items:center;justify-content:center;border-radius:6px;';
    const zoomOutBtn=el('button',{title:'Zoom out',style:zoomBtnStyle,onclick:()=>setPdfZoom(pdfZoom-PDF_ZOOM_STEP)},'−');
    zoomLabel=el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);min-width:38px;text-align:center;user-select:none'},'100%');
    const zoomInBtn=el('button',{title:'Zoom in',style:zoomBtnStyle,onclick:()=>setPdfZoom(pdfZoom+PDF_ZOOM_STEP)},'+');
    zoomControls=el('div',{style:'display:flex;align-items:center;gap:1px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:2px;flex-shrink:0'},zoomOutBtn,zoomLabel,zoomInBtn);
  }

  function closeReader() {
    _pauseReadingTimer();
    scheduleSave(); // persist timeSpentSec
    window.removeEventListener('blur',  _onReaderBlur);
    window.removeEventListener('focus', _onReaderFocus);
    saveAutoBookmark();
    closeAnnotPopover();
    clearTimeout(annotPopoverTimer);
    document.removeEventListener('selectionchange',onSelChange);
    selectionRoot.removeEventListener('mouseup',onSelFinalize);
    selectionRoot.removeEventListener('keyup',onSelFinalize);
    textBody.removeEventListener('scroll',onSelectionScroll);
    if(pdfTextSidebar) pdfTextSidebar.removeEventListener('scroll',onSelectionScroll);
    selectionToolbar.remove();
    if (onSidebarResizeMove) document.removeEventListener('mousemove', onSidebarResizeMove);
    if (onSidebarResizeEnd) document.removeEventListener('mouseup', onSidebarResizeEnd);
    if (infoBtn) infoBtn.style.display = '';
    overlay.remove();
  }

  const closeBtn=el('button',{style:'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);padding:6px 14px;cursor:pointer;font-size:13px;font-family:inherit;font-weight:700'},'✕ Close');
  closeBtn.addEventListener('click', closeReader);

  const readerExportBtn=el('button',{
    title:'Export source file + bookmarks',
    style:'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text);padding:6px 10px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:700;display:flex;align-items:center;gap:4px;flex-shrink:0',
    onclick:()=>exportSourceWithBookmarks(source.id)
  },'⬇ Export');

  const header=el('div',{style:'display:flex;align-items:center;justify-content:space-between;padding:14px 24px;border-bottom:1px solid var(--border);flex-shrink:0;gap:12px'},
    el('div',{style:'display:flex;align-items:center;gap:10px;min-width:0'},
      el('span',{style:'font-size:18px'},sourceTypeIcon(source)),
      el('div',{style:'min-width:0'},
        el('div',{style:'font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'},source.name),
        el('div',{style:'font-size:11px;color:var(--muted);margin-top:1px'},`${source.content.length.toLocaleString()} chars · ${IS_PDF?'Select text on the right to create flashcards':'Select text to create flashcards'}`)
      )
    ),
    el('div',{style:'display:flex;align-items:center;gap:6px;flex-shrink:0'},
      zoomControls,
      editToggleBtn,
      editSaveBtn,
      editCancelBtn,
      quickAddBtn,
      hamburgerBtn,
      readerExportBtn,
      closeBtn
    )
  );

  // Chapter sidebar — left-hand jump list, like the heading navigator in Word/Docs
  let _htmlChapters = null; // declared here so renderChapterSidebar can reference it
  let _htmlPartOffsets = null; // cached per-part char offsets, built once after _htmlChapters loads
  const chapterSidebar = source.chapters?.length ? el('div',{style:'width:220px;flex-shrink:0;overflow-y:auto;border-right:1px solid var(--border);padding:14px 8px'}) : null;
  function renderChapterSidebar(){
    if(!chapterSidebar) return;
    chapterSidebar.innerHTML='';
    chapterSidebar.appendChild(el('div',{style:'font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);padding:6px 10px;margin-bottom:4px'},'Chapters'));
    const items=[{id:'',title:'📄 Full text'}, ...source.chapters.map(ch=>({id:ch.id,title:ch.title}))];
    items.forEach(it=>{
      const active=activeChapterId===it.id;
      const itemEl=el('div',{style:`padding:7px 10px;border-radius:7px;font-size:12px;cursor:pointer;margin-bottom:2px;font-weight:${active?'700':'500'};color:${active?'var(--blue)':'var(--muted)'};background:${active?'rgba(var(--blue-rgb),0.12)':'transparent'};border-left:2px solid ${active?'var(--blue)':'transparent'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background 0.12s`},it.title);
      itemEl.addEventListener('click',()=>{ activeChapterId=it.id; renderText(); renderChapterSidebar(); if(!_htmlChapters) textBody.scrollTop=0; });
      itemEl.addEventListener('mouseenter',()=>{ if(activeChapterId!==it.id) itemEl.style.background='rgba(255,255,255,0.05)'; });
      itemEl.addEventListener('mouseleave',()=>{ if(activeChapterId!==it.id) itemEl.style.background='transparent'; });
      chapterSidebar.appendChild(itemEl);
    });
  }
  renderChapterSidebar();

  // ── PDF visual renderer ──────────────────────────────────────────────────
  // IS_PDF and all the zoom/pagination/offset-mapping helpers were declared
  // near the top of this function (see "PDF state & helpers" above) so the
  // header's zoom controls could close over them too.

  const textBody = el('div', { style: `flex:1;overflow-y:auto;${IS_PDF?'padding:24px 0;background:#525659;user-select:none;':'caret-color:transparent;user-select:text;'}` });

  // Delegated hover — spans are re-created on every render, so listen on textBody once.
  textBody.addEventListener('mouseover', e=>{
    const span=e.target.closest?.('.scima-annot');
    if(!span || !textBody.contains(span)) return;
    const bm=(source.bookmarks||[]).find(b=>b.id===span.dataset.annId);
    if(!bm) return;
    cancelCloseAnnotPopover();
    openAnnotPopover(span, bm);
  });
  textBody.addEventListener('mouseout', e=>{
    if(!e.target.closest?.('.scima-annot')) return;
    scheduleCloseAnnotPopover();
  });
  textBody.addEventListener('scroll', closeAnnotPopover);

  // Extracted-text sidebar (PDF only) — this is the *only* place selection happens
  // for PDF sources now, instead of an invisible text layer overlaid on the canvas
  // that never quite lined up with the rendered glyphs.
  const PDF_SIDEBAR_MIN_WIDTH = 260;
  const PDF_SIDEBAR_MAX_WIDTH = 720;
  const PDF_SIDEBAR_DEFAULT_WIDTH = 380;
  let pdfSidebarWidth = PDF_SIDEBAR_DEFAULT_WIDTH;
  if (IS_PDF) {
    try {
      const saved = parseInt(localStorage.getItem('scima_pdf_text_sidebar_width'), 10);
      if (!isNaN(saved)) pdfSidebarWidth = Math.min(PDF_SIDEBAR_MAX_WIDTH, Math.max(PDF_SIDEBAR_MIN_WIDTH, saved));
    } catch (e) { /* localStorage unavailable — fall back to default width */ }
  }
  const pdfTextSidebar = IS_PDF ? el('div', { id:'pdf-text-sidebar', style:`width:${pdfSidebarWidth}px` }) : null;
  if (pdfTextSidebar) {
    pdfTextSidebar.appendChild(el('div', { class:'pdf-text-sidebar-header' }, 'Extracted Text'));
  }
  const selectionRoot = IS_PDF ? pdfTextSidebar : textBody;

  // Drag handle to resize the extracted-text sidebar. Dragging left grows it (the
  // sidebar sits on the right edge), dragging right shrinks it. Width is clamped and
  // persisted across sessions so the reader remembers the reader's preferred size.
  let pdfSidebarResizeHandle = null;
  let onSidebarResizeMove = null;
  let onSidebarResizeEnd = null;
  if (IS_PDF) {
    pdfSidebarResizeHandle = el('div', { id:'pdf-text-sidebar-resize', title:'Drag to resize' });
    let dragStartX = 0, dragStartWidth = 0;
    onSidebarResizeMove = (e) => {
      const dx = dragStartX - e.clientX;
      const newWidth = Math.min(PDF_SIDEBAR_MAX_WIDTH, Math.max(PDF_SIDEBAR_MIN_WIDTH, dragStartWidth + dx));
      pdfTextSidebar.style.width = newWidth + 'px';
    };
    onSidebarResizeEnd = () => {
      document.removeEventListener('mousemove', onSidebarResizeMove);
      document.removeEventListener('mouseup', onSidebarResizeEnd);
      pdfSidebarResizeHandle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('scima_pdf_text_sidebar_width', String(parseInt(pdfTextSidebar.style.width, 10))); }
      catch (e) { /* localStorage unavailable — width just won't persist */ }
    };
    pdfSidebarResizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragStartX = e.clientX;
      dragStartWidth = pdfTextSidebar.getBoundingClientRect().width;
      pdfSidebarResizeHandle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onSidebarResizeMove);
      document.addEventListener('mouseup', onSidebarResizeEnd);
    });
  }

  if (IS_PDF && !document.getElementById('pdf-reader-css')) {
    const style = document.createElement('style');
    style.id = 'pdf-reader-css';
    style.textContent = `
      .pdf-page-wrap { position:relative; margin:0 auto 16px; box-shadow:0 2px 16px rgba(0,0,0,0.5); }
      .pdf-page-badge { position:absolute; top:6px; right:8px; font-size:10px; background:rgba(0,0,0,0.5); color:#fff; padding:2px 6px; border-radius:4px; z-index:2; pointer-events:none; }
      .pdf-load-more { text-align:center; padding:16px 0; }
      .pdf-load-more-btn { padding:8px 24px; border-radius:8px; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.2); color:#fff; cursor:pointer; font-size:12px; font-weight:700; font-family:inherit; }
      #pdf-text-sidebar { flex-shrink:0; overflow-y:auto; overflow-x:hidden; border-left:1px solid var(--border); background:var(--surface2); padding:0 20px 24px; font-size:13.5px; line-height:1.7; color:var(--text); user-select:text; caret-color:transparent; }
      .pdf-text-sidebar-header { position:sticky; top:0; background:var(--surface2); padding:16px 0 10px; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:0.05em; color:var(--muted); }
      .pdf-text-page-label { font-size:10px; font-weight:800; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin:16px 0 6px; user-select:none; }
      .pdf-text-page-content { white-space:pre-wrap; }
      #pdf-text-sidebar ::selection { background:rgba(91,206,250,0.35); }
      #pdf-text-sidebar-resize { width:6px; flex-shrink:0; cursor:col-resize; background:transparent; position:relative; }
      #pdf-text-sidebar-resize::after { content:''; position:absolute; top:0; bottom:0; left:2px; width:2px; border-radius:1px; background:transparent; }
      #pdf-text-sidebar-resize:hover::after, #pdf-text-sidebar-resize.dragging::after { background:rgba(91,206,250,0.5); }
    `;
    document.head.appendChild(style);
  }

  if (IS_PDF) {
    pdfLoadingEl = el('div', { style: 'text-align:center;padding:40px;color:#ccc;font-size:14px' }, '⏳ Loading PDF…');
    textBody.appendChild(pdfLoadingEl);

    (async () => {
      await ensurePdfJs();
      // PDF data may be stored inline (legacy) or in chunks
      let dataUrl = source.pdfDataUrl;
      if (!dataUrl && source.hasPdf) {
        dataUrl = await blobStore.getChunks('pdf', source.id);
      }
      if (!dataUrl) { textBody.appendChild(el('div',{style:'color:#f87171;padding:24px;text-align:center'},'⚠ PDF data not found. Re-import the file to view it visually.')); return; }
      const data = atob(dataUrl.split(',')[1]);
      const buf = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) buf[i] = data.charCodeAt(i);
      pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
      await loadMorePdfPages();
      setupPdfScrollSync();
    })();

    // Ctrl/Cmd + scroll wheel zoom, like every other PDF/image viewer
    textBody.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPdfZoom(pdfZoom + (e.deltaY < 0 ? PDF_ZOOM_STEP : -PDF_ZOOM_STEP));
    }, { passive: false });
  } else {
    // HTML chapter renderer (EPUB/MOBI with images) or plain text fallback
    const LAZY_CHUNK = 10000;
    let lazyOffset = 0;

    const PROSE_STYLE = 'max-width:720px;margin:0 auto;padding:32px 20px;line-height:1.85;font-size:14px;color:var(--text);font-family:\'Georgia\',serif;box-sizing:border-box;width:100%;';

    function renderPlainText(content) {
      textBody.innerHTML = '';
      lazyOffset = 0;
      textBody._fullContent = content;
      textBody._plainWrapper = el('div', { style: PROSE_STYLE + 'white-space:pre-wrap;' });
      textBody.appendChild(textBody._plainWrapper);
      appendTextChunk();
    }

    function appendTextChunk() {
      const content = textBody._fullContent || '';
      const wrapper = textBody._plainWrapper;
      const prev = wrapper.querySelector('.lazy-load-more');
      if (prev) prev.remove();
      const chunkStart = lazyOffset;
      const chunk = content.slice(lazyOffset, lazyOffset + LAZY_CHUNK);
      const textNode = document.createTextNode(chunk);
      wrapper.appendChild(textNode);
      const chapOffset = activeChapterId ? ((source.chapters || []).find(c => c.id === activeChapterId)?.start || 0) : 0;
      wrapAnnotationsInTextNode(textNode, chapOffset + chunkStart);
      lazyOffset += chunk.length;
      if (lazyOffset < content.length) {
        const remaining = content.length - lazyOffset;
        const loadMore = el('div', { class: 'lazy-load-more', style: 'margin:16px 0;text-align:center' },
          el('button', {
            style: 'padding:8px 20px;border-radius:8px;background:rgba(255,255,255,0.07);border:1px solid var(--border);color:var(--text);cursor:pointer;font-size:12px',
            onclick: () => appendTextChunk()
          }, `Load more (${remaining.toLocaleString()} chars remaining)`)
        );
        wrapper.appendChild(loadMore);
      }
    }

    // Render a single spine part into a div and append/prepend to wrapper.
    function buildPartDiv(part) {
      const partDiv = document.createElement('div');
      partDiv.style.cssText = 'margin-bottom:2em;';
      partDiv.dataset.partId = part.id;
      const parsed = new DOMParser().parseFromString(part.html || '', 'text/html');
      parsed.querySelectorAll('script,style,nav,head').forEach(n => n.remove());
      // Stash data: src values before innerHTML — CSP blocks data: URLs during re-parse
      const imgSrcs = [];
      parsed.querySelectorAll('img').forEach((img, i) => {
        imgSrcs.push(img.getAttribute('src') || '');
        img.setAttribute('data-src-idx', i);
        img.removeAttribute('src');
        img.style.maxWidth = '100%'; img.style.height = 'auto';
        img.style.display = 'block'; img.style.margin = '1em auto';
        img.style.borderRadius = '4px';
      });
      parsed.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => {
        h.style.color = 'var(--text)';
        h.style.fontFamily = "\'Georgia\',serif";
        h.style.marginTop = '1.5em';
      });
      partDiv.innerHTML = (parsed.body || parsed.documentElement).innerHTML;
      // Reattach src via JS so CSP allows data: URLs
      partDiv.querySelectorAll('img[data-src-idx]').forEach(img => {
        const idx = parseInt(img.getAttribute('data-src-idx'), 10);
        img.removeAttribute('data-src-idx');
        if (imgSrcs[idx]) img.src = imgSrcs[idx];
      });
      highlightAnnotationsInPart(partDiv, part);
      return partDiv;
    }


    function renderHtmlChapter(chapId) {
      if (DEBUG) {
        console.group('[SCIMA] renderHtmlChapter');
        console.log('chapId:', chapId);
        console.log('_htmlChapters count:', (_htmlChapters||[]).length);
        console.log('_htmlPartOffsets:', _htmlPartOffsets ? (Object.keys(_htmlPartOffsets).length + ' entries') : 'NULL');
        console.log('_htmlPartOffsets sample:', Object.entries(_htmlPartOffsets||{}).slice(0,3));
        console.log('source.chapters sample:', (source.chapters||[]).slice(0,3).map(c=>({id:c.id,title:c.title,start:c.start})));
      }

      textBody.innerHTML = '';
      if (textBody._lazyObserver) { textBody._lazyObserver.disconnect(); textBody._lazyObserver = null; }

      const parts = _htmlChapters || [];
      if (!parts.length) { if (DEBUG) { console.warn('No parts!'); console.groupEnd(); } return; }

      const wrapper = document.createElement('div');
      wrapper.style.cssText = PROSE_STYLE;
      textBody.appendChild(wrapper);

      let startIdx = 0;
      if (chapId) {
        const ch = (source.chapters || []).find(c => c.id === chapId);
        if (DEBUG) console.log('Matched chapter:', ch);
        if (ch) {
          if (ch.partId) {
            // New imports: exact spine part id stored at import time
            const idx = parts.findIndex(p => p.id === ch.partId);
            if (DEBUG) console.log('partId lookup:', ch.partId, '->', idx);
            if (idx >= 0) startIdx = idx;
          } else if (_htmlPartOffsets) {
            // Fallback for existing imports
            let best = -1;
            for (let i = 0; i < parts.length; i++) {
              const s = _htmlPartOffsets[parts[i].id];
              if (s != null && s <= ch.start) best = i;
            }
            if (DEBUG) console.log('offset fallback best:', best);
            if (best >= 0) startIdx = best;
          }
        }
      }
      if (DEBUG) console.log('startIdx:', startIdx, 'parts[startIdx].id:', parts[startIdx]?.id);


      const BATCH = 5;
      let renderedMin = startIdx;
      let renderedMax = Math.min(parts.length - 1, startIdx + BATCH - 1);
      for (let i = renderedMin; i <= renderedMax; i++) {
        if (parts[i].html) wrapper.appendChild(buildPartDiv(parts[i]));
      }
      textBody.scrollTop = 0;
      if (DEBUG) console.groupEnd();

      if (parts.length <= BATCH) return;

      const topSentinel = el('div', {style: 'height:1px'});
      const botSentinel = el('div', {style: 'height:1px'});
      wrapper.prepend(topSentinel);
      wrapper.appendChild(botSentinel);

      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === botSentinel && renderedMax < parts.length - 1) {
            const next = Math.min(renderedMax + BATCH, parts.length - 1);
            for (let i = renderedMax + 1; i <= next; i++) {
              if (parts[i].html) wrapper.insertBefore(buildPartDiv(parts[i]), botSentinel);
            }
            renderedMax = next;
            if (renderedMax >= parts.length - 1) observer.unobserve(botSentinel);
          }
          if (entry.target === topSentinel && renderedMin > 0) {
            const prev = Math.max(renderedMin - BATCH, 0);
            const scrollBefore = textBody.scrollHeight;
            for (let i = renderedMin - 1; i >= prev; i--) {
              if (parts[i].html) wrapper.insertBefore(buildPartDiv(parts[i]), wrapper.children[1]);
            }
            textBody.scrollTop += textBody.scrollHeight - scrollBefore;
            renderedMin = prev;
            if (renderedMin <= 0) observer.unobserve(topSentinel);
          }
        }
      }, { root: textBody, rootMargin: '200px' });

      observer.observe(topSentinel);
      observer.observe(botSentinel);
      textBody._lazyObserver = observer;
    }



    renderText = function renderText() {
      if (_htmlChapters) {
        renderHtmlChapter(activeChapterId);
      } else {
        // Plain text fallback while html loads (or if no html stored)
        let content = source.content;
        if (activeChapterId) {
          const ch = (source.chapters || []).find(c => c.id === activeChapterId);
          if (ch) content = source.content.slice(ch.start, ch.end);
        }
        renderPlainText(content);
      }
    };

    // Kick off initial render immediately with plain text, then upgrade to HTML if available
    renderText();
    if (source.hasHtml) {
      loadHtmlChapters(source.id).then(hc => {
        if (!hc) showToast('⚠ Images couldn\'t be loaded — please re-import this book to restore them', 6000);
        if (hc?.length) {
          _htmlChapters = hc;
          // Build offset lookup from stored p.start values (new imports).
          // Fallback for existing imports: find each part's text in source.content
          // by searching for a unique prefix, avoiding the drift from re-extracting HTML.
          _htmlPartOffsets = {};
          const hasStoredOffsets = hc.some(p => p.start != null);
          if (hasStoredOffsets) {
            for (const p of hc) {
              if (p.start != null) _htmlPartOffsets[p.id] = p.start;
            }
          } else {
            // Fallback: locate each part by searching for its plain-text prefix in source.content.
            let searchFrom = 0;
            for (const p of hc) {
              const pt = htmlToPlainText(p.html || '').trim();
              if (!pt) { _htmlPartOffsets[p.id] = searchFrom; continue; }
              const prefix = pt.slice(0, 40);
              const idx = source.content.indexOf(prefix, searchFrom);
              if (idx >= 0) { _htmlPartOffsets[p.id] = idx; searchFrom = idx; }
              else { _htmlPartOffsets[p.id] = searchFrom; }
            }
          }
          renderText(); // re-render with images
          if (!IS_PDF) restoreReadPosition();
        }
      });
    }
  }

  const bodyRow=el('div',{style:'flex:1;display:flex;overflow:hidden;position:relative'});
  if(!IS_PDF && chapterSidebar) bodyRow.appendChild(chapterSidebar);
  bodyRow.appendChild(textBody);
  if(pdfSidebarResizeHandle) bodyRow.appendChild(pdfSidebarResizeHandle);
  if(pdfTextSidebar) bodyRow.appendChild(pdfTextSidebar);
  bodyRow.appendChild(bmPanel);

  overlay.append(header, bodyRow);
  document.body.appendChild(overlay);

  // Restore read position after layout is painted
  if(!IS_PDF) restoreReadPosition();

  // Re-anchor scroll position when textBody width changes (window resize, sidebar toggle).
  // Snapshot the current char position before reflow, restore it after.
  {
    let _resizeCharPos = null;
    let _resizeRaf = null;
    const _resizeObserver = new ResizeObserver(() => {
      if (_resizeCharPos === null) {
        const ratio = getScrollRatio();
        _resizeCharPos = Math.floor((source.content || '').length * ratio);
      }
      cancelAnimationFrame(_resizeRaf);
      _resizeRaf = requestAnimationFrame(() => {
        if (_resizeCharPos !== null) { scrollToChar(_resizeCharPos); _resizeCharPos = null; }
      });
    });
    _resizeObserver.observe(textBody);
    overlay.addEventListener('remove', () => _resizeObserver.disconnect(), {once:true});
  }

  let currentSel={start:0,end:0,text:''};
  let currentSelRange=null; // clone of the Range behind currentSel, used to reposition the toolbar on scroll
  function getCharOffsetInTextBody(node,offset){
    const walker=document.createTreeWalker(textBody,NodeFilter.SHOW_TEXT);
    let total=0;
    while(walker.nextNode()){
      if(walker.currentNode===node) return total+offset;
      total+=walker.currentNode.textContent.length;
    }
    return total+offset;
  }
  // For PDF sources: selection happens inside the sidebar's per-page `.pdf-text-page-content`
  // blocks, whose text was built with the exact same join logic used to populate
  // source.content on import — so a plain in-page tree-walker offset, plus that page's
  // known starting offset, gives an exact character position (no fuzzy string search needed).
  function getCharOffsetInPdfSidebar(node,offset){
    const pageContentEl = node.nodeType===Node.ELEMENT_NODE
      ? node.closest('.pdf-text-page-content')
      : node.parentElement?.closest('.pdf-text-page-content');
    const pageEl = pageContentEl?.closest('.pdf-text-page');
    if(!pageContentEl || !pageEl) return 0;
    const pageNum = parseInt(pageEl.dataset.page,10);
    const base = pdfPageOffsets[pageNum]||0;
    const walker=document.createTreeWalker(pageContentEl,NodeFilter.SHOW_TEXT);
    let total=0;
    while(walker.nextNode()){
      if(walker.currentNode===node) return base+total+offset;
      total+=walker.currentNode.textContent.length;
    }
    return base+total+offset;
  }

  // Selecting text fires `selectionchange` continuously while the mouse is still
  // dragging — repositioning the toolbar on every one of those events is what
  // caused it to flicker/jump. So `selectionchange` is only used to hide the
  // toolbar reactively (the instant the selection collapses, e.g. a stray click),
  // while showing/positioning it is deferred to the *end* of the selection gesture
  // (mouseup, or keyup for Shift+Arrow selection), via requestAnimationFrame so the
  // browser has committed the final selection rect first.
  let posRAF=null;
  function onSelChange(){
    if(!document.body.contains(overlay)){
      document.removeEventListener('selectionchange',onSelChange);
      if(document.body.contains(selectionToolbar)) selectionToolbar.remove();
      return;
    }
    const sel=window.getSelection();
    if(!sel?.toString().trim()||sel.rangeCount===0||!selectionRoot.contains(sel.anchorNode)){
      selectionToolbar.style.display='none';
      currentSelRange=null;
    }
  }
  function onSelFinalize(){
    if(editMode){ selectionToolbar.style.display='none'; return; }
    if(posRAF) cancelAnimationFrame(posRAF);
    posRAF=requestAnimationFrame(()=>{
      const sel=window.getSelection();
      const txt=sel?.toString().trim();
      if(!txt||sel.rangeCount===0||!selectionRoot.contains(sel.anchorNode)){
        selectionToolbar.style.display='none'; return;
      }
      const range=sel.getRangeAt(0);
      let start, end;
      if(IS_PDF){
        start=getCharOffsetInPdfSidebar(range.startContainer,range.startOffset);
        end=getCharOffsetInPdfSidebar(range.endContainer,range.endOffset);
      } else {
        start=getCharOffsetInTextBody(range.startContainer,range.startOffset);
        const chapOffset=activeChapterId ? ((source.chapters||[]).find(c=>c.id===activeChapterId)?.start||0) : 0;
        start+=chapOffset; end=start+txt.length;
      }
      currentSel={start, end, text:txt};
      currentSelRange=range.cloneRange();
      selInfo.textContent=`"${txt.slice(0,42)}${txt.length>42?'…':''}"`; 
      if(/\p{Script=Han}/u.test(txt) && state.settings.showPinyin!==false){
        fetchPinyin(txt).then(py=>{ if(py) selInfo.textContent+=`  · ${py}`; }).catch(()=>{});
      }
      selectionToolbar.style.display='flex';
      positionSelectionToolbar(range);
    });
  }
  // Positions the toolbar above the given range's on-screen rect. Called on initial
  // selection and again on scroll (with the cloned range) so the toolbar tracks the
  // selected text instead of staying pinned to where the selection started.
  function positionSelectionToolbar(range){
    const rect=range.getBoundingClientRect();
    selectionToolbar.style.left=Math.max(8,Math.min(window.innerWidth-256,rect.left+rect.width/2-120))+'px';
    selectionToolbar.style.top=Math.max(8,rect.top-116)+'px';
  }
  let scrollRAF=null;
  function onSelectionScroll(){
    if(selectionToolbar.style.display==='none'||!currentSelRange) return;
    if(scrollRAF) cancelAnimationFrame(scrollRAF);
    scrollRAF=requestAnimationFrame(()=>positionSelectionToolbar(currentSelRange));
  }
  document.addEventListener('selectionchange',onSelChange);
  selectionRoot.addEventListener('mouseup',onSelFinalize);
  selectionRoot.addEventListener('keyup',onSelFinalize);
  textBody.addEventListener('scroll',onSelectionScroll);
  if(pdfTextSidebar) pdfTextSidebar.addEventListener('scroll',onSelectionScroll);

  createCardBtn.addEventListener('click',()=>{
    if(!currentSel.text){ showToast('Select some text first'); return; }
    if(!state.decks.length){ showToast('Create a deck first', 4000, {label:'+ Create Deck', onClick:()=>openCreateDeckModal()}); return; }
    const citation={sourceId:source.id, charStart:currentSel.start, charEnd:currentSel.end, chapterId:null};
    const ch=(source.chapters||[]).find(c=>currentSel.start>=c.start&&currentSel.end<=c.end);
    if(ch) citation.chapterId=ch.id;
    openCreateCardFromReaderModal(currentSel.text, citation, citPlacement);
  });

  defineBtn.addEventListener('click',()=>{
    if(!currentSel.text){ showToast('Select some text first'); return; }
    if(!state.decks.length){ showToast('Create a deck first', 4000, {label:'+ Create Deck', onClick:()=>openCreateDeckModal()}); return; }
    const citation={sourceId:source.id, charStart:currentSel.start, charEnd:currentSel.end, chapterId:null};
    const ch=(source.chapters||[]).find(c=>currentSel.start>=c.start&&currentSel.end<=c.end);
    if(ch) citation.chapterId=ch.id;
    openDefineFromReaderModal(currentSel.text, citation);
  });

  highlightBtn.addEventListener('click',()=>{
    if(!currentSel.text){ showToast('Select some text first'); return; }
    const bm={id:uid('bm'), charStart:currentSel.start, charEnd:currentSel.end, text:currentSel.text,
      name:'', color:ANNOT_DEFAULT_COLOR, note:'', createdAt:Date.now()};
    source.bookmarks.push(bm);
    scheduleSave();
    selectionToolbar.style.display='none';
    window.getSelection()?.removeAllRanges();
    renderText();
    if(bmPanelOpen) renderBmPanel();
    showToast('Highlighted 🖍 — hover it to add a note');
  });
}

function openDefineFromReaderModal(term, citation) {
  openModal('🔍 Define & Add', body => {
    const termEl=el('div',{style:'font-size:16px;font-weight:700;padding:8px 0;color:var(--blue)'},term);
    const resultEl=el('div',{style:'font-size:13px;color:var(--muted);line-height:1.6;min-height:48px'},'Loading definition…');
    const deckSel=el('select',{style:'width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin:10px 0'});
    state.decks.forEach(d=>deckSel.appendChild(el('option',{value:d.id,class:'u-bg'},d.name)));
    const saveBtn=btn('Save as Card','primary',{full:true});
    saveBtn.style.display='none';
    body.append(termEl, resultEl, deckSel, saveBtn);

    let cardBack='', cardHint='';
    const opts={showPinyin:state.settings.showPinyin!==false, singleWordDefinition:state.settings.singleWordDefinition!==false};
    defineTerm(term, state.settings.defineLang||'en', opts).then(({kind,back,hint,pinyin})=>{
      cardBack=back; cardHint=hint;
      if(kind==='pinyin'){
        resultEl.innerHTML = `<div style="font-size:15px;font-weight:700;color:var(--blue);margin-bottom:6px">${pinyin?`🀄 ${escHtml(pinyin)}`:''}</div>${escHtml(back)}`;
      } else if(kind==='translation'){
        resultEl.innerHTML = `<div style="font-size:11px;color:var(--blue);margin-bottom:4px">🌐 ${escHtml(hint)}</div>${escHtml(back)}`;
      } else {
        resultEl.innerHTML = `${hint?`<em>${escHtml(hint)}</em><br>`:''}${escHtml(back)}`;
      }
      saveBtn.style.display='block';
      saveBtn.onclick=()=>{
        const deck=state.decks.find(d=>d.id===deckSel.value); if(!deck)return;
        deck.cards.push({id:uid('c'),front:`Define: ${term}`,back:cardBack,hint:cardHint,tags:['definition','vocabulary'],created:Date.now(),citation});
        scheduleSave(); closeModal(); showToast('Definition saved 📖');
      };
    }).catch(()=>{ resultEl.textContent='Could not fetch definition.'; });
  });
}

function openCreateCardFromReaderModal(selectedText, citation, placement) {
  // placement: 'front' | 'back' | 'none'
  openModal('Create Flashcard', body => {
    const deckSel=el('select',{style:'width:100%;padding:8px 12px;border-radius:8px;background:rgba(255,255,255,0.06);border:1px solid var(--border);color:var(--text);font-size:13px;font-family:inherit;outline:none;margin-bottom:10px'});
    state.decks.forEach(d=>deckSel.appendChild(el('option',{value:d.id,class:'u-bg'},d.name)));

    const citBadge=el('div',{style:'font-size:11px;color:var(--blue);background:rgba(var(--blue-rgb),0.1);border:1px solid rgba(var(--blue-rgb),0.2);border-radius:6px;padding:4px 10px;display:inline-block;margin-bottom:10px'},
      `📎 Linked to "${state.sources.find(s=>s.id===citation.sourceId)?.name||'source'}"`);

    const frontField=createField('Front','text','',true);
    const frontTA=frontField.querySelector('textarea'); frontTA.rows=4;
    const backField=createField('Back','text','',true);
    const backTA=backField.querySelector('textarea'); backTA.rows=3;

    if(placement==='front')      { frontTA.value=selectedText; setTimeout(()=>backTA.focus(),60); }
    else if(placement==='back')  { backTA.value=selectedText;  setTimeout(()=>frontTA.focus(),60); }
    // 'none': both blank, user writes freely

    body.append(deckSel, citBadge, frontField, backField,
      btn('Add Card','primary',{full:true,onclick:()=>{
        const deck=state.decks.find(d=>d.id===deckSel.value); if(!deck) return;
        const f=frontTA.value.trim(), b=backTA.value.trim();
        if(!f){ showToast('Front is required'); return; }
        deck.cards.push({id:uid('c'),front:f,back:b,hint:'',tags:[],created:Date.now(),citation});
        scheduleSave(); closeModal(); showToast('Card added! 🃏');
      }})
    );
  });
}

function openChaptersModal(sourceId) {
  const source=state.sources.find(s=>s.id===sourceId); if(!source)return;
  openModal(`Chapters: ${source.name}`, body => {
    const listEl=el('div',{});
    function renderChapters(){
      listEl.innerHTML='';
      if(!source.chapters?.length){ listEl.appendChild(el('div',{style:'color:var(--muted);font-size:12px;padding:12px 0;text-align:center'},'No chapters yet — use the form below to add one.')); return; }
      source.chapters.forEach(ch=>{
        listEl.appendChild(el('div',{class:'chapter-item'},
          el('span',{style:'flex:1;font-size:12px;font-weight:600'},ch.title),
          el('span',{style:'font-size:10px;color:var(--muted);margin-right:8px'},`${ch.start}–${ch.end}`),
          btn('×','danger',{small:true,onclick:()=>{ source.chapters=source.chapters.filter(c=>c.id!==ch.id); scheduleSave(); renderChapters(); }})
        ));
      });
    }
    renderChapters();

    const addSection=el('div',{style:'border-top:1px solid var(--border);padding-top:14px;margin-top:10px'},
      el('div',{style:'font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px'},'Add Chapter')
    );
    const chTitle=createField('Chapter Title','text','e.g. Chapter 1 — The River');
    const chStart=createField('Start character position','number','0');
    const chEnd=createField('End character position','number',String(source.content.length));

    addSection.append(chTitle,
      el('div',{style:'display:grid;grid-template-columns:1fr 1fr;gap:8px'},chStart,chEnd),
      btn('Auto-detect from title','ghost',{onclick:()=>{
        const t=chTitle.querySelector('input').value.trim(); if(!t)return;
        const idx=source.content.indexOf(t);
        if(idx!==-1){ chStart.querySelector('input').value=idx; showToast(`Found "${t}" at position ${idx}`); }
        else showToast('Title not found in source text');
      }}),
      btn('Add Chapter','primary',{full:true,onclick:()=>{
        const title=chTitle.querySelector('input').value.trim(); if(!title)return;
        const start=parseInt(chStart.querySelector('input').value)||0;
        const end=parseInt(chEnd.querySelector('input').value)||source.content.length;
        source.chapters=source.chapters||[];
        source.chapters.push({id:uid('ch'),title,start,end});
        source.chapters.sort((a,b)=>a.start-b.start);
        scheduleSave(); chTitle.querySelector('input').value=''; renderChapters();
      }})
    );
    body.append(listEl,addSection);
  });
}
