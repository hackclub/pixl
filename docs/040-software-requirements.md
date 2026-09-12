---
title: Software ship requirements
group: Rules
description: Everything below is enforced by the software, not by vibes.
---

# Ship requirements

^ These get checked by code and by human reviewers. When a submission is blocked or kicked back, it's nearly always one of these.

## What every software ship needs

- **A live GitHub repo.** Public, accessible, with a README (see below) and multiple commits showing real progress. One commit doesn't hold up for a project claiming a lot of hours.
- **A working demo link.** Reviewers need to try what you built: a hosted site, a playable build, a video walkthrough, a releases page. It cannot be a second link to your repo.
- **A thumbnail image** showing the project in action.
- **The eligibility checkbox**, confirming this isn't school homework or duplicate YSWS work.
- **AI disclosure notes**, covered further down.

Updating a project that's already approved? Ship an update and write changelog notes explaining what's new.

## What to put in your README

Someone landing on your repo should be able to understand and run the project without asking you anything. At minimum, cover:

- **What it is.** What the project does, and why it exists.
- **What you built it with.** Languages, frameworks, libraries.
- **How to set it up and run it.** Install steps, environment variables, build and run commands. Enough that someone can get it working from the README alone.
- **Screenshots** of it working.

A repo that's a dump of files with two sentences for a README doesn't clear this bar, even when the demo link works.

## Journal character rules

Journal entries claiming tracked hours need at least 100 characters per logged hour, with a floor of 100 characters.

Log a 4-hour session and you're writing roughly 400 characters about what you implemented, what broke, and how you fixed it. Placeholders and one-liners get rejected.

Easiest way to stay on top of this is journalling right after each session, while it's fresh. Don't leave 10 hours of journalling for the five minutes before you submit.

## Be honest about AI

Using Claude, Copilot or ChatGPT is fine and costs you nothing on payout. Hiding it costs you plenty.

When you submit, write a sentence or two about what AI actually helped with: debugging, scaffolding, styling, whatever it was. Reviewers read commit histories regardless, so there's nothing to gain by being cagey.

## Hours only count after the cutoff

Only Hackatime hours logged after {{cutoff}} count toward Pixl. Anything tracked before that date is ignored, so everyone starts from the same line.

::: warn Before the cutoff date
Your countable hours show as zero until the cutoff passes. Set Hackatime up now so your hours start logging the moment the window opens.
:::

## Trial hour minimums

Some high-value trials have a minimum hour requirement, and you can't submit the trial until Hackatime says you've hit it. Your project dashboard shows how far along you are.

## Two gotchas

- **Referral codes expire after 2 days.** You get 48 hours from account creation to enter one. After that it's locked out.
- **Address required before shop orders.** Earn pixels whenever, but checkout won't go through without a verified mailing address.

## What happens if a submission comes back

Getting sent back isn't a punishment, it's feedback. Fix whatever it was (a dead demo link, vague journal entries, missing features) and submit again.

Reviewers can also approve a project for fewer hours than you logged, when the tracked time doesn't match the scope of what got built. The approval still stands and you're paid for the credited hours.
