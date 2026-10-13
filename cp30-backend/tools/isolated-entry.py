"""Fixed source CLI launcher; discard macOS/Python startup environment additions."""
import os
import sys
from pathlib import Path

def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise SystemExit('ISOLATED_PYTHON_REQUIRED')
    # env -i still produces these interpreter/platform entries on macOS.
    # Other inherited configuration remains an error, never an implicit input.
    if set(os.environ) - {'LC_CTYPE', '__CF_USER_TEXT_ENCODING'}:
        raise SystemExit('EMPTY_ENVIRONMENT_REQUIRED')
    os.environ.clear()
    entries = {'full-app': 'full-app.py', 'connection-bootstrap': 'connection-bootstrap.py', 'wallet-forward-extension': 'wallet-forward-extension.py'}
    if len(sys.argv) < 2 or sys.argv[1] not in entries:
        raise SystemExit('FIXED_SOURCE_ENTRY_REQUIRED')
    directory = Path(__file__).resolve().parent
    path = directory / entries[sys.argv[1]]
    sys.argv = [str(path), *sys.argv[2:]]
    sys.path.insert(0, str(directory))
    sys.path.insert(0, str(directory.parent / 'src'))
    import runpy
    runpy.run_path(str(path), run_name='__main__')

if __name__ == '__main__':
    main()
