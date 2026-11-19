"""Generate the low-poly 3D models Argus shows up close.

Writes frontend/public/models/*.glb: simple flat-shaded shapes in one
white material, so the map can tint them. They are made here rather than
downloaded, so there's nothing to license.

Aircraft: airliner, widebody, bizjet, light, helicopter, fighter,
airlifter. Ships: container, tanker, passenger, fishing, warship, boat.
Space: iss (the International Space Station, flown truss-across and
modules along its velocity).
frontend/src/map/closeModels.ts picks one from the type or category.

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


def mirror(points: list[Vec]) -> list[Vec]:
    return [(-x, y, z) for x, y, z in reversed(points)]


def wings(points: list[Vec], thickness: float) -> list[list[Vec]]:
    """A left wing (negative x) and its mirror image."""
    return wedge(points, thickness) + wedge(mirror(points), thickness)


def airliner() -> list[list[Vec]]:
    """Narrowbody twin-jet (A320 / 737 class)."""
    faces = []
    faces += box(0, 0, 0, 4.2, 4.2, 30)  # cabin
    faces += box(0, 0, 18.5, 4.2, 4.2, 7, taper_front=0.25)  # nose
    faces += box(0, 0.4, -20, 4.2, 3.4, 10)  # rear body
    faces += box(0, 0.9, -27, 1.6, 1.6, 4)  # tail cone
    faces += wings(
        [(-2, -0.8, 4), (-19, -0.2, -6), (-19, -0.2, -9), (-2, -0.8, -5)], 0.6
    )
    faces += wings(
        [(-1, 1.2, -22), (-7, 1.4, -26.5), (-7, 1.4, -28.5), (-1, 1.2, -27)],
        0.4,
    )
    faces += fin([(0, 2, -21), (0, 9, -26.5), (0, 9, -28.5), (0, 2, -28)], 0.5)
    for side in (-1, 1):  # engines under the wings
        faces += box(side * 7, -2.2, 0.5, 2.2, 2.2, 5)
    return faces


def widebody() -> list[list[Vec]]:
    """Four-engine widebody (747 / A340 class); also tankers, AWACS."""
    faces = []
    faces += box(0, 0, 0, 6.4, 6.4, 46)
    faces += box(0, 0.6, 27, 6.4, 7.6, 8, taper_front=0.3)  # nose, hump
    faces += box(0, 0.6, -29, 6.4, 5, 12)
    faces += box(0, 1.4, -38, 2.2, 2.2, 6)
    faces += wings(
        [(-3, -1.4, 8), (-32, -0.4, -10), (-32, -0.4, -14), (-3, -1.4, -8)],
        0.9,
    )
    faces += wings(
        [(-1.5, 2, -31), (-11, 2.2, -37), (-11, 2.2, -40), (-1.5, 2, -38)],
        0.5,
    )
    faces += fin([(0, 3, -29), (0, 14, -37), (0, 14, -40), (0, 3, -39)], 0.7)
    for x in (-10, -18, 10, 18):
        faces += box(x, -3, 1 - abs(x) * 0.35, 2.8, 2.8, 6.5)
    return faces


def bizjet() -> list[list[Vec]]:
    """Business jet: slim body, rear engines, T-tail."""
    faces = []
    faces += box(0, 0, 0, 2.2, 2.2, 12)
    faces += box(0, 0, 8.5, 2.2, 2.2, 5, taper_front=0.2)
    faces += box(0, 0.3, -8, 2.2, 1.8, 4)
    faces += wings(
        [(-1, -0.6, 1), (-8, -0.3, -2.5), (-8, -0.3, -4), (-1, -0.6, -3)], 0.3
    )
    faces += fin([(0, 1, -7), (0, 5, -10), (0, 5, -11.5), (0, 1, -10)], 0.3)
    faces += wedge(
        [(-3.2, 5, -9.6), (3.2, 5, -9.6), (3.2, 5, -11), (-3.2, 5, -11)], 0.2
    )
    for side in (-1, 1):
        faces += box(side * 1.9, 0.6, -6.5, 1.1, 1.1, 3)
    return faces


def light() -> list[list[Vec]]:
    """Single-engine high-wing light aircraft (Cessna class)."""
    faces = []
    faces += box(0, 0, 0, 1.3, 1.5, 4.2)
    faces += box(0, -0.1, 2.8, 1.2, 1.2, 1.4, taper_front=0.6)  # engine
    faces += box(0, 0.1, -3.5, 0.6, 0.8, 3, taper_front=1.0)  # tail boom
    faces += box(0, -0.1, 3.6, 0.2, 1.9, 0.1)  # propeller
    faces += wedge(
        [
            (-5.5, 0.95, 0.9),
            (5.5, 0.95, 0.9),
            (5.5, 0.95, -0.6),
            (-5.5, 0.95, -0.6),
        ],
        0.15,
    )
    faces += wedge(
        [(-1.7, 0.3, -4.4), (1.7, 0.3, -4.4), (1.7, 0.3, -5), (-1.7, 0.3, -5)],
        0.1,
    )
    faces += fin(
        [(0, 0.4, -4.2), (0, 1.8, -4.8), (0, 1.8, -5.2), (0, 0.4, -5)], 0.1
    )
    return faces


def helicopter() -> list[list[Vec]]:
    faces = []
    faces += box(0, 0, 0.5, 2.2, 2.2, 5, taper_front=0.7)  # cabin
    faces += box(0, 0.4, -5, 0.5, 0.6, 7)  # tail boom
    faces += fin(
        [(0, 0.4, -7.8), (0, 2.2, -8.6), (0, 2.2, -9), (0, 0.4, -8.6)], 0.15
    )
    faces += box(0, 1.5, 0.5, 0.6, 0.8, 0.6)  # rotor mast
    for angle in (0, 90):  # main rotor blades
        a = math.radians(angle)
        dx, dz = math.sin(a) * 5.5, math.cos(a) * 5.5
        px, pz = math.cos(a) * 0.25, -math.sin(a) * 0.25
        faces += wedge(
            [
                (-dx - px, 2.0, -dz - pz),
                (dx - px, 2.0, dz - pz),
                (dx + px, 2.0, dz + pz),
                (-dx + px, 2.0, -dz + pz),
            ],
            0.08,
        )
    for side in (-1, 1):  # skids
        faces += box(side * 1.1, -1.5, 0.5, 0.15, 0.15, 4.5)
    return faces


def fighter() -> list[list[Vec]]:
    """Fast jet: pointed nose, swept delta, twin fins."""
    faces = []
    faces += box(0, 0, 0, 2.2, 1.8, 11)
    faces += box(0, 0, 8, 2.2, 1.8, 5, taper_front=0.1)
    faces += box(0, 0.6, 3.5, 0.9, 0.7, 3, taper_front=0.5)  # canopy
    faces += box(0, -0.1, -7, 2.6, 1.4, 3)  # engines
    faces += wings(
        [(-1, -0.2, 3), (-5.5, -0.1, -3.5), (-5.5, -0.1, -5), (-1, -0.2, -5)],
        0.25,
    )
    faces += wings(
        [(-1, 0, -6.2), (-3.2, 0, -7.6), (-3.2, 0, -8.6), (-1, 0, -8.4)], 0.15
    )
    for side in (-1, 1):
        faces += [
            [(x + side * 1.1, y, z) for x, y, z in quad]
            for quad in fin(
                [(0, 0.6, -5), (0, 3.2, -7.5), (0, 3.2, -8.3), (0, 0.6, -8)],
                0.15,
            )
        ]
    return faces


def airlifter() -> list[list[Vec]]:
    """Military transport: high wing, T-tail, four engines (C-17 class)."""
    faces = []
    faces += box(0, 0, 0, 6.8, 6.8, 36)
    faces += box(0, -0.4, 21, 6.8, 6, 6, taper_front=0.35)
    faces += box(0, 1, -23, 6.8, 4.6, 10, taper_front=1.0)
    faces += wings(
        [(-3, 3.6, 5), (-25, 2.6, -2), (-25, 2.6, -5.5), (-3, 3.6, -3)], 0.9
    )
    faces += fin(
        [(0, 3.4, -22), (0, 13, -27), (0, 13, -30), (0, 3.4, -28)], 0.7
    )
    faces += wedge(
        [(-9, 13, -27.5), (9, 13, -27.5), (9, 13, -30.5), (-9, 13, -30.5)],
        0.4,
    )
    for x in (-8, -15, 8, 15):
        faces += box(x, 1.4, 4 - abs(x) * 0.2, 2.4, 2.4, 5)
    return faces


def container() -> list[list[Vec]]:
    faces = []
    faces += box(0, 0, -10, 32, 14, 230)  # hull
    faces += box(0, 0, 112, 32, 14, 14, taper_front=0.15)  # bow
    faces += box(0, 13, -90, 30, 12, 18)  # bridge block (aft)
    faces += box(0, 22, -92, 14, 6, 10)  # wheelhouse
    faces += box(0, 26, -100, 4, 10, 4)  # funnel
    for i in range(6):  # container stacks
        faces += box(0, 10, -60 + i * 28, 28, 6 + (i % 3) * 2, 24)
    return faces


def tanker() -> list[list[Vec]]:
    """Crude or product tanker: low flat deck, pipe run, bridge aft."""
    faces = []
    faces += box(0, 0, -5, 44, 18, 220)
    faces += box(0, 0, 112, 44, 18, 14, taper_front=0.2)
    faces += box(0, 11, 20, 3, 2, 160)  # pipe run along the deck
    for i in range(5):  # manifolds
        faces += box(0, 11, -40 + i * 30, 30, 1.2, 2)
    faces += box(0, 18, -98, 34, 18, 16)
    faces += box(0, 30, -100, 18, 6, 10)
    faces += box(0, 32, -108, 5, 12, 5)
    return faces


def passenger() -> list[list[Vec]]:
    """Cruise ship or ferry: tall stepped superstructure."""
    faces = []
    faces += box(0, 0, -5, 32, 14, 230)
    faces += box(0, 0, 113, 32, 14, 16, taper_front=0.2)
    for i, (w, ln, z) in enumerate(
        (
            (30, 200, -12),
            (28, 180, -18),
            (26, 160, -22),
            (22, 130, -26),
            (18, 90, -30),
        )
    ):
        faces += box(0, 11 + i * 6, z, w, 6, ln)
    faces += box(0, 44, -60, 8, 10, 14)  # funnel
    return faces


def fishing() -> list[list[Vec]]:
    """Trawler: bridge forward, open aft deck, gantry and mast."""
    faces = []
    faces += box(0, 0, -2, 8, 4.5, 28)
    faces += box(0, 0, 14, 8, 4.5, 6, taper_front=0.2)
    faces += box(0, 4.5, 7, 6.5, 4.5, 7)  # bridge
    faces += box(0, 9, 8, 0.4, 7, 0.4)  # mast
    faces += box(0, 6, -13, 7.5, 0.5, 0.6)  # gantry top
    for side in (-1, 1):
        faces += box(side * 3.5, 4, -13, 0.4, 4, 0.4)
    return faces


def warship() -> list[list[Vec]]:
    """Destroyer or frigate: sleek hull, angular superstructure, gun."""
    faces = []
    faces += box(0, 0, -5, 18, 9, 130)
    faces += box(0, 0, 68, 18, 9, 16, taper_front=0.05)
    faces += box(0, 8, 8, 14, 8, 30, taper_front=0.8)  # forward block
    faces += box(0, 15, 10, 8, 8, 10, taper_front=0.6)  # mast base
    faces += box(0, 23, 10, 1, 10, 1)  # mast
    faces += box(0, 7, -25, 12, 6, 28, taper_front=0.85)  # aft block
    faces += box(0, 13, -22, 5, 6, 6)  # funnel
    faces += box(0, 6, 44, 4, 2.5, 4)  # gun mount
    faces += box(0, 6.5, 49, 0.5, 0.5, 6)  # gun barrel
    faces += box(0, 6, -55, 14, 1, 16)  # flight deck
    return faces


def boat() -> list[list[Vec]]:
    """Tug, workboat or pleasure craft."""
    faces = []
    faces += box(0, 0, -1, 7, 3, 20)
    faces += box(0, 0, 11, 7, 3, 5, taper_front=0.2)
    faces += box(0, 3.5, 3, 5, 3.5, 7)
    faces += box(0, 7, 2, 0.4, 4, 0.4)
    return faces


def iss() -> list[list[Vec]]:
    """International Space Station, about 109 m across the solar arrays'
    truss and 73 m along the pressurised modules (+Z is the direction of
    flight, +Y away from Earth)."""
    faces = []
    # Integrated truss, across the direction of flight.
    faces += box(0, 0, 0, 98, 3, 4)
    # Pressurised modules along the flight path: US lab, nodes and the
    # Russian segment behind, with a cross-module either side.
    faces += box(0, 0, 4, 4.4, 4.4, 9)  # Destiny
    faces += box(0, 0, 11, 4.6, 4.6, 6)  # Harmony
    faces += box(0, 0, 16, 4.0, 4.0, 4)  # docking adapter
    faces += box(-6, 0, 11, 8, 4.4, 4.4)  # Columbus
    faces += box(6, 0, 11, 10, 4.4, 4.4)  # Kibo
    faces += box(0, 0, -4, 4.6, 4.6, 5)  # Unity
    faces += box(0, 0, -12, 4.2, 4.2, 12)  # Zarya
    faces += box(0, 0, -24, 4.2, 4.2, 13)  # Zvezda
    faces += box(0, 0, -32, 2.6, 2.6, 4)  # aft port
    # Zvezda's own small solar arrays.
    faces += box(-9, 0, -22, 14, 0.2, 3)
    faces += box(9, 0, -22, 14, 0.2, 3)
    # Eight main solar array wings, four on each end of the truss, each
    # about 35 m long and 12 m wide, in pairs either side of the truss.
    for side in (-1, 1):
        for x in (side * 37, side * 47):
            for z in (-20, 20):
                faces += box(x, 0, z, 11, 0.25, 34)
        # Mast boxes between the pairs.
        faces += box(side * 42, 0, 0, 3, 3, 6)
    # Radiators, hanging off the truss towards Earth.
    for x in (-15, 15):
        faces += box(x, -6, 0, 3, 12, 0.3)
    return faces


MODELS = {
    "airliner": airliner,
    "widebody": widebody,
    "bizjet": bizjet,
    "light": light,
    "helicopter": helicopter,
    "fighter": fighter,
    "airlifter": airlifter,
    "container": container,
    "tanker": tanker,
    "passenger": passenger,
    "fishing": fishing,
    "warship": warship,
    "boat": boat,
    "iss": iss,
}


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
    for name, build in MODELS.items():
        write_glb(os.path.join(OUT, name + ".glb"), build())
    # The first models, by their old names.
    for old in ("aircraft.glb", "ship.glb"):
        path = os.path.join(OUT, old)
        if os.path.exists(path):
            os.remove(path)
