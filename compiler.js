/*
 * Tunisian Algorithm Studio
 * Client-side interpreter for common Tunisian lycée algorithmique syntax.
 * It intentionally uses a small, deterministic parser instead of JavaScript eval.
 */

const KEYWORDS = new Set([
  'ALGORITHME','ALGORITHM','VARIABLES','VAR','DEBUT','BEGIN','FIN','END','ENTIER','INTEGER','REEL','REAL','BOOLEEN','BOOLEAN','CHAINE','STRING','CARACTERE','CHAR','TABLEAU','ARRAY','DE','A','TO','DANS','IN','SI','THEN','ALORS','SINON','ELSE','FINSI','FINSI','POUR','FOR','FAIRE','DO','FINPOUR','TANTQUE','WHILE','FINTANTQUE','REPETER','REPEAT','JUSQUA','UNTIL','PROCEDURE','PROCEDURE','FONCTION','FUNCTION','RETOURNER','RETURN','FINPROCEDURE','FINFONCTION','ET','AND','OU','OR','NON','NOT','VRAI','TRUE','FAUX','FALSE','DIV','MOD','PAS','STEP','LIRE','READ','ECRIRE','WRITE','ECRIREL','WRITELN','AFFICHER','OUTPUT'
]);

function normalizeWord(s) {
  return String(s).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeSource(source) {
  return source
    .replace(/\r\n?/g, '\n')
    .replace(/[“”«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/←/g, ':=')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/≠/g, '<>');
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ((c === '"' || c === "'") && line[i - 1] !== '\\') quote = quote === c ? null : quote || c;
    if (!quote && c === '/' && line[i + 1] === '/') return line.slice(0, i);
    if (!quote && c === '#') return line.slice(0, i);
  }
  return line;
}

export class AlgoCompileError extends Error {
  constructor(message, line = 0, column = 0, code = 'SYNTAX') {
    super(message); this.name = 'AlgoCompileError'; this.line = line; this.column = column; this.code = code;
  }
}

function tokenizeExpr(text, line, columnOffset = 0) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      const quote = c; const start = i++; let value = '';
      while (i < text.length) {
        if (text[i] === '\\' && i + 1 < text.length) { value += text[i + 1]; i += 2; continue; }
        if (text[i] === quote) { i++; break; }
        value += text[i++];
      }
      if (text[i - 1] !== quote) throw new AlgoCompileError('Chaîne non terminée.', line, columnOffset + start + 1);
      out.push({ type:'string', value, at:start }); continue;
    }
    const num = text.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (num) { out.push({type:'number', value:Number(num[0]), at:i}); i += num[0].length; continue; }
    const ident = text.slice(i).match(/^[A-Za-z_À-ÿ][A-Za-z0-9_À-ÿ]*/);
    if (ident) { const value = ident[0]; out.push({type:'id', value, at:i}); i += value.length; continue; }
    const two = text.slice(i, i+2);
    if (['<=','>=','<>',':=','=='].includes(two)) { out.push({type:'op', value:two, at:i}); i += 2; continue; }
    if ('+-*/%^=<>(),[]'.includes(c)) { out.push({type:'op', value:c, at:i}); i++; continue; }
    throw new AlgoCompileError(`Caractère inattendu « ${c} » dans l'expression.`, line, columnOffset + i + 1);
  }
  out.push({type:'eof', value:'', at:text.length});
  return out;
}

const PRECEDENCE = {
  'OU':1,'OR':1,'||':1,
  'ET':2,'AND':2,'&&':2,
  '=':3,'==':3,'<>':3,'!=':3,'<':3,'<=':3,'>':3,'>=':3,
  '+':4,'-':4,
  '*':5,'/':5,'DIV':5,'MOD':5,'%':5,
  '^':6
};

