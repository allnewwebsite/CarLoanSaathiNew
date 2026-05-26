# CarLoanSaathi

CarLoanSaathi is a full-stack dealership finance operating system for dealerships, salespersons, bank partners, and super admins.

## Stack

- Frontend: React, Vite, Tailwind CSS, React Router DOM, Axios, Firebase Authentication
- Backend: Node.js, Express.js, Firebase Admin SDK, JWT, Multer
- Database: Firebase Firestore
- Hosting: Vercel for frontend, Render or Railway for backend

## Structure

```txt
frontend/
  src/components
  src/pages
  src/layouts
  src/routes
  src/services
  src/context
  src/hooks
  src/assets
  src/styles
backend/
  controllers
  routes
  middleware
  services
  models
  validations
  firebase
  utils
  uploads
```

## Run Locally

```bash
cd frontend
npm install
npm run dev
```

```bash
cd backend
npm install
npm run dev
```

Copy `.env.example` to `.env` in both apps and fill Firebase and API values before production deployment.

## Demo Roles

The frontend includes demo login role selection for:

- Super Admin
- Dealership Admin
- Salesperson
- Bank Partner

Terminology is standardized around Bank Partner and Dealership Dashboard.
