export class FpsCounter {
  private lastTime = performance.now();
  private samples: number[] = [];
  fps = 0;
  averageFps = 0;
  frameMs = 0;

  tick(now = performance.now()): void {
    this.frameMs = now - this.lastTime;
    this.lastTime = now;
    this.fps = this.frameMs > 0 ? 1000 / this.frameMs : 0;
    this.samples.push(this.fps);
    if (this.samples.length > 120) this.samples.shift();
    this.averageFps = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }
}
