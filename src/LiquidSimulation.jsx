import { useEffect, useRef, useState, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import {
  Fn, If, Return, instancedArray, instanceIndex, uniform, attribute,
  uint, float, clamp, struct, atomicStore, int, ivec3, array, vec3,
  atomicAdd, Loop, atomicLoad, max, pow, mat3, vec4, cross, step, storage
} from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

export default function LiquidSimulation({
  particleCount = 8192 * 4,
  onParticleCountChange
}) {
  const { gl: renderer, scene, camera, size } = useThree();
  const particleMeshRef = useRef();

  const maxParticles = 8192 * 16;
  const gridSize1d = 64;
  const workgroupSize = 64;
  const gridSize = useMemo(() => new THREE.Vector3(gridSize1d, gridSize1d, gridSize1d), []);
  const fixedPointMultiplier = 1e7;

  // We keep references to our initialized data
  const particlesData = useRef(null);

  // Re-run setup whenever renderer or scene is ready (typically once)
  useEffect(() => {
    if (!renderer || !scene || !camera) return;

    // References to hold the simulation variables
    let particleCountUniform, stiffnessUniform, restDensityUniform, dynamicViscosityUniform, dtUniform, gravityUniform, gridSizeUniform;
    let particleBuffer, cellBuffer, cellBufferFloat;
    let clearGridKernel, p2g1Kernel, p2g2Kernel, updateGridKernel, g2pKernel, workgroupKernel;
    let p2g1KernelWorkgroupBuffer, p2g2KernelWorkgroupBuffer, g2pKernelWorkgroupBuffer;
    let particleMesh;
    const mouseCoord = new THREE.Vector3();
    let mouseRayOriginUniform, mouseRayDirectionUniform, mouseForceUniform;

    const setupBuffers = () => {
      const particleStruct = struct({
        position: { type: 'vec3' },
        velocity: { type: 'vec3' },
        C: { type: 'mat3' },
      });
      const particleStructSize = 20; // memory alignment
      const particleArray = new Float32Array(maxParticles * particleStructSize);

      for (let i = 0; i < maxParticles; i++) {
        particleArray[i * particleStructSize] = (Math.random() * 0.8 + 0.1);
        particleArray[i * particleStructSize + 1] = (Math.random() * 0.8 + 0.1);
        particleArray[i * particleStructSize + 2] = (Math.random() * 0.8 + 0.1);
      }

      particleBuffer = instancedArray(particleArray, particleStruct);
      const cellCount = gridSize.x * gridSize.y * gridSize.z;

      const cellStruct = struct({
        x: { type: 'int', atomic: true },
        y: { type: 'int', atomic: true },
        z: { type: 'int', atomic: true },
        mass: { type: 'int', atomic: true },
      });

      cellBuffer = instancedArray(cellCount, cellStruct);
      cellBufferFloat = instancedArray(cellCount, 'vec4');
    };

    const setupUniforms = () => {
      gridSizeUniform = uniform(gridSize);
      particleCountUniform = uniform(particleCount, 'uint');
      stiffnessUniform = uniform(50);
      restDensityUniform = uniform(1.5);
      dynamicViscosityUniform = uniform(0.1);
      dtUniform = uniform(1 / 60);
      gravityUniform = uniform(new THREE.Vector3(0, -(9.81 * 9.81), 0));
      mouseRayOriginUniform = uniform(new THREE.Vector3(0, 0, 0));
      mouseRayDirectionUniform = uniform(new THREE.Vector3(0, 0, 0));
      mouseForceUniform = uniform(new THREE.Vector3(0, 0, 0));
    };

    const setupComputeShaders = () => {
      const encodeFixedPoint = (f32) => int(f32.mul(fixedPointMultiplier));
      const decodeFixedPoint = (i32) => float(i32).div(fixedPointMultiplier);

      const cellCount = gridSize.x * gridSize.y * gridSize.z;
      
      clearGridKernel = Fn(() => {
        If(instanceIndex.greaterThanEqual(uint(cellCount)), () => {
          Return();
        });
        atomicStore(cellBuffer.element(instanceIndex).get('x'), 0);
        atomicStore(cellBuffer.element(instanceIndex).get('y'), 0);
        atomicStore(cellBuffer.element(instanceIndex).get('z'), 0);
        atomicStore(cellBuffer.element(instanceIndex).get('mass'), 0);
      })().compute(cellCount).setName('clearGridKernel');

      p2g1Kernel = Fn(() => {
        If(instanceIndex.greaterThanEqual(particleCountUniform), () => { Return(); });
        const particlePosition = particleBuffer.element(instanceIndex).get('position').toConst('particlePosition');
        const particleVelocity = particleBuffer.element(instanceIndex).get('velocity').toConst('particleVelocity');
        const C = particleBuffer.element(instanceIndex).get('C').toConst('C');

        const gridPosition = particlePosition.mul(gridSizeUniform).toVar();
        const cellIndex = ivec3(gridPosition).sub(1).toConst('cellIndex');
        const cellDiff = gridPosition.fract().sub(0.5).toConst('cellDiff');
        const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
        const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
        const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
        const weights = array([w0, w1, w2]).toConst('weights');

        Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
            Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
              const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
              const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
              const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst('cellDist');
              const Q = C.mul(cellDist);

              const massContrib = weight;
              const velContrib = massContrib.mul(particleVelocity.add(Q)).toConst('velContrib');
              const cellPtr = cellX.x.mul(int(gridSize.y * gridSize.z)).add(cellX.y.mul(int(gridSize.z))).add(cellX.z).toConst();
              const cell = cellBuffer.element(cellPtr);

              atomicAdd(cell.get('x'), encodeFixedPoint(velContrib.x));
              atomicAdd(cell.get('y'), encodeFixedPoint(velContrib.y));
              atomicAdd(cell.get('z'), encodeFixedPoint(velContrib.z));
              atomicAdd(cell.get('mass'), encodeFixedPoint(massContrib));
            });
          });
        });
      })().compute(particleCount, [workgroupSize, 1, 1]).setName('p2g1Kernel');

      p2g2Kernel = Fn(() => {
        If(instanceIndex.greaterThanEqual(particleCountUniform), () => { Return(); });
        const particlePosition = particleBuffer.element(instanceIndex).get('position').toConst('particlePosition');
        const gridPosition = particlePosition.mul(gridSizeUniform).toVar();

        const cellIndex = ivec3(gridPosition).sub(1).toConst('cellIndex');
        const cellDiff = gridPosition.fract().sub(0.5).toConst('cellDiff');
        const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
        const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
        const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
        const weights = array([w0, w1, w2]).toConst('weights');

        const density = float(0).toVar('density');
        Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
            Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
              const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
              const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
              const cellPtr = cellX.x.mul(int(gridSize.y * gridSize.z)).add(cellX.y.mul(int(gridSize.z))).add(cellX.z).toConst();
              const cell = cellBuffer.element(cellPtr);
              const mass = decodeFixedPoint(atomicLoad(cell.get('mass')));
              density.addAssign(mass.mul(weight));
            });
          });
        });

        const volume = float(1).div(density);
        const pressure = max(0.0, pow(density.div(restDensityUniform), 5.0).sub(1).mul(stiffnessUniform)).toConst('pressure');
        const stress = mat3(pressure.negate(), 0, 0, 0, pressure.negate(), 0, 0, 0, pressure.negate()).toVar('stress');
        const dudv = particleBuffer.element(instanceIndex).get('C').toConst('C');

        const strain = dudv.add(dudv.transpose());
        stress.addAssign(strain.mul(dynamicViscosityUniform));
        const eq16Term0 = volume.mul(-4).mul(stress).mul(dtUniform);

        Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
            Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
              const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
              const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
              const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst('cellDist');
              const momentum = eq16Term0.mul(weight).mul(cellDist).toConst('momentum');

              const cellPtr = cellX.x.mul(int(gridSize.y * gridSize.z)).add(cellX.y.mul(int(gridSize.z))).add(cellX.z).toConst();
              const cell = cellBuffer.element(cellPtr);
              atomicAdd(cell.get('x'), encodeFixedPoint(momentum.x));
              atomicAdd(cell.get('y'), encodeFixedPoint(momentum.y));
              atomicAdd(cell.get('z'), encodeFixedPoint(momentum.z));
            });
          });
        });
      })().compute(particleCount, [workgroupSize, 1, 1]).setName('p2g2Kernel');

      updateGridKernel = Fn(() => {
        If(instanceIndex.greaterThanEqual(uint(cellCount)), () => { Return(); });
        const cell = cellBuffer.element(instanceIndex);
        const mass = decodeFixedPoint(atomicLoad(cell.get('mass'))).toConst();
        If(mass.lessThanEqual(0), () => { Return(); });

        const vx = decodeFixedPoint(atomicLoad(cell.get('x'))).div(mass).toVar();
        const vy = decodeFixedPoint(atomicLoad(cell.get('y'))).div(mass).toVar();
        const vz = decodeFixedPoint(atomicLoad(cell.get('z'))).div(mass).toVar();

        const x = int(instanceIndex).div(int(gridSize.z * gridSize.y));
        const y = int(instanceIndex).div(int(gridSize.z)).mod(int(gridSize.y));
        const z = int(instanceIndex).mod(int(gridSize.z));
        If(x.lessThan(int(1)).or(x.greaterThan(int(gridSize.x).sub(int(2)))), () => { vx.assign(0); });
        If(y.lessThan(int(1)).or(y.greaterThan(int(gridSize.y).sub(int(2)))), () => { vy.assign(0); });
        If(z.lessThan(int(1)).or(z.greaterThan(int(gridSize.z).sub(int(2)))), () => { vz.assign(0); });

        cellBufferFloat.element(instanceIndex).assign(vec4(vx, vy, vz, mass));
      })().compute(cellCount).setName('updateGridKernel');

      const clampToRoundedBox = (pos, box, radius) => {
        const result = pos.sub(0.5).toVar();
        const pp = step(box, result.abs()).mul(result.add(box.negate().mul(result.sign())));
        const ppLen = pp.length().toVar();
        const dist = ppLen.sub(radius);
        If(dist.greaterThan(0.0), () => {
          result.subAssign(pp.normalize().mul(dist).mul(1.3));
        });
        result.addAssign(0.5);
        return result;
      };

      g2pKernel = Fn(() => {
        If(instanceIndex.greaterThanEqual(particleCountUniform), () => { Return(); });
        const particlePosition = particleBuffer.element(instanceIndex).get('position').toVar('particlePosition');
        const gridPosition = particlePosition.mul(gridSizeUniform).toVar();
        const particleVelocity = vec3(0).toVar();

        const cellIndex = ivec3(gridPosition).sub(1).toConst('cellIndex');
        const cellDiff = gridPosition.fract().sub(0.5).toConst('cellDiff');

        const w0 = float(0.5).mul(float(0.5).sub(cellDiff)).mul(float(0.5).sub(cellDiff));
        const w1 = float(0.75).sub(cellDiff.mul(cellDiff));
        const w2 = float(0.5).mul(float(0.5).add(cellDiff)).mul(float(0.5).add(cellDiff));
        const weights = array([w0, w1, w2]).toConst('weights');

        const B = mat3(0).toVar('B');
        Loop({ start: 0, end: 3, type: 'int', name: 'gx', condition: '<' }, ({ gx }) => {
          Loop({ start: 0, end: 3, type: 'int', name: 'gy', condition: '<' }, ({ gy }) => {
            Loop({ start: 0, end: 3, type: 'int', name: 'gz', condition: '<' }, ({ gz }) => {
              const weight = weights.element(gx).x.mul(weights.element(gy).y).mul(weights.element(gz).z);
              const cellX = cellIndex.add(ivec3(gx, gy, gz)).toConst();
              const cellDist = vec3(cellX).add(0.5).sub(gridPosition).toConst('cellDist');
              const cellPtr = cellX.x.mul(int(gridSize.y * gridSize.z)).add(cellX.y.mul(int(gridSize.z))).add(cellX.z).toConst();

              const weightedVelocity = cellBufferFloat.element(cellPtr).xyz.mul(weight).toConst('weightedVelocity');
              const term = mat3(
                weightedVelocity.mul(cellDist.x),
                weightedVelocity.mul(cellDist.y),
                weightedVelocity.mul(cellDist.z)
              );
              B.addAssign(term);
              particleVelocity.addAssign(weightedVelocity);
            });
          });
        });

        particleBuffer.element(instanceIndex).get('C').assign(B.mul(4));
        particleVelocity.addAssign(gravityUniform.mul(dtUniform));
        particleVelocity.divAssign(gridSizeUniform);

        const dist = cross(mouseRayDirectionUniform, particlePosition.sub(mouseRayOriginUniform)).length();
        const force = dist.mul(3.00).oneMinus().max(0.0).pow(2);
        particleVelocity.addAssign(mouseForceUniform.mul(force));
        particlePosition.addAssign(particleVelocity.mul(dtUniform));
        particlePosition.assign(clamp(particlePosition, vec3(1).div(gridSizeUniform), vec3(gridSize).sub(1).div(gridSizeUniform)));

        const innerBox = gridSizeUniform.mul(0.5).sub(9.0).div(gridSizeUniform).toVar();
        const innerRadius = float(6.0).div(gridSizeUniform.x);
        const posNext = particlePosition.add(particleVelocity.mul(dtUniform).mul(2.0)).toConst('posNext');
        const posNextClamped = clampToRoundedBox(posNext, innerBox, innerRadius);
        particleVelocity.addAssign(posNextClamped.sub(posNext));

        particleVelocity.mulAssign(gridSizeUniform);

        particleBuffer.element(instanceIndex).get('position').assign(particlePosition);
        particleBuffer.element(instanceIndex).get('velocity').assign(particleVelocity);
      })().compute(particleCount, [workgroupSize, 1, 1]).setName('g2pKernel');

      const numWorkgroups = Math.ceil(particleCount / workgroupSize);
      p2g1KernelWorkgroupBuffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array([numWorkgroups, 1, 1]), 1);
      p2g2KernelWorkgroupBuffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array([numWorkgroups, 1, 1]), 1);
      g2pKernelWorkgroupBuffer = new THREE.IndirectStorageBufferAttribute(new Uint32Array([numWorkgroups, 1, 1]), 1);

      const p2g1WorkgroupStorage = storage(p2g1KernelWorkgroupBuffer, 'uint', 3);
      const p2g2WorkgroupStorage = storage(p2g2KernelWorkgroupBuffer, 'uint', 3);
      const g2pWorkgroupStorage = storage(g2pKernelWorkgroupBuffer, 'uint', 3);

      workgroupKernel = Fn(() => {
        const workgroupsToDispatch = (particleCountUniform.sub(1)).div(workgroupSize).add(1);
        p2g1WorkgroupStorage.element(0).assign(workgroupsToDispatch);
        p2g2WorkgroupStorage.element(0).assign(workgroupsToDispatch);
        g2pWorkgroupStorage.element(0).assign(workgroupsToDispatch);
      })().compute(1);
    };

    const setupMesh = () => {
      const geometry = BufferGeometryUtils.mergeVertices(new THREE.IcosahedronGeometry(0.008, 1).deleteAttribute('uv'));
      const material = new THREE.MeshStandardNodeMaterial({ color: '#0066FF' });
      material.positionNode = Fn(() => {
        const particlePosition = particleBuffer.element(instanceIndex).get('position');
        return attribute('position').add(particlePosition);
      })();

      particleMesh = new THREE.Mesh(geometry, material);
      particleMesh.count = particleCount;
      particleMesh.position.set(-0.5, 0, -0.5);
      particleMesh.frustumCulled = false;
      scene.add(particleMesh);
      particleMeshRef.current = particleMesh;
    };

    setupBuffers();
    setupUniforms();
    setupComputeShaders();
    setupMesh();

    particlesData.current = {
      particleCountUniform,
      dtUniform,
      clearGridKernel,
      p2g1Kernel,
      p2g2Kernel,
      updateGridKernel,
      g2pKernel,
      workgroupKernel,
      p2g1KernelWorkgroupBuffer,
      p2g2KernelWorkgroupBuffer,
      g2pKernelWorkgroupBuffer,
      mouseForceUniform,
      mouseRayOriginUniform,
      mouseRayDirectionUniform,
      mouseCoord: new THREE.Vector3(),
      prevMouseCoord: new THREE.Vector3(),
    };

    return () => {
      if (particleMesh) {
        scene.remove(particleMesh);
        particleMesh.geometry.dispose();
        particleMesh.material.dispose();
      }
    };
  }, [renderer, scene, camera, particleCount]);

  // Handle Raycasting for interaction. 
  // We'll update pointer in a custom raycast plane logic since we intercept screen coords.
  const raycastPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0)), []);

  useEffect(() => {
    const handlePointerMove = (e) => {
      const data = particlesData.current;
      if (!data) return;

      const pointer = new THREE.Vector2(
        (e.clientX / window.innerWidth) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      raycaster.ray.origin.x += 0.5;
      raycaster.ray.origin.z += 0.5;
      
      data.mouseRayOriginUniform.value.copy(raycaster.ray.origin);
      data.mouseRayDirectionUniform.value.copy(raycaster.ray.direction);
      raycaster.ray.intersectPlane(raycastPlane, data.mouseCoord);
    };

    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [camera, raycastPlane]);

  useFrame((state, delta) => {
    const data = particlesData.current;
    if (!data) return;

    // Safety clamp delta to not blow up simulation
    const deltaTime = THREE.MathUtils.clamp(delta, 0.00001, 1 / 60);
    data.dtUniform.value = deltaTime;

    data.mouseForceUniform.value.copy(data.mouseCoord).sub(data.prevMouseCoord).multiplyScalar(2);
    const mouseForceLength = data.mouseForceUniform.value.length();
    if (mouseForceLength > 0.3) {
      data.mouseForceUniform.value.multiplyScalar(0.3 / mouseForceLength);
    }
    data.prevMouseCoord.copy(data.mouseCoord);

    // Compute steps
    renderer.compute(data.workgroupKernel);
    renderer.compute(data.clearGridKernel);
    renderer.compute(data.p2g1Kernel, data.p2g1KernelWorkgroupBuffer);
    renderer.compute(data.p2g2Kernel, data.p2g2KernelWorkgroupBuffer);
    renderer.compute(data.updateGridKernel);
    renderer.compute(data.g2pKernel, data.g2pKernelWorkgroupBuffer);
  });

  return null;
}
