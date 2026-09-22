import {
  AnimationClip,
  InterpolateDiscrete,
  InterpolateLinear,
  InterpolateSmooth,
  NumberKeyframeTrack,
  QuaternionKeyframeTrack,
  VectorKeyframeTrack,
} from 'three';
import type { InterpolationModes, KeyframeTrack } from 'three';
import type { ObjectId, Project } from '../document/project.js';
import type { Interpolation, Track, TrackChannel } from '../document/timeline.js';

const CLIP_NAME = 'timeline';
const CAMERA_BINDING_NAME = 'camera';

/** Authoring interpolation to Three.js interpolant. Per track, so one clip may mix all three. */
const INTERPOLANTS: Record<Interpolation, InterpolationModes> = {
  step: InterpolateDiscrete,
  linear: InterpolateLinear,
  smooth: InterpolateSmooth,
};

/**
 * The one place in ring 1 that maps a channel to its `PropertyBinding` path and value width. The
 * widths are the keyframe lengths `document/timeline.ts` validates.
 */
export function channelBinding(channel: TrackChannel): { path: string; valueSize: number } {
  switch (channel) {
    case 'position':
      return { path: '.position', valueSize: 3 };
    case 'quaternion':
      return { path: '.quaternion', valueSize: 4 };
    case 'scale':
      return { path: '.scale', valueSize: 3 };
    case 'fov':
      return { path: '.fov', valueSize: 1 };
    default: {
      const unknown: never = channel;
      throw new TypeError(`unknown track channel: ${String(unknown)}`);
    }
  }
}

function createTrack(
  channel: TrackChannel,
  name: string,
  times: Float32Array,
  values: Float32Array,
): KeyframeTrack {
  switch (channel) {
    case 'position':
    case 'scale':
      return new VectorKeyframeTrack(name, times, values);
    case 'quaternion':
      return new QuaternionKeyframeTrack(name, times, values);
    case 'fov':
      return new NumberKeyframeTrack(name, times, values);
    default: {
      const unknown: never = channel;
      throw new TypeError(`unknown track channel: ${String(unknown)}`);
    }
  }
}

/**
 * `PropertyBinding` name of a track relative to the mixer root: the target's binding name plus the
 * channel path. `Playback.bind` assigns exactly those two binding names to the mirror nodes (D22).
 */
function bindingName(
  project: Project,
  track: Track,
  only: readonly ObjectId[] | undefined,
): string | undefined {
  const path = channelBinding(track.channel).path;
  if (track.target.kind === 'camera') {
    return only === undefined ? `${CAMERA_BINDING_NAME}${path}` : undefined;
  }
  if (!project.objects.has(track.target.objectId)) return undefined;
  if (only !== undefined && !only.includes(track.target.objectId)) return undefined;
  return `${track.target.objectId}${path}`;
}

/**
 * Pure translation of the authoring timeline into one clip. Empty tracks and tracks whose object no
 * longer exists are skipped; `only` restricts the clip to the listed objects and drops the camera
 * track. Keyframe values are copied into fresh typed arrays.
 */
export function buildClip(project: Project, only?: readonly ObjectId[]): AnimationClip {
  const tracks: KeyframeTrack[] = [];
  for (const track of project.timeline.tracks) {
    const name = bindingName(project, track, only);
    if (name === undefined || track.keyframes.length === 0) continue;
    const { valueSize } = channelBinding(track.channel);
    const times = new Float32Array(track.keyframes.length);
    const values = new Float32Array(track.keyframes.length * valueSize);
    let index = 0;
    for (const keyframe of track.keyframes) {
      if (keyframe.value.length !== valueSize) {
        throw new RangeError(
          `keyframe at ${keyframe.timeMs} ms of ${name} holds ${keyframe.value.length} numbers, expected ${valueSize}`,
        );
      }
      // The clip is seconds and the authoring timeline is milliseconds: this is the one place the two units meet,
      // so playback, scrubbing, and the export keep working in seconds (README D45).
      times[index] = keyframe.timeMs / 1000;
      const offset = index * valueSize;
      for (let component = 0; component < valueSize; component += 1) {
        // The length check above established that every component exists.
        values[offset + component] = keyframe.value[component]!;
      }
      index += 1;
    }
    const keyframeTrack = createTrack(track.channel, name, times, values);
    keyframeTrack.setInterpolation(INTERPOLANTS[track.interpolation]);
    tracks.push(keyframeTrack);
  }
  // The duration is the timeline's, never the last keyframe's: a short track must not shorten an export.
  return new AnimationClip(CLIP_NAME, project.timeline.durationMs / 1000, tracks);
}