function parseExpressionText(text, line, vars) {
  const tokens = tokenizeExpr(text, line);
  let p = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];
  const accept = value => normalizeWord(peek().value) === normalizeWord(value) ? take() : null;

  function parsePrimary() {
    const t = take();
    if (t.type === 'number' || t.type === 'string') return {kind:'literal', value:t.value};
    if (t.type === 'id') {
      const word = normalizeWord(t.value);
      if (word === 'VRAI' || word === 'TRUE') return {kind:'literal', value:true};
      if (word === 'FAUX' || word === 'FALSE') return {kind:'literal', value:false};
      if (word === 'PI') return {kind:'call', name:'PI', args:[]};
      if (accept('(')) {
        const args = [];
        if (!accept(')')) { do { args.push(parseBinary(0)); } while (accept(',')); if (!accept(')')) throw new AlgoCompileError('« ) » attendu.', line, t.at + 1); }
        return {kind:'call', name:t.value, args};
      }
      let node = {kind:'variable', name:t.value};
      while (accept('[')) {
        const index = parseBinary(0);
        if (!accept(']')) throw new AlgoCompileError('« ] » attendu.', line, t.at + 1);
        node = {kind:'index', array:node, index};
      }
      return node;
    }
    if (t.value === '(') { const e = parseBinary(0); if (!accept(')')) throw new AlgoCompileError('« ) » attendu.', line, t.at + 1); return e; }
    throw new AlgoCompileError('Expression invalide.', line, t.at + 1);
  }
  function parseUnary() {
    const t = peek(); const n = normalizeWord(t.value);
    if (['+','-'].includes(t.value) || n === 'NON' || n === 'NOT') { take(); return {kind:'unary', op:n, expr:parseUnary()}; }
    return parsePrimary();
  }
  function parseBinary(minPrec) {
    let left = parseUnary();
    while (true) {
      const opToken = peek(); const op = normalizeWord(opToken.value); const prec = PRECEDENCE[op] ?? PRECEDENCE[opToken.value];
      if (prec === undefined || prec < minPrec) break;
      take();
      const right = parseBinary(prec + (op === '^' ? 0 : 1));
      left = {kind:'binary', op, left, right};
    }
    return left;
  }
  const node = parseBinary(0);
  if (peek().type !== 'eof') throw new AlgoCompileError(`Expression inattendue près de « ${peek().value} ».`, line, peek().at + 1);
  return node;
}

function parseLValue(text, line) {
  const tokens = tokenizeExpr(text, line);
  if (tokens[0].type !== 'id') throw new AlgoCompileError('Une affectation doit commencer par une variable.', line, 1);
  const base = {kind:'variable', name:tokens[0].value}; let i = 1;
  if (tokens[i]?.value === '[') {
    i++; const start = i;
    let depth = 1;
    while (i < tokens.length && depth) { if (tokens[i].value === '[') depth++; if (tokens[i].value === ']') depth--; i++; }
    if (depth) throw new AlgoCompileError('« ] » attendu dans le tableau.', line, tokens[start - 1]?.at + 1);
    const exprText = text.slice(tokens[start].at, tokens[i-1].at);
    if (tokens[i]?.type !== 'eof') throw new AlgoCompileError('Affectation invalide.', line, tokens[i].at + 1);
    return {kind:'index', array:base, index:parseExpressionText(exprText, line)};
  }
  if (tokens[i]?.type !== 'eof') throw new AlgoCompileError('Affectation invalide.', line, tokens[i].at + 1);
  return base;
}

