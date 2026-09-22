# Naro docs site

Docusaurus site rendering the canonical `docs/` corpus — sources are **not**
copied; `docusaurus.config.ts` points the docs plugin at `../docs`.

```bash
npm i          # once
npm run dev    # http://localhost:3001/Naro/
npm run build  # static site → build/
```

Conventions:

- Edit markdown in `docs/`, never in `website/`.
- Links between docs pages resolve in place; links that escape `docs/`
  (e.g. `../cli/README.md`) are rewritten to GitHub blob URLs by
  `rewriteRepoLinks` in the config.
- New folders under `docs/` need a sidebar entry in `sidebars.ts`
  (top-level files are listed explicitly; `learn/` and `adr/` autogenerate).
- Deploy is automatic via `.github/workflows/docs.yml` → GitHub Pages
  (requires repo Settings → Pages → Source: GitHub Actions).
