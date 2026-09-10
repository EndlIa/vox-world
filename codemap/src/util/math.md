# math.ts

**职责**：与渲染器无关的数学类型和运算。
**接口**：向量、矩阵、平面、AABB、射线和插值。
**内部**：保持纯函数。

## 数学约定

- **向量表示**：使用只读普通对象 `{ x, y, z }`，不使用 Three.js或其他数学类实例。
- **矩阵表示**：使用 16 个 `number` 组成的列主序只读一维数组，存储布局与 `THREE.Matrix4.elements` 一致。
- **坐标系统**：右手系、Y 轴向上；`+X` 向右、`+Y` 向上、`+Z` 朝向观察者，默认相机朝向 `-Z`。
- **矩阵乘法**：使用列向量 `M * v`；`A * B` 表示先应用 `B` 再应用 `A`；局部变换顺序为 `T * R * S`。
- **四元数**：使用只读普通对象 `{ x, y, z, w }`。`Quat` 带 brand，值域恒为单位四元数——“作为旋转必须是单位四元数”由类型保证，不是调用方纪律。调用方不得就地构造 `Quat`，必须经由 `quatNormalize`（通用构造入口，零输入返回 `QUAT_IDENTITY`）或 `quatFromAxisAngle`；本模块其余 `quat*` 函数的输出天然保持单位长度。
- **数值精度**：`math.ts` 的输入、输出和内部计算全部使用 `number`；`Float32Array` 只出现在渲染/GPU 边界，不作为本模块公开数学类型。
- **不可变性**：所有公开函数均为纯函数，不修改输入，不提供 in-place 或 out 参数版本。
- **AABB**：`min` 和 `max` 都包含；`aabbSize` 返回几何尺寸 `max - min`；闭区间整数体素覆盖数 `max - min + 1` 属于 domain 层的体素计数语义，不由 `aabbSize` 承担；空范围使用显式空状态，不使用 `Infinity`。
- **射线与 AABB 相交**：`t = 0`、起点位于内部、只接触边界以及 `tMax` 上的命中都算命中；不提供严格内部模式。
- **浮点 epsilon**：比较函数接受可选 `epsilon`，默认 `1e-6`；仅明确需要精确比较的算法可使用 `epsilon = 0`，禁止散落魔法数字。
- **零向量 normalize**：返回零向量，不返回 `null`、`Result` 或 `NaN`；需要区分零向量的调用方应在调用前显式检查。
- **插值**：`lerp` 允许 `t < 0` 和 `t > 1` 外推；另行提供 `lerpClamped` 将 `t` 限制在 `[0, 1]`。
- **平面**：使用 `{ normal, constant }`，平面方程为 `normal · point + constant = 0`。`Plane` 带 brand，**法向量恒为单位向量**——几何距离/投影要求单位法向这一点由类型保证，不是调用方纪律。调用方不得就地构造 `Plane`，必须经由 `planeNormalize`（通用构造入口）或 `planeFromPointNormal`。

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
}> & {
  readonly __brand: "Quat";
};

export type Plane = Readonly<{
  normal: Vec3;
  constant: number;
}> & {
  readonly __brand: "Plane";
};

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
- `Quat` 的 `w` 是实部，`x`、`y`、`z` 是虚部。`Quat` 带 brand，**值域恒为单位四元数**：只能由 `quatNormalize`、`quatFromAxisAngle`、`quatMultiply`、`quatConjugate`、`quatSlerp` 或 `QUAT_IDENTITY` 产出，调用方不得就地构造。brand 只用于 TypeScript 追踪，运行时仍是普通对象，不写入 `__brand` 字段。
- `Plane` 带 brand，**法向量恒为单位向量**：只能由 `planeNormalize` 或 `planeFromPointNormal` 产出，调用方不得就地构造。与 `Quat` 相同，brand 只用于 TypeScript 追踪，运行时不写入 `__brand` 字段。

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

export function quatNormalize(
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>,
): Quat;
export function quatMultiply(a: Quat, b: Quat): Quat;
export function quatConjugate(rotation: Quat): Quat;
export function quatFromAxisAngle(
  axis: Vec3,
  radians: number,
): Quat | null;
export function quatToMat4(rotation: Quat): Mat4;
export function quatRotateVec3(rotation: Quat, vector: Vec3): Vec3;
export function quatSlerp(a: Quat, b: Quat, t: number): Quat;
export function quatEquals(a: Quat, b: Quat, epsilon?: number): boolean;