class LineParser {
  constructor(source) {
    this.raw = normalizeSource(source).split('\n');
    this.lines = this.raw.map((r, idx) => ({num:idx+1, text:stripComment(r).trim(), raw:r}));
    this.i = 0; this.decls = new Map(); this.routines = new Map();
  }
  current() { return this.lines[this.i]; }
  next() { return this.lines[this.i++]; }
  fail(message, line = this.current()?.num || this.raw.length) { throw new AlgoCompileError(message, line, 1); }
  skipEmpty() { while (this.i < this.lines.length && !this.current().text) this.i++; }
  parse() {
    this.skipEmpty();
    if (/^(ALGORITHME|ALGORITHM)\b/i.test(this.current()?.text || '')) this.next();
    this.skipEmpty();
    const declarations = this.parseDeclarations();
    this.skipEmpty();
    if (!this.current() || !/^(DEBUT|BEGIN)\b/i.test(this.current().text)) this.fail('« DEBUT » attendu.');
    this.next();
    const body = this.parseBlock(new Set(['FIN','END']), 'programme');
    this.skipEmpty();
    if (!this.current() || !/^(FIN|END)\b/i.test(this.current().text)) this.fail('« FIN » attendu.');
    return {kind:'program', declarations, body, routines:this.routines};
  }
  parseDeclarations() {
    const decls = [];
    if (/^(VARIABLES|VAR)\b/i.test(this.current()?.text || '')) this.next();
    while (this.i < this.lines.length) {
      this.skipEmpty(); const line = this.current(); if (!line) break;
      if (/^(DEBUT|BEGIN|PROCEDURE|FONCTION|FUNCTION)\b/i.test(line.text)) break;
      const m = line.text.match(/^([A-Za-z_À-ÿ][\wÀ-ÿ]*(?:\s*,\s*[A-Za-z_À-ÿ][\wÀ-ÿ]*)*)\s*:\s*(.+)$/i);
      if (!m) break;
      const names = m[1].split(',').map(s=>s.trim()); const typeText = m[2].trim();
      const arr = typeText.match(/^(?:TABLEAU|ARRAY)\s*\[\s*(-?\d+)\s*\.\.\s*(-?\d+)\s*\]\s+DE\s+(.+)$/i);
      const type = arr ? {kind:'array', lower:Number(arr[1]), upper:Number(arr[2]), element:normalizeWord(arr[3].trim())} : {kind:'scalar', name:normalizeWord(typeText.replace(/\s+.*$/,''))};
      for (const name of names) { decls.push({name, type, line:line.num}); this.decls.set(normalizeWord(name), {name, type}); }
      this.next();
    }
    return decls;
  }
  parseBlock(endMatchers, context) {
    const body = [];
    while (this.i < this.lines.length) {
      this.skipEmpty(); const line = this.current(); if (!line) break;
      if ([...endMatchers].some(k => new RegExp(`^${k}\\b`, 'i').test(line.text))) break;
      body.push(this.parseStatement(context));
    }
    return body;
  }
  parseStatement(context) {
    const line = this.current(); const t = line.text;
    let m;
    if (/^SI\b/i.test(t)) return this.parseIf();
    if (/^POUR\b/i.test(t)) return this.parseFor();
    if (/^TANTQUE\b/i.test(t)) return this.parseWhile();
    if (/^REPETER\b/i.test(t)) return this.parseRepeat();
    if (/^(LIRE|READ)\b/i.test(t)) { this.next(); return {kind:'read', args:this.parseArgs(t, /^(LIRE|READ)\b/i, line, false), line:line.num}; }
    if (/^(ECRIREL|WRITELN)\b/i.test(t)) { this.next(); return {kind:'write', newline:true, args:this.parseArgs(t, /^(ECRIREL|WRITELN)\b/i, line, true), line:line.num}; }
    if (/^(ECRIRE|WRITE|AFFICHER|OUTPUT)\b/i.test(t)) { this.next(); return {kind:'write', newline:false, args:this.parseArgs(t, /^(ECRIRE|WRITE|AFFICHER|OUTPUT)\b/i, line, true), line:line.num}; }
    if (/^(RETOURNER|RETURN)\b/i.test(t)) { this.next(); const x=t.replace(/^(RETOURNER|RETURN)\b/i,'').trim(); return {kind:'return', expr:x ? parseExpressionText(x,line.num) : null, line:line.num}; }
    if (/^\w+\s*\(/.test(t)) { this.next(); const call = this.parseCallStatement(t,line); return call; }
    if (t.includes(':=') || t.includes('←') || /^[A-Za-z_À-ÿ][\wÀ-ÿ]*(?:\s*\[[^\]]+\])?\s*=/.test(t)) {
      this.next(); const split = t.match(/^(.+?)\s*(?::=|←|=)\s*(.+)$/); if (!split) this.fail('Affectation invalide.');
      return {kind:'assign', target:parseLValue(split[1].trim(),line.num), expr:parseExpressionText(split[2].trim(),line.num), line:line.num};
    }
    this.fail(`Instruction inconnue : « ${t} ».`);
  }
  parseArgs(text, regex, line, expressions = false) {
    let rest=text.replace(regex,'').trim(); if (rest.startsWith('(') && rest.endsWith(')')) rest=rest.slice(1,-1).trim();
    if (!rest) return [];
    return splitTopLevel(rest, ',').map(x => expressions ? parseExpressionText(x.trim(),line.num) : parseLValue(x.trim(),line.num));
  }
  parseCallStatement(text,line) {
    const p=text.indexOf('('); if (!text.endsWith(')')) this.fail('Appel de procédure invalide.',line.num);
    const name=text.slice(0,p).trim(); const inside=text.slice(p+1,-1).trim();
    const args=inside?splitTopLevel(inside,',').map(x=>parseExpressionText(x.trim(),line.num)):[];
    return {kind:'callstmt', name, args, line:line.num};
  }
  parseIf() {
    const start=this.next(); let condition = start.text.replace(/^SI\b/i,'').replace(/\bALORS\b.*$/i,'').trim();
    if (!condition) this.fail('Condition manquante après SI.',start.num);
    const branches=[]; let thenBody=this.parseBlock(new Set(['SINON','SINONSI','FINSI','ELSE']), 'if'); branches.push({condition:parseExpressionText(condition,start.num),body:thenBody,line:start.num});
    while (this.i < this.lines.length && /^SINONSI\b/i.test(this.current().text)) {
      const l=this.next(); const c=l.text.replace(/^SINONSI\b/i,'').replace(/\bALORS\b.*$/i,'').trim();
      branches.push({condition:parseExpressionText(c,l.num),body:this.parseBlock(new Set(['SINON','SINONSI','FINSI','ELSE']),'elseif'),line:l.num});
    }
    let elseBody=[];
    if (this.i < this.lines.length && /^(SINON|ELSE)\b/i.test(this.current().text)) { this.next(); elseBody=this.parseBlock(new Set(['FINSI']),'else'); }
    if (!this.current() || !/^FINSI\b/i.test(this.current().text)) this.fail('« FINSI » attendu.');
    this.next(); return {kind:'if',branches,elseBody,line:start.num};
  }
  parseFor() {
    const line=this.next(); const m=line.text.match(/^POUR\s+([A-Za-z_À-ÿ][\wÀ-ÿ]*)\s+DE\s+(.+?)\s+(?:A|À|TO)\s+(.+?)(?:\s+(?:PAS|STEP)\s+(.+?))?\s+FAIRE\s*$/i);
    if (!m) this.fail('Syntaxe Pour invalide. Exemple : POUR i DE 1 A 10 FAIRE',line.num);
    const body=this.parseBlock(new Set(['FINPOUR']),'for'); if (!this.current()) this.fail('« FINPOUR » attendu.'); this.next();
    return {kind:'for', variable:m[1], start:parseExpressionText(m[2],line.num), end:parseExpressionText(m[3],line.num), step:parseExpressionText(m[4]||'1',line.num), body, line:line.num};
  }
  parseWhile() {
    const line=this.next(); const c=line.text.replace(/^TANTQUE\b/i,'').replace(/\bFAIRE\b.*$/i,'').trim(); if(!c) this.fail('Condition manquante.',line.num);
    const body=this.parseBlock(new Set(['FINTANTQUE']),'while'); if(!this.current()) this.fail('« FINTANTQUE » attendu.'); this.next(); return {kind:'while',condition:parseExpressionText(c,line.num),body,line:line.num};
  }
  parseRepeat() {
    const line=this.next(); const body=this.parseBlock(new Set(['JUSQUA']),'repeat'); if(!this.current()) this.fail('« JUSQUA » attendu.'); const end=this.next(); const c=end.text.replace(/^JUSQUA\b/i,'').trim(); if(!c) this.fail('Condition manquante après JUSQUA.',end.num);
    return {kind:'repeat',body,condition:parseExpressionText(c,end.num),line:line.num};
  }
}

