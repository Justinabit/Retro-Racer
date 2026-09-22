import * as THREE from "three";
export class Particles {
  constructor() {
    this.count = 420;
    this.positions = new Float32Array(this.count * 3);
    this.colors = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.velocity = new Float32Array(this.count * 3);
    this.cursor = 0;
    this.positions.fill(-1000);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.colors, 3));
    this.mesh = new THREE.Points(
      g,
      new THREE.PointsMaterial({
        size: 0.55,
        vertexColors: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    );
    this.mesh.frustumCulled = false;
    this.skids = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.24, 1.1),
      new THREE.MeshBasicMaterial({
        color: 0x252824,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      600,
    );
    this.skidIndex = 0;
    this.obj = new THREE.Object3D();
    this.obj.position.y = -1000;
    this.obj.updateMatrix();
    for (let i = 0; i < 600; i++) this.skids.setMatrixAt(i, this.obj.matrix);
    this.skids.frustumCulled = false;
  }
  emit(p, color = 0xbab9ae, count = 2) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.cursor++ % this.count;
      this.life[i] = 0.5 + Math.random() * 0.8;
      this.positions.set(
        [
          p.x + (Math.random() - 0.5) * 1.7,
          p.y + 0.3 + Math.random() * 0.5,
          p.z + (Math.random() - 0.5) * 2,
        ],
        i * 3,
      );
      this.colors.set([c.r, c.g, c.b], i * 3);
      this.velocity.set(
        [
          (Math.random() - 0.5) * 2,
          1 + Math.random() * 2,
          (Math.random() - 0.5) * 2,
        ],
        i * 3,
      );
    }
  }
  puff(p, color = 0xc5c4b8, count = 3) {
    this.emit(p, color, count);
  }
  skid(p, yaw) {
    for (const side of [-1, 1]) {
      this.obj.position.set(
        p.x + Math.cos(yaw) * side * 0.85,
        p.y + 0.07,
        p.z - Math.sin(yaw) * side * 0.85,
      );
      this.obj.rotation.set(-Math.PI / 2, 0, -yaw);
      this.obj.updateMatrix();
      this.skids.setMatrixAt(this.skidIndex++ % 600, this.obj.matrix);
    }
    this.skids.instanceMatrix.needsUpdate = true;
  }
  skidKart(p, yaw) {
    for (const side of [-1, 1]) {
      this.obj.position.set(
        p.x + Math.cos(yaw) * side * 0.75,
        p.y + 0.08,
        p.z - Math.sin(yaw) * side * 0.75,
      );
      this.obj.rotation.set(-Math.PI / 2, 0, -yaw);
      this.obj.updateMatrix();
      this.skids.setMatrixAt(this.skidIndex++ % 600, this.obj.matrix);
    }
    this.skids.instanceMatrix.needsUpdate = true;
  }
  shieldBurst(p) {
    this.emit(p, 0x91d6f5, 14);
    const c = new THREE.Color(0xc8f1ff);
    for (let k = 0; k < 6; k++) {
      const i = this.cursor++ % this.count;
      this.life[i] = 0.6 + Math.random() * 0.4;
      const ang = (k / 6) * Math.PI * 2;
      this.positions.set([p.x + Math.cos(ang) * 1.5, p.y + 1, p.z + Math.sin(ang) * 1.5], i * 3);
      this.colors.set([c.r, c.g, c.b], i * 3);
      this.velocity.set([Math.cos(ang) * 2, 0.5 + Math.random(), Math.sin(ang) * 2], i * 3);
    }
  }
  tokenPop(p) {
    this.emit(p, 0xf6c85b, 10);
  }
  boostFlame(p, yaw) {
    const behind = new THREE.Vector3(-Math.sin(yaw) * 1.8, 0.15, -Math.cos(yaw) * 1.8);
    const q = p.clone().add(behind);
    this.emit(q, 0x71d4f2, 4);
    this.emit(q, 0xffd57b, 2);
  }
  bumpSpark(p) {
    this.emit(p, 0xffb24b, 9);
  }
  oilSlick(p) {
    this.emit(p, 0x30233e, 3);
  }
  wave(p, color = 0x9eddef) {
    const c = new THREE.Color(color);
    for (let k = 0; k < 10; k++) {
      const i = this.cursor++ % this.count;
      this.life[i] = 0.4 + Math.random() * 0.3;
      const ang = (k / 10) * Math.PI * 2 + Math.random() * 0.2;
      this.positions.set([p.x + Math.cos(ang) * 0.5, p.y + 0.2, p.z + Math.sin(ang) * 0.5], i * 3);
      this.colors.set([c.r, c.g, c.b], i * 3);
      this.velocity.set([Math.cos(ang) * 5, 0.2, Math.sin(ang) * 5], i * 3);
    }
  }
  magnetTether(from, to) {
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 1;
    this.emit(mid, 0xd7b2ee, 2);
  }
  update(dt) {
    for (let i = 0; i < this.count; i++)
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        for (let j = 0; j < 3; j++) this.positions[i * 3 + j] += this.velocity[i * 3 + j] * dt;
        this.velocity[i * 3 + 1] -= dt * 2.5;
        if (this.life[i] <= 0) this.positions[i * 3 + 1] = -1000;
      }
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.skids.geometry.dispose();
    this.skids.material.dispose();
  }
}
