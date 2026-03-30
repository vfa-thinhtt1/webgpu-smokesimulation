import { useEffect, useState, useRef, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import LiquidSimulation from './LiquidSimulation';


function SceneContent({ pCount, pSize, mouseForceEnabled, doorVisible }) {
  const { scene } = useThree();
  const { scene: gltfScene } = useGLTF('/VFA/room.glb');

  useEffect(() => {
    gltfScene.traverse((node) => {
      if (node.isMesh) {
        if (node.name.toLowerCase().includes('door')) {
          node.visible = doorVisible;
        }

        // Transparency
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        materials.forEach(mat => {
          mat.transparent = true;
          mat.opacity = 0;
          mat.side = THREE.DoubleSide;
          mat.depthWrite = false;
        });

        // Outline
        if (!node.userData.hasOutline) {
          const edges = new THREE.EdgesGeometry(node.geometry);
          const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
          node.add(line);
          node.userData.hasOutline = true;
        }
      }
    });
  }, [gltfScene, doorVisible]);

  // Compute AABB and mapping info
  const boundsInfo = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Cubic simulation size fits the max dimension of the box
    const simSize = Math.max(size.x, size.y, size.z);

    // margin = pSize / 2
    const margin = pSize / 2;
    // Sim covers [box.min, box.min + simSize]
    const simWorldMin = box.min.clone();

    const localBounds = [];
    const sceneBox = new THREE.Box3().setFromObject(gltfScene);

    gltfScene.traverse((node) => {
      if (node.isMesh) {
        // Skip hidden doors from boundary calculation
        if (!doorVisible && node.name.toLowerCase().includes('door')) return;

        const meshBox = new THREE.Box3().setFromObject(node);
        if (!meshBox.isEmpty()) {


          // Extend floor meshes to full room height
          meshBox.min.y = sceneBox.min.y;
          meshBox.max.y = sceneBox.max.y;

          localBounds.push({
            min: new THREE.Vector3(
              (meshBox.min.x - simWorldMin.x) / simSize,
              (meshBox.min.y - simWorldMin.y) / simSize,
              (meshBox.min.z - simWorldMin.z) / simSize
            ),
            max: new THREE.Vector3(
              (meshBox.max.x - simWorldMin.x - (4 * margin)) / simSize,
              (meshBox.max.y - simWorldMin.y - (4 * margin)) / simSize,
              (meshBox.max.z - simWorldMin.z - (4 * margin)) / simSize
            )
          });
        }
      }
    });

    // Fallback to entire scene if no meshes found
    if (localBounds.length === 0) {
      const fallbackBox = sceneBox.clone().expandByScalar(-margin);
      localBounds.push({
        min: new THREE.Vector3(
          (fallbackBox.min.x - simWorldMin.x) / simSize,
          (fallbackBox.min.y - simWorldMin.y) / simSize,
          (fallbackBox.min.z - simWorldMin.z) / simSize
        ),
        max: new THREE.Vector3(
          (fallbackBox.max.x - simWorldMin.x - (4 * margin)) / simSize,
          (fallbackBox.max.y - simWorldMin.y - (4 * margin)) / simSize,
          (fallbackBox.max.z - simWorldMin.z - (4 * margin)) / simSize
        )
      });
    }

    return { simWorldMin, simSize, localBounds };
  }, [gltfScene, pSize, doorVisible]);

  useEffect(() => {
    import('three/addons/loaders/UltraHDRLoader.js').then(({ UltraHDRLoader }) => {
      new UltraHDRLoader().setPath('/public/Texture/').loadAsync('royal_esplanade_2k.hdr.jpg').then((hdrTexture) => {
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = hdrTexture;
        scene.backgroundBlurriness = 0.5;
        scene.environment = hdrTexture;
      });
    });
  }, [scene]);

  return (
    <>
      <OrbitControls minDistance={1} maxDistance={100} maxPolarAngle={Math.PI * 0.45} touches={{ TWO: THREE.TOUCH.DOLLY_ROTATE }} />
      <primitive object={gltfScene} />
      <LiquidSimulation
        particleCount={pCount}
        particleSize={pSize}
        simWorldMin={boundsInfo.simWorldMin}
        simSize={boundsInfo.simSize}
        localBounds={boundsInfo.localBounds}
        mouseForceEnabled={mouseForceEnabled}
      />
    </>
  );
}

