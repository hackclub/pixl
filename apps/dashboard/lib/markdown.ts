// Safe Markdown subset for rendering player journals in the dashboard. Mirrors
// the game's web renderer (web/pixl.js): escapes first, restricts URLs to
// http(s), supports headings, bold/italic/strike, inline + fenced code, links,
// images, lists, blockquotes and rules. Returns an HTML string for
// dangerouslySetInnerHTML , never trust the input, so everything is escaped.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

function safeUrl(u: string): boolean {
  return /^https?:\/\/[^"'\s]+$/i.test(u);
}

function inline(raw: string): string {
  return esc(raw)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (_m, a, u) =>
      safeUrl(u) ? `<img class="md-img" src="${u}" alt="${a}" loading="lazy" />` : "",
    )
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, t, u) =>
      safeUrl(u) ? `<a href="${u}" target="_blank" rel="noreferrer">${t}</a>` : t,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");
}

export function renderMarkdown(src: string | null | undefined): string {
  const lines = String(src ?? "").split(/\r?\n/);
  let html = "";
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) { html += `</${list}>`; list = null; }
  };
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    if (/^```/.test(line)) {
      closeList();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      html += `<pre class="md-pre"><code>${esc(buf.join("\n"))}</code></pre>`;
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); html += `<h${h[1].length} class="md-h">${inline(h[2])}</h${h[1].length}>`; i++; continue; }
    if (/^\s*([-*_])\1\1+\s*$/.test(line)) { closeList(); html += `<hr class="md-hr" />`; i++; continue; }
    if (/^>\s?/.test(line)) {
      closeList();
      const q: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      html += `<blockquote class="md-quote">${inline(q.join(" "))}</blockquote>`;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      if (list !== "ul") { closeList(); html += `<ul class="md-list">`; list = "ul"; }
      html += `<li>${inline(line.replace(/^\s*[-*+]\s+/, ""))}</li>`; i++; continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      if (list !== "ol") { closeList(); html += `<ol class="md-list">`; list = "ol"; }
      html += `<li>${inline(line.replace(/^\s*\d+\.\s+/, ""))}</li>`; i++; continue;
    }
    if (/^\s*$/.test(line)) { closeList(); i++; continue; }
    closeList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6}\s|```|>\s?|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i]) &&
      !/^\s*([-*_])\1\1+\s*$/.test(lines[i])
    ) para.push(lines[i++]);
    html += `<p class="md-p">${para.map(inline).join("<br/>")}</p>`;
  }
  closeList();
  return html;
}