export function planeNormalize(
  plane: Readonly<{ normal: Vec3; constant: number }>,
): Plane | null;
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

- `quatNormalize(rotation)` 是 `Quat` 的通用构造入口：接受任意 `{ x, y, z, w }` 形状并返回单位四元数，是总函数，不返回 `null` 或 `Result`。零输入返回 `QUAT_IDENTITY`（判据 2）；非零输入返回除以自身长度的结果。**反序列化/导入边界必须先对 `unknown` 数据完成自己的校验**（有限性、零长度），不得依赖本函数把损坏数据静默“修”成单位四元数。
- `quatMultiply` 使用 Hamilton 乘法；两个单位四元数相乘的结果仍表示复合旋转。
- `quatConjugate` 返回 `{ x: -x, y: -y, z: -z, w }`。
- `quatFromAxisAngle(axis, radians)`：`axis` 为零向量时返回 `null`（方向无定义，判据 1）；否则先归一化轴再构造单位四元数，因此返回值**总是**单位四元数（判据 3）。不接受非有限输入。
- `quatToMat4(rotation)` 要求 `rotation` 是单位四元数，返回与其旋转一致的列主序矩阵。
- `quatRotateVec3(rotation, vector)` 要求 `rotation` 是单位四元数，返回旋转后的向量，不修改输入。
- `quatSlerp(a, b, t)` 沿最短弧插值并归一化结果；不额外限制 `t` 到 `[0, 1]`。当输入近平行（`1 - dot <= EPSILON`，`dot` 已在最短弧选边后取正值）时走 nlerp 再归一化，避免除以接近 `0` 的 `sin(theta)`；该阈值是契约的一部分，不得静默改动。该阈值由差分用例两侧夹住：`1 - dot = 5e-7` 时本模块与 `three` 都走 nlerp（`three` 的判据是 `dot < 0.9995`），`1 - dot = 2e-6` 时本模块走 slerp 而 `three` 走 nlerp。
- `quatEquals` 按分量执行 `approximatelyEqual`，不把 `q` 与 `-q` 视为相等。

## 平面函数语义

- `planeNormalize(plane)` 是 `Plane` 的通用构造入口：接受任意 `{ normal, constant }` 形状，返回法向量归一化后的平面，并把 `constant` 除以同一长度；法向量为零时返回 `null`（判据 1）。
- `planeFromPointNormal(point, normal)` 先归一化 `normal`，再令 `constant = -dot(normal, point)`；零法向量返回 `null`。
- `planeDistanceToPoint`、`planeProjectPoint` 和 `planeIntersectRay` 的 `plane` 参数已经是 `Plane`，**单位法向量由 brand 在编译期保证**；不再存在“传入未归一化平面属于调用方契约错误”这条运行时说法——那样的调用现在编译不过。
- `planeDistanceToPoint` 返回有符号距离 `dot(normal, point) + constant`。
- `planeProjectPoint` 返回点到平面的正交投影 `point - distance * normal`。
- `planeIntersectRay` 返回射线参数 `t`：`t = 0` 的命中有效（起点位于平面上，且方向与平面不平行）；`t < 0` 时返回 `null`。方向与平面法向量正交（分母为 `0`）时一律返回 `null`，**包括射线整体位于平面上的情况**——此时 `t` 无定义，不属于“`t = 0` 命中”。传入 `tMax` 时只接受 `t <= tMax`，且 `tMax` 必须是非负有限值。
  - 【用户确认】共面射线返回 `null`（而不是 `t = 0`、也不是交给调用方兜底）由用户于 2026-09-10 显式裁定。**本条不是 AI 推定、也不是从其他条款推演出来的结论**；`t = 0 命中有效` 与 `射线平行返回 null` 两条在共面情形下本来就同时成立、互相冲突，是用户在其中做的取舍。修改本条必须先取得用户同意，不得当作“可以重新判定的一般契约条款”处理。

## AABB 与射线语义

