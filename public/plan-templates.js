/* Architect-grade floor plan templates. Rooms use normalized coords (0–1) within footprint.
 * front = bottom (y→1), back = top (y→0). Scaled to actual plot on build. */
(function (global) {
  'use strict';

  var CATALOG = {
    sideGarage3bed: {
      name: 'Side garage + open living (3 bed)',
      match: function (c) { return c.floors === 2 && c.bedrooms >= 2 && c.bedrooms <= 4 && c.bathrooms >= 1 && c.garage && c.dining; },
      floors: [
        { // ground
          rooms: [
            { type: 'garage', name: 'Garage', x: 0, y: 0, w: 0.27, h: 1, door: { side: 'right', pos: 0.72, rel: true } },
            { type: 'living', name: 'Living Room', x: 0.27, y: 0, w: 0.43, h: 0.40, door: { side: 'bottom', pos: 0.5, rel: true } },
            { type: 'corridor', name: 'Hall', x: 0.27, y: 0.40, w: 0.43, h: 0.34 },
            { type: 'kitchen', name: 'Kitchen', x: 0.70, y: 0, w: 0.30, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'dining', name: 'Dining', x: 0.70, y: 0.30, w: 0.30, h: 0.28, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'WC', x: 0.70, y: 0.58, w: 0.30, h: 0.16, door: { side: 'left', pos: 0.5, rel: true } }
          ],
          corridor: { x: 0.38, y: 0.86, w: 0.20, h: 0.14 },
          entrance: { x: 0.48, y: 1.0, width: 1.2, rel: true },
          stairs: { x: 0.70, y: 0.76, w: 0.30, h: 0.18 }
        },
        { // upper
          rooms: [
            { type: 'corridor', name: 'Landing', x: 0.44, y: 0, w: 0.10, h: 1 },
            { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.44, h: 0.38, door: { side: 'right', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 0.38, w: 0.44, h: 0.34, door: { side: 'right', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 3', x: 0.54, y: 0, w: 0.46, h: 0.52, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'Bathroom', x: 0.54, y: 0.72, w: 0.22, h: 0.18, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'Bath 2', x: 0.76, y: 0.72, w: 0.24, h: 0.18, door: { side: 'left', pos: 0.5, rel: true } }
          ],
          corridor: { x: 0.44, y: 0, w: 0.10, h: 1 },
          stairs: { x: 0.44, y: 0.82, w: 0.10, h: 0.18 }
        }
      ],
      concept: 'Side-attached garage with open living hall, kitchen-dining stack, and central landing upstairs.'
    },
    openPlan2bed: {
      name: 'Compact open plan (2 bed, 1 floor)',
      match: function (c) { return c.floors === 1 && c.bedrooms >= 1 && c.bedrooms <= 3 && !c.garage; },
      floors: [
        {
          rooms: [
            { type: 'living', name: 'Living Room', x: 0, y: 0.42, w: 0.58, h: 0.44, door: { side: 'bottom', pos: 0.5, rel: true } },
            { type: 'kitchen', name: 'Kitchen', x: 0.58, y: 0.42, w: 0.42, h: 0.22, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'dining', name: 'Dining', x: 0.58, y: 0.64, w: 0.42, h: 0.22, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.50, h: 0.42, door: { side: 'bottom', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 2', x: 0.50, y: 0, w: 0.50, h: 0.42, door: { side: 'bottom', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'Bathroom', x: 0.58, y: 0, w: 0.42, h: 0.22, door: { side: 'bottom', pos: 0.5, rel: true } }
          ],
          corridor: { x: 0.20, y: 0.88, w: 0.22, h: 0.12 },
          entrance: { x: 0.31, y: 1.0, width: 1.2, rel: true }
        }
      ],
      concept: 'Single-storey split: bedrooms to the back, open living-kitchen-dining to the street.'
    },
    centralHall4bed: {
      name: 'Central hall 4 bed (no garage)',
      match: function (c) { return c.floors === 2 && c.bedrooms >= 4 && !c.garage && c.dining; },
      floors: [
        {
          rooms: [
            { type: 'living', name: 'Living Room', x: 0, y: 0.08, w: 0.46, h: 0.44, door: { side: 'right', pos: 0.5, rel: true } },
            { type: 'kitchen', name: 'Kitchen', x: 0.54, y: 0.08, w: 0.46, h: 0.26, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'dining', name: 'Dining', x: 0.54, y: 0.34, w: 0.46, h: 0.24, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'corridor', name: 'Entry Hall', x: 0.18, y: 0.78, w: 0.28, h: 0.14 },
            { type: 'bathroom', name: 'WC', x: 0.54, y: 0.58, w: 0.22, h: 0.16, door: { side: 'left', pos: 0.5, rel: true } }
          ],
          corridor: { x: 0.18, y: 0.78, w: 0.28, h: 0.14 },
          entrance: { x: 0.32, y: 1.0, width: 1.2, rel: true },
          stairs: { x: 0.46, y: 0.52, w: 0.12, h: 0.22 }
        },
        {
          rooms: [
            { type: 'corridor', name: 'Landing', x: 0.44, y: 0, w: 0.12, h: 1 },
            { type: 'bedroom', name: 'Master Bedroom', x: 0, y: 0, w: 0.44, h: 0.36, door: { side: 'right', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 2', x: 0, y: 0.36, w: 0.44, h: 0.30, door: { side: 'right', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 3', x: 0.56, y: 0, w: 0.44, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bedroom', name: 'Bedroom 4', x: 0.56, y: 0.30, w: 0.44, h: 0.30, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'Bathroom', x: 0.56, y: 0.72, w: 0.22, h: 0.18, door: { side: 'left', pos: 0.5, rel: true } },
            { type: 'bathroom', name: 'Bath 2', x: 0.78, y: 0.72, w: 0.22, h: 0.18, door: { side: 'left', pos: 0.5, rel: true } }
          ],
          corridor: { x: 0.44, y: 0, w: 0.12, h: 1 },
          stairs: { x: 0.44, y: 0.82, w: 0.12, h: 0.18 }
        }
      ],
      concept: 'Traditional central hall with four bedrooms on the upper floor.'
    }
  };

  function listTemplates() {
    return Object.keys(CATALOG).map(function (id) {
      return { id: id, name: CATALOG[id].name, concept: CATALOG[id].concept };
    });
  }

  function pickTemplate(c) {
    var best = null, score = -1;
    Object.keys(CATALOG).forEach(function (id) {
      var t = CATALOG[id];
      if (!t.match(c)) return;
      var s = 100;
      if (c.bedrooms === 3 && id === 'sideGarage3bed') s += 20;
      if (c.floors === 1 && id === 'openPlan2bed') s += 20;
      if (c.bedrooms >= 4 && id === 'centralHall4bed') s += 20;
      if (s > score) { score = s; best = id; }
    });
    if (best) return best;
    if (c.floors >= 2 && c.garage) return 'sideGarage3bed';
    if (c.floors === 1) return 'openPlan2bed';
    return 'sideGarage3bed';
  }

  var api = { CATALOG: CATALOG, listTemplates: listTemplates, pickTemplate: pickTemplate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PlanTemplates = api;
})(typeof window !== 'undefined' ? window : globalThis);
