---
title: Swipe
description: Swipe through movie, series, and book picks and request with a swipe.
sidebar_position: 10
---

# Swipe

**Swipe** (in the sidebar) shows a stack of movies, series, or books picked for
you. Each card shows the artwork, rating, overview, and why it was picked.

| Action | Gesture | Button | Key |
| --- | --- | --- | --- |
| Request it | Swipe right | **Request** | → |
| Not interested | Swipe left | **Pass** | ← |
| Already seen or read it | Swipe up | **Seen It** | ↑ |
| Bring back the last pass or seen card | — | **Undo** | Backspace |

A right swipe makes a normal request, with your usual quotas, permissions, and
approval rules. Undo does not cancel a request; cancel it from **Requests**.
Titles you pass are never shown again. Titles you mark as seen, and titles you
request, shape your next picks.

## Where the picks come from

- **Movies and series:** recommendations for titles you swiped right on, marked
  as seen, or recently requested, from TMDB. New users start with this week's
  trending titles.
- **Books:** titles that share subjects with books you liked, from Open Library.
  New users start with trending books.

Titles you already have, already requested, or already swiped are left out.

## Preferences

Select **Preferences** to choose whether a right swipe on a series requests the
first season or every season, and whether a book request is for the audiobook
or the ebook. When an administrator has turned on AI ordering, you can also
describe what you are in the mood for; the AI uses it to order your picks.

## For administrators

Swipe is on by default for everyone who can make requests. Turn it off, or set
up AI ordering, under **Settings → Services → Swipe Discovery**.

AI ordering is optional. Choose a provider:

- **Anthropic Claude**: enter an Anthropic API key. The default model is
  `claude-opus-5-5` at Low effort.
- **OpenAI or compatible**: enter the base URL and model name. Use
  `https://api.openai.com/v1` with an OpenAI key, or a local OpenAI-compatible
  server such as Ollama (`http://ollama:11434/v1`) or LM Studio, which usually
  need no key. SeerrNG asks for a JSON-schema reply and falls back to plain JSON
  mode for servers that do not support schemas.

The AI only reorders the titles SeerrNG already picked and adds a short reason
to each; it cannot add titles. If the AI is unavailable, declines, or returns
an invalid answer, the deck keeps its normal order. When AI ordering is on,
deck titles, the user's swipe history, and their mood notes are sent to the
provider (nothing leaves your network with a local server). Use **Test AI Ordering** to check the key and model.
