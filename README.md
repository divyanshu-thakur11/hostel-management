# Hostel Management System

MERN stack project built for managing a local hostel. Made this because my father runs a hostel and was doing everything in registers and WhatsApp – so I thought why not make something useful.

Built with MongoDB, Express, React and Node.js (MERN stack). Deployed on Render with MongoDB Atlas.

---

## What it does

- Owner and manager login (different access levels)
- Register hostel members with photo-ready ID card
- Assign rooms, track rent, generate receipts
- Monthly electricity readings with bill calculation
- WhatsApp reminders for pending dues
- Police verification form in Hindi
- Final billing when a member vacates
- Dashboard with revenue charts
- Reports with CSV export
- Auto notifications for due dates and expiring plans
- Audit log so you can track who changed what
- Daily database backup

---

## Tech Stack

| Part | Tech |
|---|---|
| Backend | Node.js, Express |
| Frontend | React 18 |
| Database | MongoDB Atlas |
| Auth | JWT + HttpOnly cookies |
| Hosting | Render.com |
| Charts | Recharts |
| Search | Fuse.js (fuzzy) |

---

## How to run locally

You need Node.js 20 and MongoDB installed (or use Atlas free tier).

Create a `.env` file inside the `server/` folder:

```
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=anything_long_and_random
NODE_ENV=development
PORT=5000
```

Then:

```bash
# install everything
npm run install-all

# run backend (terminal 1)
npm run dev-server

# run frontend (terminal 2)
npm run dev-client
```

Frontend runs at `http://localhost:3000`, backend at `http://localhost:5000`.

Default login: `owner` / `owner123` – change it after first login.

---

## Deploying to Render

1. Push code to GitHub
2. Go to render.com → New Web Service → connect repo
3. Build command: `npm install --prefix server && npm install --prefix client && npm run build --prefix client`
4. Start command: `node server/index.js`
5. Add environment variables:
   - `MONGODB_URI` – Atlas connection string
   - `JWT_SECRET` – any random string
   - `NODE_ENV` – production
   - `PORT` – 10000

Takes about 5-8 minutes to build. Free tier spins down after inactivity (keep-alive ping is already set up in the code).

---

## Project Structure

```
├── server/
│   ├── controllers/       # member and receipt logic
│   ├── middleware/        # auth, error handling
│   ├── models/            # mongoose schemas
│   ├── routes/            # API endpoints
│   ├── services/          # notifications, audit
│   ├── utils/             # logger, validation, encryption
│   └── index.js
│
├── client/
│   └── src/
│       ├── pages/         # all page components
│       ├── context/       # hostel + toast context
│       ├── hooks/         # auto logout hook
│       └── utils/         # api calls
│
└── package.json           # root build scripts
```

---

## Known issues / limitations

- Free tier on Render sleeps after 15 min of no traffic (keep-alive helps but doesn't fully prevent it)
- No mobile app, just a responsive web UI
- Electric bill prediction is basic linear regression on last 6 readings
- WhatsApp integration uses wa.me links, not actual WhatsApp Business API

---

## Screenshots



---

## Made by

Divyanshu Singh Thakur 