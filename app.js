import './styles.css';
import { compile, createRuntime, formatDiagnostic, formatValue, starterCode, AlgoCompileError } from './compiler.js';

const state = {
  source: localStorage.getItem('algo.source') || starterCode(),
  input: localStorage.getItem('algo.input') || '5',
  breakpoints: new Set(JSON.parse(localStorage.getItem('algo.breakpoints') || '[]')),
  compiled: null,
  runtime: null,
  iterator: null,
  paused: false,
  activeLine: null,
  speed: 50,
  trace: []
};

const app = document.querySelector('#app');
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><div class="brand-mark">A</div><div><h1>Tunisian Algorithm Studio</h1><small>Algorithmique lycée tunisien · Compiler · Run · Debug</small></div></div>
    <div class="toolbar">
      <button class="btn" id="newBtn">Nouveau</button>
      <button class="btn optional" id="examplesBtn">Exemples</button>
      <button class="btn optional" id="formatBtn">Formater</button>
      <button class="btn" id="checkBtn">Vérifier</button>
      <button class="btn primary" id="debugBtn">Déboguer</button>
      <button class="btn accent" id="runBtn">▶ Exécuter</button>
      <button class="btn mobile-only" id="helpBtn">?</button>
    </div>
  </header>
  <main class="layout">
    <aside class="panel sidebar">
      <div class="panel-title">Navigateur <span id="lineCount">0 lignes</span></div>
      <div class="nav">
        <button class="active" data-nav="editor">⌘ Éditeur</button>
        <button data-nav="debug">◉ Débogueur</button>
        <button data-nav="help">▣ Syntaxe</button>
      </div>
      <div class="panel-title">Exemples</div>
      <div class="snippet-list">
        <div class="snippet" data-example="sum"><span class="dot"></span>Somme 1..N</div>
        <div class="snippet" data-example="array"><span class="dot"></span>Maximum d’un tableau</div>
        <div class="snippet" data-example="prime"><span class="dot"></span>Test de primalité</div>
        <div class="snippet" data-example="nested"><span class="dot"></span>Boucles imbriquées</div>
      </div>
    </aside>

    <section class="panel editor-panel">
      <div class="editor-toolbar">
        <span class="chip">algo</span><span id="compileStatus" class="status">Prêt</span>
        <div style="margin-left:auto;display:flex;gap:7px;align-items:center">
          <label class="chip" for="speed">Vitesse <input id="speed" type="range" min="0" max="100" value="50" style="width:85px;vertical-align:middle"></label>
          <button class="btn icon" id="clearBtn">Effacer</button>
        </div>
      </div>
      <div class="editor-area">
        <div class="line-numbers" id="lineNumbers">1</div>
        <div class="code-wrap"><div class="current-line" id="currentLine"></div><textarea id="code" class="code" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea></div>
      </div>
      <div class="bottom-panel">
        <div class="tabs"><button class="tab active" data-tab="console">Console</button><button class="tab" data-tab="diagnostics">Diagnostics</button><button class="tab" data-tab="input">Entrée</button></div>
        <div class="output" id="panelContent"></div>
      </div>
      <div class="statusbar"><span id="cursorPos">Ln 1, Col 1</span><span id="programState">Aucun programme exécuté</span></div>
    </section>

    <aside class="panel rightbar">
      <div class="debug-toolbar">
        <button class="btn" id="stepBtn">Step</button><button class="btn" id="continueBtn">Continue</button><button class="btn danger" id="stopBtn">Stop</button>
      </div>
      <div class="debug-section"><div class="panel-title">Variables <span id="stepCount">0</span></div><div id="variables"><div class="empty">Lance le débogueur pour voir l’état.</div></div></div>
      <div class="debug-section"><div class="panel-title">Pile d’exécution</div><div id="stack"><div class="empty">Aucun appel actif.</div></div></div>
      <div class="debug-section"><div class="panel-title">Trace <span id="traceCount">0</span></div><div id="trace"><div class="empty">La trace apparaîtra ici.</div></div></div>
    </aside>
  </main>
  <div class="dialog" id="dialog"><div class="dialog-card"><div class="dialog-head"><strong id="dialogTitle">Aide</strong><button class="btn" id="dialogClose">Fermer</button></div><div class="dialog-body" id="dialogBody"></div></div></div>
