#!/usr/bin/env python3
"""WP-2.0 tracer: generate a trivial sample mesh (a box) with trimesh and
export it as STL, standing in for a real product mesh. Only exercises
mesh-library executability, not the real normalize_mesh.py pipeline."""
import trimesh

mesh = trimesh.creation.box(extents=[40.0, 30.0, 20.0])
mesh.export('/work/sample.stl')
print('wrote /work/sample.stl, extents=', mesh.extents.tolist())
