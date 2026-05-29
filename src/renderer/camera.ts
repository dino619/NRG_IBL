import { mat4, vec3 } from "wgpu-matrix";

export class OrbitCamera {
  yaw = 0.35;
  pitch = 0.18;
  distance = 4.2;
  target = vec3.create(0, 0, 0);
  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.yaw += dx * 0.006;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch + dy * 0.006));
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = Math.max(1.6, Math.min(12, this.distance * Math.exp(event.deltaY * 0.001)));
    }, { passive: false });
  }

  position(): Float32Array {
    const cp = Math.cos(this.pitch);
    return vec3.create(
      Math.sin(this.yaw) * cp * this.distance,
      Math.sin(this.pitch) * this.distance,
      Math.cos(this.yaw) * cp * this.distance,
    );
  }

  viewProjection(aspect: number): Float32Array {
    const projection = mat4.perspective((55 * Math.PI) / 180, aspect, 0.05, 100);
    const view = mat4.lookAt(this.position(), this.target, vec3.create(0, 1, 0));
    return mat4.multiply(projection, view);
  }

  skyInvViewProjection(aspect: number): Float32Array {
    const projection = mat4.perspective((55 * Math.PI) / 180, aspect, 0.05, 100);
    const eye = this.position();
    const view = mat4.lookAt(eye, this.target, vec3.create(0, 1, 0));
    view[12] = 0; view[13] = 0; view[14] = 0;
    return mat4.inverse(mat4.multiply(projection, view));
  }
}
