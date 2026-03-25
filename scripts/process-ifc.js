import { NodeIO } from '@gltf-transform/core';
import { KHRONOS_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function processGLB() {
  const io = new NodeIO()
    .registerExtensions(KHRONOS_EXTENSIONS);

  const inputPath = path.join(__dirname, '../public/VFA/VFA_Office_1.glb');
  const outputPath = path.join(__dirname, '../public/VFA/VFA_Office_1_simplified.glb');
  
  console.log(`Loading ${inputPath}...`);
  const document = await io.read(inputPath);

  const jsonPath = path.join(__dirname, '../public/VFA/VFA_Office_1.json');
  const ifcData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  // Build a map of expressID -> type
  const typeMap = new Map();
  function traverse(node) {
    if (node.expressId) {
      typeMap.set(node.expressId, node.type);
    }
    if (node.children) {
      node.children.forEach(traverse);
    }
  }
  traverse(ifcData);

  let windowNodes = 0;
  let doorNodes = 0;
  
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;

    const extras = mesh.getExtras();
    const expressId = extras.ifc?.ifcMeshExpressId;

    if (expressId !== undefined) {
      const ifcType = typeMap.get(expressId);
      if (ifcType) {
        node.setExtras({ ...node.getExtras(), ifcType });
        if (ifcType.toLowerCase().includes('window')) windowNodes++;
        if (ifcType.toLowerCase().includes('door')) doorNodes++;
      }
    }
  }
  
  console.log('Sample node names:');
  document.getRoot().listNodes().slice(0, 5).forEach(n => console.log(' - ' + n.getName()));
  console.log(`Found ${windowNodes} nodes containing 'window' and ${doorNodes} containing 'door'.`);

  console.log('Simplifying meshes... This might take a moment.');
  await MeshoptSimplifier.ready;
  await document.transform(
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.5,
      error: 0.01
    })
  );

  console.log(`Saving optimized model to ${outputPath}...`);
  await io.write(outputPath, document);
  console.log('Optimization complete!');
}

processGLB().catch(console.error);
