"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export interface CurveLoaderProps {
  /** Kept for API compatibility. The PC loader intentionally renders no text. */
  label?: string;
  size?: number;
  className?: string;
  hideVariantTag?: boolean;
}

type AnimatedPart = THREE.Group & {
  userData: {
    target: THREE.Vector3;
    start: THREE.Vector3;
  };
};

const easeOutCubic = (value: number) => 1 - Math.pow(1 - value, 3);
const easeInOutCubic = (value: number) =>
  value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Compact Three.js adaptation of the supplied PC assembly animation.
 * It deliberately has no caption, progress copy, or decorative UI.
 */
export function CurveLoader({ size = 240, className }: CurveLoaderProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(20, 11, 49);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x7c86a0, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    keyLight.position.set(30, 35, 35);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const rgbLight = new THREE.PointLight(0xff006e, 15, 48);
    rgbLight.position.set(1, 0, 6);
    scene.add(rgbLight);

    const black = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.65, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x292d35, roughness: 0.45, metalness: 0.72 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x9298a3, roughness: 0.26, metalness: 0.94 });
    const pcb = new THREE.MeshStandardMaterial({ color: 0x171a20, roughness: 0.8, metalness: 0.25 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x8fcfff,
      roughness: 0.08,
      metalness: 0.05,
      transparent: true,
      opacity: 0.13,
      transmission: 0.78,
      side: THREE.DoubleSide,
    });
    const rgbMaterials: THREE.MeshBasicMaterial[] = [];
    const rgb = () => {
      const material = new THREE.MeshBasicMaterial({ color: 0xff006e });
      rgbMaterials.push(material);
      return material;
    };

    const parts: AnimatedPart[] = [];
    const fanRotors: THREE.Group[] = [];
    const register = (group: THREE.Group, offset: THREE.Vector3) => {
      const part = group as AnimatedPart;
      part.userData.target = group.position.clone();
      part.userData.start = group.position.clone().add(offset);
      part.position.copy(part.userData.start);
      scene.add(part);
      parts.push(part);
      return part;
    };
    const box = (w: number, h: number, d: number, material: THREE.Material) =>
      new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);

    const createFan = (verticalStrips = false) => {
      const group = new THREE.Group();
      const rotor = new THREE.Group();
      const frameSize = 7.6;
      const thickness = 0.68;
      const depth = 1.1;
      const top = box(frameSize, thickness, depth, black);
      const bottom = top.clone();
      top.position.y = frameSize / 2 - thickness / 2;
      bottom.position.y = -frameSize / 2 + thickness / 2;
      const left = box(thickness, frameSize - thickness * 2, depth, black);
      const right = left.clone();
      left.position.x = -frameSize / 2 + thickness / 2;
      right.position.x = frameSize / 2 - thickness / 2;
      group.add(top, bottom, left, right);

      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.95, 0.16, 12, 48), rgb());
      ring.position.z = 0.62;
      group.add(ring);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.92, 0.92, 0.8, 24), rgb());
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);
      for (let i = 0; i < 7; i++) {
        const blade = box(2.45, 0.18, 0.62, dark);
        const angle = (i / 7) * Math.PI * 2;
        blade.position.set(Math.cos(angle) * 1.8, Math.sin(angle) * 1.8, 0);
        blade.rotation.z = angle + 0.25;
        rotor.add(blade);
      }
      group.add(rotor);
      fanRotors.push(rotor);

      const stripMaterial = rgb();
      if (verticalStrips) {
        const a = box(0.25, frameSize + 0.1, 1.2, stripMaterial);
        const b = a.clone();
        a.position.x = 3.72;
        b.position.x = -3.72;
        group.add(a, b);
      } else {
        const a = box(frameSize + 0.1, 0.25, 1.2, stripMaterial);
        const b = a.clone();
        a.position.y = 3.72;
        b.position.y = -3.72;
        group.add(a, b);
      }
      return group;
    };

    // Chassis shell
    const chassis = new THREE.Group();
    const back = box(25, 27, 0.9, black);
    back.position.z = -7.7;
    const floor = box(25, 0.9, 15, black);
    floor.position.set(0, -13, -0.2);
    const roof = floor.clone();
    roof.position.y = 13;
    const leftWall = box(0.9, 27, 15, black);
    leftWall.position.set(-12.05, 0, -0.2);
    const frontPost = box(0.9, 27, 0.9, black);
    frontPost.position.set(12.05, 0, 6.8);
    chassis.add(back, floor, roof, leftWall, frontPost);
    register(chassis, new THREE.Vector3(0, 0, -120));

    // Motherboard
    const board = new THREE.Group();
    const boardBase = box(16, 18, 0.45, pcb);
    boardBase.position.set(-3.7, 0, -7);
    const heatA = box(2.2, 11.5, 0.9, dark);
    heatA.position.set(-10.2, 1.5, -6.45);
    const heatB = box(11.5, 2, 0.9, dark);
    heatB.position.set(-3.8, 7.7, -6.45);
    board.add(boardBase, heatA, heatB);
    register(board, new THREE.Vector3(0, 0, -150));

    // Bottom and side fan banks
    const bottomFans = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const fan = createFan();
      fan.position.x = -7.8 + i * 7.8;
      fan.rotation.x = -Math.PI / 2;
      bottomFans.add(fan);
    }
    bottomFans.position.set(0, -11.8, -0.3);
    register(bottomFans, new THREE.Vector3(0, -90, 0));

    const sideFans = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const fan = createFan(true);
      fan.position.y = 7.8 - i * 7.8;
      sideFans.add(fan);
    }
    sideFans.position.set(7.8, 0, -6.85);
    register(sideFans, new THREE.Vector3(95, 0, 0));

    const rearFan = new THREE.Group();
    const singleRearFan = createFan(true);
    singleRearFan.rotation.y = Math.PI / 2;
    rearFan.add(singleRearFan);
    rearFan.position.set(-11.1, 3.8, -2.8);
    register(rearFan, new THREE.Vector3(-95, 0, 0));

    // Top radiator
    const radiator = new THREE.Group();
    radiator.add(box(24, 1.2, 8, black));
    for (let i = 0; i < 3; i++) {
      const fan = createFan();
      fan.position.set(-7.8 + i * 7.8, -1.25, 0);
      fan.rotation.x = Math.PI / 2;
      radiator.add(fan);
    }
    radiator.position.set(0, 11.6, -0.8);
    register(radiator, new THREE.Vector3(0, 90, 0));

    // RAM
    const memory = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const stick = box(0.28, 7.2, 1.15, rgb());
      stick.position.x = i * 0.85;
      memory.add(stick);
    }
    memory.position.set(-1.2, 3.8, -6.25);
    register(memory, new THREE.Vector3(0, 0, 90));

    // Pump and coolant tubes
    const aio = new THREE.Group();
    aio.add(box(5, 4.5, 2.3, black));
    const pumpFace = box(4.65, 4.1, 0.08, rgb());
    pumpFace.position.z = 1.18;
    aio.add(pumpFace);
    const tubeCurve = (x: number) =>
      new THREE.CubicBezierCurve3(
        new THREE.Vector3(x, 2.1, 0),
        new THREE.Vector3(x, 5, 3),
        new THREE.Vector3(x + 2.2, 7, 1),
        new THREE.Vector3(x + 1.4, 9.1, 1),
      );
    aio.add(
      new THREE.Mesh(new THREE.TubeGeometry(tubeCurve(-0.55), 24, 0.34, 8, false), black),
      new THREE.Mesh(new THREE.TubeGeometry(tubeCurve(0.85), 24, 0.34, 8, false), black),
    );
    aio.position.set(-3.8, 3, -5.35);
    register(aio, new THREE.Vector3(0, 60, 90));

    // GPU
    const gpu = new THREE.Group();
    gpu.add(box(16, 4.4, 5.3, dark));
    const gpuFace = box(16.2, 2.4, 0.4, black);
    gpuFace.position.z = 2.7;
    const gpuGlowA = box(12, 0.16, 0.14, rgb());
    const gpuGlowB = gpuGlowA.clone();
    gpuGlowA.position.set(0, 0.78, 2.95);
    gpuGlowB.position.set(0, -0.78, 2.95);
    const gpuPlate = box(16, 0.28, 5.3, metal);
    gpuPlate.position.y = 2.33;
    gpu.add(gpuFace, gpuGlowA, gpuGlowB, gpuPlate);
    gpu.position.set(-2.8, -3, -1.7);
    register(gpu, new THREE.Vector3(-95, -20, 90));

    // Tempered glass is the last part to arrive.
    const glassPanel = new THREE.Group();
    const pane = box(25, 27, 0.16, glass);
    pane.position.z = 7.25;
    glassPanel.add(pane);
    register(glassPanel, new THREE.Vector3(0, 0, 120));

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const clock = new THREE.Clock();
    let animationFrame = 0;
    let elapsed = 0;
    const cycleDuration = 10.2;

    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.05);
      elapsed += delta;
      const cycle = reducedMotion ? 4.8 : elapsed % cycleDuration;

      parts.forEach((part, index) => {
        let progress = 1;
        if (!reducedMotion) {
          const inStart = 0.35 + index * 0.28;
          const outStart = 7.1 + (parts.length - 1 - index) * 0.12;
          if (cycle < inStart) progress = 0;
          else if (cycle < inStart + 1.15) progress = easeOutCubic(clamp((cycle - inStart) / 1.15));
          else if (cycle < outStart) progress = 1;
          else progress = 1 - easeInOutCubic(clamp((cycle - outStart) / 0.78));
        }
        part.position.lerpVectors(part.userData.start, part.userData.target, progress);
      });

      const hue = (elapsed * 0.075) % 1;
      const color = new THREE.Color().setHSL(hue, 1, 0.52);
      rgbMaterials.forEach((material) => material.color.copy(color));
      rgbLight.color.copy(color);
      fanRotors.forEach((rotor) => { rotor.rotation.z -= delta * 12; });

      camera.position.x = 20 + Math.sin(elapsed * 0.22) * 1.1;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
      });
      [black, dark, metal, pcb, glass, ...rgbMaterials].forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  // Keep generous vertical scene space so incoming radiator/GPU parts are not clipped.
  const height = Math.round(size * 1.02);
  return (
    <div
      ref={mountRef}
      className={`relative mx-auto shrink-0 overflow-hidden ${className ?? ""}`}
      style={{ width: `min(${size}px, 100%)`, aspectRatio: `${size} / ${height}` }}
      role="status"
      aria-label="Building PC configuration"
    />
  );
}

export function BuildCurveLoader(props: CurveLoaderProps) {
  return <CurveLoader {...props} />;
}
