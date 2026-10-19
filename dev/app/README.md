# Alpha Testbook App — Build & Release Verification

## 1. Source of Truth

All application source code is maintained in `dev/app/src/`.

The following files are generated release files and must never be edited manually:

- `index.html`
- `admin/index.html`

Always regenerate both files using the official build commands before running tests or creating a pull request.

## 2. Build Commands

Run all commands from the repository root.

### Build the Student App

```bash
python3 dev/app/build.py index.html