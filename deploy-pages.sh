#!/usr/bin/env bash
# Deploy Recurrence Lab to GitHub Pages (branch: gh-pages, root).
# One-time setup: in the repo's Settings → Pages, set Source = "Deploy from a
# branch", Branch = "gh-pages" / "(root)". After that, this script keeps the
# live site in sync with main.
#
# Requires: git, and push access to the repo.
set -euo pipefail

REPO="${1:-git@github.com:gracie007-cloud/recurrence-lab.git}"
WORK="$(mktemp -d)"
echo "Cloning $REPO ..."
git clone --quiet "$REPO" "$WORK/repo"
cd "$WORK/repo"

# gh-pages from main, serving the app at the branch root.
git checkout --quiet -B gh-pages origin/main
# Pages serves index.html by default; app.html is the self-contained fallback.
git push --quiet --force origin gh-pages

echo ""
echo "Done. GitHub Pages will build from the gh-pages branch."
echo "Site (once Pages source is set to gh-pages):"
echo "  https://gracie007-cloud.github.io/recurrence-lab/"
echo "Self-contained single file:"
echo "  https://gracie007-cloud.github.io/recurrence-lab/app.html"
