#!/bin/bash
# Garante a skill design-n1 no escopo do usuário (~/.claude/skills), em toda sessão.
DEST="$HOME/.claude/skills/design-n1"
if [ -d "$DEST/.git" ]; then
  git -C "$DEST" pull --ff-only -q >/dev/null 2>&1 || true
else
  mkdir -p "$HOME/.claude/skills"
  git clone -q --depth 1 https://github.com/nilmaadvancedsystems/desing-n1 "$DEST" >/dev/null 2>&1 || true
fi
exit 0