export default function Scene() {
  const canvasRef = useRef(null);
  const rootRef = useRef(null);
  const [hasWebGPU, setHasWebGPU] = useState(true);
  const [pCount, setPCount] = useState(8192 * 4);
  const [pSize, setPSize] = useState(0.05);
  const [mouseForceEnabled, setMouseForceEnabled] = useState(true);
  const [doorVisible, setDoorVisible] = useState(true);

  // Update R3F root when controls change
  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.render(<SceneContent pCount={pCount} pSize={pSize} mouseForceEnabled={mouseForceEnabled} doorVisible={doorVisible} />);
    }
  }, [pCount, pSize, mouseForceEnabled, doorVisible]);

  useEffect(() => {
    let root;
    let renderer;
    let handleResize;

    const initWebGPU = async () => {
      const WebGPU = await import('three/addons/capabilities/WebGPU.js');
      if (!WebGPU.default.isAvailable()) {
        setHasWebGPU(false);
        const warning = WebGPU.default.getErrorMessage();
        document.body.appendChild(warning);
        return;
      }

      if (!canvasRef.current) return;

      renderer = new THREE.WebGPURenderer({
        canvas: canvasRef.current,
        antialias: true,
        requiredLimits: { maxStorageBuffersInVertexStage: 1 },
      });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.35;

      await renderer.init();

      import('@react-three/fiber').then(({ createRoot, events, extend }) => {
        extend(THREE);
        root = createRoot(canvasRef.current);
        rootRef.current = root;

        root.configure({
          gl: renderer,
          camera: { position: [-1.3, 1.3, -1.3], fov: 50, near: 0.01, far: 1000 },
          size: { width: window.innerWidth, height: window.innerHeight },
          events,
        });

        root.render(<SceneContent pCount={pCount} pSize={pSize} mouseForceEnabled={mouseForceEnabled} doorVisible={doorVisible} />);

        handleResize = () => {
          renderer.setSize(window.innerWidth, window.innerHeight);
          root.configure({ size: { width: window.innerWidth, height: window.innerHeight } });
        };
        window.addEventListener('resize', handleResize);
      });
    };

    initWebGPU();

    return () => {
      if (handleResize) window.removeEventListener('resize', handleResize);
      if (root) root.unmount();
      if (renderer) renderer.dispose();
    };
  }, []);

  if (!hasWebGPU) return null;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', touchAction: 'none' }} />
      <div style={{ position: 'absolute', top: '20px', right: '20px', background: 'rgba(0,0,0,0.8)', padding: '20px', borderRadius: '8px', color: 'white', display: 'flex', flexDirection: 'column', gap: '15px', pointerEvents: 'auto', fontFamily: 'sans-serif', zIndex: 100000 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '14px', marginBottom: '8px', fontWeight: 'bold' }}>Particle Count: {pCount}</label>
          <input type="range" min={4096} max={8192 * 16} step={4096} value={pCount} onChange={e => setPCount(Number(e.target.value))} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ fontSize: '14px', marginBottom: '8px', fontWeight: 'bold' }}>Particle Size: {pSize.toFixed(4)}</label>
          <input type="range" min={0.001} max={0.5} step={0.001} value={pSize} onChange={e => setPSize(Number(e.target.value))} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" id="mouseForce" checked={mouseForceEnabled} onChange={e => setMouseForceEnabled(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
          <label htmlFor="mouseForce" style={{ fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>Enable Mouse Force</label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input type="checkbox" id="doorToggle" checked={doorVisible} onChange={e => setDoorVisible(e.target.checked)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
          <label htmlFor="doorToggle" style={{ fontSize: '14px', fontWeight: 'bold', cursor: 'pointer' }}>Door Visible</label>
        </div>
      </div>
    </div>
  );
}
