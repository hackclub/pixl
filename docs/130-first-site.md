---
title: Your first site, line by line
group: Build & ship
description: Starter code for a personal webpage you can build and ship today.
---

# Your first site, line by line

^ Here's a small site that works. Copy it, make it yours, ship it.

## 1. Create your files

In your editor, make a folder called `my-site` with two files in it: `index.html` and `style.css`.

## 2. The markup: `index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Your Name | Pixl Maker</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hey, I'm Your Name 👋</h1>
    <p>I'm building hardware and software projects on Pixl.</p>
    <ul>
      <li><a href="https://github.com/yourusername" target="_blank">GitHub</a></li>
      <li><a href="https://pixl.hackclub.com" target="_blank">Pixl</a></li>
    </ul>
  </main>
</body>
</html>
```

## 3. The styling: `style.css`

```css
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  background: #141312;
  color: #f5eedc;
}

main {
  max-width: 32rem;
  padding: 2.5rem;
  background: #1e1c19;
  border: 2px solid #38332c;
  border-radius: 8px;
}

h1 {
  font-size: 2rem;
  margin: 0 0 0.75rem;
}

a {
  color: #e5a93c;
  text-decoration: none;
  font-weight: 600;
}

a:hover {
  text-decoration: underline;
}

ul {
  list-style: none;
  padding: 0;
  display: flex;
  gap: 1.25rem;
  margin-top: 1.5rem;
}
```

Double-click `index.html` to open it in your browser. That's a working site.

## 4. Make it your own

Don't ship it with the placeholder text still in. Change the name, write a paragraph about what you want to build, drop in an image (`<img src="me.png" alt="profile">`), pick your own colours in `style.css`.

## 5. Push to GitHub & deploy

1. Initialize Git in the folder and push to GitHub.
2. Deploy it free on GitHub Pages, Cloudflare Pages or Vercel.
3. Link your Hackatime project, write a short journal entry, and hit Ship.
