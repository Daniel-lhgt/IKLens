// IKLens — Shared Firebase Configuration

import {
  initializeApp,
  getApp,
  getApps
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

import {
  getDatabase
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

import {
  getStorage
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-storage.js";

// Your existing Firebase project configuration
const firebaseConfig = {
  apiKey: "AIzaSyALa_PGUuqqo6dndDrsq5wTkkvuPjjggok",
  authDomain: "iklens-9354a.firebaseapp.com",
  databaseURL: "https://iklens-9354a-default-rtdb.firebaseio.com",
  projectId: "iklens-9354a",
  storageBucket: "iklens-9354a.firebasestorage.app",
  messagingSenderId: "393017001832",
  appId: "1:393017001832:web:b750e8a3013148e21778dd",
  measurementId: "G-MCSFX5BL5M"
};

// Initialize Firebase once
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Shared Firebase services
export const auth = getAuth(app);
export const database = getDatabase(app);
export const storage = getStorage(app);

export { app };