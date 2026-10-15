"use strict";(function(){let t=null;const e=e=>t.querySelector(`[id="${e}"]`),i=e=>t.querySelector(e),n=e=>t.querySelectorAll(e),s=`<div class="sc-root-bar"><span class="dot" id="api-dot"></span><span id="api-label">checking API…</span></div>
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
          or click to pick one of your own decks
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

  </section>`;function o(){const l=window.SCIMA_API_BASE||"/api/v1",i={MAX_REQUEST_BODY_BYTES:5*1024*1024,MAX_CARDS_PER_DECK:5e3,MAX_CARD_TEXT_BYTES:100*1024,MAX_DECK_NAME_CHARS:200,MAX_DESCRIPTION_BYTES:25*1024,MAX_AUTHOR_CHARS:200,MAX_TAGS:30,MAX_TAG_CHARS:50,MAX_SEARCH_QUERY_CHARS:200};function k(e){return(new TextEncoder).encode(String(e||"")).length}function s(t,n={},...s){const e=document.createElement(t);for(const[t,s]of Object.entries(n))t==="class"?e.className=s:t==="text"?e.textContent=s:t.startsWith("on")?e.addEventListener(t.slice(2),s):e.setAttribute(t,s);for(const t of s.flat()){if(t==null)continue;e.append(typeof t=="string"?document.createTextNode(t):t)}return e}function f(e,t="primary",n={}){const o=s("button",{class:`btn btn-${t}${n.small?" btn-sm":""}${n.full?" btn-full":""}`},e);return n.disabled&&(o.disabled=!0),n.onclick&&o.addEventListener("click",n.onclick),o}function b(e){return s("span",{class:"tag"},e)}async function m(e,t){if(e.status===429){const t=e.headers.get("Retry-After"),n=await e.json().catch(()=>({}));throw new Error(n.detail||`Too many requests${t?` — try again in ${t}s`:""}.`)}const n=await e.json().catch(()=>({}));let s=t;throw n?.detail&&(typeof n.detail=="string"?s=n.detail:s=JSON.stringify(n.detail)),new Error(s)}const d={async health(){const e=await fetch(`${l}/health`);return e.ok||await m(e,"API health check failed."),e.json()},async listDecks(e={}){const t=new URLSearchParams;for(const[s,n]of Object.entries(e))n!=null&&n!==""&&t.set(s,n);const s=t.toString()?`?${t.toString()}`:"",n=await fetch(`${l}/decks${s}`);return n.ok||await m(n,"Could not load decks."),n.json()},async search(e,t={}){if(e.length>i.MAX_SEARCH_QUERY_CHARS)throw new Error("Search query is too long.");const s=new URLSearchParams({q:e});for(const[n,e]of Object.entries(t))e!=null&&e!==""&&s.set(n,e);const n=await fetch(`${l}/search?${s.toString()}`);return n.ok||await m(n,"Search failed."),n.json()},async getDeck(e){const t=await fetch(`${l}/decks/${encodeURIComponent(e)}`);return t.ok||await m(t,"Deck not found."),t.json()},async exportDeck(e){const t=await fetch(`${l}/decks/${encodeURIComponent(e)}/export`);return t.ok||await m(t,"Could not download deck."),t.json()},async createDeck(e){const n=JSON.stringify(e);if(k(n)>i.MAX_REQUEST_BODY_BYTES)throw new Error("This deck is too large to upload.");const t=await fetch(`${l}/decks`,{method:"POST",headers:{"Content-Type":"application/json"},body:n});return t.ok||await m(t,"Upload failed."),t.json()}},v={englishLanguage:{name:"English Language",defaultColor:"#1B3A6B"},englishLiterature:{name:"English Literature",defaultColor:"#5FA820"},mathematics:{name:"Mathematics",defaultColor:"#E07B00"},furtherMathematics:{name:"Further Mathematics",defaultColor:"#C93A2A"},biology:{name:"Biology",defaultColor:"#27AE60"},chemistry:{name:"Chemistry",defaultColor:"#00ACC1"},physics:{name:"Physics",defaultColor:"#D32F2F"},computerScience:{name:"Computer Science",defaultColor:"#7B5EA7"},economics:{name:"Economics",defaultColor:"#C8960A"},french:{name:"French",defaultColor:"#C2185B"},geography:{name:"Geography",defaultColor:"#7B1FA2"},music:{name:"Music",defaultColor:"#C5A800"},misc:{name:"Miscellaneous",defaultColor:"#AAAAAA"}},g="misc";function w(e="id"){return`${e}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`}const O={load(){return{decks:state.decks,folders:state.folders,settings:state.settings}},save(){scheduleSave()},addDeckToDashboard(e,t,n,s){const i=(e.deck.cards||[]).map(e=>sanitizeCard({...e,id:e.id||w("c")})),o=sanitizeDeck({id:w("d"),name:e.deck.name||t.name,emoji:e.deck.emoji||"📖",image:e.deck.image||null,subject:n||g,folderId:s||null,color:"var(--blue)",cards:i});return state.decks.push(o),scheduleSave(),typeof renderSidebar=="function"&&renderSidebar(),o},createFolder(e,t,n){const s={id:w("f"),name:e,subjectKey:t||g,parentId:n||null};return state.folders.push(s),scheduleSave(),s}};function R(e,n){const o=s("div",{class:"sc-modal-overlay",onclick:e=>{e.target===o&&_()}}),i=s("div",{class:"sc-modal-box"},s("div",{class:"sc-modal-header"},s("h3",{class:"sc-modal-title"},e),s("button",{class:"sc-modal-close",onclick:()=>_()},"✕")),s("div",{class:"sc-modal-body"}));o.appendChild(i),t.appendChild(o),n(i.querySelector(".sc-modal-body")),t.classList.add("sc-modal-open")}function _(){n(".sc-modal-overlay").forEach(e=>e.remove()),t.classList.remove("sc-modal-open")}function H(e){R(`Add "${e.name}" to dashboard`,t=>{const c=O.load(),u=Array.isArray(c.folders)?c.folders:[],o=s("div",{class:"sc-modal-status"}),h=s("label",{class:"sc-field-label"},"Subject"),i=s("select",{class:"sc-select"});Object.entries(v).forEach(([t,n])=>{const o=s("option",{value:t},n.name);t===(e.subject&&v[e.subject]?e.subject:g)&&(o.selected=!0),i.appendChild(o)});const m=s("label",{class:"sc-field-label"},"Folder (optional)"),n=s("select",{class:"sc-select"});function l(){const e=i.value;n.innerHTML="",n.appendChild(s("option",{value:""},"— No folder (top level) —")),u.filter(t=>t.subjectKey===e).forEach(e=>{n.appendChild(s("option",{value:e.id},e.name))}),n.appendChild(s("option",{value:"__new__"},"+ New folder…"))}l(),i.addEventListener("change",l);const a=s("input",{type:"text",class:"sc-text-input",placeholder:"New folder name",style:"display:none;margin-top:8px"});n.addEventListener("change",()=>{a.style.display=n.value==="__new__"?"":"none"});const r=f("Add to dashboard","primary",{full:!0});r.addEventListener("click",async()=>{o.className="sc-modal-status",o.textContent="",r.disabled=!0;try{const t=i.value||g;let s=n.value||null;if(s==="__new__"){const e=a.value.trim();if(!e)throw a.focus(),new Error("Enter a name for the new folder.");const n=O.createFolder(e,t,null);s=n.id}const r=await d.exportDeck(e.id);try{typeof ensureSubjectKeyExists=="function"&&ensureSubjectKeyExists(t,v[t]?.name)}catch(e){console.warn("[SCIMA] community import: could not seed subject",t,e)}O.addDeckToDashboard(r,e,t,s),o.className="sc-modal-status ok",o.textContent=`Added to ${v[t]?.name||t} ✓`,setTimeout(()=>_(),900)}catch(e){o.className="sc-modal-status err",o.textContent=e.message}finally{r.disabled=!1}}),t.append(h,i,m,n,a,s("div",{style:"margin-top:16px"},r),o)})}const o={currentDeck:null,popularLoaded:!1,search:{query:"",sort:"relevance"},upload:{parsed:null,tags:[]}};function x(e){n(".screen").forEach(t=>{t.classList.toggle("active",t.id===`screen-${e}`)}),window.scrollTo({top:0,behavior:"smooth"})}e("back-to-search").addEventListener("click",()=>{x("search")});function E(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function Y(e){if(e==null||e==="")return"";const s=typeof katex!="undefined",o=e=>e.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'"),n=(e,t)=>{const n=o(e);if(!s)return E(t?`$$${n}$$`:`$${n}$`);try{return katex.renderToString(n,{throwOnError:!1,displayMode:t})}catch{return E(t?`$$${n}$$`:`$${n}$`)}};let t=E(String(e));return t=t.replace(/\$\$([\s\S]+?)\$\$/g,(e,t)=>n(t,!0)),t=t.replace(/\$([^$\n]+?)\$/g,(e,t)=>n(t,!1)),t=t.replace(/\*\*([\s\S]+?)\*\*/g,"<strong>$1</strong>"),t=t.replace(/__([\s\S]+?)__/g,"<u>$1</u>"),t=t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g,"$1<em>$2</em>"),t=t.replace(/\n/g,"<br>"),t}function J(e,t){return e.innerHTML=Y(t),e}function N(e){if(!e)return"Unknown";const t=new Date(e);return Number.isNaN(t.getTime())?String(e):t.toLocaleDateString(0[0],{year:"numeric",month:"short",day:"numeric"})}function D(e){const t=[];e.subject&&t.push(b(e.subject)),e.level&&t.push(b(e.level)),e.examBoard&&t.push(b(e.examBoard));for(const n of e.tags||[]){if(t.length>=5)break;t.push(b(n))}return t}function G(e){const t=s("div",{class:"deck-card"},s("div",{class:"deck-emoji"},e.emoji||"📖"),s("div",{class:"deck-name"},e.name||"Untitled deck"),s("div",{class:"deck-desc"},e.description||"No description provided."),s("div",{class:"deck-meta"},s("span",{},`${e.cardCount??0} cards`),s("span",{},`⬇ ${e.downloads??0}`)),s("div",{class:"deck-tags"},D(e)));return t.addEventListener("click",()=>U(e.id)),t}function T(e,t,n){if(e.innerHTML="",!t?.length){n.style.display="";return}n.style.display="none";for(const n of t)e.appendChild(G(n))}async function S(){const n=e("popular-grid"),t=e("popular-empty");try{const e=await d.listDecks({sort:"popularity",limit:5,offset:0});T(n,e.items||[],t),o.popularLoaded=!0}catch{n.innerHTML="",t.style.display="",t.querySelector("div:nth-child(2)").textContent="Could not load community decks."}}async function A(){const h=e("search-input"),n=e("search-sort").value,s=h.value.trim(),a=e("search-results-section"),l=e("search-results"),c=e("search-empty"),u=e("results-count"),m=e("results-title");if(!s){a.style.display="none",e("popular-section").style.display="";return}if(s.length>i.MAX_SEARCH_QUERY_CHARS){r(null,"Search query is too long.",!0);return}const t=e("search-btn");if(t.disabled)return;t.disabled=!0,t.textContent="Searching…";try{const t=await d.search(s,{sort:n,limit:50,offset:0}),i=t.items||[];a.style.display="",e("popular-section").style.display="none",m.textContent=n==="relevance"?"Search results":n==="newest"?"Newest matches":"Most popular matches",typeof t.total=="number"?u.textContent=`${t.total} result${t.total===1?"":"s"}`:u.textContent=`${i.length} result${i.length===1?"":"s"}`,T(l,i,c),o.search.query=s,o.search.sort=n}catch(e){a.style.display="",l.innerHTML="",c.style.display="",c.querySelector("div:nth-child(2)").textContent=e.message||"Search failed."}finally{t.disabled=!1,t.textContent="Search"}}document.getElementById("search-btn").addEventListener("click",A),document.getElementById("search-sort").addEventListener("change",()=>{document.getElementById("search-input").value.trim()&&A()}),document.getElementById("search-input").addEventListener("keydown",e=>{e.key==="Enter"&&(e.preventDefault(),A())});function j(e){const t=new Error(e);return t.uploadValidation=!0,t}function M(e,t){const n=[];if(!e||typeof e!="object")return n.push("The selected file is not a valid SCIMA export."),n;if(!e.deck||typeof e.deck!="object"||!Array.isArray(e.deck.cards))return n.push("The selected file is not a recognized SCIMA deck export."),n;const s=e.deck;(typeof s.name!="string"||!s.name.trim())&&n.push("The deck does not contain a valid name."),s.name&&s.name.length>i.MAX_DECK_NAME_CHARS&&n.push("The deck name is too long."),s.cards.length>i.MAX_CARDS_PER_DECK&&n.push("This deck contains too many cards.");for(let e=0;e<s.cards.length;e++){const t=s.cards[e];if(!t||typeof t!="object"){n.push(`Card ${e+1} is invalid.`);break}for(const e of["front","back","hint"])if(typeof t[e]=="string"&&k(t[e])>i.MAX_CARD_TEXT_BYTES){n.push(`One or more cards contain too much text.`);break}if(n.length)break}k(t.description)>i.MAX_DESCRIPTION_BYTES&&n.push("The description is too long."),t.author.length>i.MAX_AUTHOR_CHARS&&n.push("The author name is too long."),t.tags.length>i.MAX_TAGS&&n.push("Too many tags were added.");for(const e of t.tags)if(e.length>i.MAX_TAG_CHARS){n.push("One or more tags are too long.");break}return n}function q(e){const t={...e,cards:e.cards.map(e=>({...e,frontImage:null,backImage:null}))};return t}function y(){const t=e("upload-tags-list");t.innerHTML="",o.upload.tags.forEach((e,n)=>{const i=s("button",{type:"button",title:"Remove tag",style:`
            border:none;
            background:none;
            color:inherit;
            cursor:pointer;
            padding:0 0 0 3px;
            font:inherit;
          `},"×");i.addEventListener("click",()=>{o.upload.tags.splice(n,1),y()});const a=s("span",{class:"tag",style:`
            background:rgba(var(--blue-rgb),0.12);
            color:var(--blue);
            border:1px solid rgba(var(--blue-rgb),0.2);
          `},e,i);t.appendChild(a)})}function C(e){const t=String(e||"").trim().replace(/,$/,"").trim();if(!t)return;if(o.upload.tags.some(e=>e.toLowerCase()===t.toLowerCase()))return;if(o.upload.tags.length>=i.MAX_TAGS)return;if(t.length>i.MAX_TAG_CHARS)return;o.upload.tags.push(t),y()}const a=e("upload-tag-input");a.addEventListener("keydown",e=>{(e.key==="Enter"||e.key===",")&&(e.preventDefault(),C(a.value),a.value=""),e.key==="Backspace"&&!a.value&&o.upload.tags.length&&(o.upload.tags.pop(),y())}),a.addEventListener("blur",()=>{a.value.trim()&&(C(a.value),a.value="")});function r(t,n,s=!1){const o=e("upload-status");if(!o)return;o.className=s?"err":"ok",o.textContent=n||t||""}function L(t,n){const s=t.deck,a={description:e("upload-desc").value,author:e("upload-author").value.trim(),tags:[...o.upload.tags]},i=M(t,a);if(i.length)throw j(i.join(" "));o.upload.parsed=t,e("upload-file-name").textContent=n,e("upload-extracted").style.display="",e("upload-extracted-name").textContent=s.name,e("upload-extracted-meta").textContent=[`${s.cards.length} cards`,s.id?`source ID ${s.id}`:"no source ID",t.version!=null?`export v${t.version}`:"unknown export version",t.exportedAt?`exported ${N(t.exportedAt)}`:"unknown export date"].join(" · "),r(null,"Deck ready to upload.",!1)}async function F(t){if(!t)return;r(null,"",!1);const n=e("upload-file-name");n.textContent=t.name;try{const n=await t.text();let e;try{e=JSON.parse(n)}catch{throw j("Could not parse the selected file as JSON.")}if(typeof scimaClassify=="function"){const s=scimaClassify(e),n=scimaToFullDeck(e);if(!s||!n||s.kind!=="deck"&&s.kind!=="cards")throw j("The selected file is not a recognized SCIMA deck export.");(typeof n.name!="string"||!n.name.trim())&&(n.name=t.name.replace(/\.[^.]+$/,"")||"Imported deck"),e=s.kind==="cards"?scimaStamp({version:2,exportedAt:(new Date).toISOString(),deck:n,citedSources:[]},"share","deck"):{...e,deck:n}}else if(!e||!e.deck||!Array.isArray(e.deck.cards))throw j("The selected file is not a recognized SCIMA deck export.");L(e,t.name)}catch(t){o.upload.parsed=null,e("upload-extracted").style.display="none",r(null,t.message||"Could not read this deck.",!0)}}const u=e("upload-file"),c=e("upload-dropzone");c.addEventListener("click",e=>{if(e.target===u)return;$()}),u.addEventListener("change",()=>{F(u.files[0])}),c.addEventListener("dragover",e=>{e.preventDefault(),c.style.borderColor="rgba(var(--blue-rgb),0.6)",c.style.background="rgba(var(--blue-rgb),0.06)"}),c.addEventListener("dragleave",()=>{c.style.borderColor="",c.style.background=""}),c.addEventListener("drop",e=>{e.preventDefault(),c.style.borderColor="",c.style.background="";const t=e.dataTransfer.files[0];if(!t)return;try{const e=new DataTransfer;e.items.add(t),u.files=e.files}catch{}F(t)});const I={biology:"biology",chemistry:"chemistry",physics:"physics",mathematics:"mathematics",furtherMathematics:"mathematics",computerScience:"computer science",englishLanguage:"english",englishLiterature:"english",geography:"geography",french:"languages"};function B(e){const t={...e,cards:(e.cards||[]).map(e=>{if(!e.citation)return e;const t=(state.sources||[]).find(t=>t.id===e.citation.sourceId),n=e.citation.chapterId&&t?.chapters?.find(t=>t.id===e.citation.chapterId),s=t?String(t.content||"").slice(e.citation.charStart,e.citation.charEnd):"";return{...e,citation:{...e.citation,sourceName:t?.name||null,chapterTitle:n?.title||null,excerpt:s||null}}})},s=new Set(t.cards.map(e=>e.citation?.sourceId).filter(Boolean)),o=(state.sources||[]).filter(e=>s.has(e.id)),i=typeof scimaDeckToShare=="function"?scimaDeckToShare(t):(()=>{const e={...t};return delete e.id,delete e.pinned,e.cards=(e.cards||[]).map(e=>{const t={...e};return["id","ease","interval","reps","lapses","due","state","created","lastRated","suspended","leech"].forEach(e=>delete t[e]),t}),e})(),n={version:2,exportedAt:(new Date).toISOString(),deck:i,citedSources:o};return typeof scimaStamp=="function"?scimaStamp(n,"share","deck"):n}function V(t){if(!t)return;r(null,"",!1);try{L(B(t),`${t.emoji||"📚"} ${t.name} — from your decks`);const n=e("upload-subject"),s=I[t.subject];s&&!n.value&&(n.value=s)}catch(t){o.upload.parsed=null,e("upload-extracted").style.display="none",r(null,t.message||"Could not read this deck.",!0)}}function $(){if(typeof openDeckExplorerOverlay!="function"||!state.decks.length){u.click();return}openDeckExplorerOverlay({singleDeck:!0,title:"📂 Choose a Deck to Upload",confirmLabel:"Use this deck ✓",footerButtons:[{label:"📄 Choose a JSON file instead…",variant:"ghost",onClick(e){e(),u.click()}}],onConfirm(e){V(e)}})}document.getElementById("upload-btn").addEventListener("click",async()=>{const t=e("upload-btn");if(t.disabled)return;if(!o.upload.parsed){r(null,"Choose a valid SCIMA deck export first.",!0);return}a.value.trim()&&(C(a.value),a.value="");const n=e("upload-desc").value,s=e("upload-author").value.trim(),c=e("upload-subject").value,l=e("upload-level").value,u=e("upload-exam-board").value,h={description:n,author:s,tags:[...o.upload.tags]},i=M(o.upload.parsed,h);if(i.length){r(null,i.join(" "),!0);return}t.disabled=!0,t.textContent="Uploading…",r(null,"",!1);try{const t=q(o.upload.parsed.deck),e={version:o.upload.parsed.version,exportedAt:o.upload.parsed.exportedAt,deck:{...t,subject:c,level:l,examBoard:u},citedSources:Array.isArray(o.upload.parsed.citedSources)?o.upload.parsed.citedSources:[],meta:{description:n,author:s,tags:[...o.upload.tags]}},i=await d.createDeck(typeof scimaStamp=="function"?scimaStamp(e,"share","deck"):e);r(null,`Uploaded ✓ "${i.name}"`,!1),W(),await S()}catch(e){r(null,`Upload failed: ${e.message}`,!0)}finally{t.disabled=!1,t.textContent="Upload deck"}});function W(){o.upload.parsed=null,o.upload.tags=[],u.value="",e("upload-file-name").textContent="Drop a SCIMA JSON export here",e("upload-extracted").style.display="none",e("upload-desc").value="",e("upload-author").value="",e("upload-subject").value="",e("upload-level").value="",e("upload-exam-board").value="",a.value="",y()}async function U(t){const n=e("deck-detail");n.innerHTML="",n.append(s("div",{style:`
          text-align:center;
          color:var(--muted);
          padding:50px 0;
        `},"Loading deck…")),x("deck");try{const e=await d.getDeck(t);o.currentDeck=e,P(e)}catch(e){n.innerHTML="",n.append(s("div",{class:"empty-state"},s("div",{class:"big-emoji"},"⚠️"),s("div",{},e.message),f("Back to decks","ghost",{small:!0,onclick:()=>x("search")})))}}function P(t){const o=e("deck-detail");o.innerHTML="";const n=t.export||null,i=n?.deck||null,a=s("div",{class:"deck-detail-header"},s("div",{class:"deck-detail-emoji"},i?.emoji||"📖"),s("div",{},s("h2",{class:"deck-detail-title"},t.name||"Untitled deck"),s("div",{class:"section-sub",style:"margin:0"},t.description||"No description provided."),s("div",{style:"margin-top:8px;display:flex;gap:5px;flex-wrap:wrap"},D(t)))),r=s("div",{class:"deck-detail-stats",style:"flex-wrap:wrap"},p(t.cardCount??"—","Cards"),p(t.downloads??0,"Downloads"),p(t.rating?.average!=null?Number(t.rating.average).toFixed(1):"—",t.rating?.count!=null?`${t.rating.count} ratings`:"Rating"),p(t.author||"—","Author")),c=s("div",{style:`
          margin:18px 0;
          padding:16px;
          background:var(--surface);
          border:1px solid var(--border);
          border-radius:var(--r-sm);
        `},h("Source deck ID",i?.id),h("Export version",n?.version),h("Exported",n?.exportedAt?N(n.exportedAt):null),h("Subject",t.subject),h("Level",t.level),h("Exam board",t.examBoard)),l=s("div",{style:"display:flex;gap:10px;flex-wrap:wrap"},(()=>{const e=f("⬇ Download deck","primary");return e.addEventListener("click",()=>Q(t,e)),e})(),(()=>{const e=f("＋ Add to dashboard","ghost");return e.addEventListener("click",()=>H(t)),e})());o.append(a,r,c,l)}function p(e,t){return s("div",{class:"stat-box"},s("div",{class:"stat-num"},String(e)),s("div",{class:"stat-lab"},t))}function h(e,t){return s("div",{style:`
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding:5px 0;
        font-size:12px;
      `},s("span",{style:"color:var(--muted)"},e),s("span",{style:"text-align:right;font-weight:700;overflow-wrap:anywhere"},t==null||t===""?"—":String(t)))}function z(e){return String(e||"deck").trim().replace(/[^a-z0-9-_ ]/gi,"").replace(/\s+/g,"_").slice(0,80)||"deck"}function X(e){const t=z(e.subject),n=z(e.name);return`${t||"misc"}__${n}.json`}async function Q(e,t){if(t.disabled)return;t.disabled=!0,t.textContent="Downloading…";try{const s=await d.exportDeck(e.id),o=JSON.stringify(s,null,2),i=new Blob([o],{type:"application/json"}),n=URL.createObjectURL(i),t=document.createElement("a");t.href=n,t.download=X(e),document.body.appendChild(t),t.click(),t.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}catch(e){alert(`Download failed: ${e.message}`)}finally{t.disabled=!1,t.textContent="⬇ Download deck"}}async function Z(){const t=e("api-dot"),n=e("api-label");t.classList.remove("ok");try{const e=await d.health();if(e?.status!=="ok")throw new Error("Unexpected health response");t.classList.add("ok"),n.textContent=`Server online at ${l}`}catch{n.textContent=`Server temporarily offline at ${l}`}}async function K(){await Z(),await S()}return K}window.renderCommunity=function(e){e.classList.add("sc-root"),e.innerHTML=s,t=e;const n=o();typeof n=="function"&&n()}})()