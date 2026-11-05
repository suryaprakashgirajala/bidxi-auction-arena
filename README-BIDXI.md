# BIDXI branding update (V7 + brand integration)

This package applies the V7 player-pool/player-management update and adds the BIDXI visual identity.

## What changes
- BIDXI logo in the application header, home hero, and login/register card
- Browser tab title, SVG favicon, ICO fallback, Apple touch icon, and web manifest
- Retains V7 player catalogue and player-avatar files
- Does not overwrite `.env` files or the SQLite database

## Install
Stop both development servers. Extract the ZIP. From PowerShell in the extracted folder run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Install-BIDXI-Branding.ps1 -ProjectPath "C:\path\to\IPL-Auction-Arena"
```

The installer makes a timestamped backup of every file it replaces.

After installation, from the project backend folder run `npm install`, `npm run check`, `npm test`, then `npm run dev`. From a second terminal, run `npm start` in the frontend folder. Refresh with Ctrl+F5.

The logo artwork is included locally, so it does not need a third-party image host.
