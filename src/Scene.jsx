import { useEffect, useState, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import LiquidSimulation from './LiquidSimulation';


function SceneContent() {
  const { scene } = useThree();

  useEffect(() => {
    // Load HDRI environment specifically for webgpu context
    // R3F Environment doesn't consistently work with WebGPURenderer natively yet
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
      <OrbitControls minDistance={1} maxDistance={3} maxPolarAngle={Math.PI * 0.35} touches={{ TWO: THREE.TOUCH.DOLLY_ROTATE }} />
      <LiquidSimulation particleCount={8192 * 4} />
    </>
  );
}

export default function Scene() {
  const canvasRef = useRef(null);
  const [hasWebGPU, setHasWebGPU] = useState(true);

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

      import('@react-three/fiber').then(({ createRoot, events }) => {
        root = createRoot(canvasRef.current);
        
        root.configure({
          gl: renderer,
          camera: { position: [-1.3, 1.3, -1.3], fov: 40, near: 0.01, far: 10 },
          size: { width: window.innerWidth, height: window.innerHeight },
          events,
        });

        root.render(<SceneContent />);
        
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

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100vw', height: '100vh', touchAction: 'none' }} />;
}