- `aabbFromPoints([])` 返回 `EMPTY_AABB`；非空输入返回包含所有点的最小闭 AABB。
- `aabbUnion(EMPTY_AABB, b)` 返回 `b`，`aabbUnion(a, EMPTY_AABB)` 返回 `a`；两者都为空时返回 `EMPTY_AABB`。
- `aabbExpand(EMPTY_AABB, point)` 返回只包含该点的 AABB；非空 AABB 则按分量扩展 `min` 和 `max`。不使用 `Infinity` 作为哨兵。
- `aabbContainsPoint` 对 `min` 和 `max` 使用闭区间；可选 `epsilon` 同时放宽两端边界。
- `aabbIntersects` 使用闭区间相交判断；可选 `epsilon` 允许各轴区间之间存在不超过容差的间隙。
- `aabbCenter` 和 `aabbSize` 对空 AABB 返回 `null`。
- 非空 `aabbSize` 返回几何尺寸 `max - min`，各分量可以为 `0`；它不是体素个数。需要体素计数（闭区间覆盖数 `max - min + 1`）的调用方在 domain 层自行计算，不得依赖 `aabbSize`。
  - 【用户确认】`aabbSize` 保持几何尺寸语义（非空返回 `max - min`，各分量可以为 `0`），体素计数 `max - min + 1` 由 domain 层自行计算。用户于 2026-09-10 在“改契约 / 改实现”之间选择改契约；本条目不是 AI 推定，修改前必须取得用户同意。
- `ray.direction` 必须是非零有限向量，但不要求归一化；返回的 `t` 是射线参数，只有方向为单位向量时才等于世界距离。
- `rayIntersectAabb` 与 `THREE.Ray.intersectBox` 的边界语义一致：起点在 AABB 外时返回进入参数，起点在 AABB 内时返回离开参数；只接触边界和 `t === tMax` 都算命中。
- 省略 `tMax` 表示不设上限；显式传入时必须是有限非负值。未命中、`t < 0` 或 `t > tMax` 时返回 `null`。

## 输入有效性与退化情形

- 所有数值输入必须是有限数；`NaN`、`Infinity` 和 `-Infinity` 属于调用方契约错误，调用方必须在基础设施或领域边界先完成校验。
- `math.ts` 不使用 `Result` 表达数学退化，也不为非法输入提供恢复语义；退化结果使用零向量、单位四元数、`null` 或显式空 AABB。
- **退化输入的取舍判据**（上一条四种做法的选择依据，新增判别场景时按此推演，不要凭惯例照抄）：
  1. **结果无定义时返回 `null`**：矩阵不可逆、法向量/轴为零、射线与平面无唯一交点、空 AABB 的中心与尺寸。此时任何具体值都是任意挑选，会伪装成有效结果向下游传播。
  2. **存在唯一中性结果时返回中性值**：`vec3Normalize(zero) = VEC3_ZERO`、`quatNormalize(zero) = QUAT_IDENTITY`、`aabbFromPoints([]) = EMPTY_AABB`。这些是中性的，不会让调用方误以为是别的含义。
  3. **绝不返回违反本契约后置条件的值**：例如构造旋转的函数不得返回非单位四元数，构造归一化平面的函数不得返回非单位法向量。构造器对**每一个接受的输入**都必须保住后置条件。
  4. 非有限输入不属于退化，属于调用方契约错误（见上一条），本模块不为其定义行为。
