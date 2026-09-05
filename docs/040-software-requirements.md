---
title: Software ship requirements
group: Rules
description: Everything below is enforced by the software, not by vibes.
---

# Ship requirements

^ These rules are checked programmatically and by human reviewers. If a submission gets blocked or kicked back, it's almost always due to one of these.

## What every Software ship needs

- **A live GitHub repo.** It must be public and accessible, with a README (see below), and multiple commits showing real development progress. A single commit does not hold up for a project claiming significant hours.
- **A working demo link.** Reviewers need to test what you built: a hosted site, a playable build, a video walkthrough, or a releases page. It **cannot** just be another link to your repo.
- **A thumbnail image** showing your project in action.
- **The eligibility checkbox** confirming this isn't school homework or duplicate YSWS work.
- **AI disclosure notes** explaining where and how AI was used (details below).

If you're updating an already-approved project, you can ship an update: just write clear changelog notes explaining what new features you built.

## What to put in your README

Reviewers (and anyone else who lands on your repo) should be able to understand and run your project without asking you anything. At minimum, your `README.md` should cover:

- **What it is.** A clear, concise summary of what the project does and why it exists.
- **What tech was used.** The languages, frameworks, and libraries behind it.
- **How to set it up and run it.** Install steps, environment variables, build/run commands - enough for someone with minimal technical knowledge to get it working from the README alone.

A repo that's just a dump of files with one or two sentences for a README doesn't meet this bar, even if the demo link works.

## Journal character rules

Journal entries that claim tracked hours must have **at least 100 characters per logged hour** (with an absolute floor of 100 characters). 

If you log a 4-hour session, write at least ~400 characters describing what you implemented, what broke, and how you fixed it. Entries with lazy placeholders or one-liners get rejected.

The easiest way to handle this is to journal after every build session while the work is fresh. Don't leave 10 hours of journalling for the last 5 minutes before submitting.

## Be honest about AI

Using AI tools (Claude, Copilot, ChatGPT) is fine and won't penalize your payout. Hiding it will. 

When submitting, write an honest sentence or two describing what AI helped you with (e.g. debugging, scaffolding boilerplate, styling). Reviewers check commit histories anyway, so just be upfront.

## Hours only count after the cutoff

Only Hackatime hours logged after {{cutoff}} count toward Pixl. Pre-existing coding time logged before that date is ignored. This keeps the playing field fair and ensures rewards go toward fresh work.

::: warn Before the cutoff date
Your countable hours will show as zero until the cutoff passes. Install and configure Hackatime now so your hours automatically log the moment the window opens.
:::

## Trial hour minimums

Certain high-value trials have minimum hour requirements. You cannot submit the trial until you've logged at least that many hours in Hackatime. Your project dashboard shows your exact progress toward the threshold.

## Two gotchas to remember

- **Referral codes expire in 2 days.** You have 48 hours after account creation to enter a referral code. After that, the system locks it out.
- **Address required before shop orders.** You can earn pixels anytime, but you cannot checkout in the shop without a verified mailing address on your account.

## What happens if a submission is returned?

Getting a project sent back isn't a penalty, it's feedback. Fix the issue (e.g., dead demo link, vague journal entries, missing features) and submit again. 

Reviewers may also approve a project for fewer hours than logged if the tracked time doesn't match the scope of what was built. You keep your approval and get paid for the credited hours.
