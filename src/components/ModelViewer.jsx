import React, { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { loadSection } from '../lib/sectionStorage.js'

// See earlier comments in project history for the Scene/Camera/Renderer/
// Loop explanation — kept brief here since this file is now mostly about
// hotspots, which work like this:
//
// A hotspot has a fixed 3D position (in the model's own coordinate space).
// Every animation frame, we ask the camera "if I look at this 3D point,
// where does it land on the 2D screen?" via Vector3.project(camera) —
// that's the same math the GPU itself uses to draw the model, we're just
// running it ourselves for a plain HTML <div> instead of a triangle. The
// div's CSS position gets updated to match, every frame, so it appears to
// "stick" to the model as you orbit — even though it's not really a 3D
// object at all, just a 2D dot that's really good at pretending.

// Owns a Three.js scene + WebGL context and loads the .glb itself with no
// caching (see the useEffect below) — React.memo so an unrelated parent
// re-render (e.g. the "logged in as" select) doesn't even re-run this
// component's body, on top of App.jsx passing a stable onHotspotClick so
// the effect below doesn't see it as a changed dependency either.
// Page-relative (via Vite's BASE_URL, not a hardcoded absolute "/…") so
// this resolves correctly both on the web (http://…) and when the built
// app is loaded from disk in the Electron desktop shell (file://…) — an
// absolute "/models/…" path resolves to the filesystem root under
// file://, not the dist/ folder, and silently fails to fetch there.
const ModelViewer = React.memo(function ModelViewer({
  modelUrl = `${import.meta.env.BASE_URL}models/model_1.glb`,
  hotspots = [],
  onHotspotClick,
}) {
  const mountRef = useRef(null)
  const hotspotElsRef = useRef({}) // { [hotspot.id]: <div> element }
  const [loadProgress, setLoadProgress] = useState(0)
  const [error, setError] = useState(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const mount = mountRef.current
    // Mutable (not const) — this component now gets portaled between
    // differently-sized containers (the standalone 3D Model tab vs. the
    // Section Configurator split-pane's narrower left slot, see App.jsx)
    // without unmounting, so width/height captured once at effect-setup
    // time would go stale the moment it moves. The ResizeObserver below
    // keeps these current; updateHotspotPositions and the render loop
    // both close over these same variables, so they pick up the change
    // automatically without needing their own resize plumbing.
    let width = mount.clientWidth
    let height = 480

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#ffffff')

    let aspect = width / height
    const frustumSize = 8
    // Current vertical extent in world units — starts at frustumSize,
    // then gets replaced with the model's own fitSize once it loads and
    // the camera re-frames around it (see loader.load below). Kept in a
    // variable (not recomputed from frustumSize) so a later resize
    // preserves whatever framing is currently on screen instead of
    // snapping back to the pre-load default.
    let frustumHeight = frustumSize
    const camera = new THREE.OrthographicCamera(
      (-frustumHeight * aspect) / 2,
      (frustumHeight * aspect) / 2,
      frustumHeight / 2,
      -frustumHeight / 2,
      0.1,
      1000
    )
    camera.position.set(5, 5, 5)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    mount.appendChild(renderer.domElement)

    function applySize(newWidth, newHeight) {
      // Guards a real race: the portal (App.jsx) can briefly detach this
      // component's mount div from the document while relocating it
      // between slots (old slot's parent unmounting before the new
      // target is set) — a ResizeObserver notification landing in that
      // window reports 0×0 (or a stale rect) for a node that's about to
      // reappear correctly-sized a moment later. Applying that transient
      // 0 would corrupt the canvas' actual bitmap size with no future
      // resize guaranteed to fire and correct it.
      if (newWidth <= 0 || newHeight <= 0 || !mount.isConnected) return
      width = newWidth
      height = newHeight
      aspect = width / height
      renderer.setSize(width, height)
      camera.left = (-frustumHeight * aspect) / 2
      camera.right = (frustumHeight * aspect) / 2
      camera.top = frustumHeight / 2
      camera.bottom = -frustumHeight / 2
      camera.updateProjectionMatrix()
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width: newWidth, height: newHeight } = entry.contentRect
      if (newWidth !== width || newHeight !== height) applySize(newWidth, newHeight)
    })
    resizeObserver.observe(mount)

    scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const sun = new THREE.DirectionalLight(0xffffff, 0.8)
    sun.position.set(5, 10, 7)
    scene.add(sun)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    // --- Hotspot dots: plain HTML divs, positioned with JS each frame ---
    // Created once here, appended directly into the mount div (which sits
    // in front of the canvas via CSS). We keep references in
    // hotspotElsRef so the animate() loop can move them every frame.
    hotspots.forEach((hotspot) => {
      const el = document.createElement('button')
      // Amber by default (status-attention); green once that section
      // actually has saved layers — same 3-color system used for status
      // badges elsewhere, not this dot's own independent color. Read
      // once at mount/hotspots-change, same freshness as the rest of
      // this effect — won't live-update if a section is saved on
      // another tab without this component re-running its effect.
      const hasData = hotspot.kind === 'layers' && (loadSection(hotspot.id)?.layers?.length ?? 0) > 0
      el.className = hasData ? 'model-hotspot model-hotspot--complete' : 'model-hotspot'
      el.title = hotspot.label
      el.textContent = hotspot.label[0] // first letter as a compact label
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        onHotspotClick?.(hotspot)
      })
      mount.appendChild(el)
      hotspotElsRef.current[hotspot.id] = el
    })

    function updateHotspotPositions() {
      hotspots.forEach((hotspot) => {
        const el = hotspotElsRef.current[hotspot.id]
        if (!el) return
        const vector = new THREE.Vector3(hotspot.position.x, hotspot.position.y, hotspot.position.z)
        vector.project(camera) // now in normalized device coords, -1..1
        const x = (vector.x * 0.5 + 0.5) * width
        const y = (-vector.y * 0.5 + 0.5) * height
        el.style.transform = `translate(${x}px, ${y}px)`
      })
    }

    const loader = new GLTFLoader()
    const dracoLoader = new DRACOLoader()
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/')
    loader.setDRACOLoader(dracoLoader)
    let mounted = true

    loader.load(
      modelUrl,
      (gltf) => {
        if (!mounted) return
        scene.add(gltf.scene)

        const preBox = new THREE.Box3().setFromObject(gltf.scene)
        const preSize = preBox.getSize(new THREE.Vector3())
        const modelScale = Math.max(preSize.x, preSize.y, preSize.z)
        const weldTolerance = modelScale * 1e-5

        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshBasicMaterial({ color: 0xffffff })
            const mergedGeometry = mergeVertices(child.geometry, weldTolerance)
            const edges = new THREE.EdgesGeometry(mergedGeometry, 55)
            const outline = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }))
            child.add(outline)
          }
        })

        const box = new THREE.Box3().setFromObject(gltf.scene)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        const fitSize = maxDim * 1.2
        frustumHeight = fitSize // remember this framing so a later resize (applySize) rebuilds around it, not the pre-load default

        camera.left = (-fitSize * aspect) / 2
        camera.right = (fitSize * aspect) / 2
        camera.top = fitSize / 2
        camera.bottom = -fitSize / 2
        camera.near = maxDim / 1000
        camera.far = maxDim * 10
        camera.updateProjectionMatrix()

        controls.target.copy(center)
        camera.position.copy(center).add(new THREE.Vector3(1, 1, 1).multiplyScalar(maxDim))
        camera.lookAt(center)
        controls.update()

        setLoaded(true)
      },
      (progressEvent) => {
        if (progressEvent.lengthComputable) {
          setLoadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100))
        }
      },
      (err) => {
        console.error(err)
        setError('Could not load model — check that public/models/model_1.glb exists.')
      }
    )

    let frameId
    function animate() {
      frameId = requestAnimationFrame(animate)
      controls.update()
      updateHotspotPositions()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      mounted = false
      resizeObserver.disconnect()
      cancelAnimationFrame(frameId)
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      Object.values(hotspotElsRef.current).forEach((el) => el.remove())
      hotspotElsRef.current = {}
    }
  }, [modelUrl, hotspots, onHotspotClick])

  return (
    <div className="model-viewer">
      <div ref={mountRef} className="model-viewer-canvas-mount" />
      {!loaded && !error && (
        <div className="model-viewer-status">Loading model… {loadProgress}%</div>
      )}
      {error && <div className="model-viewer-status error">{error}</div>}
    </div>
  )
})

export default ModelViewer