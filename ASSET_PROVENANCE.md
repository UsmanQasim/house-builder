# Asset provenance and export status

Last audited: 2026-07-30

## Current licensing status

The GLB files in `public/models/` are locally cached prototype assets. This
repository currently contains no corresponding source URLs, author records,
license texts, purchase receipts, or attribution records for them. Their
redistribution and resale rights are therefore **unverified**.

Do not describe these bundled files as CC0, royalty-free, commercially cleared,
or marketplace-ready until provenance evidence has been collected for each
exact file. Until then, use them only for internal evaluation and replace or
remove them from any distributed product or asset pack.

## Bundled GLB inventory

Hashes identify the exact binaries covered by this audit.

| File | Runtime role | Bytes | SHA-256 | Redistribution status |
|---|---|---:|---|---|
| `bathtub.glb` | Bathtub furniture slot | 73,680 | `46c98db7c9c0870262145182c9082808415a0c3177057b8a2c178d02151b094a` | Unverified |
| `bed.glb` | Bed furniture slot | 27,684 | `23c5c32096840f3dd347b1c68029d2f50e2af468ccd38daa33b494f1943b3dc8` | Unverified |
| `car.glb` | Garage vehicle slot | 1,829,316 | `c04bb20bce55ea878e4b340ed23492a1d6834bd40fdafc5512c06abd7c7079eb` | Unverified |
| `chair.glb` | Dining chair slot | 13,360 | `bdc6aeeb64524bbdccba2f079e6485e2a372aed1c428d976d5da67aadcf18b7a` | Unverified |
| `coffee_table.glb` | Coffee-table slot | 14,864 | `744d72a41c75e3435c17025a98ad91d0774b596aff69c81500c02bd8a59d2dc0` | Unverified |
| `dining_table.glb` | Dining-table slot | 77,616 | `e034abcfd847512bb0608d276295f4e6a54b19906e3d591be513839dcead508a` | Unverified |
| `potted_plant.glb` | Decorative plant slot | 2,834,140 | `0bb015344424982ac49e0c3ce733112f3970bb8cb7349ae630befcf13749eee1` | Unverified |
| `refrigerator.glb` | Refrigerator slot | 17,360 | `65437d539065381839fdfdff5ea10b7133d28e762e38ff1b6d7e3723f798e408` | Unverified |
| `sofa.glb` | Sofa furniture slot | 82,880 | `a8da1feb0507a894e2cc69d8e263bdfbc09361a668e6273a7eb900a611498599` | Unverified |
| `toilet.glb` | Toilet fixture slot | 57,216 | `b615b9fbd194e5ab6bb5df4e9f18071291238419a4b07992484f16b1ea3002d9` | Unverified |
| `wardrobe.glb` | Wardrobe furniture slot | 162,868 | `20c69ab0c009f5c7664183398b7a2a6cf72a886f1537c44d5bf2e5af30c00e84` | Unverified |

## Prototype export versus marketplace-ready assets

ForthHome's GLB export is a technical prototype feature. It can package the
procedural building geometry, generated materials, and any loaded furniture in
the current scene. A successful export proves only that the scene can be
serialized; it does **not** grant or verify rights to redistribute its contents.

A marketplace-ready export requires, at minimum:

1. A source URL, creator, exact license/version, and retrieval date for every
   third-party binary, texture, and material.
2. Written confirmation that the license permits commercial use, modification,
   embedding in a GLB, redistribution to customers, and resale inside an asset
   pack. These permissions are not equivalent.
3. Required attribution and license notices shipped beside the exported asset.
4. Replacement of any asset whose origin or resale permission cannot be proven.
5. A final export audit covering external assets fetched after this inventory.

## Runtime-fetched assets

`/api/model` may obtain additional models from configured Rodin/Hyper3D or Poly
Pizza providers and cache them locally. `/api/texture` may fetch Poly Haven
materials. Those files are not part of the bundled inventory above. Record the
provider response, source asset identifier, applicable terms, and exact binary
hash before including any such result in a distributable GLB.

For a legally conservative marketplace build, disable third-party model loading
and export procedural geometry/materials only until every external asset has a
verified provenance record.
