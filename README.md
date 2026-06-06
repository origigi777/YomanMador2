# Department Attendance & Remote Work Management System

A lightweight web-based system for managing personal calendars, department-wide calendars, employee/manager permissions, manager approvals, employee color coding, and CSV exports.

## Default Administrator Account

* ID Number: `000000000`
* Role: Administrator

After the first login, it is recommended to create real administrator and employee accounts and either remove or keep the default administrator account as needed.

## Local Development

```bash
cp .env.example .env
npm install
npm start
```

Open in your browser:

```text
http://localhost:3000
```

## Running with Docker

```bash
cp .env.example .env
docker compose up --build
```

## Persistent Data Storage

The database file is stored in:

```text
database/attendance.db
```

Docker volumes are configured so the `database` directory is stored outside the container and is not deleted when the container is restarted.

## CSV Export

CSV files are generated in:

```text
exports/
```

Automatic exports can be enabled through the `.env` file:

```text
AUTO_EXPORT_ENABLED=true
AUTO_EXPORT_CRON=0 1 * * *
```

## Project Structure

```text
attendance-system/
├── server.js
├── package.json
├── Dockerfile
├── docker-compose.yml
├── database/
├── exports/
└── public/
    ├── index.html
    ├── app.js
    ├── style.css
    ├── manifest.json
    └── service-worker.js
```

## Features

* Personal calendar for each employee
* Shared department calendar
* Employee and administrator roles
* Approval workflow for attendance and remote work events
* Employee-specific color coding
* Mobile-friendly responsive design
* Progressive Web App (PWA) support
* CSV export and backup capabilities
* Docker deployment support
* SQLite-based persistent storage
