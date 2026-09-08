# math.ts

**职责**：与渲染器无关的数学类型和运算。
**接口**：向量、矩阵、平面、AABB、射线和插值。
**内部**：保持纯函数；在基础设施边界再转换为 Three.js 类型。

## 数学约定

- **向量表示**：使用只读普通对象 `{ x, y, z }`，不使用 Three.js、Babylon 或其他数学类实例。
- **矩阵表示**：使用 16 个 `number` 组成的列主序只读一维数组，存储布局与 `THREE.Matrix4.elements` 一致。
- **坐标系统**：右手系、Y 轴向上；`+X` 向右、`+Y` 向上、`+Z` 朝向观察者，默认相机朝向 `-Z`。
- **矩阵乘法**：使用列向量 `M * v`；`A * B` 表示先应用 `B` 再应用 `A`；局部变换顺序为 `T * R * S`。
- **四元数**：使用只读普通对象 `{ x, y, z, w }`；作为旋转时必须为单位四元数，构造和插值负责归一化。
- **数值精度**：`math.ts` 的输入、输出和内部计算全部使用 `number`；`Float32Array` 只出现在渲染/GPU 边界，不作为本模块公开数学类型。
- **不可变性**：所有公开函数均为纯函数，不修改输入，不提供 in-place 或 out 参数版本。
- **AABB**：`min` 和 `max` 都包含；整数体素尺寸为 `max - min + 1`；空范围使用显式空状态，不使用 `Infinity`。
- **射线与 AABB 相交**：`t = 0`、起点位于内部、只接触边界以及 `tMax` 上的命中都算命中；不提供严格内部模式。
- **浮点 epsilon**：比较函数接受可选 `epsilon`，默认 `1e-6`；仅明确需要精确比较的算法可使用 `epsilon = 0`，禁止散落魔法数字。
- **零向量 normalize**：返回零向量，不返回 `null`、`Result` 或 `NaN`；需要区分零向量的调用方应在调用前显式检查。
- **插值**：`lerp` 允许 `t < 0` 和 `t > 1` 外推；另行提供 `lerpClamped` 将 `t` 限制在 `[0, 1]`。
- **平面**：使用 `{ normal, constant }`，平面方程为 `normal · point + constant = 0`；几何距离计算要求 `normal` 为单位向量。

## 公开类型

```ts
export type Vec3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type Quat = Readonly<{
  x: number;
  y: number;
  z: number;
  w: number;
}>;

export type Plane = Readonly<{
  normal: Vec3;
  constant: number;
}>;

export type Aabb =
  | Readonly<{ isEmpty: true }>
  | Readonly<{ isEmpty: false; min: Vec3; max: Vec3 }>;

export type Ray = Readonly<{
  origin: Vec3;
  direction: Vec3;
}>;
```

- 所有公开类型都是普通只读数据，不使用 class 或带方法的包装对象。
- `Mat4` 是列主序的 16 元组，索引与 `THREE.Matrix4.elements` 一致。
- `Aabb` 使用 `isEmpty` 作为可辨识字段；空 AABB 不保存 `min`/`max`。
- `Quat` 的 `w` 是实部，`x`、`y`、`z` 是虚部。

## 公开常量

```ts
export const EPSILON: number;
export const VEC3_ZERO: Vec3;
export const MAT4_IDENTITY: Mat4;
export const QUAT_IDENTITY: Quat;
export const EMPTY_AABB: Aabb;
```

- `EPSILON` 固定为 `1e-6`，作为所有默认近似比较的容差。
- `VEC3_ZERO` 是 `{ x: 0, y: 0, z: 0 }`。
- `MAT4_IDENTITY` 是列主序单位矩阵 `[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]`。
- `QUAT_IDENTITY` 是 `{ x: 0, y: 0, z: 0, w: 1 }`。
- `EMPTY_AABB` 是 `{ isEmpty: true }`。
- 常量本身也是只读值；函数不得修改常量，调用方也不应依赖运行时冻结。

## 公开接口

