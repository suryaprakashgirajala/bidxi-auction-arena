# IPL Auction Arena V7 — Player Management, Expanded Pool & Auction Analytics

V7 is an update for an existing V6 installation. Use the **V7 update ZIP** and installer to preserve your current account database and environment files.

## What's new

### Expanded player pool and images
- The seeded Arena pool grows from 75 to **263 players**.
- Role counts: 71 batters, 81 bowlers, 42 wicketkeepers and 69 all-rounders.
- Nationality split in this seed data: 153 domestic and 110 overseas.
- Every seeded player has a local SVG fallback profile image. Eight existing IPL headshot URLs are retained as primary images where available; the other 255 use Arena illustrated profile artwork, not a claim that they are real photographs. The local fallback also exists for the eight headshot players in case an external image does not load.
- The pool is an expanded game seed catalogue, not a verified official active-player or current-season shortlist. Review/update records before using it for a season-specific simulation.

### Player management
- Authenticated `Player Management` screen with search by name/nationality/role and role filters.
- Add custom players with role, nationality, base price, Arena rating and optional PNG/JPG/WEBP profile image (up to 600 KB).
- Edit or remove player entries you added. Built-in seed records are read-only.
- Import up to 250 custom rows per CSV import and export the current visible catalogue.
- CSV headers: `name,role,nationality,basePrice,arenaRating,image`.
- Supported role values: `Batter`, `Bowler`, `Wicket Keeper`, `All Rounder`.

### Auction analytics
- Personal archive-based overview: auctions played, players sold, combined spend, average spend per auction and overseas pool count.
- Spend by role, top signing, most-purchased player names, franchise expenditure and recent completed auctions.
- Analytics are based on completed auctions in which the logged-in user participated; they are not global platform-wide statistics.

### Pre-auction pool review
- When the creator starts the room, the room moves to a review screen rather than immediately opening the first lot.
- Shows total player count and names grouped by Batter, Bowler, Wicket Keeper and All Rounder.
- Each category is split into domestic and overseas players with base prices and profile thumbnails.
- Every connected human participant must click **OK, START AUCTION**. The auction begins automatically when everyone has confirmed.

### Live remaining-player queue
- The live auction screen now shows players remaining by role, split into domestic and overseas names.
- Counts include the player currently on the auction block and the unsold queue after it.

## Install V7 over V6

1. Stop backend and frontend terminals with `Ctrl+C`.
2. Extract `IPL-Auction-Arena-v7-update.zip` to a new folder. The installer script is at the extracted folder's top level.
3. Open PowerShell in that extracted folder and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Install-V7-Update.ps1 -ProjectPath "C:\Users\gsp56\OneDrive\Documents\Desktop\IPL-Auction-Arena-auth-v2\IPL-Auction-Arena"
```

4. The installer creates a timestamped backup inside the existing project at `backups\v7-backup-*` and updates only the V7 files and player avatar assets.
5. It does **not** replace `backend\.env`, `frontend\.env`, `backend\data\arena.sqlite` or `node_modules`.

## Verify and start

Backend terminal:

```powershell
cd "C:\Users\gsp56\OneDrive\Documents\Desktop\IPL-Auction-Arena-auth-v2\IPL-Auction-Arena\backend"
npm run check
npm test
npm run dev
```

Frontend terminal:

```powershell
cd "C:\Users\gsp56\OneDrive\Documents\Desktop\IPL-Auction-Arena-auth-v2\IPL-Auction-Arena\frontend"
npm start
```

Expected backend tests: **17 passed, 0 failed**.

Open `http://localhost:3000`, log in, and use the new `PLAYER POOL` and `ANALYTICS` navigation buttons.

## Database and compatibility notes

- V7 adds/ensures the `player_catalog` table and seeds the 263 built-in player records. Existing built-in catalogue records are refreshed from the new seed JSON so their updated image paths and metadata are used; user-added entries are not overwritten.
- The current SQLite archive tables and existing accounts are retained.
- Active auction rooms are still held in server memory. This release does not yet add active-room recovery after a backend restart.
- No new third-party npm runtime dependency is introduced by V7.
