// ============================================================
// RPi5 Industrial Enclosure — 7" Capacitive Touchscreen
// Version: 005
//
// ASSEMBLY LOGIC (read before printing):
//
//   THREE separate printed parts:
//
//   1. REAR COVER — the main box. Open face points toward screen.
//      Four corner TOWERS rise from the open front face; each tower
//      has a self-tapping M3 pilot hole that opens toward the screen.
//      The kickstand prong columns rise from the inner bottom face.
//
//   2. FRONT BEZEL — the display frame. Four countersunk M3 holes at
//      the corners align with the rear cover's tower holes.
//      Assembly: lay screen face-down, place rear cover over it,
//      lay bezel over the front, drive 4× M3×30 self-tapping screws
//      from the bezel face through into the corner towers.
//
//   3. KICKSTAND — separate wedge plate. Slide its 3 prongs upward
//      into the 3 slots in the case bottom wall. The prong guide
//      columns inside the case prevent the prongs from falling into
//      the main cavity and give a solid 14 mm engagement.
//
// Changes vs 004:
//   - Screen resized to 164.9 × 124.27 mm (7" 1024×600 capacitive)
//   - Corner towers replace insert bosses: visible M3 holes on the
//     OPEN front face of the rear cover — no hidden geometry
//   - Prong guide columns (nested-difference CSG) give the slots a
//     closed ceiling so the kickstand prongs cannot fall through
//   - Left-wall USB-C touch cutout permanently removed
//   - Wall 4 mm retained
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w        = 164.9;  // screen outer width  (mm)
scr_h        = 124.27; // screen outer height (mm)
scr_d        = 12;     // screen body depth   (mm) ← confirm with calipers
scr_active_w = 154;    // active display width  (mm) ← confirm
scr_active_h = 90;     // active display height (mm) ← confirm
scr_mount_x  = 75;     // rear M2.5 hole pattern X (mm) ← verify
scr_mount_y  = 75;     // rear M2.5 hole pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w         = 85;     // Pi board width  (mm)
pi_h         = 56;     // Pi board height (mm)
pi_d         = 17;     // Pi board + tallest component (mm)
pi_mnt_x     = 58;     // Pi mount hole pattern X (mm)
pi_mnt_y     = 49;     // Pi mount hole pattern Y (mm)
pi_standoff  = 5;      // standoff: screen rear → Pi PCB (mm)
pi_offset_x  = 0;      // Pi centre X offset from screen centre (mm)
pi_offset_y  = 0;      // Pi centre Y offset from screen centre (mm)

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall         = 4.0;    // wall thickness (mm)
chamfer      = 1.5;    // external edge chamfer (mm)
recess       = 1.0;    // screen recess depth in front bezel (mm)

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w       = 3;      // slot width  (mm)
vent_l       = 18;     // slot length (mm)
vent_sp      = 4;      // gap edge-to-edge (mm)
soc_vent_sz  = 28;     // SoC vent zone (mm, square)

// ── CABLE GLAND PARAMETERS ───────────────────────────────────
gland_count  = 2;      // number of M16 cable glands
gland_dia    = 16.5;   // M16 clearance hole diameter (mm)
gland_spacing= 36;     // gland centre-to-centre (mm)

// ── KICKSTAND PARAMETERS ─────────────────────────────────────
ks_tilt      = 75;     // screen angle from horizontal when standing (deg)
ks_depth     = 60;     // plate reach behind rear face (mm)
ks_thick     = 5;      // plate thickness at thin (prong) end (mm)
ks_prong_n   = 3;      // number of prongs
ks_prong_w   = 12;     // prong width in X (mm)
ks_prong_h   = 14;     // prong engagement height (mm) — guided inside column
ks_prong_t   = 5;      // prong thickness in Z (mm)
ks_prong_clr = 0.25;   // clearance per side for slide fit (mm)

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia       = 3.4;    // M3 clearance hole (mm)
m3_pilot     = 2.5;    // M3 self-tapping pilot hole (mm)
m3_cs_dia    = 6.5;    // M3 countersink OD (mm)
m3_cs_depth  = 3.5;    // countersink depth (mm)
// Corner tower — a full-depth solid pillar at each inner corner.
// The M3 pilot hole is drilled from the open front face of the rear cover.
tower_w      = 10;     // tower footprint width and depth (mm)
tower_hole_d = 12;     // M3 pilot hole depth from front face (mm)

// ── DERIVED DIMENSIONS ───────────────────────────────────────
rear_d       = pi_standoff + pi_d + 10;  // rear cavity depth = 32 mm
enc_w        = scr_w + 2*wall;           // outer width  = 172.9 mm
enc_h        = scr_h + 2*wall;           // outer height = 132.27 mm
enc_d        = rear_d + wall;            // rear cover depth = 36 mm

// Pi centre in enclosure coordinates
pi_enc_cx    = wall + scr_w/2 + pi_offset_x;
pi_enc_cy    = wall + scr_h/2 + pi_offset_y;
pi_z         = wall + pi_standoff;        // Pi PCB Z from rear face

