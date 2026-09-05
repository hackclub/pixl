---
title: Hardware ship requirements
group: Rules
description: Everything below is enforced by the Hardware, not by vibes.
---

Adapted from [Fallout](fallout.hackclub.com)

# Submitting your Design

Okay, you’ve designed your project digitally\! Congrats\! Before giving you funding, the project needs to meet our ✨ _Submission Requirements_ ✨

Pixl wants you to create [**real, shipped projects**](/docs/rules/what-is-shipping).

There are two key areas of our Design Submission Requirements:

1. A good README
2. Fully completed design

**Missing any will get your project returned**. Read through all of them\! It’s easy to miss one.

**95/% of Rejections come from problems that take 5 Minutes to fix.**

We’re here to help\! But we can’t tell you exactly what to do. Before directly reaching out to us, read our documentation, ask in [\#pixl](https://hackclub.enterprise.slack.com/archives/C0B5P4N0WHH), Google it!

> Note : missing any of these will get your project returned. You would have to wait some more days to get it reviewed as it goes last in the queue

## 1. A Good README

Your README is people’s first impression. Make it awesome\! Someone landing on your repository for the first time should understand:

- What your project is
- What it does
- Why it exists

If they have to open even a single file, your README is not doing its job. At minimum, your `README.md` file must include:

1\. Explanation of what your project is

- [x] Short description of what your project is\! Highlight what makes it unique
- [x] How do you use it? Be detailed\! Others can’t read your mind.
- [x] Why did you make it? Be personal\! Are you solving a problem? Trying to make something smaller than previously thought possible?

2\. Add images\! A picture is worth a thousand words. Include:

- [x] Screenshots of a full 3D model of your project fully assembled
- [x] Screenshots of your PCB with components, if you have one
- [x] A clear wiring diagram, if you’re not using a PCB
- [x] Anything else that makes it clear what your project is and what it’s for

## 2. A fully finished design:

Whoa… A lot at first glance\! Breathe. You got this. It’s simpler than it seems\!

For a design to be 100% finished, someone else should be able to read your repo, understand, and replicate it… i.e. You need to include all files and instructions\!

A project that only you can make is not [**shipped**](/docs/requirements/what-is-shipping). It only lives in your head.

The design should also reasonably actually work\! Of course, you can’t be sure until building it, but stuff like floating parts, incomplete firmware, or parts attached with “magic” is a no-go.

#### At minimum, your project should be:

- [x] Original, custom design by you. **Not by AI, not a direct copy of a tutorial, or someone else.**
- [x] Has a complete CAD assembly, with all components (including electronics).
- [x] Have a concrete way to attach components (including electronics). Use screws, clips, etc. This is a product, not a demo, it should feel solid, and not held up by tape, glue, and dreams.
- [x] Has firmware if applicable, even if it’s untested. If you have a microcontroller, you should probably have firmware.
- [x] Someone else sanity checked your design\! It’s EASY to miss things. Ask a friend, in [\#pixl](https://hackclub.enterprise.slack.com/archives/C0B5P4N0WHH), and fix them before submitting\!

#### Your GitHub repository needs to contain all your project files

- [x] A BOM (Bill of Materials) in CSV format, with links, and a line indicating the total cost\! Even if you own a part, still include it. Someone else needs to be able to build what you’ve designed
- [x] The source files of your PCB, if you have one (`.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `.epro`, `gerbers.zip`, etc)
- [x] If you have 3D models, `.step` files of your project’s 3D CAD and the source design file (`.f3d`, `FCStd`, or a link to onshape)
- [x] Your firmware files, if applicable. Make sure to include the source code
- [x] ANY other files that are part of your project (libraries, references, etc.)
- [x] Make sure your repository is well organized. Use and name folders and files clearly

## You shouldn’t have

- [ ] Designs copied from other people. It’s okay to reference or use parts of other’s work. Make sure to credit it. Never present others’ work as your own.
- [ ] Missing files\! Check the above

> Note :  Any project containing plagiarized content, Fully AI generated design files or stolen work may be permanently rejected and could even result in a ban in Hackclub programs.

# Sumbitting Build

Whoaa! You built the project irl which you designed. Now its time to get it approved to get pixels to spend in shop

For submitting your build, You should lapse the building phase and journal it. If not lapsed building it, We might deflate the time accordingly.

- It should have several pictures of the build in journals to show the progress.
- Pictures of the finished build and the link of demo video in the readme of the repo.
- If any changes made like adding a wire in pcb as you forgot a connection, Update in pcb and repo.

> Note: Submitting your build requires you to follow the design submission requirements too. If not, Your project will be returned for changes due to that you would have to wait again for the next review.
