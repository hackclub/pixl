---
title: HTML guide
group: Guides
description: The basics for building and styling your first web page.
---

# HTML guide

^ You don't need a framework to start. Plain HTML and CSS get you a real site.

## The skeleton

Every page starts here:

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

- `<h1>` to `<h6>`: headings, in order of importance.
- `<p>`: a paragraph.
- `<a href="URL">`: a link, to another page or a local file.
- `<img src="image.png" alt="description">`: an image. The `alt` text matters.
- `<button>` and `<input>`: things people click and type into.
- `<div>` and `<main>`: containers you hang layout off.

## Styling it (`style.css`)

Drop this in `style.css` for centered, dark-mode text:

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

For a trial like an item shop or a portfolio, split the page into three parts:

1. A header with the project title.
2. A grid of cards (items, projects, posts) with images and descriptions.
3. A footer with your links.

Get the layout roughly right before you start fussing over details.
