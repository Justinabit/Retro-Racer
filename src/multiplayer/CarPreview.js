import * as THREE from "three";
import { Car } from "../player/Car.js";
import { CARS } from "../data.js";
import { CHARACTERS, combineStats } from "../kart/data.js";

// Reuse the game's WebGL renderer. The UI owns only a cheap 2D canvas; no
// additional animation loop, WebGL context, or lighting recreation on selection.
export class CarPreview {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#d5d8c9");
    this.scene.add(new THREE.HemisphereLight(0xfff3d7, 0x536474, 3));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(5, 8, 5);
    this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(38, 2, 0.1, 50);
    this.camera.position.set(6, 3.8, 7);
    this.camera.lookAt(0, 0.6, 0);
    this.viewport = new THREE.Vector4();
    this.scissor = new THREE.Vector4();
  }
  render(game, now) {
    const canvas = document.getElementById("mp-car-preview");
    if (!canvas) return;
    const base = CARS.find((c) => c.id === game.store.data.car) || CARS[0];
    const character =
      CHARACTERS.find((c) => c.id === game.store.data.character) ||
      CHARACTERS[0];
    const key = `${base.id}:${game.lobby?.mode}:${character.id}`;
    const changed = this.key !== key;
    if (changed) {
      this.car?.group.removeFromParent();
      this.car?.dispose();
      this.car = new Car(
        game.lobby?.mode === "kart" ? combineStats(base, character) : base,
        base.color,
        {},
        false,
      );
      this.scene.add(this.car.group);
      this.key = key;
    }
    if (!changed && canvas === this.canvas && now - this.last < 1000 / 30)
      return;
    this.canvas = canvas;
    this.last = now;
    this.car.group.rotation.y = Math.sin(now / 3500) * 0.3;
    const r = this.renderer,
      ratio = r.getPixelRatio();
    r.getViewport(this.viewport);
    r.getScissor(this.scissor);
    const test = r.getScissorTest();
    const width = Math.min(480, r.domElement.width),
      height = Math.min(240, r.domElement.height);
    r.setViewport(0, 0, width / ratio, height / ratio);
    r.setScissor(0, 0, width / ratio, height / ratio);
    r.setScissorTest(true);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    r.render(this.scene, this.camera);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas
      .getContext("2d")
      .drawImage(
        r.domElement,
        0,
        r.domElement.height - height,
        width,
        height,
        0,
        0,
        width,
        height,
      );
    r.setViewport(this.viewport);
    r.setScissor(this.scissor);
    r.setScissorTest(test);
  }
  dispose() {
    this.car?.group.removeFromParent();
    this.car?.dispose();
  }
}
