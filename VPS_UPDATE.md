# Update the VPS and restart the app

Use this after new code is on `main` at https://github.com/elektran-services/mantrac-dashboard.

PM2 runs a production build (`next start`), not the dev server. Pulling the code is not enough. Install dependencies, build, then restart both processes.

Saved report folders and `.env.local` stay on the server. Do not delete them.

## 1. Sign in and open the app folder

```bash
ssh user@your-vps
cd /path/to/mantrac-dashboard
```

Replace `user@your-vps` and `/path/to/mantrac-dashboard` with the real SSH login and the folder where this repo is cloned.

## 2. Confirm what is running

```bash
git status -sb
npm run pm2:status
```

`git status` should show branch `main`. Local files that are normal and should stay:

- `.env.local`
- `mileage_report/`
- `mileage_overall_report/`
- `trips/`
- `parking_reports/`
- `offline_reports/`
- `generated_reports/`
- `logs/`

## 3. Pull the latest code

```bash
git pull origin main
```

If Git refuses because a tracked file was edited on the server, look at `git status` first. Keep `.env.local` and the report folders. Only discard a change when you know the server copy is not needed:

```bash
git checkout -- path/to/changed-file
git pull origin main
```

## 4. Install dependencies and build

```bash
npm install
npm run build
```

`npm install` picks up any new packages. `npm run build` creates the production files that `next start` serves.

## 5. Restart the app

```bash
npm run pm2:restart
npm run pm2:status
```

That restarts both processes:

- `nextjs-server` — the dashboard (port `3001` unless `MANTRAC_PORT` is set)
- `monitoring-service` — the scheduled report jobs

If the processes are not in PM2 yet:

```bash
npm run pm2:start
pm2 save
```

## 6. Check that it came back up

```bash
pm2 logs nextjs-server --lines 40
pm2 logs monitoring-service --lines 40
```

`nextjs-server` should be `online`. Open the dashboard in a browser and sign in.

Press `Ctrl+C` to leave the log view. The app keeps running.

## Restart one process only

```bash
pm2 restart nextjs-server
pm2 restart monitoring-service
```

Restart `monitoring-service` as well whenever the scheduled jobs changed. A dashboard-only change still needs `npm run build` before restarting `nextjs-server`.
