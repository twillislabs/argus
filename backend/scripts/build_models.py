"""Generate the low-poly 3D models Argus shows up close.

Writes frontend/public/models/aircraft.glb and ship.glb: simple
flat-shaded shapes in one white material, so the map can tint them. They
are made here rather than downloaded, so there's nothing to license.

    python scripts/build_models.py

Axes (glTF): +Z forward (nose or bow), +Y up, +X to the right side.
Units: metres, at roughly airliner and container-ship size.
"""

import json
import math
import os
import struct

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "frontend", "public", "models")

Vec = tuple[float, float, float]


def box(cx, cy, cz, sx, sy, sz, taper_front=1.0) -> list[list[Vec]]:
    """Six quads of a box centred at (cx, cy, cz); the front (+Z) face
    can be shrunk by taper_front."""
    x, y, z = sx / 2, sy / 2, sz / 2
    tf = taper_front
    back = [(-x, -y, -z), (x, -y, -z), (x, y, -z), (-x, y, -z)]
    front = [
        (-x * tf, -y * tf, z),
        (x * tf, -y * tf, z),
        (x * tf, y * tf, z),
        (-x * tf, y * tf, z),
    ]
    b = [(cx + px, cy + py, cz + pz) for px, py, pz in back]
    f = [(cx + px, cy + py, cz + pz) for px, py, pz in front]
    return [
        [b[0], b[3], b[2], b[1]],  # back
        [f[0], f[1], f[2], f[3]],  # front
        [b[0], b[1], f[1], f[0]],  # bottom
        [b[3], f[3], f[2], b[2]],  # top
        [b[0], f[0], f[3], b[3]],  # left
        [b[1], b[2], f[2], f[1]],  # right
    ]


def wedge(points: list[Vec], thickness: float) -> list[list[Vec]]:
    """A flat polygon (in a horizontal plane) extruded to a slab."""
    top = [(x, y + thickness / 2, z) for x, y, z in points]
    bottom = [(x, y - thickness / 2, z) for x, y, z in points]
    faces = [top, list(reversed(bottom))]
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        faces.append([bottom[i], bottom[j], top[j], top[i]])
    return faces


def fin(points: list[Vec], thickness: float) -> list[list[Vec]]:
    """A flat polygon in a vertical plane (x = 0) extruded sideways."""
    right = [(thickness / 2, y, z) for _, y, z in points]
    left = [(-thickness / 2, y, z) for _, y, z in points]
    faces = [right, list(reversed(left))]
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        faces.append([left[i], left[j], right[j], right[i]])
    return faces


def aircraft() -> list[list[Vec]]:
    faces = []
    faces += box(0, 0, 0, 4.2, 4.2, 30)  # cabin
    faces += box(0, 0, 18.5, 4.2, 4.2, 7, taper_front=0.25)  # nose
    faces += box(0, 0.4, -20, 4.2, 3.4, 10, taper_front=1.0)  # rear body
    faces += box(0, 0.9, -27, 1.6, 1.6, 4)  # tail cone
    wing = [(-2, -0.8, 4), (-19, -0.2, -6), (-19, -0.2, -9), (-2, -0.8, -5)]
    faces += wedge(wing, 0.6)
    faces += wedge([(-x, y, z) for x, y, z in reversed(wing)], 0.6)
    stab = [(-1, 1.2, -22), (-7, 1.4, -26.5), (-7, 1.4, -28.5), (-1, 1.2, -27)]
    faces += wedge(stab, 0.4)
    faces += wedge([(-x, y, z) for x, y, z in reversed(stab)], 0.4)
    faces += fin([(0, 2, -21), (0, 9, -26.5), (0, 9, -28.5), (0, 2, -28)], 0.5)
    for side in (-1, 1):  # engines under the wings
        faces += box(side * 7, -2.2, 0.5, 2.2, 2.2, 5)
    return faces


def ship() -> list[list[Vec]]:
    faces = []
    faces += box(0, 0, -10, 32, 14, 230)  # hull
    faces += box(0, 0, 112, 32, 14, 14, taper_front=0.15)  # bow
    faces += box(0, 13, -90, 30, 12, 18)  # bridge block (aft)
    faces += box(0, 22, -92, 14, 6, 10)  # wheelhouse
    faces += box(0, 26, -100, 4, 10, 4)  # funnel
    for i in range(6):  # container stacks
        faces += box(0, 10, -60 + i * 28, 28, 6 + (i % 3) * 2, 24)
    return faces


def triangles(faces: list[list[Vec]]):
    positions, normals = [], []
    for quad in faces:
        a, b, c = quad[0], quad[1], quad[2]
        u = [b[i] - a[i] for i in range(3)]
        v = [c[i] - a[i] for i in range(3)]
        n = [
            u[1] * v[2] - u[2] * v[1],
            u[2] * v[0] - u[0] * v[2],
            u[0] * v[1] - u[1] * v[0],
        ]
        length = math.sqrt(sum(x * x for x in n)) or 1
        n = [x / length for x in n]
        for i in range(1, len(quad) - 1):
            for p in (quad[0], quad[i], quad[i + 1]):
                positions.append(p)
                normals.append(n)
    return positions, normals


def write_glb(path: str, faces: list[list[Vec]]) -> None:
    positions, normals = triangles(faces)
    pos = b"".join(struct.pack("<3f", *p) for p in positions)
    nor = b"".join(struct.pack("<3f", *n) for n in normals)
    blob = pos + nor
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]
    gltf = {
        "asset": {"version": "2.0", "generator": "argus build_models.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [
            {
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1},
                        "material": 0,
                    }
                ]
            }
        ],
        "materials": [
            {
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1, 1, 1, 1],
                    "metallicFactor": 0.1,
                    "roughnessFactor": 0.7,
                },
                "doubleSided": True,
            }
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": [
            {
                "buffer": 0,
                "byteOffset": 0,
                "byteLength": len(pos),
                "target": 34962,
            },
            {
                "buffer": 0,
                "byteOffset": len(pos),
                "byteLength": len(nor),
                "target": 34962,
            },
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(positions),
                "type": "VEC3",
                "min": mins,
                "max": maxs,
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(normals),
                "type": "VEC3",
            },
        ],
    }
    text = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    text += b" " * ((4 - len(text) % 4) % 4)
    blob += b"\0" * ((4 - len(blob) % 4) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(text), b"JSON"))
        f.write(text)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0"))
        f.write(blob)
    print("wrote {0} ({1} triangles)".format(path, len(positions) // 3))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    write_glb(os.path.join(OUT, "aircraft.glb"), aircraft())
    write_glb(os.path.join(OUT, "ship.glb"), ship())