function splitTopLevel(text, sep=',') {
  const chunks=[]; let start=0, depth=0, quote=null;
  for(let i=0;i<text.length;i++) { const c=text[i]; if((c==='"'||c==="'") && text[i-1]!=='\\') quote=quote===c?null:quote||c; if(quote) continue; if('(['.includes(c)) depth++; if(')]'.includes(c)) depth--; if(c===sep && depth===0){chunks.push(text.slice(start,i)); start=i+1;} }
  chunks.push(text.slice(start)); return chunks;
}

function defaultValue(type) {
  if (type.kind === 'array') { const len = type.upper-type.lower+1; return {__array:true,lower:type.lower,upper:type.upper,values:Array(Math.max(0,len)).fill(0).map(()=>defaultScalar(type.element))}; }
  return defaultScalar(type.name);
}
function defaultScalar(t) { if (t.includes('REEL') || t.includes('REAL')) return 0; if (t.includes('BOOLEEN')||t.includes('BOOLEAN')) return false; if (t.includes('CHAINE')||t.includes('STRING')||t.includes('CHAR')) return ''; return 0; }

function truth(v){ return !!v; }
function scalar(v){ return v?.__array ? v : v; }

const BUILTINS = {
  PI: () => Math.PI,
  ABS: ([x]) => Math.abs(Number(x)),
  RACINE: ([x]) => Math.sqrt(Number(x)),
  SQRT: ([x]) => Math.sqrt(Number(x)),
  CARRE: ([x]) => Number(x)*Number(x),
  PUISSANCE: ([a,b]) => Math.pow(Number(a),Number(b)),
  POWER: ([a,b]) => Math.pow(Number(a),Number(b)),
  MAX: (a) => Math.max(...a.map(Number)),
  MIN: (a) => Math.min(...a.map(Number)),
  ENT: ([x]) => Math.trunc(Number(x)),
  TRONQUE: ([x]) => Math.trunc(Number(x)),
  ARRONDI: ([x]) => Math.round(Number(x)),
  LONGUEUR: ([x]) => String(x).length,
  LENGTH: ([x]) => String(x).length,
  HASARD: ([x]) => Math.floor(Math.random()*Number(x))+1,
  ALEA: ([x]) => Math.floor(Math.random()*Number(x))+1,
  MODULO: ([a,b]) => Number(a)%Number(b)
};

