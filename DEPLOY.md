# Deploy Recurrence Lab to Netlify

Two paths — pick one. Everything build-side is already done (`netlify.toml`
is in the repo, all files committed).

## Path A — Git-connected (recommended; auto-deploys on every push)

### One-time setup

1. **Create an empty GitHub repo** (no README, no .gitignore — this repo
   already has them). Name it e.g. `recurrence-lab`.
   → https://github.com/new

2. **Copy the remote URL** GitHub shows you, e.g.
   `https://github.com/youruser/recurrence-lab.git`

3. **From your machine**, in the folder containing this repo, run:

   ```bash
   # If you received this as a git bundle (recurrence-lab.bundle):
   git clone recurrence-lab.bundle recurrence-lab
   cd recurrence-lab

   # Point it at your GitHub repo and push:
   git remote add origin https://github.com/youruser/recurrence-lab.git
   git push -u origin main
   ```

   If you already have the repo as a folder (not a bundle), just `cd` into it
   and run the `git remote add` + `git push -u origin main` lines.

4. **In Netlify:** https://app.netlify.com → **Add new site → Import an
   existing project** → pick the `recurrence-lab` repo.

5. **Build settings** — Netlify reads `netlify.toml` automatically. Verify:
   - **Build command:** *(leave empty)*
   - **Publish directory:** `.`
   - **Branch:** `main`

6. **Deploy.** Done. Every future `git push` to `main` auto-deploys.

### Subsequent updates

```bash
# Edit files, then:
git add -A
git commit -m "your change"
git push
```

Netlify rebuilds and ships automatically. No build step runs — the repo root
is served as-is.

## Path B — Drag-and-drop (fastest; no Git)

1. **Zip the repo folder:**
   ```bash
   cd recurrence-lab
   # From the parent directory, exclude .git if you like:
   zip -r recurrence-lab.zip recurrence-lab -x '*.git*'
   ```

2. **Drop the zip onto** https://app.netlify.com/drop

3. Live in ~10 seconds. You'll get a temporary URL; rename it in
   **Site settings → Domain management**.

> Path B does **not** auto-deploy on future changes — re-drop the zip each
> time you update. Switch to Path A when you want auto-deploy.

## Verify the deploy

After deploy, open the Netlify URL. You should see:
- The Recurrence Lab intake with the **Real lottery dataset library** panel
  populated with 5 dataset cards (Canada 6/49, US Powerball, US Mega
  Millions, UK Lotto, Philippine PCSO 6/49).
- A **Save to my library** button next to **Upload CSV / TXT** (enabled once
  you type/paste draws).
- The **Draw format preset** dropdown with 8 presets + Custom.

If the library panel shows a fetch error instead of cards, the
`/datasets/manifest.json` path isn't being served — check that
`datasets/manifest.json` is present in the deployed folder and that the
publish directory is `.` (repo root), not a subfolder.

## Local preview before deploying

```bash
# Option 1: npx serve (no install)
npx serve .

# Option 2: Python stdlib
python3 -m http.server 8000
```

Then open the printed URL. The library fetch only works over http(s), not
`file://` — that's a browser security rule, not a bug.
