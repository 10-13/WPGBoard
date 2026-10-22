"""Build the four releases from tracked data, then prepare a GitHub Pages artifact."""
import subprocess
import sys

sys.dont_write_bytecode = True
from release_layout import ROOT
from pages_site import build_site

if __name__ == '__main__':
    subprocess.run([sys.executable, str(ROOT / 'build.py')], check=True)
    target = build_site()
    print(f'Pages site: {target} (four HTML releases, four JSON parties and index)')
