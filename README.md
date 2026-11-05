# IPL Auction Arena

A multiplayer cricket-auction game with human participants, AI-controlled franchises, live bidding, and account-based auction history.

## Current milestone

This version adds account registration/login and a persistent SQLite database while retaining the existing room and auction flow.

### Included in this version

- Create an account with display name, username, email, and password.
- Log in with email or username.
- Passwords are stored as salted `scrypt` hashes, not plain text.
- Signed seven-day JWT sessions for REST APIs and Socket.IO connections.
- Update your display name from My Account.
- Account statistics and completed-auction history.
- Completed auctions are archived with team squads and auction activity.
- Existing dynamic franchise count, friend rooms, AI franchises, bidding, and chat remain available.
- SQLite database file is created at `backend/data/arena.sqlite` by default.

## Requirements

- Node.js 20 or later
- npm

No separate database server is required for local development. The backend uses `sql.js` (SQLite compiled to WebAssembly) and writes the database file to disk.

## 1. Start the backend (Terminal 1)

```powershell
cd backend
npm install
```

Create `backend/.env` by copying `.env.example` if it does not already exist:

```powershell
Copy-Item .env.example .env
```

If you already have a `.env` file, keep your existing `PORT` and `CLIENT_ORIGIN` values and add these two settings:

```env
JWT_SECRET=replace-this-with-a-long-random-secret
DATABASE_FILE=./data/arena.sqlite
```

For a local development secret, generate a strong value with:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Copy the output into `JWT_SECRET` in `backend/.env`.

Start the backend:

```powershell
npm run dev
```

Confirm it is running at `http://localhost:4000/health`. The response should show `"status":"ok"` and `"database":"connected"`.

## 2. Start the frontend (Terminal 2)

Open a second terminal:

```powershell
cd frontend
npm install
```

Create the frontend environment file if it does not exist:

```powershell
Copy-Item .env.example .env
```

Start React:

```powershell
npm start
```

Open `http://localhost:3000`.

## 3. First-time use

1. Choose **Create Account**.
2. Enter a display name, username, email, and password (minimum 8 characters).
3. After registration, you will be signed in automatically.
4. Create an auction or join a friend's room.
5. Friends should each create their own account before joining.
6. At the end of an auction, the completed result is saved to the participants' **My Account → Auction history** pages.

## Important limitations in this milestone

- Account registration, login, profile updates, and completed-auction history are persisted in SQLite.
- Active room and live bidding state are still held in backend memory. Restarting the backend clears active rooms; completed results remain in the SQLite database.
- SQLite/WASM is used to make local setup simple. Before a public production launch with multiple server instances, migrate the storage layer to a managed PostgreSQL database and use secure, HTTP-only session cookies, rate limiting, and an email verification/password-reset provider.
- The current account flow does not yet include email verification, password reset, or social sign-in.
- Localhost is only for testing on your laptop. Friends outside your network need a deployed frontend and backend before they can join from their own devices.

## Main folders

```text
IPL-Auction-Arena/
├── backend/
│   ├── src/
│   │   ├── auth.js
│   │   ├── database.js
│   │   ├── players.json
│   │   └── server.js
│   ├── data/                 # Created automatically; contains arena.sqlite
│   └── package.json
└── frontend/
    ├── public/
    ├── src/
    │   ├── App.js
    │   ├── App.css
    │   └── data/
    └── package.json
```
