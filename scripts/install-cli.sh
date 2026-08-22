#!/usr/bin/env bash
# Put `shall` on your PATH without needing root.
#
# `npm link` writes into npm's global prefix, which on most Linux installs is a
# system directory and therefore needs sudo. This writes a two-line wrapper into
# ~/.local/bin instead, which is already on PATH on virtually every desktop
# distribution and needs no elevated permissions.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
TARGET="$BIN_DIR/shall"

if [ ! -f "$REPO/dist/shall/cli.js" ]; then
  echo "error: dist/shall/cli.js not found. Run 'npm run build' first." >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
cat > "$TARGET" <<EOF
#!/usr/bin/env bash
exec node "$REPO/dist/shall/cli.js" "\$@"
EOF
chmod +x "$TARGET"

echo "installed: $TARGET -> $REPO/dist/shall/cli.js"

case ":$PATH:" in
  *":$BIN_DIR:"*)
    echo "ready:     try  shall check examples/word-count.shall"
    ;;
  *)
    echo
    echo "$BIN_DIR is not on your PATH. Add it:"
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc && exec bash"
    ;;
esac
