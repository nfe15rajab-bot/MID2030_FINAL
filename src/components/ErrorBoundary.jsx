import React from 'react'

// Last-resort rendering safety net. Without this, ANY uncaught error
// during render (a corrupted saved record, a rare edge case) unmounts
// the entire React tree — exactly the "blank page" failure reported for
// the fiche photo-import bug. Purely a rendering catch: it never reads,
// clears, or otherwise touches localStorage/Firestore, so a teammate's
// saved layers, fiche research, and uploaded photos are untouched by
// whatever tripped this — only the current page's render is affected.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Uncaught render error:', error, info)
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: 'sans-serif', maxWidth: 640, margin: '60px auto', color: '#222' }}>
          <h2>Something went wrong</h2>
          <p>
            The page hit an unexpected rendering error. Nothing saved — layers, fiche research,
            uploaded photos — was touched by this; it only affected this render.
          </p>
          <pre style={{ background: '#f5f5f5', padding: 12, borderRadius: 6, overflow: 'auto', fontSize: 12 }}>
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button type="button" onClick={this.handleReload} style={{ marginTop: 16, padding: '8px 16px' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
