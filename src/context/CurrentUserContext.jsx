import React, { createContext, useCallback, useContext, useState } from 'react'
import {
  getActiveSession,
  startGroup2Session,
  startOtherSession,
  clearActiveSession,
  isAdmin as computeIsAdmin,
  sessionOwnerName,
} from '../lib/sessionScope.js'

// Single source of truth for "who's logged in, and in which session" —
// backed by sessionScope.js (localStorage), same as before this context
// only tracked a bare name. Exists as context (not just App.jsx-local
// state) so components several levels deep — like LayerBuilder's per-layer
// FieldSuggest rows and MaterialSearchPanel — can read/tag the current
// user without prop-drilling `owner` through every intermediate component.
//
// `currentUser` keeps its original contract (a plain string to attribute
// saves to) for every existing read-only consumer — it's now
// sessionOwnerName() under the hood (the Group 2 name, or an Other
// session's group name), so nothing downstream needed to change.
const CurrentUserContext = createContext(null)

function deriveState() {
  const session = getActiveSession()
  return {
    group: session.group,
    groupName: session.groupName,
    sessionId: session.sessionId,
    currentUser: sessionOwnerName(),
    isAdmin: computeIsAdmin(),
  }
}

export function CurrentUserProvider({ children }) {
  const [state, setState] = useState(deriveState)

  const selectGroup2 = useCallback((name) => {
    startGroup2Session(name)
    setState(deriveState())
  }, [])

  const selectOther = useCallback((groupName) => {
    startOtherSession(groupName)
    setState(deriveState())
  }, [])

  const switchSession = useCallback(() => {
    clearActiveSession()
    setState(deriveState())
  }, [])

  return (
    <CurrentUserContext.Provider value={{ ...state, selectGroup2, selectOther, switchSession }}>
      {children}
    </CurrentUserContext.Provider>
  )
}

/**
 * @returns {{
 *   currentUser: string, group: 'group2'|'other'|null, groupName: string|null,
 *   sessionId: string|null, isAdmin: boolean,
 *   selectGroup2: (name: string) => void, selectOther: (groupName: string) => void,
 *   switchSession: () => void,
 * }}
 */
export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext)
  if (!ctx) throw new Error('useCurrentUser must be used within a CurrentUserProvider')
  return ctx
}