export function createRuntime(program, {inputText='', maxSteps=100000}={}) {
  const vars = new Map();
  for (const d of program.declarations) vars.set(normalizeWord(d.name), defaultValue(d.type));
  const inputs = inputText.split(/\s+/).filter(Boolean); let inputIndex=0;
  const output=[]; const trace=[]; let steps=0; let returnSignal=null;
  const callStack=['programme'];
  const get = name => { const key=normalizeWord(name); if(!vars.has(key)) throw runtimeError(`Variable « ${name} » inconnue.`); return vars.get(key); };
  const set = (name,v) => { const key=normalizeWord(name); if(!vars.has(key)) throw runtimeError(`Variable « ${name} » inconnue.`); vars.set(key,v); };
  function runtimeError(msg, line=0){ const e=new Error(msg); e.code='RUNTIME'; e.line=line; return e; }
  function evalExpr(n){
    switch(n.kind){
      case 'literal': return n.value;
      case 'variable': return get(n.name);
      case 'index': { const arr=evalExpr(n.array); if(!arr?.__array) throw runtimeError('La valeur indexée n’est pas un tableau.'); const idx=Number(evalExpr(n.index)); if(!Number.isInteger(idx)||idx<arr.lower||idx>arr.upper) throw runtimeError(`Indice ${idx} hors limites [${arr.lower}..${arr.upper}].`); return arr.values[idx-arr.lower]; }
      case 'unary': { const x=evalExpr(n.expr); if(n.op==='-') return -Number(x); if(n.op==='+') return Number(x); return !truth(x); }
      case 'binary': { const a=evalExpr(n.left), b=evalExpr(n.right); switch(n.op){ case '+': return (typeof a==='string'||typeof b==='string')?String(a)+String(b):Number(a)+Number(b); case '-':return Number(a)-Number(b); case '*':return Number(a)*Number(b); case '/': if(Number(b)===0) throw runtimeError('Division par zéro.'); return Number(a)/Number(b); case 'DIV': if(Number(b)===0) throw runtimeError('Division entière par zéro.'); return Math.trunc(Number(a)/Number(b)); case 'MOD': case '%': if(Number(b)===0) throw runtimeError('Modulo par zéro.'); return Number(a)%Number(b); case '^':return Number(a)**Number(b); case '=': case '==':return a===b; case '<>': case '!=':return a!==b; case '<':return a<b; case '<=':return a<=b; case '>':return a>b; case '>=':return a>=b; case 'ET': case 'AND':return truth(a)&&truth(b); case 'OU': case 'OR':return truth(a)||truth(b); default: throw runtimeError(`Opérateur ${n.op} non supporté.`); } }
      case 'call': { const name=normalizeWord(n.name); if(name==='PI') return Math.PI; const fn=BUILTINS[name]; if(!fn) throw runtimeError(`Fonction « ${n.name} » inconnue.`); return fn(n.args.map(evalExpr)); }
    }
  }
  function assignTarget(n,v){
    if(n.kind==='variable') { set(n.name,v); return; }
    if(n.kind==='index') { const arr=evalExpr(n.array); if(!arr?.__array) throw runtimeError('La cible n’est pas un tableau.'); const idx=Number(evalExpr(n.index)); if(!Number.isInteger(idx)||idx<arr.lower||idx>arr.upper) throw runtimeError(`Indice ${idx} hors limites [${arr.lower}..${arr.upper}].`); arr.values[idx-arr.lower]=v; return; }
    throw runtimeError('Cible d’affectation invalide.');
  }
  async function* runBlock(body, ctx){
    for(const stmt of body){
      if(++steps>maxSteps) throw runtimeError(`Limite d’exécution atteinte (${maxSteps} instructions).`);
      trace.push({line:stmt.line||0, text:program.__sourceLines?.[stmt.line-1]||''});
      yield {line:stmt.line||0, stmt, vars: snapshotVars(vars), output:[...output], stack:[...callStack], steps};
      if(stmt.kind==='assign') assignTarget(stmt.target,evalExpr(stmt.expr));
      else if(stmt.kind==='write') { const s=stmt.args.map(a=>formatValue(evalExpr(a))).join(''); output.push(stmt.newline?s+'\n':s); }
      else if(stmt.kind==='read') { for(const a of stmt.args){ if(inputIndex>=inputs.length) throw runtimeError(`Entrée manquante pour Lire (variable « ${a.name||'?' } »).`,stmt.line); assignTarget(a,parseInput(inputs[inputIndex++])); } }
      else if(stmt.kind==='if') { let executed=false; for(const b of stmt.branches){ if(truth(evalExpr(b.condition))){ yield* runBlock(b.body,ctx); executed=true; break; } } if(!executed) yield* runBlock(stmt.elseBody,ctx); }
      else if(stmt.kind==='for') { const start=Number(evalExpr(stmt.start)); const end=Number(evalExpr(stmt.end)); let step=Number(evalExpr(stmt.step)); if(step===0) throw runtimeError('Le PAS d’une boucle POUR ne peut pas être zéro.',stmt.line); set(stmt.variable,start); const forward=step>0; while(forward?get(stmt.variable)<=end:get(stmt.variable)>=end){ yield* runBlock(stmt.body,ctx); set(stmt.variable,Number(get(stmt.variable))+step); } }
      else if(stmt.kind==='while') { let guard=0; while(truth(evalExpr(stmt.condition))){ if(++guard>maxSteps) throw runtimeError('Boucle TantQue trop longue.',stmt.line); yield* runBlock(stmt.body,ctx); } }
      else if(stmt.kind==='repeat') { let guard=0; do { if(++guard>maxSteps) throw runtimeError('Boucle Répéter trop longue.',stmt.line); yield* runBlock(stmt.body,ctx); } while(!truth(evalExpr(stmt.condition))); }
      else if(stmt.kind==='return') { returnSignal=stmt.expr?evalExpr(stmt.expr):undefined; return; }
      else if(stmt.kind==='callstmt') { throw runtimeError(`Procédure « ${stmt.name} » non définie dans cette version.`,stmt.line); }
    }
  }
  async function* iterator(){ yield* runBlock(program.body,{}); }
  return {vars, output, trace, get inputIndex(){return inputIndex;}, iterator, get steps(){return steps;}, evalExpr, reset(){}};
}

