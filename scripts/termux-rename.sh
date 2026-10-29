#!/data/data/com.termux/files/usr/bin/bash
# Rename the GitHub repository QuillLens -> Annes-lens and update the local checkout.
#
# Run in Termux (works in any bash with git and the GitHub CLI):
#   pkg install -y git gh
#   gh auth login            # GitHub.com, HTTPS, log in with a browser; grant "repo" scope
#   gh auth setup-git
#   termux-setup-storage     # once, so ~/storage/downloads exists
#   bash ~/storage/downloads/termux-rename.sh                  # rename on GitHub and fix the local remote
#   bash ~/storage/downloads/termux-rename.sh --update-links   # also rewrite the links in the source, commit and push
#
# Environment overrides: OWNER (default socrtwo), OLD (default QuillLens), NEW (default Annes-lens),
# OLD_DIR (default ~/QuillLens), NEW_DIR (default ~/Annes-lens).
# Safe to re-run: each step checks whether it was already done.
set -euo pipefail

OWNER="${OWNER:-socrtwo}"
OLD="${OLD:-QuillLens}"
NEW="${NEW:-Annes-lens}"
OLD_DIR="${OLD_DIR:-$HOME/$OLD}"
NEW_DIR="${NEW_DIR:-$HOME/$NEW}"

for tool in git gh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "✗ $tool is missing. In Termux: pkg install -y git gh"; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo "✗ Not logged in to GitHub. Run: gh auth login && gh auth setup-git"; exit 1; }

echo "== GitHub repository"
if gh repo view "$OWNER/$NEW" --json name >/dev/null 2>&1; then
  echo "✓ $OWNER/$NEW already exists"
elif gh repo view "$OWNER/$OLD" --json name >/dev/null 2>&1; then
  gh repo rename "$NEW" -R "$OWNER/$OLD" --yes
  echo "✓ renamed $OWNER/$OLD to $OWNER/$NEW (GitHub keeps a redirect from the old name)"
else
  echo "✗ Neither $OWNER/$OLD nor $OWNER/$NEW exists on GitHub"; exit 1
fi

echo "== Local checkout"
if [[ -d "$OLD_DIR/.git" && ! -e "$NEW_DIR" ]]; then
  mv "$OLD_DIR" "$NEW_DIR"
  echo "✓ moved $OLD_DIR to $NEW_DIR"
fi
if [[ ! -d "$NEW_DIR/.git" ]]; then
  git clone "https://github.com/$OWNER/$NEW.git" "$NEW_DIR"
  echo "✓ cloned into $NEW_DIR"
fi
cd "$NEW_DIR"
git remote set-url origin "https://github.com/$OWNER/$NEW.git"
git fetch -q origin
echo "✓ origin is $(git remote get-url origin)"

# Optional: rewrite the old address inside the repository and commit.
# Only the repository URL changes. The app id (io.github.socrtwo.quilllens), the npm name, the
# binary name QuillLens and the settings folder stay, so installed Android and desktop builds keep
# their identity and their settings.
if [[ "${1:-}" == "--update-links" ]]; then
  echo "== Updating links in the source"
  FILES=$(grep -rl "github.com/$OWNER/$OLD" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=android --exclude-dir=ios . || true)
  if [[ -n "$FILES" ]]; then
    echo "$FILES" | xargs sed -i "s#github.com/$OWNER/$OLD#github.com/$OWNER/$NEW#g"
  fi
  [[ -f scripts/termux-setup.sh ]] && sed -i "s/^REPO=\"\${REPO:-$OLD}\"/REPO=\"\${REPO:-$NEW}\"/" scripts/termux-setup.sh
  [[ -f scripts/termux-build.sh ]] && sed -i "s#QL_DIR=\"\${QL_DIR:-\$HOME/$OLD}\"#QL_DIR=\"\${QL_DIR:-\$HOME/$NEW}\"#" scripts/termux-build.sh
  if git diff --quiet; then
    echo "✓ no links to update"
  else
    LOGIN="$(gh api user --jq .login)"
    UID_NUM="$(gh api user --jq '.id|tostring')"
    git add -A
    git -c user.name="$LOGIN" -c user.email="${UID_NUM}+${LOGIN}@users.noreply.github.com" commit -q -m "Rename repository to $NEW"
    git push -u origin "$(git rev-parse --abbrev-ref HEAD)"
    echo "✓ links updated, committed and pushed"
  fi
fi

echo
echo "Done: https://github.com/$OWNER/$NEW"
