import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, Object3D, PerspectiveCamera } from 'three';
import { buildClip } from './compile.js';
import { resolveCameraAt } from '../document/camera.js';
import type { ObjectId, Project } from '../document/project.js';

const CAMERA_NAME = 'camera';

/** Topmost ancestor: the mirror's scene root, which is the single mixer root. */
function sceneRootOf(object: Object3D): Object3D {
  let root = object;
  while (root.parent !== null) root = root.parent;
  return root;
}

/**
 * Thin `AnimationMixer` wrapper. It owns transport state and the frame-exact `setTime` the export
 * loop drives; the authored keyframes stay in `document/timeline.ts` and the clip is derived by
 * `./compile.js`. Nothing here writes back into the project.
 */
export class Playback {
  private readonly camera: PerspectiveCamera;
  /** The project whose camera is resolved onto the output camera; set by the first `rebuild`. */
  private project: Project | null = null;
  private mixer: AnimationMixer | null = null;
  private clip: AnimationClip | null = null;
  private action: AnimationAction | null = null;
  private objects: Map<ObjectId, Object3D> = new Map();
  private looping = false;
  /** Whether the transport is running; the public face of it is the `playing` accessor. */
  private running = false;

  /**
   * Points the mixer at the mirror's scene root and names the bound nodes after their `ObjectId`,
   * which is what makes the compiled track names resolve. Re-binding releases the old root.
   */
  constructor(opts: { camera: PerspectiveCamera }) {
    this.camera = opts.camera;
  }

  bind(objects: Map<ObjectId, Object3D>): void {
    this.objects = objects;
    for (const [objectId, object] of objects) object.name = objectId;
    this.camera.name = CAMERA_NAME;
    let root: Object3D | undefined;
    for (const object of objects.values()) {
      root = sceneRootOf(object);
      break;
    }
    if (root === undefined) return; // nothing bound: there is no root to bind tracks against
    if (this.mixer !== null) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.action = null;
    this.mixer = new AnimationMixer(root);
    this.installAction();
  }

  /** Recompiles the clip and keeps the playhead, so an edit never jumps the timeline. */
  rebuild(project: Project): void {
    const time = this.time;
    this.project = project;
    this.clip = buildClip(project);
    if (this.mixer === null) return; // the clip is retained; bind installs the action
    this.releaseAction();
    this.installAction();
    this.setTime(time);
  }

  /**
   * Clamps to `[0, duration]`, then applies exactly one mixer update of that time: the sampled
   * transforms depend only on `t` and the clip, never on call history, and a keyframe time
   * reproduces its authored value exactly. The shot is resolved here too, from the camera model rather than from a
   * track, so the frame the export loop asks for and the frame an author scrubs to are the same frame.
   */
  setTime(time: number): void {
    if (!Number.isFinite(time)) {
      throw new RangeError(`setTime requires a finite time, received ${time}`);
    }
    const clamped = Math.min(Math.max(time, 0), this.duration);
    const action = this.action;
    if (this.mixer !== null) {
      // A paused action zeroes the mixer's effective time scale, so it would ignore the update
      // below; sampling must not depend on transport state, so the flag is held clear for it.
      const wasPaused = action !== null && action.paused;
      if (action !== null) action.paused = false;
      this.mixer.setTime(clamped);
      if (action !== null && wasPaused) action.paused = true;
    }
    this.applyCamera();
  }

  play(): void {
    this.running = true;
    if (this.action !== null) this.action.paused = false;
  }

  /** Pausing keeps the action active, so scrubbing still samples. */
  pause(): void {
    this.running = false;
    if (this.action !== null) this.action.paused = true;
  }

  stop(): void {
    this.pause();
    this.setTime(0);
  }

  setLoop(loop: boolean): void {
    this.looping = loop;
    this.applyLoop();
  }

  /** Interactive preview only: it accumulates through the mixer's clock and is not reproducible. */
  advance(deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds)) {
      throw new RangeError(`advance requires a finite delta, received ${deltaSeconds}`);
    }
    if (this.mixer !== null) this.mixer.update(deltaSeconds);
    this.applyCamera();
  }

  /** The action's own playhead: `[0, duration)` while looping, clamped at the end otherwise. */
  get time(): number {
    return this.action === null ? 0 : this.action.time;
  }

  /**
   * True while the mixer is advancing the clip, i.e. between `play()` and `pause()`/`stop()`; false
   * before the first `play()`. The app uses it to refuse writing authored data from a running clip,
   * where a sampled transform would drift the authored camera pose towards the animation.
   */
  get playing(): boolean {
    return this.running;
  }

  /**
   * Whether the clip repeats. The transport's own setting rather than the clip's, and read by the app to tell a
   * clip that reached its end from one that wrapped: a run of a non-looping clip is over at the last frame, which
   * is where the app hands the view back and stops the transport.
   */
  get loop(): boolean {
    return this.looping;
  }

  get duration(): number {
    return this.clip === null ? 0 : this.clip.duration;
  }

  /**
   * Writes the active take's state at the playhead into the output camera: pose, clip planes, and the lens of a
   * perspective segment.
   */
  private applyCamera(): void {
    const state = this.project === null ? undefined : resolveCameraAt(this.project.camera, this.time * 1000);
    if (state !== undefined) {
      this.camera.position.copy(state.position);
      this.camera.quaternion.copy(state.quaternion);
      this.camera.near = state.near;
      this.camera.far = state.far;
      this.camera.fov = state.projection === 'perspective' ? state.lens : this.camera.fov;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Releases the mixer; mirrored objects, the camera, and the project are left untouched. */
  dispose(): void {
    if (this.mixer !== null) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.mixer.getRoot());
    }
    this.mixer = null;
    this.clip = null;
    this.action = null;
    this.objects = new Map();
  }

  private installAction(): void {
    const mixer = this.mixer;
    const clip = this.clip;
    if (mixer === null || clip === null) return;
    const action = mixer.clipAction(clip);
    this.action = action;
    this.applyLoop();
    action.setEffectiveWeight(1);
    action.play();
    action.paused = !this.running; // the action stays active so setTime can bind into it
  }

  private releaseAction(): void {
    const action = this.action;
    const mixer = this.mixer;
    if (action === null || mixer === null) return;
    const clip = action.getClip();
    action.stop();
    mixer.uncacheClip(clip);
    this.action = null;
  }

  private applyLoop(): void {
    if (this.action === null) return;
    this.action.setLoop(this.looping ? LoopRepeat : LoopOnce, this.looping ? Infinity : 1);
    this.action.clampWhenFinished = !this.looping;
  }
}
