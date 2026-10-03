/**
 * Hand-rolled Markdown → HTML for the docs served as pages (/protocol). Pure,
 * no dependencies, and deliberately small: ATX headings (with id anchors),
 * paragraphs, unordered and ordered lists (one level), fenced code blocks,
 * horizontal rules, and inline code, bold and links. Anything else is text.
 * Everything is HTML-escaped first; links are only emitted for http(s),
 * site-relative and fragment targets.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (s) => String(s).toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Inline markup on already-escaped text; code spans are protected from the other rules. */
function inline(text) {
  const codes = [];
  let s = esc(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${c}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^\s)]*)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** Plain text of a heading/paragraph line (for <title> and meta description). */
const plain = (text) => String(text).replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

function renderMarkdown(md) {
  const out = [];
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  let para = [], list = null, code = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`); list = null; } };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw)) { out.push(`<pre><code${code.lang ? ` class="language-${esc(code.lang)}"` : ''}>${esc(code.lines.join('\n'))}</code></pre>`); code = null; } else code.lines.push(raw);
      continue;
    }
    const line = raw.replace(/\s+$/, '');
    let m;
    if ((m = /^```\s*([\w-]*)/.exec(line))) { flushPara(); flushList(); code = { lang: m[1], lines: [] }; continue; }
    if (line === '') { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line))) { flushPara(); flushList(); const n = m[1].length; out.push(`<h${n} id="${slug(plain(m[2]))}">${inline(m[2])}</h${n}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = /^[-*]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.lines.join('\n'))}</code></pre>`);
  flushPara(); flushList();
  return out.join('\n');
}

/** First "# " heading and first paragraph after it, as plain text. */
function summary(md) {
  const lines = String(md).split('\n');
  const h1 = lines.find((l) => /^#\s+/.test(l));
  const title = h1 ? plain(h1.replace(/^#\s+/, '').trim()) : '';
  const start = h1 ? lines.indexOf(h1) + 1 : 0;
  const first = lines.slice(start).find((l) => l.trim() && !/^#|^```|^[-*]\s|^\d+\.\s/.test(l));
  let description = first ? plain(first.trim()) : '';
  if (description.length > 200) description = description.slice(0, description.lastIndexOf('. ', 200) + 1) || description.slice(0, 200);
  return { title, description };
}

/** [{ level, text, id }] for every heading — tests and tables of contents. */
function headings(md) {
  return [...String(md).matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)].map((m) => ({ level: m[1].length, text: plain(m[2]), id: slug(plain(m[2])) }));
}

module.exports = { renderMarkdown, inline, summary, headings, slug };