```ts
export function clamp(value: number, min: number, max: number): number;
export function lerp(a: number, b: number, t: number): number;
export function lerpClamped(a: number, b: number, t: number): number;
export function smoothstep(t: number): number;
export function approximatelyEqual(
  a: number,
  b: number,
  epsilon?: number,
): boolean;

export function vec3Add(a: Vec3, b: Vec3): Vec3;
export function vec3Subtract(a: Vec3, b: Vec3): Vec3;
export function vec3Scale(vector: Vec3, scalar: number): Vec3;
export function vec3Dot(a: Vec3, b: Vec3): number;
export function vec3Cross(a: Vec3, b: Vec3): Vec3;
export function vec3Length(vector: Vec3): number;
export function vec3LengthSquared(vector: Vec3): number;
export function vec3Distance(a: Vec3, b: Vec3): number;
export function vec3Normalize(vector: Vec3): Vec3;
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3;
export function vec3LerpClamped(a: Vec3, b: Vec3, t: number): Vec3;
export function vec3Equals(a: Vec3, b: Vec3, epsilon?: number): boolean;

export function mat4Multiply(a: Mat4, b: Mat4): Mat4;
export function mat4Compose(position: Vec3, rotation: Quat, scale: Vec3): Mat4;
export function mat4Invert(matrix: Mat4): Mat4 | null;
export function mat4TransformPoint(matrix: Mat4, point: Vec3): Vec3;
export function mat4TransformDirection(matrix: Mat4, direction: Vec3): Vec3;
export function mat4Equals(a: Mat4, b: Mat4, epsilon?: number): boolean;

export function quatNormalize(rotation: Quat): Quat;
export function quatMultiply(a: Quat, b: Quat): Quat;
export function quatConjugate(rotation: Quat): Quat;
export function quatFromAxisAngle(axis: Vec3, radians: number): Quat;
export function quatToMat4(rotation: Quat): Mat4;
export function quatRotateVec3(rotation: Quat, vector: Vec3): Vec3;
export function quatSlerp(a: Quat, b: Quat, t: number): Quat;
export function quatEquals(a: Quat, b: Quat, epsilon?: number): boolean;

export function planeNormalize(plane: Plane): Plane | null;
export function planeFromPointNormal(point: Vec3, normal: Vec3): Plane | null;
export function planeDistanceToPoint(plane: Plane, point: Vec3): number;
export function planeProjectPoint(plane: Plane, point: Vec3): Vec3;
export function planeIntersectRay(
  ray: Ray,
  plane: Plane,
  tMax?: number,
): number | null;

export function aabbFromPoints(points: readonly Vec3[]): Aabb;
export function aabbUnion(a: Aabb, b: Aabb): Aabb;
export function aabbExpand(aabb: Aabb, point: Vec3): Aabb;
export function aabbContainsPoint(
  aabb: Aabb,
  point: Vec3,
  epsilon?: number,
): boolean;
export function aabbIntersects(a: Aabb, b: Aabb, epsilon?: number): boolean;
export function aabbCenter(aabb: Aabb): Vec3 | null;
export function aabbSize(aabb: Aabb): Vec3 | null;
export function rayIntersectAabb(
  ray: Ray,
  aabb: Aabb,
  tMax?: number,
): number | null;
```

## 标量函数语义

- `clamp(value, min, max)` 在 `value < min` 时返回 `min`，在 `value > max` 时返回 `max`，否则返回 `value`；调用方必须保证 `min <= max`。
- `lerp(a, b, t)` 使用 `a + (b - a) * t`，允许外推。
- `lerpClamped(a, b, t)` 先执行 `clamp(t, 0, 1)`，再执行线性插值。
- `smoothstep(t)` 先把 `t` 限制到 `[0, 1]`，再返回 `t * t * (3 - 2 * t)`。
- `approximatelyEqual(a, b, epsilon = EPSILON)` 使用 `abs(a - b) <= epsilon`。
- 所有标量函数都不做输入 clamp 之外的数值修正，也不返回 `NaN` 作为可预期结果。

## Vec3 函数语义

- 加、减、缩放、点积和叉积使用标准三维向量定义。
- `vec3LengthSquared` 返回点积；`vec3Length` 返回其平方根；`vec3Distance` 返回两点差值的长度。
- `vec3Normalize(zero)` 返回 `VEC3_ZERO`；非零向量返回除以自身长度的结果。
- `vec3Lerp` 按分量执行 `a + (b - a) * t`，允许外推。
- `vec3LerpClamped` 先限制 `t` 到 `[0, 1]`，再按分量插值。
- `vec3Equals` 对三个分量分别执行 `approximatelyEqual`。

## Mat4 函数语义

- `mat4Multiply(a, b)` 执行标准列主序矩阵乘法，结果表示先应用 `b` 再应用 `a`。
- `mat4Compose(position, rotation, scale)` 等价于 `T * R * S`；`rotation` 必须是单位四元数，`scale` 按 x/y/z 分量缩放。
- `mat4Invert(matrix)` 返回逆矩阵；行列式严格等于 `0` 时返回 `null`，不抛异常。
- `mat4TransformPoint(matrix, point)` 与 `THREE.Vector3.applyMatrix4` 一致，包含齐次坐标的透视除法；计算得到的齐次 `w` 为 `0` 时结果未定义，属于调用方契约错误。
- `mat4TransformDirection(matrix, direction)` 只应用矩阵左上角的 `3x3` 线性部分，忽略平移，不执行透视除法，也不归一化结果。
- `mat4Equals` 对 16 个元素分别执行 `approximatelyEqual`。

## Quat 函数语义

