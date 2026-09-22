import * as THREE from "three";
// Original modular helmeted racers. No downloaded models or branded assets.
export function createCharacter(character, index = 0) {
  const group = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({
    color: character.color,
    roughness: 0.6,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x243544,
    roughness: 0.35,
    metalness: 0.2,
  });
  const light = new THREE.MeshStandardMaterial({
    color: 0xece6ce,
    emissive: character.color,
    emissiveIntensity: 0.18,
  });
  const add = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  const bulk = 0.82 + character.weight / 250;
  add(new THREE.BoxGeometry(0.65 * bulk, 0.65, 0.43), suit, 0, 0.5, 0);
  const helmet = add(new THREE.SphereGeometry(0.44, 10, 7), suit, 0, 1.15, 0);
  helmet.scale.x = bulk;
  add(new THREE.BoxGeometry(0.68, 0.18, 0.19), dark, 0, 1.2, 0.34);
  add(new THREE.BoxGeometry(0.5, 0.035, 0.03), light, 0, 1.2, 0.45);
  for (const side of [-1, 1]) {
    const arm = add(
      new THREE.CapsuleGeometry(0.12, 0.38, 2, 6),
      suit,
      side * 0.44,
      0.53,
      0.2,
    );
    arm.rotation.x = -0.8;
    arm.rotation.z = side * 0.2;
    add(new THREE.BoxGeometry(0.25, 0.18, 0.42), dark, side * 0.22, 0.08, 0.25);
    add(new THREE.SphereGeometry(0.13, 6, 4), dark, side * 0.42, 0.34, 0.43);
  }
  // Silhouettes: antenna, crest, ear fins and heavy shoulder plates.
  if (index % 3 === 0) {
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 5), dark, 0.27, 1.65, 0);
    add(new THREE.SphereGeometry(0.09, 6, 4), light, 0.27, 1.84, 0);
  }
  if (index % 3 === 1)
    add(new THREE.BoxGeometry(0.1, 0.2, 0.6), light, 0, 1.61, 0);
  if (index % 3 === 2)
    for (const side of [-1, 1])
      add(new THREE.ConeGeometry(0.16, 0.35, 4), light, side * 0.48, 1.37, 0);
  if (character.weight > 85)
    for (const side of [-1, 1])
      add(new THREE.BoxGeometry(0.36, 0.28, 0.5), light, side * 0.46, 0.8, 0);
  return group;
}
