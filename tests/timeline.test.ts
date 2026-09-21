import {
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  Object3D,
  PerspectiveCamera,
  QuaternionKeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import { describe, expect, it } from 'vitest';
import { buildClip, channelBinding } from '../src/animation/compile.js';
import { Playback } from '../src/animation/playback.js';
import { Project, type ObjectId } from '../src/document/project.js';
import {
  addKeyframe,
  ensureTrack,
  findTrack,
  moveKeyframe,
  removeKeyframe,
  removeTracksFor,
  setInterpolation,
  sortKeyframes,
  trackKey,
  type Timeline,
  type Track,
  type TrackChannel,
  type TrackTarget,
} from '../src/document/timeline.js';

const CHANNELS: readonly TrackChannel[] = ['position', 'quaternion', 'scale', 'fov'];

/** Keyframe times in array order. */
function times(track: Track | undefined): number[] {
  return (track?.keyframes ?? []).map((keyframe) => keyframe.time);
}

/** Keyframe values in array order, flattened, so "changed nothing" is observable. */
function values(track: Track | undefined): number[][] {
  return (track?.keyframes ?? []).map((keyframe) => [...keyframe.value]);
}

function oneProject() {
  const project = new Project();
  const car = project.createObject({ name: 'car', representation: 'empty' });
  const wheel = project.createObject({ name: 'wheel', parentId: car.id, representation: 'empty' });
  project.timeline.fps = 10;
  project.timeline.duration = 2;
  return { project, car, wheel };
}

function objectTarget(objectId: ObjectId): TrackTarget {
  return { kind: 'object', objectId };
}

const CAMERA: TrackTarget = { kind: 'camera' };

/**
 * A mirror shaped like `SceneMirror`: one scene root, one node per project object, and the output
 * camera as a child of that root. `Playback.bind` names the nodes after their ids (D22).
 */
function mirrorFor(project: Project, objectId: ObjectId) {
  const root = new Object3D();
  root.name = 'scene';
  const nodes = new Map<ObjectId, Object3D>();
  for (const id of project.objects.keys()) {
    const object = new Object3D();
    root.add(object);
    nodes.set(id, object);
  }
  const camera = new PerspectiveCamera(50, 1, 0.1, 2000);
  root.add(camera);
  const playback = new Playback({ camera });
  playback.bind(nodes);
  playback.rebuild(project);
  const node = nodes.get(objectId);
  if (node === undefined) throw new Error(`no mirror node for ${objectId}`);
  return { playback, node, camera };
}

describe('track identity', () => {
  it('keys a distinct string per target kind, object id, and channel', () => {
    const { project, car, wheel } = oneProject();
    const targets: TrackTarget[] = [
      CAMERA,
      objectTarget(car.id),
      objectTarget(wheel.id),
      objectTarget('obj-999'),
    ];
    const keys = new Set<string>();
    let count = 0;
    for (const target of targets) {
      for (const channel of CHANNELS) {
        keys.add(trackKey(target, channel));
        count += 1;
      }
    }
    expect(keys.size).toBe(count);
    expect(trackKey(CAMERA, 'position')).not.toBe(trackKey(objectTarget(car.id), 'position'));
    expect(trackKey(objectTarget(car.id), 'position')).not.toBe(
      trackKey(objectTarget(car.id), 'quaternion'),
    );
    expect(project.objects.size).toBe(2);
  });

  it('creates a missing track with the default interpolation and returns the existing one again', () => {
    const { project, car } = oneProject();
    const track = ensureTrack(project.timeline, objectTarget(car.id), 'position');
    expect(track.interpolation).toBe('linear');
    expect(track.keyframes).toEqual([]);
    expect(project.timeline.tracks).toHaveLength(1);

    const again = ensureTrack(project.timeline, objectTarget(car.id), 'position', 'step');
    expect(again).toBe(track);
    expect(project.timeline.tracks).toHaveLength(1);
    expect(again.interpolation).toBe('linear');

    const explicit = ensureTrack(project.timeline, objectTarget(car.id), 'scale', 'smooth');
    expect(explicit.interpolation).toBe('smooth');
    expect(project.timeline.tracks).toHaveLength(2);
  });

  it('finds a track and returns undefined when the target has none', () => {
    const { project, car, wheel } = oneProject();
    const track = ensureTrack(project.timeline, CAMERA, 'fov');
    expect(findTrack(project.timeline, CAMERA, 'fov')).toBe(track);
    expect(findTrack(project.timeline, CAMERA, 'position')).toBeUndefined();
    expect(findTrack(project.timeline, objectTarget(car.id), 'fov')).toBeUndefined();
    expect(findTrack(project.timeline, objectTarget(wheel.id), 'fov')).toBeUndefined();
  });
});

describe('keyframes', () => {
  it('keeps keyframes strictly ascending by time after an out-of-order insert', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 1, [1, 0, 0]);
    addKeyframe(timeline, target, 'position', 0.5, [0.5, 0, 0]);
    addKeyframe(timeline, target, 'position', 2, [2, 0, 0]);
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    const track = findTrack(timeline, target, 'position');
    expect(times(track)).toEqual([0, 0.5, 1, 2]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it('replaces the value of a keyframe already sitting at that time', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const authored = [1, 2, 3];
    const first = addKeyframe(project.timeline, target, 'position', 1, authored);
    const second = addKeyframe(project.timeline, target, 'position', 1, [4, 5, 6]);
    const track = findTrack(project.timeline, target, 'position');
    expect(times(track)).toEqual([1]);
    expect(values(track)).toEqual([[4, 5, 6]]);
    if (!first.ok || !second.ok) throw new Error('both inserts must succeed');
    expect(second.keyframe).toBe(first.keyframe);
    expect(first.keyframe.value).not.toBe(authored);
    authored[0] = 99;
    expect(first.keyframe.value).toEqual([4, 5, 6]);
  });

  it('rejects a value whose length does not match the channel with bad-value-length', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    const before = values(findTrack(timeline, target, 'position'));

    const short = addKeyframe(timeline, target, 'quaternion', 0.5, [0, 0, 0]);
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.error).toBe('bad-value-length');
      expect(short.detail.length).toBeGreaterThan(0);
    }

    const long = addKeyframe(timeline, target, 'fov', 0.5, [1, 2, 3]);
    expect(long.ok).toBe(false);
    expect(findTrack(timeline, target, 'quaternion')).toBeUndefined();
    expect(findTrack(timeline, target, 'fov')).toBeUndefined();
    expect(values(findTrack(timeline, target, 'position'))).toEqual(before);

    // The neighbouring programmer errors throw instead of returning: a bad time or a non-finite value.
    expect(() => addKeyframe(timeline, target, 'position', -1, [0, 0, 0])).toThrow(RangeError);
    expect(() => addKeyframe(timeline, target, 'position', Infinity, [0, 0, 0])).toThrow(RangeError);
    expect(() => addKeyframe(timeline, target, 'position', 0.5, [0, Number.NaN, 0])).toThrow(
      TypeError,
    );
    expect(() => moveKeyframe(timeline, target, 'position', 0, -0.5)).toThrow(RangeError);
    expect(values(findTrack(timeline, target, 'position'))).toEqual(before);
  });

  it('moves and removes keyframes by index and reports whether anything changed', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    const timeline = project.timeline;
    addKeyframe(timeline, target, 'position', 0, [0, 0, 0]);
    addKeyframe(timeline, target, 'position', 0.5, [0.5, 0, 0]);
    addKeyframe(timeline, target, 'position', 1.5, [1.5, 0, 0]);
    const track = findTrack(timeline, target, 'position');

    expect(moveKeyframe(timeline, target, 'position', 2, 0.25)).toBe(true);
    expect(times(track)).toEqual([0, 0.25, 0.5]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [1.5, 0, 0],
      [0.5, 0, 0],
    ]);

    const snapshot = values(track);
    expect(moveKeyframe(timeline, target, 'position', 9, 1)).toBe(false);
    expect(moveKeyframe(timeline, CAMERA, 'fov', 0, 1)).toBe(false);
    expect(moveKeyframe(timeline, target, 'position', -1, 1)).toBe(false);
    expect(values(track)).toEqual(snapshot);

    // Moving onto an occupied time keeps the moved keyframe and drops the one that sat there.
    expect(moveKeyframe(timeline, target, 'position', 2, 0.25)).toBe(true);
    expect(times(track)).toEqual([0, 0.25]);
    expect(values(track)).toEqual([
      [0, 0, 0],
      [0.5, 0, 0],
    ]);

    expect(removeKeyframe(timeline, target, 'position', 5)).toBe(false);
    expect(removeKeyframe(timeline, CAMERA, 'fov', 0)).toBe(false);
    expect(removeKeyframe(timeline, target, 'position', 0)).toBe(true);
    expect(times(track)).toEqual([0.25]);
  });

  it('drops the whole track when its last keyframe is removed', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'scale', 0, [1, 1, 1]);
    expect(project.timeline.tracks).toHaveLength(1);
    expect(removeKeyframe(project.timeline, target, 'scale', 0)).toBe(true);
    expect(findTrack(project.timeline, target, 'scale')).toBeUndefined();
    expect(project.timeline.tracks).toHaveLength(0);
  });

  it('changes interpolation only for a track that exists', () => {
    const { project, car, wheel } = oneProject();
    const target = objectTarget(car.id);
    ensureTrack(project.timeline, target, 'position');
    expect(setInterpolation(project.timeline, target, 'position', 'smooth')).toBe(true);
    expect(findTrack(project.timeline, target, 'position')?.interpolation).toBe('smooth');
    expect(setInterpolation(project.timeline, objectTarget(wheel.id), 'scale', 'step')).toBe(false);
    expect(project.timeline.tracks).toHaveLength(1);
  });

  it('sorts keyframes in place and drops every object track of a removed object while keeping the camera track', () => {
    const ids = new Project();
    const firstId = ids.allocateId();
    const secondId = ids.allocateId();
    const timeline: Timeline = {
      duration: 3,
      fps: 24,
      tracks: [
        {
          target: { kind: 'object', objectId: firstId },
          channel: 'position',
          interpolation: 'linear',
          keyframes: [
            { time: 2, value: [2, 0, 0] },
            { time: 0, value: [0, 0, 0] },
            { time: 1, value: [1, 0, 0] },
          ],
        },
        {
          target: { kind: 'object', objectId: secondId },
          channel: 'scale',
          interpolation: 'step',
          keyframes: [
            { time: 1.5, value: [2, 2, 2] },
            { time: 0.5, value: [1, 1, 1] },
          ],
        },
      ],
    };
    const firstKeyframes = timeline.tracks[0]?.keyframes;
    const secondKeyframes = timeline.tracks[1]?.keyframes;
    sortKeyframes(timeline);
    expect(timeline.tracks[0]?.keyframes).toBe(firstKeyframes);
    expect(timeline.tracks[1]?.keyframes).toBe(secondKeyframes);
    expect(times(timeline.tracks[0])).toEqual([0, 1, 2]);
    expect(times(timeline.tracks[1])).toEqual([0.5, 1.5]);

    const { project, car } = oneProject();
    const carTarget = objectTarget(car.id);
    addKeyframe(project.timeline, carTarget, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    const tracks = project.timeline.tracks;
    project.remove(car.id);
    expect(project.timeline.tracks).toBe(tracks);
    expect(findTrack(project.timeline, carTarget, 'quaternion')).toBeUndefined();
    expect(findTrack(project.timeline, CAMERA, 'fov')?.keyframes).toHaveLength(1);

    removeTracksFor(project.timeline, 'obj-999');
    expect(project.timeline.tracks).toHaveLength(1);
  });

});

