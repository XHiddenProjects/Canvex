# ForgeEngine Desktop / Windows Installer

This folder contains the desktop shell only. It deliberately does **not** duplicate ForgeEngine's editor or engine code.

## Design goals

- Keep Gavin's existing browser development workflow intact.
- Run the existing Express API/editor inside an Electron desktop window.
- Store writable user data outside the installed application directory.
- Pick a free localhost port automatically.
- Make packaging repeatable through npm scripts.
- Keep the desktop layer small so future engine modules normally require no installer changes.

## Development

Install dependencies once:

```bash
npm install
```

Run the existing browser version:

```bash
npm run dev
```

Run the desktop version:

```bash
npm run desktop
```

## Build the Windows installer

On Windows:

```bash
npm run dist:win
```

The installer will be written to `dist/` and uses NSIS through `electron-builder`.

## Data location

Desktop builds set `FORGE_DATA_ROOT` to Electron's per-user `userData` directory. That keeps `.forge/account.json`, `games/`, scenes and uploaded assets writable and safe across application updates.

For testing, the location can be overridden:

```powershell
$env:FORGE_DESKTOP_DATA_ROOT="C:\Temp\ForgeEngine-Test"
npm run desktop
```

## Extension rule

New engine/editor features should normally be added to `core/`, `src/`, `assets/`, `public/`, `2d/`, `3d/` or `utils/`. The installer automatically packages those folders, so adding normal ForgeEngine modules should not require edits to `desktop/main.js`.

Only edit the desktop shell when ForgeEngine needs OS-level desktop behavior, such as native file dialogs, protocol handlers, auto-update support, crash reporting, or additional windows.
