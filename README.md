# מערכת יומן מדורי לניהול עבודה מהבית והיעדרויות

מערכת Web פשוטה לניהול יומן אישי, יומן מדורי, הרשאות עובד/מנהל, אישורי מנהל, צבע קבוע לעובד וייצוא CSV.

## משתמש ראשוני

- תעודת זהות: `000000000`
- הרשאה: מנהל

לאחר כניסה ראשונית מומלץ ליצור משתמשי מנהל/עובדים אמיתיים ולמחוק או להשאיר את המשתמש הראשוני לפי הצורך.

## הרצה מקומית

```bash
cp .env.example .env
npm install
npm start
```

כניסה בדפדפן:

```text
http://localhost:3000
```

## הרצה עם Docker

```bash
cp .env.example .env
docker compose up --build
```

## שמירת נתונים קבועה

קובץ הנתונים נשמר כאן:

```text
database/attendance.db
```

ב-Docker מוגדר Volume כך שהתיקייה `database` נשמרת מחוץ לקונטיינר ולא נמחקת בכל הפעלה.

## ייצוא CSV

קבצי CSV נוצרים בתיקייה:

```text
exports/
```

אפשר להפעיל ייצוא אוטומטי דרך `.env`:

```text
AUTO_EXPORT_ENABLED=true
AUTO_EXPORT_CRON=0 1 * * *
```

## מבנה הפרויקט

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
