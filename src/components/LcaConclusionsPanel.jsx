import React from 'react'
import './LcaConclusionsPanel.css'

export default function LcaConclusionsPanel({ assemblyKey }) {
  return (
    <div className="lca-conclusions-card">
      <div className="lca-conclusions-header">
        <h3>Synthesis & Conclusions: LCA, EPD, and GWP Calculations</h3>
        <span className="lca-conclusions-badge">DIN EN 15978 / ISO 14040</span>
      </div>

      <div className="lca-conclusions-grid">
        <div className="lca-conclusion-item">
          <div className="lca-conclusion-title">
            <span>🏭</span> A1–A3 Production Stage & Material Drivers
          </div>
          <p className="lca-conclusion-text">
            Upfront manufacturing carbon is dominated by high-precision technical units (Schüco ASE 80.HI sliding doors @ 226.4 kg CO₂e/unit frame + 136.3 glazing, per the externally verified Bau-EPD; Schüco AWS 75 BS.HI+ windows @ 165 kg CO₂e/unit). Aluminium extrusions (77% secondary content in the door's main profiles) and multi-pane insulating glass (Ug ≈ 0.6 W/m²K) represent the primary carbon drivers in the envelope assembly.
          </p>
        </div>

        <div className="lca-conclusion-item lca-conclusion-item--accent">
          <div className="lca-conclusion-title">
            <span>🌲</span> Biogenic Carbon Carbon-Sink Offsets
          </div>
          <p className="lca-conclusion-text">
            Bio-based substructures and interior lining panels (SWISS KRONO Kronoply OSB @ -13.6 kg CO₂e/m²; STEICO wood fiber insulation @ -6.2 kg CO₂e/m²) sequester atmospheric carbon during biomass growth, creating significant negative carbon offsets during the initial A1–A3 product phase.
          </p>
        </div>

        <div className="lca-conclusion-item lca-conclusion-item--warning">
          <div className="lca-conclusion-title">
            <span>🚚</span> A4 Transport Logistics & Supplier Proximity
          </div>
          <p className="lca-conclusion-text">
            Sourcing frame profiles from regional manufacturers (Schüco Bielefeld, 40 km to Detmold collection hub) reduces transport GWP compared to distant suppliers. Consolidated transport from Detmold to the Haarlem construction site (370 km via road) contributes a predictable ~2.5–5.0% addition to baseline product emissions.
          </p>
        </div>

        <div className="lca-conclusion-item lca-conclusion-item--purple">
          <div className="lca-conclusion-title">
            <span>🔄</span> B4 Maintenance, Replacement & EOL Recycling (Module D)
          </div>
          <p className="lca-conclusion-text">
            Glazing units and perimeter elastomeric sealants (RSL 25–30 years) incur 1 replacement cycle (Module B4) within the 50-year building reference study period. However, high recyclability of aluminium profiles (90%+ recycling rate) yields major net environmental credits in Module D (-92.0 kg CO₂e for window units; -145.0 kg CO₂e for sliding doors).
          </p>
        </div>
      </div>

      <div className="lca-conclusions-summary-box">
        <h4>Key Takeaway & Overall Assembly Recommendation</h4>
        <p>
          While high-performance window and door assemblies require substantial upfront embodied carbon (A1–A3), their exceptional thermal performance (Uw ≈ 0.8–1.0 W/m²K) dramatically suppresses operational heating demands (Module B6). Over the 50-year building service life, the operational carbon savings surpass the upfront embodied investment by a ratio of over 6:1, confirming the environmental viability of the Schüco system specifications owned by Michael.
        </p>
      </div>
    </div>
  )
}