describe('clip compilation', () => {
  it('maps step, linear, and smooth to the matching Three.js interpolation modes', () => {
    const { project, car, wheel } = oneProject();
    const carTarget = objectTarget(car.id);
    const wheelTarget = objectTarget(wheel.id);
    addKeyframe(project.timeline, carTarget, 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, carTarget, 'position', 1, [1, 1, 1]);
    addKeyframe(project.timeline, wheelTarget, 'scale', 0, [1, 1, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    addKeyframe(project.timeline, CAMERA, 'fov', 1, [70]);
    setInterpolation(project.timeline, carTarget, 'position', 'step');
    setInterpolation(project.timeline, wheelTarget, 'scale', 'smooth');
    setInterpolation(project.timeline, CAMERA, 'fov', 'linear');

    const clip = buildClip(project);
    const byName = new Map(clip.tracks.map((track) => [track.name, track]));
    expect(byName.get(`${car.id}.position`)?.getInterpolation()).toBe(InterpolateDiscrete);
    expect(byName.get(`${wheel.id}.scale`)?.getInterpolation()).toBe(InterpolateSmooth);
    expect(byName.get('camera.fov')?.getInterpolation()).toBe(InterpolateLinear);
    expect(byName.get(`${car.id}.position`)).toBeInstanceOf(VectorKeyframeTrack);
    expect(byName.get(`${wheel.id}.scale`)).toBeInstanceOf(VectorKeyframeTrack);
    expect(byName.get('camera.fov')).toBeInstanceOf(NumberKeyframeTrack);
  });

  it('binds each channel to its property path and value size', () => {
    expect(channelBinding('position')).toEqual({ path: '.position', valueSize: 3 });
    expect(channelBinding('quaternion')).toEqual({ path: '.quaternion', valueSize: 4 });
    expect(channelBinding('scale')).toEqual({ path: '.scale', valueSize: 3 });
    expect(channelBinding('fov')).toEqual({ path: '.fov', valueSize: 1 });

    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, target, 'quaternion', 0.5, [0, 0, 0, 1]);
    const clip = buildClip(project);
    const track = clip.tracks[0];
    expect(track).toBeInstanceOf(QuaternionKeyframeTrack);
    expect(track?.name).toBe(`${car.id}.quaternion`);
    expect(track?.times.length).toBe(2);
    expect(track?.values.length).toBe(2 * 4);
  });

  it('names object tracks obj-<n>.<path> and the camera track camera.fov', () => {
    const { project, car, wheel } = oneProject();
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, objectTarget(wheel.id), 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [50]);
    const names = buildClip(project).tracks.map((track) => track.name);
    expect(names).toEqual([`${car.id}.position`, `${wheel.id}.quaternion`, 'camera.fov']);
    expect(car.id).toMatch(/^obj-\d+$/);
  });

  it('skips objects that own no tracks and takes the duration from the timeline', () => {
    const { project, car, wheel } = oneProject();
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, objectTarget(car.id), 'position', 1, [1, 1, 1]);
    expect(project.objects.has(wheel.id)).toBe(true);
    expect(buildClip(project).tracks).toHaveLength(1);

    project.timeline.duration = 5;
    const stretched = buildClip(project);
    expect(stretched.duration).toBe(5);
    expect(stretched.tracks[0]?.times[1]).toBe(1);

    const empty = new Project();
    expect(buildClip(empty).tracks).toHaveLength(0);
    expect(buildClip(empty).duration).toBe(0);
  });
});

