# Zouwu Forge — шар направления света для IC-LoRA Relight.
# Точная копия сцены из узла Sphere-Light-Render (eric-venti-seeds), которым официальный
# граф Lightricks рисует шар: three.js r128, камера (0,6,8) → (0,-0.5,0), FOV 35°,
# шар r=1 (0xcccccc, roughness 0.8) на плоскости y=-1 (0x8a8a8a), ambient 0.2,
# направленный свет 1.5 с мягкой тенью, вывод в sRGB. Рендер — numpy-трассировка лучей.
# Использование: relight_ball.py <out.png> <азимут°> <высота°> [размер=512] [интенсивность=1.5]
#   азимут: 0 — со стороны камеры (спереди), 90 — справа, 180 — сзади (контровой), -90/270 — слева.
import sys, math
import numpy as np
from PIL import Image, ImageFilter


def _norm(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


def render(az_deg, el_deg, size=512, intensity=1.5, ss=2):
    az, el = math.radians(az_deg), math.radians(el_deg)
    L = np.array([math.cos(el) * math.sin(az), math.sin(el), math.cos(el) * math.cos(az)])
    L = L / np.linalg.norm(L)

    # камера three.js: PerspectiveCamera(35, 1), position (0,6,8), lookAt (0,-0.5,0)
    C = np.array([0.0, 6.0, 8.0]); T = np.array([0.0, -0.5, 0.0])
    f = T - C; f /= np.linalg.norm(f)
    r = np.cross(f, [0.0, 1.0, 0.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    N = size * ss
    th = math.tan(math.radians(35) / 2)
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float64)
    px = ((xs + 0.5) / N * 2 - 1) * th
    py = (1 - (ys + 0.5) / N * 2) * th
    D = _norm(f[None, None, :] + px[..., None] * r + py[..., None] * u)

    # пересечения: шар (центр 0, r=1) и плоскость y=-1
    b = np.einsum('ijk,k->ij', D, C)
    c = C @ C - 1.0
    disc = b * b - c
    ts = np.where(disc > 0, -b - np.sqrt(np.clip(disc, 0, None)), np.inf)
    ts = np.where(ts > 0, ts, np.inf)
    tp = np.where(D[..., 1] < -1e-6, (-1.0 - C[1]) / D[..., 1], np.inf)
    hit_s = ts < tp
    t = np.where(hit_s, ts, tp)
    P = C + D * t[..., None]
    Nn = np.where(hit_s[..., None], _norm(P), np.array([0.0, 1.0, 0.0]))
    albedo = np.where(hit_s, 0xCC / 255.0, 0x8A / 255.0)

    # тень на плоскости от шара: луч из точки к свету пересекает шар?
    b2 = np.einsum('ijk,k->ij', P, L)
    c2 = np.einsum('ijk,ijk->ij', P, P) - 1.0
    d2 = b2 * b2 - c2
    occl = (~hit_s) & (d2 > 0) & ((-b2 + np.sqrt(np.clip(d2, 0, None))) > 0)
    vis = 1.0 - occl.astype(np.float64)
    # PCFSoftShadowMap: мягкий край
    vimg = Image.fromarray((vis * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(N / 512 * 1.6))
    vis = np.where(hit_s, 1.0, np.asarray(vimg).astype(np.float64) / 255.0)

    # MeshStandardMaterial (r128, legacy lights): diffuse = albedo * I * NdotL; ambient = albedo * 0.2;
    # specular GGX (roughness 0.8, F0 0.04) * PI * I * NdotL
    NL = np.clip(np.einsum('ijk,k->ij', Nn, L), 0, None)
    V = -D
    NV = np.clip(np.einsum('ijk,ijk->ij', Nn, V), 1e-4, None)
    H = _norm(V + L)
    NH = np.clip(np.einsum('ijk,ijk->ij', Nn, H), 0, None)
    VH = np.clip(np.einsum('ijk,ijk->ij', V, H), 0, None)
    a = 0.8 ** 2; a2 = a * a
    Dg = a2 / (math.pi * (NH * NH * (a2 - 1) + 1) ** 2)
    gv = 0.5 / (NL * np.sqrt(a2 + (1 - a2) * NV * NV) + NV * np.sqrt(a2 + (1 - a2) * NL * NL) + 1e-6)
    F = 0.04 + 0.96 * (1 - VH) ** 5
    spec = math.pi * intensity * NL * F * gv * Dg
    diffuse_col = albedo          # metalness 0 → diffuseColor без изменений
    lin = albedo * 0.2 + vis * (diffuse_col * intensity * NL + spec)

    # LinearTosRGB
    lin = np.clip(lin, 0, 1)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
    img = (np.clip(srgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    out = Image.fromarray(np.stack([img] * 3, axis=-1)).resize((size, size), Image.LANCZOS)
    return out


if __name__ == '__main__':
    out = sys.argv[1]
    az = float(sys.argv[2]) if len(sys.argv) > 2 else 90
    el = float(sys.argv[3]) if len(sys.argv) > 3 else 45
    size = int(sys.argv[4]) if len(sys.argv) > 4 else 512
    inten = float(sys.argv[5]) if len(sys.argv) > 5 else 1.5
    render(az, el, size, inten).save(out)
    print('RESULT', out)
