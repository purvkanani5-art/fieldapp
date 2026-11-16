/* Fixed-word translation: English → Gujarati / Hindi for everything the app itself says (menus, buttons, labels, help
   text, messages, server errors). What people type is not translated.

   Dictionaries live in i18n.gu.js and i18n.hi.js as window.I18N_DATA[lang] = { "English": "translation", … }.
   A key may hold placeholders: {n} for a number, {x} for any text (a name, a site, a value). The translation uses
   the same placeholders, in order, or {1} {2} … to put them in a different order. Text joined with " · " is
   translated piece by piece. A MutationObserver translates whatever appears on the page (screens, pop-ups,
   messages, the camera), so screens need no changes. */

window.I18N_DATA = window.I18N_DATA || {};
const LOCALE = { en: 'en-IN', gu: 'gu-IN', hi: 'hi-IN' };
function lang() { try { return localStorage.getItem('kl.lang') || 'en'; } catch { return 'en'; } }
/** Dates, times and numbers stay in English (0-9, Nov, am/pm) in every language: owner's choice, easier to read. */
const appLocale = () => 'en-IN';

let TR = null;
function trTable() {
  const L = lang();
  if (L === 'en') return null;
  if (TR && TR.lang === L) return TR;
  const dict = window.I18N_DATA[L] || {};
  const exact = new Map();
  const pats = [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [k, v] of Object.entries(dict)) {
    if (!v) continue;
    if (/\{[xn]\}/.test(k)) {
      const parts = k.split(/(\{[xn]\})/).filter((p) => p !== '');
      const lits = parts.filter((p) => p !== '{x}' && p !== '{n}');
      const anchor = lits.sort((a, b) => b.length - a.length)[0] || '';
      const re = new RegExp(`^${parts.map((p) => (p === '{x}' ? '(.+?)' : p === '{n}' ? '(₹?[\\d,]+(?:\\.\\d+)?)' : esc(p))).join('')}$`);
      pats.push({ re, v, anchor, size: lits.join('').length });
    } else exact.set(k, v);
  }
  pats.sort((a, b) => b.size - a.size); // the most specific pattern first
  TR = { lang: L, exact, pats, memo: new Map() };
  return TR;
}
/** Translation of one trimmed text, or null when there is none. */
function tr(text) {
  const T = trTable();
  if (!T || !text) return null;
  if (T.memo.has(text)) return T.memo.get(text);
  let r = T.exact.get(text) ?? null;
  if (r === null) {
    for (const p of T.pats) {
      if (p.anchor && !text.includes(p.anchor)) continue;
      const m = p.re.exec(text);
      if (!m) continue;
      const g = m.slice(1).map((x) => T.exact.get(x) ?? x); // a value inside may itself be a known word
      let i = 0;
      r = p.v.replace(/\{(\d)\}|\{[xn]\}/g, (_, d) => (d ? g[Number(d) - 1] ?? '' : g[i++] ?? ''));
      break;
    }
  }
  if (r === null && text.includes(' · ')) {
    const segs = text.split(' · ');
    const t2 = segs.map((s) => tr(s.trim()) ?? s);
    if (t2.some((s, i) => s !== segs[i])) r = t2.join(' · ');
  }
  T.memo.set(text, r);
  return r;
}
/** For text built in JavaScript (e.g. a confirm button label): translated when a translation exists. */
const t = (s) => tr(s) ?? s;

const TR_SKIP = 'script,style,noscript,textarea,[data-notr],.notr';
const TR_ATTRS = ['placeholder', 'aria-label', 'title'];
function trNode(n) {
  const v = n.nodeValue;
  const s = v.trim();
  if (!s || !/[A-Za-z]/.test(s)) return;
  const r = tr(s);
  if (r !== null && r !== s) n.nodeValue = v.replace(s, r);
}
function trAttrs(el) {
  for (const a of TR_ATTRS) {
    const v = el.getAttribute?.(a);
    if (v && /[A-Za-z]/.test(v)) { const r = tr(v.trim()); if (r !== null) el.setAttribute(a, r); }
  }
}
function translate(root) {
  if (!root || lang() === 'en') return;
  if (root.nodeType === 3) { if (!root.parentElement?.closest(TR_SKIP)) trNode(root); return; }
  if (root.nodeType !== 1 || root.closest?.(TR_SKIP)) return;
  trAttrs(root);
  for (const el of root.querySelectorAll?.('[placeholder],[aria-label],[title]') || []) if (!el.closest(TR_SKIP)) trAttrs(el);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement?.closest(TR_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  for (const n of nodes) trNode(n);
}
/** Whatever is added to the page is translated before it is painted. */
const trObserver = new MutationObserver((muts) => {
  if (lang() === 'en') return;
  for (const m of muts) for (const n of m.addedNodes) translate(n);
});
function startTranslation() {
  document.documentElement.lang = lang() === 'en' ? 'en' : lang();
  trObserver.observe(document.body, { childList: true, subtree: true });
}