`;

const code = document.querySelector('#code');
const lineNumbers = document.querySelector('#lineNumbers');
const panelContent = document.querySelector('#panelContent');
const compileStatus = document.querySelector('#compileStatus');
const variables = document.querySelector('#variables');
const stack = document.querySelector('#stack');
const trace = document.querySelector('#trace');
const currentLine = document.querySelector('#currentLine');
const programState = document.querySelector('#programState');
const dialog = document.querySelector('#dialog');

code.value = state.source;

function renderLines() {
  const n = code.value.split('\n').length; lineNumbers.textContent = Array.from({length:n},(_,i)=>i+1).join('\n'); document.querySelector('#lineCount').textContent=`${n} ligne${n>1?'s':''}`;
}
function syncLineNumbers(){ lineNumbers.scrollTop=code.scrollTop; }
function updateCursor(){ const before=code.value.slice(0,code.selectionStart); const ln=before.split('\n').length; const col=before.length-before.lastIndexOf('\n'); document.querySelector('#cursorPos').textContent=`Ln ${ln}, Col ${col}`; }
function persist(){ localStorage.setItem('algo.source',code.value); localStorage.setItem('algo.input',state.input); localStorage.setItem('algo.breakpoints',JSON.stringify([...state.breakpoints])); }
function setStatus(msg, kind='') { compileStatus.textContent=msg; compileStatus.className=`status ${kind}`; }
function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');}
function output(lines, cls=''){ panelContent.innerHTML = `<div class="${cls}">${lines.map(escapeHtml).join('\n')}</div>`; }
function setTab(tab){
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  if(tab==='console') panelContent.innerHTML = state.runtime ? `<span class="ok">${escapeHtml(state.runtime.output.join(''))}</span>` : `<span class="status">Console prête.</span>`;
  if(tab==='input') panelContent.innerHTML=`<textarea id="inputBox" style="width:100%;min-height:150px;background:#09101d;color:#eef4ff;border:1px solid #26334e;border-radius:9px;padding:10px;font:12px/1.5 Consolas,monospace" placeholder="Une valeur par espace ou par ligne">${escapeHtml(state.input)}</textarea><p class="status">Lire(...) consomme les valeurs dans l’ordre.</p>`;
  if(tab==='diagnostics') panelContent.innerHTML=state.diagHtml || '<span class="status good">Aucune erreur.</span>';
  const box=document.querySelector('#inputBox'); if(box) box.addEventListener('input',()=>{state.input=box.value;persist();});
}

function diagnosticsError(err){ state.diagHtml=`<span class="err">✕ ${escapeHtml(formatDiagnostic(err))}</span>`; setTab('diagnostics'); setStatus('Erreur', 'bad'); programState.textContent='Compilation échouée'; }
function diagnosticsOk(){state.diagHtml='<span class="ok">✓ Syntaxe valide. Le programme peut être exécuté.</span>'; setTab('diagnostics'); setStatus('Valide','good');}
function compileNow(){
  try { state.compiled=compile(code.value); diagnosticsOk(); return state.compiled; } catch(err){ state.compiled=null; diagnosticsError(err); return null; }
}
function resetDebug(){ state.runtime=null; state.iterator=null; state.paused=false; state.activeLine=null; currentLine.style.display='none'; state.trace=[]; variables.innerHTML='<div class="empty">Lance le débogueur pour voir l’état.</div>'; stack.innerHTML='<div class="empty">Aucun appel actif.</div>'; trace.innerHTML='<div class="empty">La trace apparaîtra ici.</div>'; document.querySelector('#stepCount').textContent='0'; document.querySelector('#traceCount').textContent='0'; }
function renderDebug(snap){
  const entries=Object.entries(snap.vars||{}); variables.innerHTML=entries.length?entries.map(([k,v])=>`<div class="kv"><span class="key">${escapeHtml(k)}</span><span class="value">${escapeHtml(formatValue(v))}</span></div>`).join(''):'<div class="empty">Aucune variable.</div>';
  stack.innerHTML=(snap.stack||[]).map((x,i)=>`<div class="stack-item ${i===snap.stack.length-1?'active':''}">${escapeHtml(x)}</div>`).join('')||'<div class="empty">Vide.</div>';
  document.querySelector('#stepCount').textContent=String(snap.steps||0); document.querySelector('#traceCount').textContent=String(state.trace.length);
  trace.innerHTML=state.trace.slice(-120).reverse().map(x=>`<div class="trace-row"><span class="ln">${x.line||''}</span><span>${escapeHtml(x.text||'')}</span></div>`).join('')||'<div class="empty">Aucun pas exécuté.</div>';
  state.activeLine=snap.line||null; if(state.activeLine){ currentLine.style.display='block'; currentLine.style.top=((state.activeLine-1)*21+14)+'px'; code.focus(); const start=getLineStart(state.activeLine); code.setSelectionRange(start,start); }
  programState.textContent=`Débogage · ligne ${snap.line||'-'} · étape ${snap.steps||0}`;
}
function getLineStart(line){ const a=code.value.split('\n'); let p=0; for(let i=0;i<line-1;i++) p+=a[i].length+1; return p; }
async function ensureRuntime(){
  if(!state.compiled && !compileNow()) return false;
  if(!state.runtime){ state.compiled.__sourceLines=code.value.split('\n'); state.runtime=createRuntime(state.compiled,{inputText:state.input,maxSteps:100000}); state.iterator=state.runtime.iterator(); }
  return true;
}
async function step(){
  if(!await ensureRuntime()) return;
  try { const r=await state.iterator.next(); if(r.done){ state.paused=false; currentLine.style.display='none'; programState.textContent='Programme terminé'; setStatus('Terminé','good'); setTab('console'); panelContent.innerHTML=`<span class="ok">${escapeHtml(state.runtime.output.join(''))}</span>`; return false; } state.paused=true; state.trace.push({line:r.value.line,text:state.compiled.__sourceLines?.[r.value.line-1]||''}); renderDebug(r.value); return true; }
  catch(err){ diagnosticsError(err); programState.textContent=`Arrêt · ${err.message}`; return false; }
}
async function runToEnd(){
  if(!await ensureRuntime()) return;
  setStatus('Exécution…');
  while(true){
    const has=await step(); if(!has) break;
    if(state.activeLine && state.breakpoints.has(state.activeLine)) { setStatus(`Breakpoint ligne ${state.activeLine}`,'good'); break; }
    if(state.runtime?.steps>100000) break;
    if(state.speed<100) await new Promise(r=>setTimeout(r,Math.max(0,100-state.speed)));
  }
  panelContent.innerHTML=`<span class="ok">${escapeHtml(state.runtime.output.join(''))}</span>`; programState.textContent=state.paused?'En pause sur breakpoint':'Programme terminé';
}
function toggleBreakAtCurrent(){
  const line=Math.max(1,code.value.slice(0,code.selectionStart).split('\n').length); if(state.breakpoints.has(line)) state.breakpoints.delete(line); else state.breakpoints.add(line); persist();
  setStatus(`${state.breakpoints.has(line)?'Breakpoint ajouté':'Breakpoint retiré'} · ligne ${line}`); // visual line-number marker
  renderLinesWithBreakpoints();
}
function renderLinesWithBreakpoints(){
  const nums=code.value.split('\n').map((_,i)=>state.breakpoints.has(i+1)?`● ${i+1}`:`  ${i+1}`); lineNumbers.textContent=nums.join('\n');
}
function formatSource(){
  const lines=code.value.split('\n').map(x=>x.trim()).filter((x,i,a)=>x||a[i-1]);
  let indent=0; const out=[];
  for(const line of lines){ const u=line.toUpperCase(); if(/^(FIN|FINSI|FINPOUR|FINTANTQUE|JUSQUA|SINON|SINONSI)\b/.test(u)) indent=Math.max(0,indent-1); out.push('  '.repeat(indent)+line); if(/\b(DEBUT|ALORS|FAIRE|SINON|SINONSI|REPETER)\b/i.test(line)&&!/^FIN/i.test(line)&&!/JUSQUA/i.test(line)) indent++; } code.value=out.join('\n'); renderLinesWithBreakpoints(); persist();
}
function openDialog(title,body){document.querySelector('#dialogTitle').textContent=title;document.querySelector('#dialogBody').innerHTML=body;dialog.classList.add('open');}

const examples={
 sum:`Algorithme Somme\nVariables\n  n, i, somme : Entier\nDebut\n  Lire(n)\n  somme := 0\n  Pour i de 1 à n Faire\n    somme := somme + i\n  FinPour\n  EcrireL("Somme = ", somme)\nFin`,
 array:`Algorithme Maximum\nVariables\n  T : Tableau[1..5] de Entier\n  i, max : Entier\nDebut\n  T[1] := 12\n  T[2] := 7\n  T[3] := 19\n  T[4] := 3\n  T[5] := 14\n  max := T[1]\n  Pour i de 2 à 5 Faire\n    Si T[i] > max Alors\n      max := T[i]\n    Finsi\n  FinPour\n  EcrireL("Maximum = ", max)\nFin`,
 prime:`Algorithme Premier\nVariables\n  n, d : Entier\n  premier : Booleen\nDebut\n  Lire(n)\n  premier := VRAI\n  Si n < 2 Alors\n    premier := FAUX\n  Sinon\n    d := 2\n    TantQue d * d <= n Faire\n      Si n MOD d = 0 Alors\n        premier := FAUX\n      Finsi\n      d := d + 1\n    FinTantQue\n  Finsi\n  EcrireL("Premier : ", premier)\nFin`,
 nested:`Algorithme Triangle\nVariables\n  i, j : Entier\nDebut\n  Pour i de 1 à 5 Faire\n    Pour j de 1 à i Faire\n      Ecrire("*")\n    FinPour\n    EcrireL("")\n  FinPour\nFin`
};

code.addEventListener('input',()=>{state.source=code.value;renderLinesWithBreakpoints();persist();updateCursor();});
code.addEventListener('scroll',syncLineNumbers);
code.addEventListener('click',updateCursor); code.addEventListener('keyup',updateCursor); code.addEventListener('select',updateCursor);
code.addEventListener('keydown',e=>{ if(e.key==='Tab'){e.preventDefault(); const s=code.selectionStart; code.value=code.value.slice(0,s)+'  '+code.value.slice(code.selectionEnd); code.selectionStart=code.selectionEnd=s+2; renderLinesWithBreakpoints();persist(); } if(e.key==='F9'){e.preventDefault();toggleBreakAtCurrent();} if(e.key==='F5'){e.preventDefault();runToEnd();} });

document.querySelector('#checkBtn').onclick=()=>compileNow();
document.querySelector('#runBtn').onclick=()=>{resetDebug(); runToEnd();};
document.querySelector('#debugBtn').onclick=async()=>{resetDebug(); if(await ensureRuntime()) { setStatus('Débogueur prêt','good'); await step(); } };
document.querySelector('#stepBtn').onclick=step;
document.querySelector('#continueBtn').onclick=runToEnd;
document.querySelector('#stopBtn').onclick=()=>{resetDebug(); setStatus('Arrêté'); programState.textContent='Débogage arrêté';};
document.querySelector('#clearBtn').onclick=()=>{code.value='';renderLinesWithBreakpoints();persist();setStatus('Éditeur vide');};
document.querySelector('#newBtn').onclick=()=>{resetDebug();code.value='Algorithme Nouveau\nVariables\n\nDebut\n\nFin';renderLinesWithBreakpoints();persist();};
document.querySelector('#formatBtn').onclick=()=>formatSource();
document.querySelector('#examplesBtn').onclick=()=>openDialog('Exemples','<p>Choisis un exemple depuis le panneau de gauche. Ils couvrent les boucles, conditions et tableaux.</p>');
document.querySelector('#helpBtn').onclick=()=>openHelp();
document.querySelector('#dialogClose').onclick=()=>dialog.classList.remove('open');
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.classList.remove('open');});
document.querySelector('#speed').oninput=e=>{state.speed=Number(e.target.value);};
document.querySelectorAll('.tab').forEach(x=>x.onclick=()=>setTab(x.dataset.tab));
document.querySelectorAll('.snippet').forEach(x=>x.onclick=()=>{code.value=examples[x.dataset.example];state.breakpoints.clear();resetDebug();renderLinesWithBreakpoints();persist();setStatus('Exemple chargé');});
document.querySelectorAll('[data-nav]').forEach(x=>x.onclick=()=>{if(x.dataset.nav==='help')openHelp();else if(x.dataset.nav==='debug')document.querySelector('#stepBtn').focus();});

function openHelp(){openDialog('Syntaxe supportée',`
  <h3>Structure</h3><p><b>Algorithme</b> → <b>Variables</b> → <b>Debut</b> → instructions → <b>Fin</b>.</p>
  <h3>Types</h3><div class="chip-row"><span class="chip">Entier</span><span class="chip">Réel</span><span class="chip">Booléen</span><span class="chip">Chaîne</span><span class="chip">Tableau[1..N] de Entier</span></div>
  <h3>Contrôle</h3><p><b>Si / SinonSi / Sinon / Finsi</b>, <b>Pour i de 1 à N Faire / FinPour</b>, <b>TantQue ... Faire / FinTantQue</b>, <b>Répéter / JusquA</b>.</p>
  <h3>Entrées / sorties</h3><p><b>Lire(x)</b>, <b>Ecrire(...)</b>, <b>EcrireL(...)</b>. Les entrées sont séparées par des espaces ou des lignes dans l’onglet Entrée.</p>
  <h3>Opérateurs</h3><p>+ − × /, <b>DIV</b>, <b>MOD</b>, =, &lt;&gt;, &lt;, &lt;=, &gt;, &gt;=, <b>ET</b>, <b>OU</b>, <b>NON</b>.</p>
  <h3>Débogage</h3><p><b>F9</b> ajoute/retire un breakpoint à la ligne courante. <b>F5</b> lance l’exécution. Step avance instruction par instruction et expose les variables et la trace.</p>
`);}

renderLinesWithBreakpoints(); updateCursor(); setTab('console');

window.addEventListener('beforeunload',persist);
