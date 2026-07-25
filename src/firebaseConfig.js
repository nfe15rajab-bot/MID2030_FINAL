// Shared real-time backend (Firestore) so all 6 team members see each
// other's λ/GWP edits live, Google-Docs style, instead of each person's
// accepted Suggest values being stuck in their own browser's localStorage.
//
// This config is not a secret — it's a client-side project identifier,
// not an access-control credential (Firestore's actual security rules,
// currently "test mode" = open read/write, are what gate access). Safe to
// commit. Test mode is fine for this class project's lifetime; don't
// leave it open on anything long-lived — see the team's Firestore setup
// notes in chat history for the tradeoff.
import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyCVTkAmos5QBHIxEnlD3z3jXEhiTK2kY4E',
  authDomain: 'midlca.firebaseapp.com',
  projectId: 'midlca',
  storageBucket: 'midlca.firebasestorage.app',
  messagingSenderId: '1032186811906',
  appId: '1:1032186811906:web:6433d7db1fec68406d391b',
  measurementId: 'G-SHFL1QWXVG',
}

const app = initializeApp(firebaseConfig)

// Firestore only — no Analytics. This app has no use for pageview/event
// analytics, and initializing it pulls in extra SDK weight and a
// same-origin-frame requirement that isn't worth it for a shared-data
// feature that's purely about Firestore reads/writes.
export const db = getFirestore(app)
