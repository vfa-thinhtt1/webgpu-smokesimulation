import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Grid } from "@react-three/drei";
import BIMScene from "./components/BIMScene";
import "./App.css";

// Path to the BIM model in the public folder
const MODEL_PATH = "/VFA/VFA_Office_1_simplified.glb";

function Scene({ showWindows, showDoors }) {
  return (
    <>
      <color attach="background" args={["#0d0e12"]} />
      <ambientLight intensity={1.5} />
      <directionalLight position={[10, 10, 10]} intensity={2.0} castShadow />
      <Environment preset="city" />

      <Suspense fallback={null}>
        <BIMScene
          src={MODEL_PATH}
          showWindows={showWindows}
          showDoors={showDoors}
        />
      </Suspense>

      <Grid
        infiniteGrid
        fadeDistance={200}
        fadeStrength={5}
        cellSize={1}
        sectionSize={5}
        sectionColor="#d2d2d2ff"
        cellColor="#b4b4b4ff"
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2 + 0.15}
        makeDefault
      />
    </>
  );
}

export default function App() {
  const [showWindows, setShowWindows] = useState(true);
  const [showDoors, setShowDoors] = useState(true);

  return (
    <div className="viewer-container">
      <div className="canvas-container">
        <Canvas
          shadows
          camera={{ position: [20, 20, 20], fov: 50 }}
          gl={{ antialias: true }}
          dpr={[1, 2]}
        >
          <Scene showWindows={showWindows} showDoors={showDoors} />
        </Canvas>
      </div>

      <div className="ui-overlay">
        <div className="glass-panel">
          <h2>🏢 BIM Model Viewer</h2>
          <p>Standard WebGL Renderer</p>

          <div className="section-label" style={{ marginBottom: 12, fontSize: '0.7rem', color: '#888', fontWeight: 600 }}>VISIBILITY</div>
          <div className="toggle-group" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[
              ["Windows", showWindows, setShowWindows],
              ["Doors", showDoors, setShowDoors],
            ].map(([label, value, setter]) => (
              <label className="toggle" key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => setter(e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="info-row" style={{ marginTop: 24 }}>
            <span>Model</span>
            <span className="info-val">VFA Office</span>
          </div>
          <div className="info-row">
            <span>Status</span>
            <span className="info-val">Loaded</span>
          </div>
        </div>
      </div>
    </div>
  );
}