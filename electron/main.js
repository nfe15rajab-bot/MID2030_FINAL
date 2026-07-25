// Desktop shell for teammates who can't reach a working web deployment —
// wraps the same static build (`npm run build`'s dist/) that Vercel would
// otherwise serve. Deliberately does NOT bundle server/*.js — those need
// GEMINI_API_KEY/ORS_API_KEY, and embedding either in a file every
// teammate downloads would hand out the real key. AI material search and
// real-road routing just fail over the network the same way they would on
// a flaky connection; every call site for those already has its own
// try/catch and shows a "search/lookup failed" message rather than
// crashing — see FieldSuggest.jsx, FicheTechniquePanel.jsx's
// fetchAndUpgradeRoute, etc. Section/PDF generation, Firestore team sync,
// and the quick-preview PDF export are all client-side (html2canvas +
// jsPDF, or Firestore's own SDK) and need nothing from this process beyond
// a window to run in.
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'MID 2030 — Model 1 Assembly Builder',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // vite.config.js already sets base: './' (relative asset paths) — that's
  // what makes loadFile's file:// origin resolve /assets/... correctly;
  // without it every asset request 404s under file://.
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
