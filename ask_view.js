/* Ask: chat about the records from inside the viewer (optional).
   - "Ask anything" box at the top of the navigator; the conversation opens under it.
   - "Ask questions" button on each panel: that panel alone, with a chat about it beside it.
     The chat is sent what the panel shows (title, time window, its text, the chart points in the window).
   It talks to a separate local chat server (not part of this repo), given in local/ask.json as
   {"chatServer": "http://127.0.0.1:8820"}. That server answers POST /api/chat with a stream of
   Claude Code stream-json lines, and serves /review and /file. If the server can't be reached
   (e.g. on another device), nothing is shown. */
(function () {
'use strict';
const API = String((typeof ASK_CONFIG !== 'undefined' && ASK_CONFIG.chatServer) || '').replace(/\/$/, '');
if (!API) return;
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, href) => {
    href = href.replace(/&amp;/g, '&');
    if (/^https?:/.test(href)) return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
    let path = href.replace(/[:#]\d+$/, '').replace(/#.*$/, '');
    return `<a href="#" data-file="${esc(path)}">${text}</a>`;
  });
  return s;
}
function md(src) {
  const lines = src.replace(/\r/g,'').split('\n'); let html = '', i = 0;
  while (i < lines.length) {
    let l = lines[i];
    if (/^```/.test(l)) { let buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])) {
      const row = r => r.trim().replace(/^\||\|$/g,'').split('|').map(c => c.trim());
      html += '<table><tr>' + row(l).map(c => `<th>${inline(c)}</th>`).join('') + '</tr>'; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) html += '<tr>' + row(lines[i++]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>';
      html += '</table>'; continue;
    }
    let h = l.match(/^(#{1,4})\s+(.*)/); if (h) { html += `<h3>${inline(h[2])}</h3>`; i++; continue; }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l); html += ordered ? '<ol>' : '<ul>';
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) html += '<li>' + inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, '')) + '</li>';
      html += ordered ? '</ol>' : '</ul>'; continue;
    }
    if (/^---+$/.test(l.trim())) { html += '<hr>'; i++; continue; }
    if (!l.trim()) { i++; continue; }
    let buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s+|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    if (!buf.length) buf.push(lines[i++]);
    html += '<p>' + buf.map(inline).join('<br>') + '</p>';
  }
  return html;
}


const css = `
#askTop { display:flex; gap:8px; align-items:center; margin:2px 0 6px; }
#askTop input { flex:1; font:inherit; font-size:15px; padding:8px 12px; border-radius:10px; border:1px solid #5c7cfa88; background:rgba(92,124,250,.08); color:inherit; }
#askTop input:focus { outline:2px solid #5c7cfa; }
.askBtn { font:inherit; padding:7px 14px; border-radius:10px; border:0; background:#5c7cfa; color:#fff; cursor:pointer; }
.askBtn:disabled { opacity:.5; }
.askGhost { font:inherit; font-size:12px; padding:4px 9px; border-radius:8px; border:1px solid #8884; background:none; color:inherit; cursor:pointer; opacity:.85; }
#askTopWrap { display:none; border:1px solid #5c7cfa55; border-radius:12px; margin:0 0 8px; background:rgba(92,124,250,.05); }
#askTopWrap.open { display:block; }
#askTopWrap .bar { display:flex; justify-content:space-between; align-items:center; padding:6px 10px; font-size:12px; opacity:.85; border-bottom:1px solid #8883; }
#askTopWrap .askLog { max-height:44vh; overflow:auto; padding:10px 14px; }
#askTopWrap.collapsed .askLog { display:none; }
.askLog .q { text-align:right; margin:8px 0; }
.askLog .q span { display:inline-block; background:rgba(92,124,250,.18); border-radius:10px; padding:7px 11px; white-space:pre-wrap; text-align:left; }
.askLog .steps { font-size:12px; opacity:.7; margin:4px 0; }
.askLog .steps div::before { content:"· "; }
.askLog .a { border:1px solid #8883; border-radius:10px; padding:10px 13px; margin:6px 0 14px; overflow-x:auto; line-height:1.5; }
.askLog .a table { border-collapse:collapse; margin:6px 0; font-size:13px; }
.askLog .a th, .askLog .a td { border:1px solid #8885; padding:4px 7px; text-align:left; vertical-align:top; }
.askLog .a p { margin:6px 0; }
.askLog .a h3 { font-size:15px; margin:10px 0 4px; }
.askLog .suggest { cursor:pointer; color:#5c7cfa; }
.askLog .suggest:hover { text-decoration:underline; }
.askLog .err { color:#e03131; }
.askPanelBtn { font:inherit; font-size:12px; padding:3px 9px; margin-left:8px; border-radius:8px; border:1px solid #5c7cfa88; background:rgba(92,124,250,.12); color:inherit; cursor:pointer; white-space:nowrap; }
.askPanelBtn:hover { background:rgba(92,124,250,.25); }
#askSide { position:fixed; top:0; right:0; width:min(560px, 40vw); height:100vh; display:none; flex-direction:column; z-index:50;
  background:var(--card, #1f1f22); border-left:1px solid #8884; box-shadow:-8px 0 30px rgba(0,0,0,.25); }
body.askFocus #askSide { display:flex; }
#askSide .head { padding:12px 14px; border-bottom:1px solid #8883; }
#askSide .head .t { font-weight:700; font-size:15px; }
#askSide .head .s { font-size:12px; opacity:.75; margin-top:2px; }
#askSide .head .row { display:flex; justify-content:space-between; align-items:center; gap:8px; }
#askSide .chips { display:flex; flex-wrap:wrap; gap:6px; padding:10px 14px 0; }
#askSide .askLog { flex:1; overflow:auto; padding:6px 14px; }
#askSide form { display:flex; gap:8px; padding:10px 14px; border-top:1px solid #8883; }
#askSide textarea { flex:1; font:inherit; resize:none; padding:8px 10px; border-radius:10px; border:1px solid #8885; background:transparent; color:inherit; min-height:42px; }
body.askFocus { padding-right:min(560px, 40vw); }
body.askFocus aside { display:none !important; }
body.askFocus .wrap { grid-template-columns: minmax(0, 1fr) !important; }
body.askFocus :is(.card, .cmp):not(.askTarget):not(:has(.askTarget)) { display:none !important; }
body.askFocus .askTarget { outline:2px solid #5c7cfa; outline-offset:4px; }
`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));

const asker = () => localStorage.getItem('recordsChatAsker') || '';
const newId = () => 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const navpin = () => document.querySelector('.navpin');

function windowDates() {
  // The navigator's From / To date buttons (#wal, #wbl).
  const v = ['wal', 'wbl'].map(id => ((document.getElementById(id) || {}).textContent || '').trim());
  return v.every(x => /^\d{4}-\d\d-\d\d$/.test(x)) ? v : null;
}
function windowRange() { const w = windowDates(); return w ? `${w[0]} to ${w[1]}` : ''; }
// The charts' x axis is a 0-100 position in the time window (with the compressed stretch before
// the break); the viewer's own unpos() turns a position back into a time.
function xToDate(x, scale) {
  if (typeof unpos === 'function' && scale && scale.min === 0 && scale.max === 100) {
    const t = unpos(x); if (isFinite(t)) return new Date(t).toISOString().slice(0, 10);
  }
  if (x > 1e11) return new Date(x).toISOString().slice(0, 10);
  return String(x);
}
function panelTitle(p) {
  const h = p.querySelector('.txh, .cmph, .mhead') || p;
  const b = h.querySelector('b'); const sub = h.querySelector('.sub');
  return { title: b ? b.textContent.trim() : 'this panel', sub: sub ? sub.textContent.trim().slice(0, 140) : '' };
}
function chartData(p) {
  const out = [];
  if (!window.Chart || !Chart.getChart) return out;
  for (const cv of p.querySelectorAll('canvas')) {
    const ch = Chart.getChart(cv); if (!ch) continue;
    const xs = ch.scales && ch.scales.x, lo = xs ? xs.min : -Infinity, hi = xs ? xs.max : Infinity;
    for (const ds of ch.data.datasets || []) {
      if (ds.hidden) continue;
      const pts = (ds.data || []).filter(d => d && typeof d === 'object' && d.x != null && d.x >= lo && d.x <= hi)
        .slice(-60).map(d => `${xToDate(d.x, xs)}: ${typeof d.y === 'number' ? +d.y.toFixed(3) : d.y}`);
      if (pts.length) out.push(`${ds.label || 'series'} → ${pts.join('; ')}`);
    }
  }
  return out.slice(0, 25);
}
function panelContext(p) {
  const { title, sub } = panelTitle(p);
  const text = p.innerText.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').slice(0, 5000);
  const data = chartData(p);
  return `Panel: "${title}"${sub ? ' (' + sub + ')' : ''}\nTime window shown: ${windowRange() || 'unknown'}\n` +
    (data.length ? `Data points in the chart(s) within the window:\n${data.join('\n')}\n` : '') +
    `Text visible in the panel:\n${text}`;
}
function pageContext() {
  const titles = [...document.querySelectorAll('.txh, .cmph, .mhead')].filter(e => e.offsetParent).map(e => panelTitle(e.closest('.cmp, .card') || e).title);
  return `Main viewer page. Time window: ${windowRange() || 'unknown'}. Panels shown: ${titles.join(', ')}.`;
}

// One conversation, drawn into a log element.
function Chat(logEl, opts) {
  this.log = logEl; this.opts = opts; this.reset();
}
Chat.prototype.reset = function () { this.conversationId = newId(); this.sessionId = null; this.busy = false; this.log.innerHTML = ''; };
Chat.prototype.ask = async function (text) {
  text = (text || '').trim(); if (!text || this.busy) return;
  this.busy = true; this.opts.onBusy && this.opts.onBusy(true); this.opts.onAsk && this.opts.onAsk();
  const q = document.createElement('div'); q.className = 'q'; q.innerHTML = `<span>${esc(text)}</span>`; this.log.appendChild(q);
  const steps = document.createElement('div'); steps.className = 'steps'; steps.innerHTML = '<div>Thinking…</div>'; this.log.appendChild(steps);
  const a = document.createElement('div'); a.className = 'a'; a.style.display = 'none'; this.log.appendChild(a);
  const scroll = () => { this.log.scrollTop = this.log.scrollHeight; }; scroll();
  let answer = '';
  try {
    const res = await fetch(API + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: this.sessionId, conversationId: this.conversationId,
        asker: asker(), context: this.opts.context(), where: this.opts.where() }) });
    const reader = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true }); let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue;
        let ev; try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.session_id) this.sessionId = ev.session_id;
        if (ev.type === 'assistant' && ev.message && ev.message.content) {
          for (const b of ev.message.content) {
            if (b.type === 'tool_use') {
              if (steps.textContent === 'Thinking…') steps.innerHTML = '';
              const s = document.createElement('div'); const i = b.input || {};
              s.textContent = b.name === 'Read' ? 'Reading ' + (i.file_path || '').split('/').slice(-2).join('/')
                : b.name === 'Grep' ? 'Searching for “' + (i.pattern || '') + '”' : b.name === 'Glob' ? 'Looking for files' : 'Looking';
              steps.appendChild(s);
            }
            if (b.type === 'text' && b.text.trim()) { answer += (answer ? '\n\n' : '') + b.text; a.style.display = ''; a.innerHTML = md(answer); }
          }
          scroll();
        }
        if (ev.type === 'result' && (ev.is_error || ev.subtype !== 'success')) { a.style.display = ''; a.innerHTML += `<p class="err">${esc(ev.result || 'Something went wrong.')}</p>`; }
        if (ev.type === 'plain') { a.style.display = ''; a.innerHTML += `<p class="err">${esc(ev.text)}</p>`; }
      }
    }
  } catch (e) { a.style.display = ''; a.innerHTML += `<p class="err">Couldn't reach the chat server.</p>`; }
  if (steps.textContent === 'Thinking…') steps.remove();
  else { const n = steps.children.length; steps.innerHTML = `<div>Looked at ${n} thing${n > 1 ? 's' : ''}</div>`; }
  a.querySelectorAll('li').forEach(li => { const t = li.innerText.trim().replace(/^[“"']+|[”"']+$/g, ''); const lead = ((li.parentElement || {}).previousElementSibling || {}).textContent || ''; if (t.endsWith('?') || /follow|next|ask/i.test(lead)) { li.classList.add('suggest'); li.onclick = () => this.ask(t); } });
  a.querySelectorAll('a[data-file]').forEach(l => { l.href = API + '/file?path=' + encodeURIComponent(l.dataset.file); l.target = '_blank'; });
  this.busy = false; this.opts.onBusy && this.opts.onBusy(false); scroll();
};

// 1) "Ask anything" in the navigator.
function buildTop() {
  const nav = navpin(); if (!nav || document.getElementById('askTop')) return;
  const row = document.createElement('div'); row.id = 'askTop';
  row.innerHTML = `<input id="askTopIn" placeholder="Ask anything about the records…"><button class="askBtn" id="askTopGo">Ask</button>`;
  const wrap = document.createElement('div'); wrap.id = 'askTopWrap';
  wrap.innerHTML = `<div class="bar"><span>Conversation · answers come from the files · <a href="${API}/review" target="_blank" style="color:inherit">review all ↗</a></span>
    <span><button class="askGhost" id="askTopNew">New</button> <button class="askGhost" id="askTopHide">▴ Hide</button></span></div><div class="askLog"></div>`;
  nav.insertBefore(wrap, nav.firstChild); nav.insertBefore(row, wrap);
  const input = row.querySelector('input'), go = row.querySelector('button');
  const chat = new Chat(wrap.querySelector('.askLog'), {
    context: pageContext, where: () => 'navigator',
    onAsk: () => { wrap.classList.add('open'); wrap.classList.remove('collapsed'); hide.textContent = '▴ Hide'; },
    onBusy: b => { go.disabled = b; } });
  const hide = wrap.querySelector('#askTopHide');
  hide.onclick = () => { const c = wrap.classList.toggle('collapsed'); hide.textContent = c ? '▾ Show' : '▴ Hide'; };
  wrap.querySelector('#askTopNew').onclick = () => { chat.reset(); wrap.classList.remove('open'); input.focus(); };
  const send = () => { const t = input.value; input.value = ''; chat.ask(t); };
  go.onclick = send; input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
}

// 2) "Ask questions" on each panel -> focused view: that panel + a chat about it.
const side = document.createElement('div'); side.id = 'askSide';
side.innerHTML = `<div class="head"><div class="row"><div><div class="t" id="askSideT"></div><div class="s" id="askSideS"></div></div>
  <button class="askGhost" id="askSideClose">✕ Back to all panels</button></div></div>
  <div class="chips" id="askChips"></div><div class="askLog"></div>
  <form><textarea placeholder="Ask about this panel… (Enter to send)"></textarea><button class="askBtn">Ask</button></form>`;
let target = null;
const sideChat = new Chat(side.querySelector('.askLog'), {
  context: () => target ? panelContext(target) : pageContext(),
  where: () => target ? 'panel: ' + panelTitle(target).title : 'panel',
  onBusy: b => { side.querySelector('form button').disabled = b; } });
const starters = ['What does this panel show, in plain words?', 'What changed in this time window?',
  'Explain the terms and abbreviations here', 'What should we ask the doctors about this?'];
function focusPanel(p) {
  if (target) target.classList.remove('askTarget');
  target = p; p.classList.add('askTarget'); document.body.classList.add('askFocus');
  const { title, sub } = panelTitle(p);
  side.querySelector('#askSideT').textContent = 'Asking about: ' + title;
  side.querySelector('#askSideS').textContent = (windowRange() ? 'Time window ' + windowRange() + ' · ' : '') + 'the chat sees what this panel shows';
  sideChat.reset();
  const chips = side.querySelector('#askChips'); chips.innerHTML = '';
  for (const s of starters) { const b = document.createElement('button'); b.className = 'askGhost'; b.textContent = s; b.onclick = () => sideChat.ask(s); chips.appendChild(b); }
  window.dispatchEvent(new Event('resize'));
  setTimeout(() => { p.scrollIntoView({ block: 'start' }); window.scrollBy(0, -((navpin() || {}).offsetHeight || 0) - 10); }, 60);
  side.querySelector('textarea').focus();
}
function unfocus() {
  document.body.classList.remove('askFocus');
  const p = target; if (target) target.classList.remove('askTarget'); target = null;
  window.dispatchEvent(new Event('resize'));
  if (p) setTimeout(() => p.scrollIntoView({ block: 'center' }), 60);
}
side.querySelector('#askSideClose').onclick = unfocus;
const ta = side.querySelector('textarea');
side.querySelector('form').onsubmit = e => { e.preventDefault(); const t = ta.value; ta.value = ''; sideChat.ask(t); };
ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); side.querySelector('form').requestSubmit(); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('askFocus') && document.activeElement !== ta) unfocus(); });

function addPanelButtons() {
  for (const head of document.querySelectorAll('.txh, .cmph, .mhead')) {
    const p = head.closest('.cmp, .card'); if (!p || p.querySelector('.askPanelBtn')) continue;
    const b = document.createElement('button'); b.className = 'askPanelBtn'; b.textContent = '💬 Ask questions';
    b.title = 'Open this panel next to a chat about it';
    b.onclick = e => { e.stopPropagation(); focusPanel(p); };
    const t = head.querySelector('b'); (t && t.parentElement === head ? t : head.firstChild).after(b);
  }
}
// Only switch on when the chat server answers (it runs on this computer only).
const ctl = new AbortController(); setTimeout(() => ctl.abort(), 3000);
fetch(API + '/api/quick-asks', { signal: ctl.signal }).then(r => {
  if (!r.ok) return;
  document.body.appendChild(side);
  let pending = null;
  new MutationObserver(() => { if (!pending) pending = setTimeout(() => { pending = null; buildTop(); addPanelButtons(); }, 150); })
    .observe(document.body, { childList: true, subtree: true });
  buildTop(); addPanelButtons();
}).catch(() => {});
})();