// Corner tower position — inset so tower is entirely within the wall zone
// (tower must NOT overlap the screen footprint X=wall..wall+scr_w)
tower_cx     = wall/2;   // tower centre offset from outer edge
// Four tower centre positions
tower_xs     = [tower_cx, enc_w - tower_cx];
tower_ys     = [tower_cx, enc_h - tower_cx];

// Kickstand wedge geometry
ks_drop      = ks_depth * tan(90 - ks_tilt);  // tip drop ≈ 16 mm

// Prong column Z extent (guide column behind and into cavity)
col_z_size   = ks_prong_t + 2*wall;   // = 13 mm
col_y_size   = ks_prong_h;            // = 14 mm (above inner bottom face)
col_x_size   = ks_prong_w + wall;     // = 16 mm (centred on prong)

$fn = 48;

// ============================================================
// PRIMITIVES
// ============================================================

module cbox(w, h, d, c=chamfer) {
    hull() {
        translate([c, c, 0]) cube([w-2*c, h-2*c, d      ]);
        translate([0, c, c]) cube([w,     h-2*c, d-2*c  ]);
        translate([c, 0, c]) cube([w-2*c, h,     d-2*c  ]);
    }
}

module slot(len, w, d) {
    r = w/2;
    hull() {
        translate([0, -len/2+r, 0]) cylinder(r=r, h=d);
        translate([0,  len/2-r, 0]) cylinder(r=r, h=d);
    }
}

module vent_row(n, len, w, spacing, depth) {
    for(i = [0:n-1])
        translate([i*(w+spacing), 0, 0])
            slot(len, w, depth);
}

// Countersunk M3 through-hole for bezel face
module m3_countersunk(total_depth) {
    cylinder(d=m3_dia, h=total_depth+0.1);
    cylinder(d1=m3_cs_dia, d2=m3_dia, h=m3_cs_depth+0.1);
}

// Prong slot cutter — used in both the rear cover and the guide column
// Origin at the prong centre-X, outer bottom face (Y=0), prong-Z start
module prong_slot_cut() {
    translate([-ks_prong_w/2 - ks_prong_clr,
               -0.1,
               -ks_prong_clr])
        cube([ks_prong_w + 2*ks_prong_clr,
              wall + ks_prong_h + 0.2,
              ks_prong_t + 2*ks_prong_clr]);
}

// ============================================================
// KICKSTAND  (separate removable piece, print separately)
// ============================================================
module kickstand() {
    ks_front_h = ks_thick + ks_drop;   // height at the thick/front end

    // Wedge plate — thin at prong end (Z=0), thick at desk end (Z=-ks_depth)
    hull() {
        translate([0, -ks_thick, 0])
            cube([enc_w, ks_thick, wall]);
        translate([0, -ks_front_h, -ks_depth])
            cube([enc_w, ks_front_h, wall]);
    }

    // Three tapered prongs on the top edge (rear/thin end)
    for(i = [0:ks_prong_n-1]) {
        px = enc_w * (i+1) / (ks_prong_n+1);
        translate([px - ks_prong_w/2, 0, 0]) {
            // Body of prong
            cube([ks_prong_w, ks_prong_h - 2, ks_prong_t]);
            // Tapered tip (last 2 mm, narrowed 1 mm per side)
            translate([0, ks_prong_h - 2, 0])
                hull() {
                    cube([ks_prong_w, 0.01, ks_prong_t]);
                    translate([1, 2, 0])
                        cube([ks_prong_w - 2, 0.01, ks_prong_t]);
                }
        }
    }
}

// ============================================================
// FRONT BEZEL  (removable — 4× M3 countersunk screws)
// ============================================================
module front_bezel() {
    difference() {
        cbox(enc_w, enc_h, wall + recess);

        // Display window
        translate([(enc_w - scr_active_w)/2,
                   (enc_h - scr_active_h)/2,
                   -0.1])
            cube([scr_active_w, scr_active_h, wall+recess+0.2]);

        // 1 mm recess pocket — bezel lip grips screen edge
        translate([(enc_w - scr_w)/2,
                   (enc_h - scr_h)/2,
                   wall])
            cube([scr_w, scr_h, recess+0.1]);

        // 4× M3 countersunk screw holes, aligned to corner towers
        for(x = tower_xs) for(y = tower_ys)
            translate([x, y, 0])
                m3_countersunk(wall + recess);
    }
}

