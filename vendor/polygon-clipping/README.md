# polygon-clipping (vendored)

`polygon-clipping.esm.js` is the ESM build of [polygon-clipping](https://github.com/mfogel/polygon-clipping)
0.15.7, with its two imports rewritten to the copies beside it (`splaytree.js` from
[splaytree](https://github.com/w8r/splaytree) 3.2.3, `orient2d.js` + `util.js` from
[robust-predicates](https://github.com/mourner/robust-predicates) 3.0.3). Licences are kept
alongside as `LICENSE.*`. No other change was made to the sources.

It is here for exactly one job: subtracting the pits from a material plate, where the result
has to be exact. A pit can straddle a plate's edge (the cut is a notch in the outline) or slice
clean across a thin strip of it (the result is two plates), and neither of those is a path that
can be handed to a triangulator as a hole. See `regionGeometry` in `src/engine/materials.js`,
and the Rendering section of `docs/DESIGN.md` for what it replaced and why.

Updating: `npm pack polygon-clipping@<version>` into a scratch directory, copy the same four
files, redo the two import rewrites above, and re-run the node suite (`npm test`) plus the
browser check (`node sim/smoke.mjs`), which reads the drawn plate's own triangles back and
asserts where the material reaches around a pit.
