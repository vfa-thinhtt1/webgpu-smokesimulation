import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

export default function BIMScene({ src, showWindows = true, showDoors = true }) {
    const { scene } = useGLTF(src);

    // Classify meshes once on load
    const { windowMeshes, doorMeshes } = useMemo(() => {
        const windows = [];
        const doors = [];

        let totalCount = 0;
        scene.traverse((child) => {
            totalCount++;
            if (!child.isMesh) return;

            // Extract classification from name or userData
            const name = (child.name || "").toLowerCase();
            const ifcType = (child.userData?.ifcType || "").toLowerCase();
            const combined = (name + " " + ifcType).toLowerCase();

            if (
                combined.includes("window") ||
                combined.includes("glazing") ||
                combined.includes("glass")
            ) {
                windows.push(child);
            } else if (
                combined.includes("door") ||
                combined.includes("opening")
            ) {
                doors.push(child);
            } else if (totalCount % 50 === 0) {
                // Log some names occasionally to help debug if nothing is found
                console.log(`[BIMScene Debug] Sample mesh: name="${name}", type="${ifcType}"`);
            }
        });

        console.log(`[BIMScene] Final Classification: Windows=${windows.length}, Doors=${doors.length} (out of ${totalCount} nodes)`);
        return { windowMeshes: windows, doorMeshes: doors };
    }, [scene]);

    // Synchronize visibility
    useEffect(() => {
        console.log(`[BIMScene] Setting showWindows=${showWindows} for ${windowMeshes.length} meshes`);
        windowMeshes.forEach(mesh => { mesh.visible = showWindows; });
    }, [showWindows, windowMeshes]);

    useEffect(() => {
        console.log(`[BIMScene] Setting showDoors=${showDoors} for ${doorMeshes.length} meshes`);
        doorMeshes.forEach(mesh => { mesh.visible = showDoors; });
    }, [showDoors, doorMeshes]);

    return <primitive object={scene} castShadow receiveShadow />;
}

// Preload the model
useGLTF.preload("/VFA/VFA_Office_1_simplified.glb");
