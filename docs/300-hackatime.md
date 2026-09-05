---
title: Hackatime setup
group: Setup
description: Hackatime is how your build time gets tracked, and it's what turns hours into pixels, so get it set up before you start your first trial.
---

# Hackatime setup

^ Hackatime logs the time you spend coding in your editor, converting your real build hours into pixels. Set it up before you begin working on a project.

## Installation steps

1. Install the **WakaTime** extension in your editor (VS Code, Cursor, Neovim, JetBrains, etc.).
2. When prompted for your API Key, use your personal **Hackatime API Key** from your Pixl/Hack Club profile.
3. Set your custom API URL endpoint to `https://waka.hackclub.com/api`.

## Verifying tracking

Write code in your project for 5 minutes, then check your Hackatime dashboard. You should see active coding time appear under your current project folder name.

If hours aren't tracking, double-check that your API URL and Secret Key are pasted correctly into your editor settings.

## Project folder naming

Hackatime uses your local folder name as the project identifier. Keep each build in its own dedicated directory so your hours log to the correct submission.
