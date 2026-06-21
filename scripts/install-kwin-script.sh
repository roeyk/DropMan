#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "${script_dir}/.." && pwd)"
package_source="${repo_root}/kwin/dropman"
package_target="${HOME}/.local/share/kwin/scripts/dropman"

rm -rf "${package_target}"
mkdir -p "$(dirname -- "${package_target}")"
cp -a "${package_source}" "${package_target}"

echo "Installed DropMan KWin script to ${package_target}"
echo "Enable it in System Settings -> Window Management -> KWin Scripts."
