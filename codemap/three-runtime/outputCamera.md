# src/three-runtime/outputCamera.ts

Ring: 2 · Layer: three-runtime · Depends on: `three`, `document/camera.ts` (the constants and the projection kind)

## Responsibility
The output camera: the one instance every render, export, carrier and preview goes through, carrying whichever
projection the active segment authors — perspective or orthographic — and rebuilding its own projection matrices from
four numbers.

It is a class of its own because three's two camera classes are each one projection and nothing else, while this
camera changes kind at a cut. The mirror, the capture, the export job, the carrier and the app all hold one instance for
the life of the page, so swapping the instance is not an option: what changes is the kind and the lens this object is
told to stand for.

It owns its projection and nothing else. The pose is the ordinary `Object3D` transform, written by
`SceneMirror.applyShot`; layers, name, and `up` are exactly three's `Camera`.

## Public interface
```ts
class OutputCamera extends THREE.Camera {
  projection: ProjectionKind;   // 'perspective' | 'orthographic'; a segment's own kind, switched only at a cut
  lens: number;                 // vertical FOV in degrees, or a visible world height in world units
  aspect: number;               // width over height of the frame this camera draws
  near: number;
  far: number;
  constructor();                // builds a perspective projection at the model's defaults
  updateProjectionMatrix(): void;
}
```

## Internal logic
1. Construction seeds the fields from the camera model's own constants — `DEFAULT_FOV`, `DEFAULT_NEAR`, `DEFAULT_FAR`,
   `projection = 'perspective'`, `aspect = 1` — and builds the matrix once, so a camera that is never told anything is
   usable rather than an uninitialised one.
2. `updateProjectionMatrix` builds one of two matrices from the four numbers. Perspective: `top = near · tan(lens / 2)`,
   `halfWidth = top · aspect`, then `makePerspective(-halfWidth, halfWidth, top, -top, near, far)` — which is three's own
   `PerspectiveCamera` arithmetic, so a frame drawn through this camera is the frame that camera would have drawn.
   Orthographic: `halfHeight = lens / 2`, `halfWidth = halfHeight · aspect`, then
   `makeOrthographic(-halfWidth, halfWidth, halfHeight, -halfHeight, near, far)`.
3. It then copies the matrix into `projectionMatrixInverse` and inverts it, because three reads `projectionMatrix` to
   draw and `projectionMatrixInverse` to unproject: a picking ray or a `CameraHelper` left on the other projection
   would silently disagree with the frame on screen.
4. Nothing else is written. There is no `zoom`, no `fov` alias, and no `view` field: the lens is one number whose unit
   the projection decides, which is exactly what an authored key holds and what the exchange format carries.

## Invariants
- `projectionMatrix` and `projectionMatrixInverse` are always the inverse pair of the same projection, and both are
  current after `updateProjectionMatrix`.
- The perspective arithmetic is three's own, so swapping between this class and a `PerspectiveCamera` cannot change a
  rendered frame; the orthographic one is the orthographic camera's, with `lens` standing in for `top - bottom`.
- The pose, the layers, the name, and `up` belong to the caller (`SceneMirror`): this class never writes them.
- The lens is in the unit its projection asks for, and the unit is never converted: switching a shot from perspective
  to orthographic reinterprets the number, which is why the author sets it after the switch.

## Errors
Nothing throws. The fields are plain numbers the caller validates elsewhere — `document/camera.ts` refuses a
non-positive or non-increasing clip-plane pair, and the projection kind comes from the model's own union.

## Dependencies
- `three` — `Camera`, `MathUtils`, and the `Matrix4` methods `makePerspective`/`makeOrthographic`.
- `../document/camera.js` — `DEFAULT_FAR`, `DEFAULT_FOV`, `DEFAULT_NEAR`, and the `ProjectionKind` union, so the
  defaults and the kind are declared once and read here rather than copied.

## Tests
Covered where it is observable rather than directly: `tests/scene.test.ts` pins that `SceneMirror.applyShot` writes a
shot into this camera and that an orthographic segment's matrix is the orthographic camera's own, element for element,
with the inverse in step; `tests/cameraControl.test.ts` pins that the carrier draws the frustum of the projection the
shot uses, orthographic included. Nothing here needs a GPU: three builds these matrices without a renderer.

## Open questions
- The class exposes no `fov` alias, so a caller that wants "the perspective field of view" must read the kind as well.
  If a second consumer ever needs that convenience, it belongs in the model as a derived value rather than as a second
  field on a camera.
