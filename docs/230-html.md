---
title: HTML guide
group: Guides
description: Practical basics for building and styling your first clean web page.
---

# HTML guide

^ Web development doesn't require complex frameworks to start. Plain HTML and CSS can build fast, clean, and interactive websites.

## Core HTML skeleton

Every web page starts with this boilerplate:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Project</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello World</h1>
  <p>Building something cool on Pixl.</p>
</body>
</html>
```

## Essential tags

- `<h1>` to `<h6>`: Headings for page hierarchy.
- `<p>`: Paragraphs for text content.
- `<a href="URL">`: Hyperlinks to external pages or local files.
- `<img src="image.png" alt="description">`: Images.
- `<button>` and `<input>`: Interactive elements and form controls.
- `<div>` and `<main>`: Structural layout containers.

## Adding modern styling (`style.css`)

Drop this into `style.css` for clean typography and centered dark-mode styling:

```css
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: #121110;
  color: #ede5d8;
}

main {
  max-width: 600px;
  padding: 2rem;
  background: #1c1a18;
  border-radius: 8px;
  border: 1px solid #332f2a;
}
```

## Building a showcase project

If you're tackling a trial like an item shop or personal portfolio, break the UI into distinct sections:
1. A clean header with your project title.
2. A grid of cards (items, projects, or blog posts) with images and descriptions.
3. A footer with social/GitHub links.

Get the layout working first, then refine the details.
