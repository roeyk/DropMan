#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/kwin/effects/dropman_slide"
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"

for target_dir in \
    "$data_home/kwin/effects/dropman_slide" \
    "$data_home/kwin-wayland/effects/dropman_slide"
do
    mkdir -p "$(dirname "$target_dir")"
    rm -rf "$target_dir"
    cp -a "$source_dir" "$target_dir"
    echo "Installed DropMan Slide KWin effect to $target_dir"
done

echo "Enable it in System Settings -> Window Management -> Desktop Effects."
