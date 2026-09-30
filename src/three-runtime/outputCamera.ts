/**
 * The output camera: the one instance every render, export and carrier goes through, carrying whichever projection the
 * active segment authors — perspective or orthographic.
 *
 * It is a class of its own because three's two camera classes are each one projection and nothing else, while this
 * camera changes kind at a cut. The mirror, the capture, the export job, the carrier and the app all hold one instance
 * for the life of the page, so swapping the instance is not an option: what changes is the kind and the lens this
 * object is told to stand for.
 *
 * It owns its projection matrices and nothing else. The pose is the ordinary `Object3D` transform, written by
 * `SceneMirror.applyShot`, and the rest of the object — layers, name, `up` — is exactly three's `Camera`.
 */

import { Camera, MathUtils } from 'three';
import { DEFAULT_FAR, DEFAULT_FOV, DEFAULT_NEAR, type ProjectionKind } from '../document/camera.js';

export class OutputCamera extends Camera {
  /** Which projection `updateProjectionMatrix` builds. A segment's own kind, switched only at a cut. */
  projection: ProjectionKind = 'perspective';
  /**
   * The lens, in the unit its projection asks for: a vertical field of view in degrees for a perspective segment, a
   * visible world height in world units for an orthographic one. One number, because that is what an authored key
   * holds and what the exchange format carries.
   */
  lens = DEFAULT_FOV;
  /** Width over height of the frame this camera draws. The viewport's aspect, or the export's. */
  aspect = 1;
  near = DEFAULT_NEAR;
  far = DEFAULT_FAR;

  constructor() {
    super();
    this.updateProjectionMatrix();
  }

  /**
   * Rebuilds the projection from the current kind, lens, aspect, and clip planes, and keeps the inverse in step: three
   * reads `projectionMatrix` to draw and `projectionMatrixInverse` to unproject, and a picking ray or a `CameraHelper`
   * that used the other projection would silently disagree with the frame on screen.
   */
  updateProjectionMatrix(): void {
    if (this.projection === 'perspective') {
      const top = this.near * Math.tan(MathUtils.degToRad(this.lens) / 2);
      const halfWidth = top * this.aspect;
      this.projectionMatrix.makePerspective(-halfWidth, halfWidth, top, -top, this.near, this.far);
    } else {
      const halfHeight = this.lens / 2;
      const halfWidth = halfHeight * this.aspect;
      this.projectionMatrix.makeOrthographic(-halfWidth, halfWidth, halfHeight, -halfHeight, this.near, this.far);
    }
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}