describe('playback sampling', () => {
  it('reproduces each keyframe value exactly at its keyframe time', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'position', 0, [1.5, -2.25, 0]);
    addKeyframe(project.timeline, target, 'position', 0.5, [4, 5.5, -6]);
    addKeyframe(project.timeline, target, 'position', 1.5, [0.25, 0, 8]);
    addKeyframe(project.timeline, target, 'quaternion', 0, [0, 0, 0, 1]);
    addKeyframe(project.timeline, target, 'quaternion', 1, [0.5, 0.5, 0.5, 0.5]);
    addKeyframe(project.timeline, CAMERA, 'fov', 0, [40]);
    addKeyframe(project.timeline, CAMERA, 'fov', 1, [70]);

    const { playback, node, camera } = mirrorFor(project, car.id);
    expect(playback.duration).toBe(2);

    const expectations: readonly (readonly [number, readonly number[]])[] = [
      [0, [1.5, -2.25, 0]],
      [0.5, [4, 5.5, -6]],
      [1.5, [0.25, 0, 8]],
    ];
    for (const [time, position] of expectations) {
      playback.setTime(time);
      expect(node.position.toArray()).toEqual([...position]);
    }

    playback.setTime(0);
    expect(node.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    playback.setTime(1);
    expect(node.quaternion.toArray()).toEqual([0.5, 0.5, 0.5, 0.5]);

    playback.setTime(1);
    expect(camera.fov).toBe(70);
    const expectedProjection = new PerspectiveCamera(70, 1, 0.1, 2000);
    expect(camera.projectionMatrix.elements).toEqual(expectedProjection.projectionMatrix.elements);

    // The mixer animates the mirror only: the project's own transform is untouched.
    expect(project.get(car.id)?.transform.position.toArray()).toEqual([0, 0, 0]);
    expect(project.camera.fov).toBe(50);
  });

  it('keeps the current time when the clip is rebuilt after an edit', () => {
    const { project, car } = oneProject();
    const target = objectTarget(car.id);
    addKeyframe(project.timeline, target, 'position', 0, [0, 0, 0]);
    addKeyframe(project.timeline, target, 'position', 0.5, [0.5, 0, 0]);
    const { playback, node } = mirrorFor(project, car.id);

    playback.setTime(0.5);
    expect(playback.time).toBe(0.5);

    addKeyframe(project.timeline, target, 'position', 1.5, [1.5, 0, 0]);
    project.timeline.duration = 3;
    playback.rebuild(project);
    expect(playback.time).toBe(0.5);
    expect(playback.duration).toBe(3);

    playback.setTime(1.5);
    expect(node.position.toArray()).toEqual([1.5, 0, 0]);

    // Transport state survives the rebuild: the action is still playing and still looping.
    playback.play();
    playback.setLoop(true);
    playback.rebuild(project);
    expect(playback.time).toBe(1.5);
    playback.advance(1.5);
    expect(playback.time).toBe(0); // 1.5 + 1.5 = 3 seconds wrapped by the 3 second loop

    playback.stop();
    expect(playback.time).toBe(0);
    expect(node.position.toArray()).toEqual([0, 0, 0]);
  });
});