function parseInput(v){
  const s=String(v); if(/^[-+]?\d+$/.test(s)) return Number(s); if(/^[-+]?(?:\d*\.\d+|\d+\.\d*)$/.test(s)) return Number(s); if(/^(vrai|true)$/i.test(s)) return true; if(/^(faux|false)$/i.test(s)) return false; return s; }
export function formatValue(v){
  if(v?.__array) return `[${v.values.map(formatValue).join(', ')}]`;
  if(typeof v==='boolean') return v?'VRAI':'FAUX'; if(typeof v==='number') return Number.isInteger(v)?String(v):String(Number(v.toFixed(10))); return String(v);
}
function snapshotVars(vars){ const out={}; for(const [k,v] of vars) out[k]=structuredClone?structuredClone(v):v; return out; }

export function compile(source){
  const parser=new LineParser(source); const program=parser.parse(); program.__sourceLines=normalizeSource(source).split('\n'); return program;
}

export function formatDiagnostic(error){
  const line=error.line?`Ligne ${error.line}`:'Compilation';
  return `${line}${error.column?`, colonne ${error.column}`:''} — ${error.message}`;
}

export function starterCode(){ return `Algorithme Exemple\nVariables\n  n : Entier\n  i : Entier\n  somme : Entier\nDebut\n  Lire(n)\n  somme := 0\n  Pour i de 1 à n Faire\n    somme := somme + i\n  FinPour\n  EcrireL("Somme = ", somme)\nFin`; }