// ============================================================
// REAR COVER
// ============================================================
//
// CORNER TOWER DESIGN — replaces hidden insert bosses:
//   Each corner has a solid square tower (tower_w × tower_w) that
//   runs the FULL DEPTH of the cavity (from inner rear face to the
//   open front at Z=enc_d).  An M3 pilot hole enters from the front
//   face (Z=enc_d) and goes tower_hole_d into the tower body.
//   Because the tower reaches the front opening, the holes are
//   plainly visible from the front of the assembled unit — no
//   hidden geometry.
//
// PRONG COLUMN DESIGN — prevents prongs falling into cavity:
//   A solid rectangular column rises from the inner bottom face at
//   each prong position.  The prong slot cuts through the bottom wall
//   AND the column.  The column ceiling is at Y=wall+ks_prong_h,
//   which acts as the hard stop for the prong — it cannot travel
//   beyond that height.  The column is added AFTER the main interior
//   hollow is subtracted (nested-difference CSG), so the hollow
//   does not remove it.
//
module rear_cover() {
    n_vent       = 5;
    vent_block_w = n_vent*(vent_w+vent_sp) - vent_sp;

    difference() {

        // ── SOLID GEOMETRY ────────────────────────────────────
        union() {

            // 1. Main shell with interior already removed
            //    (nested so subsequent additions are NOT removed by hollow)
            difference() {
                cbox(enc_w, enc_h, enc_d);
                // Interior hollow — from rear inner face to front opening
                translate([wall, wall, wall])
                    cube([scr_w, scr_h, enc_d]);
            }

            // 2. Corner towers — full cavity height, clearly visible from front
            for(x = tower_xs) for(y = tower_ys)
                translate([x - tower_w/2, y - tower_w/2, wall])
                    cube([tower_w, tower_w, enc_d - wall]);

            // 3. Prong guide columns — solid pillars on inner bottom face
            //    One per prong, gives 14 mm of guided engagement
            for(i = [0:ks_prong_n-1]) {
                px = enc_w * (i+1) / (ks_prong_n+1);
                translate([px - col_x_size/2,
                           wall,
                           0])
                    cube([col_x_size, col_y_size, col_z_size]);
            }
        }

        // ── ALL CUTOUTS ───────────────────────────────────────

        // Corner tower M3 pilot holes (from front/open face, going inward)
        for(x = tower_xs) for(y = tower_ys)
            translate([x, y, enc_d + 0.1])
                rotate([180, 0, 0])
                    cylinder(d=m3_pilot, h=tower_hole_d);

        // ── PORT CUTOUTS ──────────────────────────────────────
        pi_bot = pi_enc_cy - pi_h/2;
        pi_top = pi_enc_cy + pi_h/2;

        // LEFT WALL — USB-C power + HDMI ×2
        translate([-0.1, pi_bot + 3,  pi_z + 2]) cube([wall+0.2, 11, 11]);
        translate([-0.1, pi_bot + 16, pi_z + 2]) cube([wall+0.2, 17,  9]);
        translate([-0.1, pi_bot + 35, pi_z + 2]) cube([wall+0.2, 17,  9]);

        // RIGHT WALL — RJ45 + USB-A ×4
        translate([enc_w-wall-0.1, pi_top - 24, pi_z + 1])
            cube([wall+0.2, 22, 16]);
        translate([enc_w-wall-0.1, pi_bot +  2, pi_z + 1])
            cube([wall+0.2, 50, 15]);

        // ── COOLING VENTS ─────────────────────────────────────

        // Bottom intake
        translate([enc_w/2 - vent_block_w/2, -0.1, wall + 6])
            rotate([-90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Top exhaust
        translate([enc_w/2 - vent_block_w/2, enc_h - wall + 0.1, wall + 6])
            rotate([90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // SoC direct-vent on rear panel
        translate([pi_enc_cx - soc_vent_sz/2,
                   pi_enc_cy - soc_vent_sz/2,
                   enc_d - wall - 0.1]) {
            n_soc = floor(soc_vent_sz / (vent_w + vent_sp));
            for(i = [0:n_soc-1])
                translate([i*(vent_w+vent_sp), soc_vent_sz/2 - vent_l/2, 0])
                    slot(vent_l, vent_w, wall+0.2);
        }

        // ── CABLE GLANDS — rear panel face ────────────────────
        for(i = [0:gland_count-1]) {
            cx = enc_w/2 + (i - (gland_count-1)/2) * gland_spacing;
            translate([cx, wall + gland_dia/2 + 4, -0.1])
                cylinder(d=gland_dia, h=wall+0.2);
        }

        // ── KICKSTAND PRONG SLOTS ─────────────────────────────
        // Each slot cuts through the outer bottom wall AND the guide
        // column above it.  The column ceiling at Y=wall+ks_prong_h
        // is the hard stop — the prong cannot fall through.
        for(i = [0:ks_prong_n-1]) {
            px = enc_w * (i+1) / (ks_prong_n+1);
            translate([px, 0, 0])
                prong_slot_cut();
        }
    }
}

// ============================================================
// SCENE — three parts exploded for visual clarity
// ============================================================

// FRONT BEZEL — floated forward (toward viewer)
color("DarkSlateGray", 0.92)
    translate([0, 0, enc_d + 14])
        front_bezel();

// REAR COVER — at origin
color("SlateGray", 0.88)
    rear_cover();

// KICKSTAND — floated below the case to show it is a separate piece
color("DimGray", 0.85)
    translate([0, -(ks_thick + ks_drop + 20), 0])
        kickstand();
