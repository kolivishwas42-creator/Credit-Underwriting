# Credit Underwriting console (frontend)

One React + Vite app for every agent: a tab bar lists the agents, clicking one opens its screen.
Design and conventions: [DESIGN.md](DESIGN.md). Design system: [../docs/DESIGN.md](../docs/DESIGN.md).

```powershell
npm install
npm run dev      # http://localhost:5190 — needs the backend on 8010 (LOS_API overrides)
npm run build    # -> dist\
npm test         # every agent's tests + the shell
```

* `src/shared/` — shell and shared components (Sidebar, Pagination, Loader, ErrorBoundary, theme, tokens)
* `src/agents/<agent>/` — one agent's screen; it calls only its own API base route (`src/config/agents.ts`)
