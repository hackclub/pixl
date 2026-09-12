---
title: Hackatime setup
group: Setup
description: Hackatime is how your build time gets tracked, and it's what turns hours into pixels, so get it set up before you start your first trial.
---

# Hackatime setup

^ Hackatime logs the time you spend coding in your editor, and that's what becomes pixels. Set it up before you start a project, not after.

## Installing it

1. Install the **WakaTime** extension in your editor. VS Code, Cursor, Neovim and JetBrains all have one.
2. When it asks for an API key, give it your **Hackatime API key** from your Pixl or Hack Club profile.
3. Set the API URL to `https://waka.hackclub.com/api`.

That third step is the one people miss. Without it the extension reports to WakaTime instead of Hackatime and none of your hours count.

## Checking it works

Write code for five minutes, then open your Hackatime dashboard. Your time should show up under your project's folder name.

If nothing appears, the API URL or the key is wrong in your editor settings. It's almost always one of those two.

## Folder naming

Hackatime identifies projects by your local folder name, so keep each build in its own directory. Two projects in one folder means their hours land on the same submission.
