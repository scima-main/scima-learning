"use strict";(function(){let t=null;const e=e=>t.querySelector(`[id="${e}"]`),l=e=>t.querySelector(e),i=e=>t.querySelectorAll(e);let n=null,s=null;function a(e){const t=location.origin+location.pathname.replace(/index\.html$/,"");return`${t}#community/${encodeURIComponent(e)}`}function o(){if(typeof scReplaceHash!="function")return;const e=n?`community/${encodeURIComponent(n)}`:"community";scReplaceHash(e),s=e}window.SCIMA_URL_SYNC=window.SCIMA_URL_SYNC||{},window.SCIMA_URL_SYNC.community=function(){const e=typeof scParseHash=="function"?scParseHash():null;if(e&&e.segs[0]==="community"&&e.segs[1]&&s!==e.raw&&!n)return;o()};const r=`<div class="sc-root-bar"><span class="dot" id="api-dot"></span><span id="api-label">checking API…</span></div>
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

  </section>`;function c(){const m=window.SCIMA_API_BASE||"/api/v1",l={MAX_REQUEST_BODY_BYTES:5*1024*1024,MAX_CARDS_PER_DECK:5e3,MAX_CARD_TEXT_BYTES:100*1024,MAX_DECK_NAME_CHARS:200,MAX_DESCRIPTION_BYTES:25*1024,MAX_AUTHOR_CHARS:200,MAX_TAGS:30,MAX_TAG_CHARS:50,MAX_SEARCH_QUERY_CHARS:200};function E(e){return(new TextEncoder).encode(String(e||"")).length}function r(t,n={},...s){const e=document.createElement(t);for(const[t,s]of Object.entries(n))t==="class"?e.className=s:t==="text"?e.textContent=s:t.startsWith("on")?e.addEventListener(t.slice(2),s):e.setAttribute(t,s);for(const t of s.flat()){if(t==null)continue;e.append(typeof t=="string"?document.createTextNode(t):t)}return e}function b(e,t="primary",n={}){const s=r("button",{class:`btn btn-${t}${n.small?" btn-sm":""}${n.full?" btn-full":""}`},e);return n.disabled&&(s.disabled=!0),n.onclick&&s.addEventListener("click",n.onclick),s}function w(e){return r("span",{class:"tag"},e)}async function v(e,t){if(e.status===429){const t=e.headers.get("Retry-After"),n=await e.json().catch(()=>({}));throw new Error(n.detail||`Too many requests${t?` — try again in ${t}s`:""}.`)}const n=await e.json().catch(()=>({}));let s=t;throw n?.detail&&(typeof n.detail=="string"?s=n.detail:s=JSON.stringify(n.detail)),new Error(s)}const f={async health(){const e=await fetch(`${m}/health`);return e.ok||await v(e,"API health check failed."),e.json()},async listDecks(e={}){const t=new URLSearchParams;for(const[s,n]of Object.entries(e))n!=null&&n!==""&&t.set(s,n);const s=t.toString()?`?${t.toString()}`:"",n=await fetch(`${m}/decks${s}`);return n.ok||await v(n,"Could not load decks."),n.json()},async search(e,t={}){if(e.length>l.MAX_SEARCH_QUERY_CHARS)throw new Error("Search query is too long.");const s=new URLSearchParams({q:e});for(const[n,e]of Object.entries(t))e!=null&&e!==""&&s.set(n,e);const n=await fetch(`${m}/search?${s.toString()}`);return n.ok||await v(n,"Search failed."),n.json()},async getDeck(e){const t=await fetch(`${m}/decks/${encodeURIComponent(e)}`);return t.ok||await v(t,"Deck not found."),t.json()},async exportDeck(e){const t=await fetch(`${m}/decks/${encodeURIComponent(e)}/export`);return t.ok||await v(t,"Could not download deck."),t.json()},async createDeck(e){const n=JSON.stringify(e);if(E(n)>l.MAX_REQUEST_BODY_BYTES)throw new Error("This deck is too large to upload.");const t=await fetch(`${m}/decks`,{method:"POST",headers:{"Content-Type":"application/json"},body:n});return t.ok||await v(t,"Upload failed."),t.json()}},_={englishLanguage:{name:"English Language",defaultColor:"#1B3A6B"},englishLiterature:{name:"English Literature",defaultColor:"#5FA820"},mathematics:{name:"Mathematics",defaultColor:"#E07B00"},furtherMathematics:{name:"Further Mathematics",defaultColor:"#C93A2A"},biology:{name:"Biology",defaultColor:"#27AE60"},chemistry:{name:"Chemistry",defaultColor:"#00ACC1"},physics:{name:"Physics",defaultColor:"#D32F2F"},computerScience:{name:"Computer Science",defaultColor:"#7B5EA7"},economics:{name:"Economics",defaultColor:"#C8960A"},french:{name:"French",defaultColor:"#C2185B"},geography:{name:"Geography",defaultColor:"#7B1FA2"},music:{name:"Music",defaultColor:"#C5A800"},misc:{name:"Miscellaneous",defaultColor:"#AAAAAA"}},y="misc";function F(e="id"){return`${e}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`}const M={load(){return{decks:state.decks,folders:state.folders,settings:state.settings}},save(){scheduleSave()},addDeckToDashboard(e,t,n,s){const i=(e.deck.cards||[]).map(e=>sanitizeCard({...e,id:e.id||F("c")})),o=sanitizeDeck({id:F("d"),name:e.deck.name||t.name,emoji:e.deck.emoji||"📖",image:e.deck.image||null,subject:n||y,folderId:s||null,color:"var(--blue)",cards:i});return state.decks.push(o),scheduleSave(),typeof renderSidebar=="function"&&renderSidebar(),o},createFolder(e,t,n){const s={id:F("f"),name:e,subjectKey:t||y,parentId:n||null};return state.folders.push(s),scheduleSave(),s}};function V(e,n){const s=r("div",{class:"sc-modal-overlay",onclick:e=>{e.target===s&&C()}}),o=r("div",{class:"sc-modal-box"},r("div",{class:"sc-modal-header"},r("h3",{class:"sc-modal-title"},e),r("button",{class:"sc-modal-close",onclick:()=>C()},"✕")),r("div",{class:"sc-modal-body"}));s.appendChild(o),t.appendChild(s),n(o.querySelector(".sc-modal-body")),t.classList.add("sc-modal-open")}function C(){i(".sc-modal-overlay").forEach(e=>e.remove()),t.classList.remove("sc-modal-open")}function $(e){V(`Add "${e.name}" to dashboard`,t=>{const c=M.load(),d=Array.isArray(c.folders)?c.folders:[],s=r("div",{class:"sc-modal-status"}),u=r("label",{class:"sc-field-label"},"Subject"),o=r("select",{class:"sc-select"});Object.entries(_).forEach(([t,n])=>{const s=r("option",{value:t},n.name);t===(e.subject&&_[e.subject]?e.subject:y)&&(s.selected=!0),o.appendChild(s)});const h=r("label",{class:"sc-field-label"},"Folder (optional)"),n=r("select",{class:"sc-select"});function l(){const e=o.value;n.innerHTML="",n.appendChild(r("option",{value:""},"— No folder (top level) —")),d.filter(t=>t.subjectKey===e).forEach(e=>{n.appendChild(r("option",{value:e.id},e.name))}),n.appendChild(r("option",{value:"__new__"},"+ New folder…"))}l(),o.addEventListener("change",l);const i=r("input",{type:"text",class:"sc-text-input",placeholder:"New folder name",style:"display:none;margin-top:8px"});n.addEventListener("change",()=>{i.style.display=n.value==="__new__"?"":"none"});const a=b("Add to dashboard","primary",{full:!0});a.addEventListener("click",async()=>{s.className="sc-modal-status",s.textContent="",a.disabled=!0;try{const t=o.value||y;let a=n.value||null;if(a==="__new__"){const e=i.value.trim();if(!e)throw i.focus(),new Error("Enter a name for the new folder.");const n=M.createFolder(e,t,null);a=n.id}const r=await f.exportDeck(e.id);try{typeof ensureSubjectKeyExists=="function"&&ensureSubjectKeyExists(t,_[t]?.name)}catch(e){console.warn("[SCIMA] community import: could not seed subject",t,e)}M.addDeckToDashboard(r,e,t,a),s.className="sc-modal-status ok",s.textContent=`Added to ${_[t]?.name||t} ✓`,setTimeout(()=>C(),900)}catch(e){s.className="sc-modal-status err",s.textContent=e.message}finally{a.disabled=!1}}),t.append(u,o,h,n,i,r("div",{style:"margin-top:16px"},a),s)})}const c={currentDeck:null,popularLoaded:!1,search:{query:"",sort:"relevance"},upload:{parsed:null,tags:[]}};function k(e){i(".screen").forEach(t=>{t.classList.toggle("active",t.id===`screen-${e}`)}),e==="search"&&n&&(n=null,o()),window.scrollTo({top:0,behavior:"smooth"})}e("back-to-search").addEventListener("click",()=>{k("search")});function S(e){return String(e??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function Z(e){if(e==null||e==="")return"";const s=typeof katex!="undefined",o=e=>e.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'"),n=(e,t)=>{const n=o(e);if(!s)return S(t?`$$${n}$$`:`$${n}$`);try{return katex.renderToString(n,{throwOnError:!1,displayMode:t})}catch{return S(t?`$$${n}$$`:`$${n}$`)}};let t=S(String(e));return t=t.replace(/\$\$([\s\S]+?)\$\$/g,(e,t)=>n(t,!0)),t=t.replace(/\$([^$\n]+?)\$/g,(e,t)=>n(t,!1)),t=t.replace(/\*\*([\s\S]+?)\*\*/g,"<strong>$1</strong>"),t=t.replace(/__([\s\S]+?)__/g,"<u>$1</u>"),t=t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g,"$1<em>$2</em>"),t=t.replace(/\n/g,"<br>"),t}function se(e,t){return e.innerHTML=Z(t),e}function P(e){if(!e)return"Unknown";const t=new Date(e);return Number.isNaN(t.getTime())?String(e):t.toLocaleDateString(0[0],{year:"numeric",month:"short",day:"numeric"})}function R(e){const t=[];e.subject&&t.push(w(e.subject)),e.level&&t.push(w(e.level)),e.examBoard&&t.push(w(e.examBoard));for(const n of e.tags||[]){if(t.length>=5)break;t.push(w(n))}return t}function J(e){const t=r("div",{class:"deck-card"},r("div",{class:"deck-emoji"},e.emoji||"📖"),r("div",{class:"deck-name"},e.name||"Untitled deck"),r("div",{class:"deck-desc"},e.description||"No description provided."),r("div",{class:"deck-meta"},r("span",{},`${e.cardCount??0} cards`),r("span",{},`⬇ ${e.downloads??0}`)),r("div",{class:"deck-tags"},R(e)));return t.addEventListener("click",()=>H(e.id)),t}function z(e,t,n){if(e.innerHTML="",!t?.length){n.style.display="";return}n.style.display="none";for(const n of t)e.appendChild(J(n))}async function N(){const n=e("popular-grid"),t=e("popular-empty");try{const e=await f.listDecks({sort:"popularity",limit:5,offset:0});z(n,e.items||[],t),c.popularLoaded=!0}catch{n.innerHTML="",t.style.display="",t.querySelector("div:nth-child(2)").textContent="Could not load community decks."}}async function T(){const d=e("search-input"),n=e("search-sort").value,s=d.value.trim(),o=e("search-results-section"),a=e("search-results"),i=e("search-empty"),r=e("results-count"),h=e("results-title");if(!s){o.style.display="none",e("popular-section").style.display="";return}if(s.length>l.MAX_SEARCH_QUERY_CHARS){u(null,"Search query is too long.",!0);return}const t=e("search-btn");if(t.disabled)return;t.disabled=!0,t.textContent="Searching…";try{const t=await f.search(s,{sort:n,limit:50,offset:0}),l=t.items||[];o.style.display="",e("popular-section").style.display="none",h.textContent=n==="relevance"?"Search results":n==="newest"?"Newest matches":"Most popular matches",typeof t.total=="number"?r.textContent=`${t.total} result${t.total===1?"":"s"}`:r.textContent=`${l.length} result${l.length===1?"":"s"}`,z(a,l,i),c.search.query=s,c.search.sort=n}catch(e){o.style.display="",a.innerHTML="",i.style.display="",i.querySelector("div:nth-child(2)").textContent=e.message||"Search failed."}finally{t.disabled=!1,t.textContent="Search"}}document.getElementById("search-btn").addEventListener("click",T),document.getElementById("search-sort").addEventListener("change",()=>{document.getElementById("search-input").value.trim()&&T()}),document.getElementById("search-input").addEventListener("keydown",e=>{e.key==="Enter"&&(e.preventDefault(),T())});function O(e){const t=new Error(e);return t.uploadValidation=!0,t}function D(e,t){const n=[];if(!e||typeof e!="object")return n.push("The selected file is not a valid SCIMA export."),n;if(!e.deck||typeof e.deck!="object"||!Array.isArray(e.deck.cards))return n.push("The selected file is not a recognized SCIMA deck export."),n;const s=e.deck;(typeof s.name!="string"||!s.name.trim())&&n.push("The deck does not contain a valid name."),s.name&&s.name.length>l.MAX_DECK_NAME_CHARS&&n.push("The deck name is too long."),s.cards.length>l.MAX_CARDS_PER_DECK&&n.push("This deck contains too many cards.");for(let e=0;e<s.cards.length;e++){const t=s.cards[e];if(!t||typeof t!="object"){n.push(`Card ${e+1} is invalid.`);break}for(const e of["front","back","hint"])if(typeof t[e]=="string"&&E(t[e])>l.MAX_CARD_TEXT_BYTES){n.push(`One or more cards contain too much text.`);break}if(n.length)break}E(t.description)>l.MAX_DESCRIPTION_BYTES&&n.push("The description is too long."),t.author.length>l.MAX_AUTHOR_CHARS&&n.push("The author name is too long."),t.tags.length>l.MAX_TAGS&&n.push("Too many tags were added.");for(const e of t.tags)if(e.length>l.MAX_TAG_CHARS){n.push("One or more tags are too long.");break}return n}function Q(e){const t={...e,cards:e.cards.map(e=>({...e,frontImage:null,backImage:null}))};return t}function x(){const t=e("upload-tags-list");t.innerHTML="",c.upload.tags.forEach((e,n)=>{const s=r("button",{type:"button",title:"Remove tag",style:`
            border:none;
            background:none;
            color:inherit;
            cursor:pointer;
            padding:0 0 0 3px;
            font:inherit;
          `},"×");s.addEventListener("click",()=>{c.upload.tags.splice(n,1),x()});const o=r("span",{class:"tag",style:`
            background:rgba(var(--blue-rgb),0.12);
            color:var(--blue);
            border:1px solid rgba(var(--blue-rgb),0.2);
          `},e,s);t.appendChild(o)})}function A(e){const t=String(e||"").trim().replace(/,$/,"").trim();if(!t)return;if(c.upload.tags.some(e=>e.toLowerCase()===t.toLowerCase()))return;if(c.upload.tags.length>=l.MAX_TAGS)return;if(t.length>l.MAX_TAG_CHARS)return;c.upload.tags.push(t),x()}const d=e("upload-tag-input");d.addEventListener("keydown",e=>{(e.key==="Enter"||e.key===",")&&(e.preventDefault(),A(d.value),d.value=""),e.key==="Backspace"&&!d.value&&c.upload.tags.length&&(c.upload.tags.pop(),x())}),d.addEventListener("blur",()=>{d.value.trim()&&(A(d.value),d.value="")});function u(t,n,s=!1){const o=e("upload-status");if(!o)return;o.className=s?"err":"ok",o.textContent=n||t||""}function I(t,n){const s=t.deck,i={description:e("upload-desc").value,author:e("upload-author").value.trim(),tags:[...c.upload.tags]},o=D(t,i);if(o.length)throw O(o.join(" "));c.upload.parsed=t,e("upload-file-name").textContent=n,e("upload-extracted").style.display="",e("upload-extracted-name").textContent=s.name,e("upload-extracted-meta").textContent=[`${s.cards.length} cards`,s.id?`source ID ${s.id}`:"no source ID",t.version!=null?`export v${t.version}`:"unknown export version",t.exportedAt?`exported ${P(t.exportedAt)}`:"unknown export date"].join(" · "),u(null,"Deck ready to upload.",!1)}async function B(t){if(!t)return;u(null,"",!1);const n=e("upload-file-name");n.textContent=t.name;try{const n=await t.text();let e;try{e=JSON.parse(n)}catch{throw O("Could not parse the selected file as JSON.")}if(typeof scimaClassify=="function"){const s=scimaClassify(e),n=scimaToFullDeck(e);if(!s||!n||s.kind!=="deck"&&s.kind!=="cards")throw O("The selected file is not a recognized SCIMA deck export.");(typeof n.name!="string"||!n.name.trim())&&(n.name=t.name.replace(/\.[^.]+$/,"")||"Imported deck"),e=s.kind==="cards"?scimaStamp({version:2,exportedAt:(new Date).toISOString(),deck:n,citedSources:[]},"share","deck"):{...e,deck:n}}else if(!e||!e.deck||!Array.isArray(e.deck.cards))throw O("The selected file is not a recognized SCIMA deck export.");I(e,t.name)}catch(t){c.upload.parsed=null,e("upload-extracted").style.display="none",u(null,t.message||"Could not read this deck.",!0)}}const p=e("upload-file"),h=e("upload-dropzone");h.addEventListener("click",e=>{if(e.target===p)return;q()}),p.addEventListener("change",()=>{B(p.files[0])}),h.addEventListener("dragover",e=>{e.preventDefault(),h.style.borderColor="rgba(var(--blue-rgb),0.6)",h.style.background="rgba(var(--blue-rgb),0.06)"}),h.addEventListener("dragleave",()=>{h.style.borderColor="",h.style.background=""}),h.addEventListener("drop",e=>{e.preventDefault(),h.style.borderColor="",h.style.background="";const t=e.dataTransfer.files[0];if(!t)return;try{const e=new DataTransfer;e.items.add(t),p.files=e.files}catch{}B(t)});const W={biology:"biology",chemistry:"chemistry",physics:"physics",mathematics:"mathematics",furtherMathematics:"mathematics",computerScience:"computer science",englishLanguage:"english",englishLiterature:"english",geography:"geography",french:"languages"};function U(e){const t={...e,cards:(e.cards||[]).map(e=>{if(!e.citation)return e;const t=(state.sources||[]).find(t=>t.id===e.citation.sourceId),n=e.citation.chapterId&&t?.chapters?.find(t=>t.id===e.citation.chapterId),s=t?String(t.content||"").slice(e.citation.charStart,e.citation.charEnd):"";return{...e,citation:{...e.citation,sourceName:t?.name||null,chapterTitle:n?.title||null,excerpt:s||null}}})},s=new Set(t.cards.map(e=>e.citation?.sourceId).filter(Boolean)),o=(state.sources||[]).filter(e=>s.has(e.id)),i=typeof scimaDeckToShare=="function"?scimaDeckToShare(t):(()=>{const e={...t};return delete e.id,delete e.pinned,e.cards=(e.cards||[]).map(e=>{const t={...e};return["id","ease","interval","reps","lapses","due","state","created","lastRated","suspended","leech"].forEach(e=>delete t[e]),t}),e})(),n={version:2,exportedAt:(new Date).toISOString(),deck:i,citedSources:o};return typeof scimaStamp=="function"?scimaStamp(n,"share","deck"):n}function K(t){if(!t)return;u(null,"",!1);try{I(U(t),`${t.emoji||"📚"} ${t.name} — from your decks`);const n=e("upload-subject"),s=W[t.subject];s&&!n.value&&(n.value=s)}catch(t){c.upload.parsed=null,e("upload-extracted").style.display="none",u(null,t.message||"Could not read this deck.",!0)}}function q(){if(typeof openDeckExplorerOverlay!="function"||!state.decks.length){p.click();return}openDeckExplorerOverlay({singleDeck:!0,title:"📂 Choose a Deck to Upload",confirmLabel:"Use this deck ✓",footerButtons:[{label:"📄 Choose a JSON file instead…",variant:"ghost",onClick(e){e(),p.click()}}],onConfirm(e){K(e)}})}document.getElementById("upload-btn").addEventListener("click",async()=>{const t=e("upload-btn");if(t.disabled)return;if(!c.upload.parsed){u(null,"Choose a valid SCIMA deck export first.",!0);return}d.value.trim()&&(A(d.value),d.value="");const n=e("upload-desc").value,s=e("upload-author").value.trim(),i=e("upload-subject").value,a=e("upload-level").value,r=e("upload-exam-board").value,l={description:n,author:s,tags:[...c.upload.tags]},o=D(c.upload.parsed,l);if(o.length){u(null,o.join(" "),!0);return}t.disabled=!0,t.textContent="Uploading…",u(null,"",!1);try{const t=Q(c.upload.parsed.deck),e={version:c.upload.parsed.version,exportedAt:c.upload.parsed.exportedAt,deck:{...t,subject:i,level:a,examBoard:r},citedSources:Array.isArray(c.upload.parsed.citedSources)?c.upload.parsed.citedSources:[],meta:{description:n,author:s,tags:[...c.upload.tags]}},o=await f.createDeck(typeof scimaStamp=="function"?scimaStamp(e,"share","deck"):e);u(null,`Uploaded ✓ "${o.name}"`,!1),Y(),await N()}catch(e){u(null,`Upload failed: ${e.message}`,!0)}finally{t.disabled=!1,t.textContent="Upload deck"}});function Y(){c.upload.parsed=null,c.upload.tags=[],p.value="",e("upload-file-name").textContent="Drop a SCIMA JSON export here",e("upload-extracted").style.display="none",e("upload-desc").value="",e("upload-author").value="",e("upload-subject").value="",e("upload-level").value="",e("upload-exam-board").value="",d.value="",x()}async function H(t){n=t,o();const s=e("deck-detail");s.innerHTML="",s.append(r("div",{style:`
          text-align:center;
          color:var(--muted);
          padding:50px 0;
        `},"Loading deck…")),k("deck");try{const e=await f.getDeck(t);c.currentDeck=e,X(e)}catch(e){s.innerHTML="",s.append(r("div",{class:"empty-state"},r("div",{class:"big-emoji"},"⚠️"),r("div",{},e.message),b("Back to decks","ghost",{small:!0,onclick:()=>k("search")})))}}function X(t){const s=e("deck-detail");s.innerHTML="";const n=t.export||null,o=n?.deck||null,i=r("div",{class:"deck-detail-header"},r("div",{class:"deck-detail-emoji"},o?.emoji||"📖"),r("div",{},r("h2",{class:"deck-detail-title"},t.name||"Untitled deck"),r("div",{class:"section-sub",style:"margin:0"},t.description||"No description provided."),r("div",{style:"margin-top:8px;display:flex;gap:5px;flex-wrap:wrap"},R(t)))),c=r("div",{class:"deck-detail-stats",style:"flex-wrap:wrap"},j(t.cardCount??"—","Cards"),j(t.downloads??0,"Downloads"),j(t.rating?.average!=null?Number(t.rating.average).toFixed(1):"—",t.rating?.count!=null?`${t.rating.count} ratings`:"Rating"),j(t.author||"—","Author")),l=r("div",{style:`
          margin:18px 0;
          padding:16px;
          background:var(--surface);
          border:1px solid var(--border);
          border-radius:var(--r-sm);
        `},g("Source deck ID",o?.id),g("Export version",n?.version),g("Exported",n?.exportedAt?P(n.exportedAt):null),g("Subject",t.subject),g("Level",t.level),g("Exam board",t.examBoard)),d=r("div",{style:"display:flex;gap:10px;flex-wrap:wrap"},(()=>{const e=b("⬇ Download deck","primary");return e.addEventListener("click",()=>te(t,e)),e})(),(()=>{const e=b("＋ Add to dashboard","ghost");return e.addEventListener("click",()=>$(t)),e})(),(()=>{const e=b("🔗 Copy link","ghost");return e.addEventListener("click",async()=>{const s=a(t.id),n=typeof copyTextToClipboard=="function"&&await copyTextToClipboard(s);typeof showToast=="function"&&showToast(n?"Deck link copied ✓":`Copy failed — link: ${s}`,n?2500:6e3),n&&(e.textContent="✓ Copied")}),e})());s.append(i,c,l,d)}function j(e,t){return r("div",{class:"stat-box"},r("div",{class:"stat-num"},String(e)),r("div",{class:"stat-lab"},t))}function g(e,t){return r("div",{style:`
        display:flex;
        justify-content:space-between;
        gap:20px;
        padding:5px 0;
        font-size:12px;
      `},r("span",{style:"color:var(--muted)"},e),r("span",{style:"text-align:right;font-weight:700;overflow-wrap:anywhere"},t==null||t===""?"—":String(t)))}function L(e){return String(e||"deck").trim().replace(/[^a-z0-9-_ ]/gi,"").replace(/\s+/g,"_").slice(0,80)||"deck"}function ee(e){const t=L(e.subject),n=L(e.name);return`${t||"misc"}__${n}.json`}async function te(e,t){if(t.disabled)return;t.disabled=!0,t.textContent="Downloading…";try{const s=await f.exportDeck(e.id),o=JSON.stringify(s,null,2),i=new Blob([o],{type:"application/json"}),n=URL.createObjectURL(i),t=document.createElement("a");t.href=n,t.download=ee(e),document.body.appendChild(t),t.click(),t.remove(),setTimeout(()=>URL.revokeObjectURL(n),1e3)}catch(e){alert(`Download failed: ${e.message}`)}finally{t.disabled=!1,t.textContent="⬇ Download deck"}}async function ne(){const t=e("api-dot"),n=e("api-label");t.classList.remove("ok");try{const e=await f.health();if(e?.status!=="ok")throw new Error("Unexpected health response");t.classList.add("ok"),n.textContent=`Server online at ${m}`}catch{n.textContent=`Server temporarily offline at ${m}`}}async function G(){await ne(),await N();const e=typeof scParseHash=="function"?scParseHash():null;e&&e.segs[0]==="community"&&e.segs[1]&&(s=e.raw,H(e.segs[1]))}return G}window.renderCommunity=function(e){n=null,e.classList.add("sc-root"),e.innerHTML=r,t=e;const s=c();typeof s=="function"&&s()}})()