- `quatNormalize(zero)` 返回 `QUAT_IDENTITY`；非零四元数返回除以自身长度的结果。
- `quatMultiply` 使用 Hamilton 乘法；两个单位四元数相乘的结果仍表示复合旋转。
- `quatConjugate` 返回 `{ x: -x, y: -y, z: -z, w }`。
- `quatFromAxisAngle(axis, radians)` 要求 `axis` 是非零有限向量；实现先归一化轴，再构造单位四元数。
- `quatToMat4(rotation)` 要求 `rotation` 是单位四元数，返回与其旋转一致的列主序矩阵。
- `quatRotateVec3(rotation, vector)` 要求 `rotation` 是单位四元数，返回旋转后的向量，不修改输入。
- `quatSlerp(a, b, t)` 沿最短弧插值并归一化结果；不额外限制 `t` 到 `[0, 1]`。
- `quatEquals` 按分量执行 `approximatelyEqual`，不把 `q` 与 `-q` 视为相等。

## 平面函数语义

- `planeNormalize(plane)` 返回法向量归一化后的平面，并把 `constant` 除以同一长度；法向量为零时返回 `null`。
- `planeFromPointNormal(point, normal)` 先归一化 `normal`，再令 `constant = -dot(normal, point)`；零法向量返回 `null`。
- `planeDistanceToPoint`、`planeProjectPoint` 和 `planeIntersectRay` 都要求 `plane` 已归一化；未归一化属于调用方契约错误。
- `planeDistanceToPoint` 返回有符号距离 `dot(normal, point) + constant`。
- `planeProjectPoint` 返回点到平面的正交投影 `point - distance * normal`。
- `planeIntersectRay` 返回射线参数 `t`：`t = 0` 的平面内命中有效，`t < 0` 或射线与平面平行时返回 `null`；传入 `tMax` 时只接受 `t <= tMax`，且 `tMax` 必须是非负有限值。

## AABB 与射线语义

- `aabbFromPoints([])` 返回 `EMPTY_AABB`；非空输入返回包含所有点的最小闭 AABB。
- `aabbUnion(EMPTY_AABB, b)` 返回 `b`，`aabbUnion(a, EMPTY_AABB)` 返回 `a`；两者都为空时返回 `EMPTY_AABB`。
- `aabbExpand(EMPTY_AABB, point)` 返回只包含该点的 AABB；非空 AABB 则按分量扩展 `min` 和 `max`。不使用 `Infinity` 作为哨兵。
- `aabbContainsPoint` 对 `min` 和 `max` 使用闭区间；可选 `epsilon` 同时放宽两端边界。
- `aabbIntersects` 使用闭区间相交判断；可选 `epsilon` 允许各轴区间之间存在不超过容差的间隙。
- `aabbCenter` 和 `aabbSize` 对空 AABB 返回 `null`。
- `ray.direction` 必须是非零有限向量，但不要求归一化；返回的 `t` 是射线参数，只有方向为单位向量时才等于世界距离。
- `rayIntersectAabb` 与 `THREE.Ray.intersectBox` 的边界语义一致：起点在 AABB 外时返回进入参数，起点在 AABB 内时返回离开参数；只接触边界和 `t === tMax` 都算命中。
- 省略 `tMax` 表示不设上限；显式传入时必须是有限非负值。未命中、`t < 0` 或 `t > tMax` 时返回 `null`。

## 输入有效性与退化情形

- 所有数值输入必须是有限数；`NaN`、`Infinity` 和 `-Infinity` 属于调用方契约错误，调用方必须在基础设施或领域边界先完成校验。
- `math.ts` 不使用 `Result` 表达数学退化，也不为非法输入提供恢复语义；退化结果使用零向量、单位四元数、`null` 或显式空 AABB。
- 可选 `epsilon` 必须是有限非负数；省略时使用 `EPSILON`。
- 可选 `tMax` 必须是有限非负数；省略时表示不设上限。
- `mat4Invert` 只把行列式严格等于 `0` 判定为不可逆；非有限输入不在函数契约内。
- 空 AABB 不参与点包含或相交命中；需要中心、尺寸或合并时使用 `null` 或显式空状态。
- 射线未命中、射线与平面平行、法向量为零或矩阵不可逆时返回 `null`，不使用异常。

## API 边界

- 只提供本文列出的类型、常量和函数，不创建占位 API。
- 不提供 `Vec2`、`Vec4`、Euler 角类型或欧拉角转换函数。
- 不提供相机投影矩阵构造、视锥体、包围球或碰撞响应 API。
- 不提供 in-place、out 参数、class 或 builder API。
- 不提供 `Result` 版本；可预期退化使用 `null`、零值、单位值或显式空状态。
- 不导出内部辅助函数、临时数组或实现细节。

## Three.js 对齐约束

- 不依赖 Three.js 作为运行时依赖，但上述数学语义必须与 Three.js 对应类型和函数保持一致。
- 类型表示可以不同，但运算结果、坐标约定和边界行为不得不同。
- Three.js 类型转换只发生在基础设施/渲染适配层。
- Three.js 只允许作为测试期 `devDependency`，用于对关键运算做一致性测试。
- 生产代码不得导入 Three.js。

**依赖**：none。
