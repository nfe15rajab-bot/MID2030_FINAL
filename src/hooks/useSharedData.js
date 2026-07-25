import { useEffect, useState } from 'react'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../firebaseConfig.js'

// Subscribes to one Firestore document in real time, so every team member
// sees the same doc update live with no refresh needed — used for "last
// edited by / at" banners (see LayerBuilder.jsx, MaterialSearchPanel.jsx).
// Falls back to `fallbackData` whenever Firestore is unreachable (offline,
// blocked, misconfigured) or the doc doesn't exist yet — this hook is
// meant to sit in front of an existing local dataset, not be a hard
// dependency the app breaks without.
//
// `path` is a Firestore doc path with an even number of segments, e.g.
// "sharedData/materialData".
export function useSharedData(path, fallbackData = null) {
  const [state, setState] = useState({ data: fallbackData, loading: true, source: 'pending', error: null })

  useEffect(() => {
    if (!path) {
      setState({ data: fallbackData, loading: false, source: 'fallback', error: null })
      return
    }
    setState((s) => ({ ...s, loading: true }))

    let ref
    try {
      ref = doc(db, path)
    } catch (err) {
      setState({ data: fallbackData, loading: false, source: 'fallback', error: err.message })
      return
    }

    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        setState({
          data: snap.exists() ? snap.data() : fallbackData,
          loading: false,
          source: 'firestore',
          error: null,
        })
      },
      (err) => {
        console.warn(`[useSharedData] Firestore unreachable for "${path}", using local fallback:`, err.message)
        setState({ data: fallbackData, loading: false, source: 'fallback', error: err.message })
      }
    )
    return unsubscribe
    // fallbackData is intentionally not a dependency — callers usually
    // pass a fresh literal/object each render, and re-subscribing on that
    // would tear down and reopen the Firestore listener every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return state
}

/**
 * Writes (merges) data into a Firestore document. Not tied to
 * useSharedData's subscription — any caller, including plain non-React
 * modules (e.g. aiMaterialDataStorage.js), can call this directly to
 * save an edit without needing a live subscription of their own.
 *
 * @param {string} path - Firestore doc path, e.g. "sharedData/materialData".
 * @param {object} data - fields to merge into the document.
 */
export async function saveData(path, data) {
  const ref = doc(db, path)
  await setDoc(ref, data, { merge: true })
}
