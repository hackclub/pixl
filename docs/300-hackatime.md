---
title: Hackatime setup
group: Setup
description: Hackatime is how your build time gets tracked, and it's what turns hours into pixels, so get it set up before you start your first trial.
---

# Hackatime setup

^ Hackatime logs the time you spend coding in your editor, and that's what becomes pixels. Set it up before you start a project, not after.

## Installing it

1. Create a Hackatime account at [hackatime.hackclub.com](https://hackatime.hackclub.com) if you don't already have one.
2. Install your editor's plugin. VS Code has its own **Hackatime Time Tracker** extension in the marketplace, install that one, not the "Hackatime" extension (that one's unofficial and won't work). Every other editor - Cursor, Neovim, JetBrains and 70+ others - uses the same WakaTime-compatible plugin Hackatime has always run on; see [Hackatime's editor guides](https://hackatime.hackclub.com/docs#editor-guides) for yours.
3. Run [Hackatime's setup wizard](https://hackatime.hackclub.com/setup). It generates your API key and endpoint and drops them straight into supported plugins, so you're not copying an API URL in by hand anymore.
4. Back in Pixl, hit **Connect Hackatime** on your Projects page. The plugin tracks your time either way, but Pixl never sees it until your Hackatime account is linked here.

## Checking it works

Write code for five minutes, then open your Hackatime dashboard. Your time should show up under your project's folder name.

If nothing appears, first check that the folder is an actual git repository (`git init` or `git clone` it), Hackatime only tracks time inside one. Still nothing? Re-run the setup wizard, a stale key or endpoint from before you set it up is the next most common cause.

## Folder naming

Hackatime identifies projects by your local folder name, so keep each build in its own directory. Two projects in one folder means their hours land on the same submission.
