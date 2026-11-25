# IKLens

Static web app (HTML + JS modules) backed by Firebase (Auth + Realtime Database) and Cloudinary (image uploads). Hosted on Netlify.

```
IKLENS/
├── index.html            landing page (public)
├── login.html, signup.html, reset.html   authentication
├── dashboard.html        app shell; views load from js/views/
├── error.html            standalone error page
├── robots.txt, sitemap.xml, _headers     search + security headers (Netlify)
├── admin/                admin panel (login + home); access checked against `admins/{uid}` in the database
├── pages/                about, privacy, terms
├── js/
│   ├── firebase-config.js, app.js, router.js, design-system.css
│   ├── dashboard-boot.js, dashboard-init.js
│   └── views/            home, gallery, explore, generate, submit, profile, notification
└── images/               site images (category-*.jpg are used by the app; og-image.jpg is the social preview)
```

## Notes
- New users can choose which categories they want template alerts for (saved at `users/{uid}/profile/followedCategories`, editable on the Profile page). When the admin publishes a template, only users who follow its category are notified. Accounts that never chose still get everything.
- Gender and favorite styles at signup are optional.
- All data access is protected by Firebase Realtime Database rules, which are managed in the Firebase console (not stored in this repo).
