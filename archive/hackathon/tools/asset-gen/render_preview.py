# Render a preview.png per GLB: 3 views (front / side / top) composited side-by-side.
# Dependency-free numpy software rasterizer (no GL) — adapted from old repo
# experiments/fidelity-test/render_and_check.py. Run via the venv:
#   .venv/bin/python render_preview.py <glb_path> <out_png> [label]
import sys, os
import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFont

W = H = 512
BG = np.array([245, 245, 245], np.float32)
BASE = np.array([210, 180, 130])  # warm neutral

VIEWS = {
    'front': (np.array([0, 0, 1.0]),      np.array([0, 1.0, 0])),
    'side':  (np.array([1.0, 0, 0]),      np.array([0, 1.0, 0])),
    'top':   (np.array([0, 1.0, 0.001]),  np.array([0, 0, -1.0])),
}

def load_concat(path):
    s = trimesh.load(path, force='scene')
    return s.dump(concatenate=True) if isinstance(s, trimesh.Scene) else s

def render(mesh, eye_dir, up, zoom=1.0):
    v = mesh.vertices.astype(np.float64)
    f = mesh.faces.astype(np.int64)
    c = (v.max(0) + v.min(0)) / 2
    v = v - c
    scale = (v.max(0) - v.min(0)).max()
    if scale == 0: scale = 1
    v = v / scale
    zc = eye_dir / np.linalg.norm(eye_dir)
    xc = np.cross(up, zc); nx = np.linalg.norm(xc); xc = xc / (nx if nx else 1)
    yc = np.cross(zc, xc)
    R = np.stack([xc, yc, zc], 0)
    vc = v @ R.T
    pad = 1.15 / zoom
    sx = ((vc[:, 0] / pad) * 0.5 + 0.5) * (W - 1)
    sy = (0.5 - (vc[:, 1] / pad) * 0.5) * (H - 1)
    depth = vc[:, 2]
    fz = depth[f].mean(1)
    order = np.argsort(fz)
    p0, p1, p2 = vc[f[:, 0]], vc[f[:, 1]], vc[f[:, 2]]
    n = np.cross(p1 - p0, p2 - p0)
    ln = np.linalg.norm(n, axis=1, keepdims=True); ln[ln == 0] = 1
    n = n / ln
    light = np.array([0.3, 0.5, 0.8]); light = light / np.linalg.norm(light)
    shade = np.clip(np.abs(n @ light), 0.2, 1.0)
    img = np.repeat(BG[None, None, :], H, 0).repeat(W, 1).copy()
    zbuf = np.full((H, W), -1e9, np.float64)
    X = sx[f]; Y = sy[f]
    for idx in order:
        x0, x1, x2 = X[idx]; y0, y1, y2 = Y[idx]
        minx = max(int(np.floor(min(x0, x1, x2))), 0); maxx = min(int(np.ceil(max(x0, x1, x2))), W - 1)
        miny = max(int(np.floor(min(y0, y1, y2))), 0); maxy = min(int(np.ceil(max(y0, y1, y2))), H - 1)
        if minx > maxx or miny > maxy: continue
        xs, ys = np.meshgrid(np.arange(minx, maxx + 1), np.arange(miny, maxy + 1))
        d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(d) < 1e-9: continue
        a = ((y1 - y2) * (xs - x2) + (x2 - x1) * (ys - y2)) / d
        b = ((y2 - y0) * (xs - x2) + (x0 - x2) * (ys - y2)) / d
        g = 1 - a - b
        inside = (a >= 0) & (b >= 0) & (g >= 0)
        if not inside.any(): continue
        fd = fz[idx]
        yy = ys[inside]; xx = xs[inside]
        closer = fd > zbuf[yy, xx]
        yy = yy[closer]; xx = xx[closer]
        if len(xx) == 0: continue
        zbuf[yy, xx] = fd
        img[yy, xx] = np.clip(BASE * shade[idx], 0, 255)
    return Image.fromarray(img.astype(np.uint8))

def band(img, text):
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 18)
    except Exception:
        font = ImageFont.load_default()
    d.rectangle([0, 0, W, 26], fill=(30, 30, 30))
    d.text((8, 4), text, fill=(255, 255, 255), font=font)
    return img

def main():
    glb, out = sys.argv[1], sys.argv[2]
    label = sys.argv[3] if len(sys.argv) > 3 else os.path.basename(os.path.dirname(glb))
    mesh = load_concat(glb)
    # decimate very heavy meshes for a fast preview (topology preserved enough for a look)
    if len(mesh.faces) > 120000:
        try:
            import fast_simplification
            vv, ff = fast_simplification.simplify(mesh.vertices.astype('float32'), mesh.faces.astype('int64'), target_count=80000)
            mesh = trimesh.Trimesh(vertices=vv, faces=ff, process=False)
        except Exception:
            pass
    tiles = []
    for name, (eye, up) in VIEWS.items():
        im = band(render(mesh, eye, up).copy(), f'{label} · {name}')
        tiles.append(im)
    combo = Image.new('RGB', (W * 3, H), (245, 245, 245))
    for i, t in enumerate(tiles):
        combo.paste(t, (i * W, 0))
    combo.save(out)
    print(f'preview saved {out} ({len(mesh.faces)} faces)')

if __name__ == '__main__':
    main()
