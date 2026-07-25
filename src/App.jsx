import React, { useCallback, useState } from 'react'
import ModelViewer from './components/ModelViewer.jsx'
import ConfiguratorPanel from './components/ConfiguratorPanel.jsx'
import SectionConfigurator from './components/SectionConfigurator.jsx'
import AssemblyAnalysisTab from './components/AssemblyAnalysisTab.jsx'
import LcaEpdTab from './components/LcaEpdTab.jsx'
import ProvidersTab from './components/ProvidersTab.jsx'
import TeamSummaryTab from './components/TeamSummaryTab.jsx'
import LcaSummaryTab from './components/LcaSummaryTab.jsx'
import SpreadsheetTab from './components/SpreadsheetTab.jsx'
import DeliverablesTab from './components/DeliverablesTab.jsx'
import IdentityPanel from './components/IdentityPanel.jsx'
import { CurrentUserProvider, useCurrentUser } from './context/CurrentUserContext.jsx'
import { hotspots } from './data/hotspots.js'
import 'leaflet/dist/leaflet.css'
import './styles.css'

const TABS = ['3D Model', 'Section Configurator', 'Assembly Analysis Preview', 'LCA and EPD', 'Materials and Providers', 'Team Summary', 'LCA Summary', 'Spreadsheet', 'Deliverables']

export default function App() {
  return (
    <CurrentUserProvider>
      <AppShell />
    </CurrentUserProvider>
  )
}

function AppShell() {
  const [activeTab, setActiveTab] = useState(TABS[0])
  const [activeSection, setActiveSection] = useState('wall')
  const [activeHotspot, setActiveHotspot] = useState(null)
  // Bubbled up from SectionConfigurator/LayerBuilder — whether the
  // currently-open section has edits that haven't been saved (and, for
  // Group 2, synced to Firestore). Only meaningful while
  // activeTab === 'Section Configurator'; guards navigating away from it
  // below instead of silently discarding those edits the way switching
  // tabs always used to.
  const [sectionConfiguratorDirty, setSectionConfiguratorDirty] = useState(false)
  const { currentUser, group, isAdmin } = useCurrentUser()

  // Stable reference on purpose — this sits in ModelViewer's own useEffect
  // dependency array, so a new function identity here would tear down and
  // reload the whole Three.js scene (including re-fetching the .glb) on
  // every unrelated App re-render (e.g. typing in the user select above).
  // Every hotspot now opens the same overlay panel — wall/roof/floor show
  // that section's own analysis progress (ConfiguratorPanel's
  // AssemblyProgressView), door/window/skylight show their spec card, same
  // as before. Wall/roof/floor used to jump straight to Section
  // Configurator instead; that's now one click further, via the panel's
  // own "Open in Section Configurator" button (handleOpenSectionConfigurator
  // below), so you can see progress without leaving the 3D view first.
  const handleHotspotClick = useCallback((hotspot) => {
    setActiveHotspot(hotspot)
  }, [])

  // Shared guard for every way of leaving Section Configurator while it
  // has unsaved edits — the top tab bar (below) and hotspot navigation
  // both funnel through this rather than calling setActiveSection/
  // setActiveTab directly. Returns false (and asks nothing) when there's
  // nothing to lose.
  function confirmLeaveSectionConfiguratorIfDirty() {
    if (activeTab !== 'Section Configurator' || !sectionConfiguratorDirty) return true
    return window.confirm(
      `You have unsaved changes in ${activeSection && typeof activeSection === 'string' ? (activeSection.charAt(0).toUpperCase() + activeSection.slice(1)) : 'this section'}. ` +
        "Leaving now will discard them (they won't be saved or synced). Leave anyway?"
    )
  }

  function handleTabClick(tab) {
    if (tab === activeTab) return
    if (!confirmLeaveSectionConfiguratorIfDirty()) return
    setActiveTab(tab)
  }

  function handleOpenSectionConfigurator(section) {
    if (!confirmLeaveSectionConfiguratorIfDirty()) return
    setActiveSection(section)
    setActiveTab('Section Configurator')
    setActiveHotspot(null)
  }

  return (
    <div className="app">
      <header>
        <h1>MID 2030 — Model 1 Assembly Builder</h1>
        <p>Group 02 · Batavierenplantsoen, Haarlem</p>
        {currentUser && (
          <p className="header-identity">
            Logged in as <strong>{currentUser}</strong>
            {group === 'group2' && ' · Group 2'}
            {group === 'other' && ' · Other group'}
            {isAdmin && ' · Admin'}
          </p>
        )}
      </header>

      <div className="app-tabs">
        {TABS.map((tab) => (
          <button
            key={tab}
            className={tab === activeTab ? 'active' : ''}
            onClick={() => handleTabClick(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* CSS-hidden rather than unmounted when inactive, so switching away
          and back doesn't reload the .glb or lose the WebGL context —
          ModelViewer now only ever renders in this one place (Section
          Configurator's left pane used to be a second portal target for
          it; that pane now shows the live layer-stack diagram instead —
          see SectionConfigurator.jsx). */}
      <section className="model-section" hidden={activeTab !== '3D Model'}>
        <h2>3D model (axo view)</h2>
        <div className="split-pane model-split">
          <div className="split-pane-left">
            <ModelViewer hotspots={hotspots} onHotspotClick={handleHotspotClick} />
            <p className="hotspot-hint">
              Click a dot on the model — wall/roof/floor show that section's analysis progress,
              door/window/skylight show a spec card, both here.
            </p>
          </div>
          <div className="split-pane-right">
            <IdentityPanel />
          </div>
        </div>
      </section>

      {activeTab === 'Section Configurator' && (
        <SectionConfigurator
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          owner={currentUser}
          onDirtyChange={setSectionConfiguratorDirty}
        />
      )}

      {activeTab === 'Assembly Analysis Preview' && <AssemblyAnalysisTab />}

      {activeTab === 'LCA and EPD' && <LcaEpdTab />}

      {activeTab === 'Materials and Providers' && <ProvidersTab />}

      {activeTab === 'Team Summary' && <TeamSummaryTab />}

      {activeTab === 'LCA Summary' && <LcaSummaryTab />}

      {activeTab === 'Spreadsheet' && <SpreadsheetTab />}

      {activeTab === 'Deliverables' && <DeliverablesTab />}

      <ConfiguratorPanel
        hotspot={activeHotspot}
        onClose={() => setActiveHotspot(null)}
        onOpenSectionConfigurator={handleOpenSectionConfigurator}
      />
    </div>
  )
}
