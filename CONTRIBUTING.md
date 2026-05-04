# Contributing

Thanks for helping improve this project.

Repository: **https://github.com/bestpracticaI/kalshi-ai-trading-bot**

## Setup

- **Node.js** 18.18 or newer  
- **Git**

```bash
git clone https://github.com/bestpracticaI/kalshi-ai-trading-bot.git
cd kalshi-ai-trading-bot
npm install
npm run lint
npm run build
```

Copy `env.template` to `.env` for local integration tests against Kalshi (optional).

## Pull requests

1. Fork and create a focused branch.
2. Match existing TypeScript style (strict mode, ESM `.js` import suffixes in imports).
3. Run `npm run lint` (typecheck) before submitting.
4. Describe behavior changes clearly.

## Scope

This repository is **TypeScript / Node.js only**. Add strategies and persistence under `src/` following existing patterns (`clients/`, `jobs/`, `config/`).
