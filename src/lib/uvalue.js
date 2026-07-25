// U-value calculation per DIN EN ISO 6946
// U = 1 / R_total, where R_total = Rsi + sum(R_layer) + Rse
// R_layer = thickness [m] / thermal conductivity λ [W/mK]

// Standard surface resistances (m²K/W) — direction of heat flow matters.
// These defaults are for a wall (horizontal heat flow).
export const SURFACE_RESISTANCE = {
  wall: { rsi: 0.13, rse: 0.04 },
  roof: { rsi: 0.10, rse: 0.04 }, // upward heat flow
  floor: { rsi: 0.17, rse: 0.04 }, // downward heat flow (adjust rse if on ground)
}

/**
 * @param {Array<{thicknessMM: number, thermalConductivityWmK: number}>} layers
 * @param {'wall'|'roof'|'floor'} elementType
 * @returns {{ uValue: number|null, rTotal: number|null, layerResistances: number[], missingData: boolean }}
 */
export function calculateUValue(layers, elementType = 'wall') {
  const { rsi, rse } = SURFACE_RESISTANCE[elementType] ?? SURFACE_RESISTANCE.wall

  let missingData = false
  const layerResistances = layers.map((layer) => {
    const thicknessM = (layer.thicknessMM ?? 0) / 1000
    const lambda = layer.thermalConductivityWmK
    if (!lambda || lambda <= 0 || !thicknessM) {
      missingData = true
      return 0
    }
    return thicknessM / lambda
  })

  if (missingData || layers.length === 0) {
    return { uValue: null, rTotal: null, layerResistances, missingData: true }
  }

  const rTotal = rsi + rse + layerResistances.reduce((sum, r) => sum + r, 0)
  const uValue = 1 / rTotal

  return { uValue, rTotal, layerResistances, missingData: false }
}

// Typical reference: passive-house-grade wall ~0.15 W/m²K, standard NL
// building code (Bouwbesluit) wall requirement ~0.18-0.29 W/m²K depending
// on element. Not hardcoded here — surface these as reference lines in the UI,
// confirm exact NL Bouwbesluit figures before citing them in the report.
