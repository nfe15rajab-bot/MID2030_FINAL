import appletConfig from '../../firebase-applet-config.json'

const OAUTH_CLIENT_ID = appletConfig.oAuthClientId || appletConfig.clientId || '554420918216-dm2thiheujc80cq47o279c5a3h7jume9.apps.googleusercontent.com'

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/presentations'
]

let cachedAccessToken = null
let currentUser = null

/**
 * Dynamically loads Google Identity Services (GIS) library script if not already present.
 */
function loadGisScript() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      return resolve(window.google)
    }
    const existing = document.getElementById('gis-client-script')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', (e) => reject(new Error('Failed to load Google Identity Services.')))
      return
    }
    const script = document.createElement('script')
    script.id = 'gis-client-script'
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.google)
    script.onerror = () => reject(new Error('Failed to load Google Identity Services SDK.'))
    document.head.appendChild(script)
  })
}

export function initGoogleAuth(onAuthSuccess, onAuthFailure) {
  // Preload GIS script
  loadGisScript().catch((err) => console.warn('GIS preload warning:', err))

  if (cachedAccessToken && currentUser) {
    if (onAuthSuccess) onAuthSuccess(currentUser, cachedAccessToken)
  } else {
    if (onAuthFailure) onAuthFailure()
  }

  return () => {}
}

export async function googleSignIn() {
  await loadGisScript()

  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      return reject(new Error('Google Identity Services SDK is unavailable in this environment.'))
    }

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: OAUTH_CLIENT_ID,
        scope: GOOGLE_SCOPES.join(' '),
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            console.error('GIS OAuth Error:', tokenResponse)
            return reject(
              new Error(tokenResponse.error_description || tokenResponse.error || 'Google Authentication failed.')
            )
          }

          cachedAccessToken = tokenResponse.access_token

          // Fetch user profile from Google OAuth2 userinfo endpoint
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${cachedAccessToken}` }
            })
            if (userRes.ok) {
              const profile = await userRes.json()
              currentUser = {
                displayName: profile.name || profile.given_name || 'Google User',
                email: profile.email || 'authenticated@google.com',
                photoURL: profile.picture || null
              }
            } else {
              currentUser = {
                displayName: 'Authenticated Google User',
                email: 'Connected to Google Workspace'
              }
            }
          } catch (e) {
            currentUser = {
              displayName: 'Authenticated Google User',
              email: 'Connected to Google Workspace'
            }
          }

          resolve({ user: currentUser, accessToken: cachedAccessToken })
        }
      })

      tokenClient.requestAccessToken({ prompt: 'consent' })
    } catch (err) {
      console.error('initTokenClient Error:', err)
      reject(err)
    }
  })
}

export function getCachedAccessToken() {
  return cachedAccessToken
}

export function getCurrentGoogleUser() {
  return currentUser
}

export async function googleSignOut() {
  if (cachedAccessToken && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(cachedAccessToken, () => {})
    } catch (e) {
      console.warn('Token revocation error:', e)
    }
  }
  cachedAccessToken = null
  currentUser = null
}
