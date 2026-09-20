# ContactCheck

**Find the best public contact route for any business website.**

ContactCheck is an Apify Actor designed for AI agents, automations, lead workflows, research systems, and human users that need one structured answer:

> Given this company and my intent, how should I contact them?

Instead of returning an unranked pile of scraped emails, ContactCheck inspects the company's public website, discovers relevant contact pages, extracts public contact channels, and ranks them for the requested intent.

## Why ContactCheck

Raw contact extraction is easy. Choosing the appropriate route is the useful part.

ContactCheck can distinguish between intents such as:

- sales
- partnership
- support
- press / media
- careers
- general enquiries

It returns the best route with a confidence score and evidence, while preserving the other public options it found.

## Input

```json
{
  "domain": "example.com",
  "intent": "sales",
  "maxPages": 8
}
```

Only `domain` is required.

## Output

```json
{
  "domain": "example.com",
  "intent": "sales",
  "contactable": true,
  "bestContact": {
    "value": "sales@example.com",
    "type": "email",
    "confidence": 0.96,
    "sourceUrl": "https://example.com/contact",
    "reasons": [
      "publicly listed on company website",
      "matches company domain",
      "mailbox matches requested intent"
    ]
  },
  "emails": [],
  "phones": [],
  "contactForms": [],
  "socialProfiles": [],
  "pagesChecked": [],
  "checkedAt": "2026-09-20T00:00:00.000Z"
}
```

## Agent use cases

- Outbound agent: qualify a company, then ask ContactCheck for the best sales route.
- Support agent: locate the company's official support channel.
- Partnership agent: identify a public partnerships or business-development route.
- Research agent: establish whether a company publishes a usable contact channel.
- Recruiting workflow: locate the appropriate careers or talent contact route.

## How it works

1. Normalizes the supplied domain.
2. Loads the company homepage.
3. Prioritizes contact, about, team, and intent-specific pages.
4. Extracts public email addresses, phone numbers, forms, and social profiles.
5. Scores routes based on domain match, page context, mailbox role, and requested intent.
6. Returns the highest-ranked route plus evidence.

## Privacy and responsible use

ContactCheck only extracts contact information that is publicly exposed on the supplied company's website. Users are responsible for complying with applicable privacy, marketing, anti-spam, and data-protection laws.

## API

As an Apify Actor, ContactCheck can be run from the Apify Console, REST API, schedules, webhooks, integrations, and agent/tooling layers supported by Apify.

## Current version

v0.1.0