- `vec3Normalize`、`quatNormalize`、`planeNormalize`、`planeFromPointNormal` 必须对**每一个有限非零输入**都保住后置条件（判据 3）：实现先按最大绝对分量缩放再做 `sqrt` 与除法，因此分量在 `1e200` 或 `1e-200` 量级时不会出现 `Infinity` / `0` 中间值，零向量判据也使用分量比较而不是长度。`vec3Length` 仍按 `sqrt(Σx²)` 直接计算，极端量级下溢出为 `Infinity` 或下溢为 `0` 属于它的数值范围，本模块内部不使用它做零向量判据。
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
- **three 是一致性参照物，不是正确性参照物。** three 自身有若干处对本项目而言是错误的默认（舍入的 sRGB 系数、归一化的 `transformDirection`、奇异矩阵返回全零、宽松的 CSS 解析），照抄会引入缺陷。下列差异是逐条判定后有意保留的，每项给出判据；差分用例必须同时钉住两侧，不得为了“与对端一致”而改动其中一侧，也不得因为“契约这么写了”而跳过重新判定：
  - `mat4Invert` 对不可逆矩阵返回 `null`（判据 1）。`Matrix4.invert` 返回全零矩阵——那是“看起来像矩阵”的值，会把几何静默压到原点；`null` 把处置权交回调用点。节点 `scale` 为 0 时拾取必须能跳过该节点，而不是得到错误命中。
  - `mat4TransformDirection` 只应用 3x3 线性部分且**不归一化**。`THREE.Vector3.transformDirection` 会归一化，丢掉的模长不可恢复；需要单位向量时由调用方自行 `vec3Normalize`。对齐用 `Matrix3.setFromMatrix4` + `applyMatrix3` 作 oracle。
  - `quatFromAxisAngle`、`planeFromPointNormal`、`planeNormalize` 自行归一化轴/法向量，并在零向量时返回 `null`（判据 1、3）。`Quaternion.setFromAxisAngle` 与 `Plane.setFromNormalAndCoplanarPoint` 要求调用方传入单位向量：传入非单位向量时结果不同，传入零向量时它们产出非单位四元数/非单位法向量——正是本契约禁止返回值出现的形态。
  - `aabbCenter`/`aabbSize` 对空 AABB 返回 `null`（判据 1），`Box3.getCenter`/`getSize` 返回零向量。空 AABB 在本模块是显式状态（`isEmpty`），零向量会被下游当作真实坐标使用。
  - `planeIntersectRay` 对位于平面上的射线返回 `null`（判据 1），`Ray.intersectPlane` 返回起点。此时 `t` 不唯一，返回 `t = 0` 等于把命中点放在射线起点上，对拖拽类交互是“看着合理的错答案”。
  - `quatSlerp` 的退化阈值是 `1 - dot <= EPSILON`，`Quaternion.slerp` 是 `dot < 0.9995`。阈值越紧，走精确 slerp 的情形越多、结果越准确（`sin ≈ 1.4e-3` 时双精度仍保有约 `1e-13` 相对误差）；three 放宽阈值是为 float32/GPU 稳健性。`dot` 落在 `(0.9995, 1 - EPSILON)` 区间时双方参数化不同（nlerp 对 slerp）：`t = 0.25` / `0.75` 的绝对偏差在区间内随 `dot` 增大单调衰减，`dot = 0.9995` 端约 `4.9e-7`（不超过 `6e-7`），`dot = 1 - 2e-6` 端约 `1.25e-10`，再靠近 `1` 时衰减到 `4.4e-11` 量级；`t` 外推到 `±1.25` 时不超过 `3e-6`（`dot = 0.9995` 端约 `2.5e-6`）。端点（`t = 0`、`t = 1`）与轨迹一致。
  - `vec3Equals`/`mat4Equals`/`quatEquals` 默认用 `EPSILON` 近似比较，`Vector3.equals`/`Matrix4.equals`/`Quaternion.equals` 是精确比较。渲染浮点经矩阵复合后几乎不可能精确相等，精确比较会让“变换是否变化”恒为真；需要精确比较的算法显式传 `epsilon = 0`。**使用约束：近似比较不是等价关系（不满足传递性），不得用于去重、`Set`/`Map` 键或排序去重。**
- Three.js 类型转换只发生在基础设施/渲染适配层。
- `three`（配合 `@types/three`）已安装为测试期 `devDependency`。`test/util/math.test.ts` 的 Three.js 对齐用例必须以 `Matrix4`、`Quaternion`、`Vector3`、`Plane`、`Ray`、`Box3` 作为独立 oracle，对 `vec3*`、`mat4Multiply`、`mat4Compose`、`mat4Invert`、`mat4TransformPoint`、`mat4TransformDirection`、`mat4Equals`、`quatFromAxisAngle`、`quatNormalize`、`quatMultiply`、`quatConjugate`、`quatToMat4`、`quatRotateVec3`、`quatSlerp`、`quatEquals`、`planeFromPointNormal`、`planeNormalize`、`planeDistanceToPoint`、`planeProjectPoint`、`planeIntersectRay`、`rayIntersectAabb`、`aabbFromPoints`、`aabbUnion`、`aabbExpand`、`aabbContainsPoint`、`aabbIntersects`、`aabbCenter`、`aabbSize` 做差分断言。这些用例是本契约“与 Three.js 一致”这条要求的可执行证据，不得因为实现改动而放宽或删除。
- 生产代码不得导入 Three.js。

**依赖**：none。
