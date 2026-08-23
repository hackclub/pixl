import type { Doc } from "./markdown.ts";

export interface NavItem {
  slug: string;
  title: string;
  group: string;
}

export interface PageInput {
  doc: Doc;
  nav: NavItem[];
  siteUrl: string;
  prev: NavItem | null;
  next: NavItem | null;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function navHtml(nav: NavItem[], current: string): string {
  const groups: { label: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const last = groups[groups.length - 1];
    if (last && last.label === item.group) last.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }
  return groups
    .map((g) => {
      const open = g.items.some((i) => i.slug === current);
      const links = g.items
        .map(
          (i) =>
            `<a class="section-link${i.slug === current ? " active" : ""}" href="/docs/${i.slug}/">${esc(i.title)}</a>`,
        )
        .join("\n            ");
      return `<div class="docs-group${open ? "" : " collapsed"}">
          <button class="docs-group-head" type="button">
            <span class="g-title">${esc(g.label)}</span><span class="count">${g.items.length}</span><span class="chev">▼</span>
          </button>
          <div class="docs-group-items">
            ${links}
          </div>
        </div>`;
    })
    .join("\n        ");
}

export function renderPage({ doc, nav, siteUrl, prev, next }: PageInput): string {
  const url = `${siteUrl}/docs/${doc.slug}/`;
  const image = `${url}og.png`;
  const toc = doc.headings.length >= 2;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  try {
    document.documentElement.dataset.theme = localStorage.getItem("pixl_theme_v2") || "light";
  } catch (e) {
    document.documentElement.dataset.theme = "light";
  }
</script>
<title>Pixl · ${esc(doc.meta.title)}</title>
<meta name="description" content="${esc(doc.meta.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Pixl">
<meta property="og:title" content="${esc(doc.meta.title)}">
<meta property="og:description" content="${esc(doc.meta.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(doc.meta.title)}">
<meta name="twitter:description" content="${esc(doc.meta.description)}">
<meta name="twitter:image" content="${image}">
<link rel="icon" href="/index.icon.png">
<link rel="stylesheet" href="/pixl.css?v=2">
<link rel="stylesheet" href="/docs/docs.css?v=2">
</head>
<body>
<div class="docs">
  <aside class="docs-nav">
    <div class="docs-nav-head">
      <a class="docs-brand" id="docs-brand" title="Back to the game"><img src="/index.icon.png" alt="">PIXL <span>DOCS</span></a>
      <div class="theme-picker">
        <button class="theme-toggle" id="docs-theme-btn" type="button" title="Change theme" aria-expanded="false"></button>
        <div class="theme-menu" id="docs-theme-menu" hidden></div>
      </div>
    </div>
    <button class="btn dark" id="docs-back" type="button" style="margin:0 6px 16px;justify-content:center">◄ BACK</button>
    <nav id="docs-nav-list">
        ${navHtml(nav, doc.slug)}
    </nav>
  </aside>

  <main class="docs-main">
    <article class="doc">
      <div class="eyebrow">${esc(doc.meta.group)}</div>
      ${doc.body}
      <div class="doc-foot">
        ${prev ? `<a class="prev" href="/docs/${prev.slug}/"><span class="dir">Previous</span><span class="ttl">${esc(prev.title)}</span></a>` : ""}
        ${next ? `<a class="next" href="/docs/${next.slug}/"><span class="dir">Next</span><span class="ttl">${esc(next.title)}</span></a>` : ""}
      </div>
      <div class="doc-sign">${["Start here", "Resources", "Guides", "Setup"].includes(doc.meta.group) ? "Built by alexx" : "Built by the Pixl team"}</div>
    </article>
  </main>

  <aside class="docs-toc${toc ? "" : " empty"}">
    ${toc ? `<div class="docs-toc-h">On this page</div>${doc.headings.map((h) => `<a href="#${h.id}" data-h="${h.id}">${esc(h.text)}</a>`).join("")}` : ""}
  </aside>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" integrity="sha512-D9gUyxqja7hBtkWpPWGt9wfbfaMGVt9gnyCvYa+jojwwPHLCzUm5i8rpk7vD7wNee9bA35eYIjobYPaQuKS1MQ==" crossorigin="anonymous"></script>
<script src="/docs/docs.js?v=2"></script>
</body>
</html>
`;
}
