import { useEffect, useState, useRef, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import LiquidSimulation from './LiquidSimulation';


function SceneContent({ pCount, pSize }) {
  const { scene } = useThree();
  const { scene: gltfScene } = useGLTF('/VFA/VFA_Office_1_simplified.glb');

  // Compute AABB and mapping info
  const boundsInfo = useMemo(() => {
    const box = new THREE.Box3().setFromObject(gltfScene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // Cubic simulation size fits the max dimension of the box
    const simSize = Math.max(size.x, size.y, size.z);

    // Sim covers [center - simSize/2, center + simSize/2]
    const simWorldMin = new THREE.Vector3(
      center.x - simSize / 2,
      center.y - simSize / 2,
      center.z - simSize / 2
    );

    const localMin = new THREE.Vector3(
      (box.min.x - simWorldMin.x) / simSize,
      (box.min.y - simWorldMin.y) / simSize,
      (box.min.z - simWorldMin.z) / simSize
    );

    const localMax = new THREE.Vector3(
      (box.max.x - simWorldMin.x) / simSize,
      (box.max.y - simWorldMin.y) / simSize,
      (box.max.z - simWorldMin.z) / simSize
    );

    return { simWorldMin, simSize, localMin, localMax };
  }, [gltfScene]);

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
        localMin={boundsInfo.localMin}
        localMax={boundsInfo.localMax}
      />
    </>
  );
}

export default function Scene() {
  const canvasRef = useRef(null);
  const rootRef = useRef(null);
  const [hasWebGPU, setHasWebGPU] = useState(true);
  const [pCount, setPCount] = useState(8192 * 4);
  const [pSize, setPSize] = useState(0.1);

  // Update R3F root when controls change
  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.render(<SceneContent pCount={pCount} pSize={pSize} />);
    }
  }, [pCount, pSize]);

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

        root.render(<SceneContent pCount={pCount} pSize={pSize} />);

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
      </div>
    </div>
  );
}
