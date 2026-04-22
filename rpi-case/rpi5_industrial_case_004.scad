// ============================================================
// RPi5 Industrial Enclosure — Luckfox DHX-10.1" Touchscreen
// Version: 004
//   Changes vs 003:
//     1. KICKSTAND is now a separate, removable piece (own module + color)
//        - Full enc_w width (no shorter ks_width param)
//        - 3 prongs on rear edge that slide into slots in case bottom wall
//        - Tapered prong tips for easy insertion
//     2. Prong slots added to rear cover bottom wall
//     3. USB-C touch cutout on left wall REMOVED (per user request)
//     4. Wall thickness increased 2.5 → 4 mm for rigidity
//     5. Bezel screw holes now countersunk + clearly sized
//     6. Insert bosses on rear cover made taller and more prominent
//        so the two-piece (bezel + rear cover) joint is obvious in renders
//     7. Render shows THREE separate bodies: bezel / rear cover / kickstand
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w        = 236;    // screen outer width  (mm)
scr_h        = 144;    // screen outer height (mm)
scr_d        = 19;     // screen outer depth  (mm)
scr_active_w = 222;    // active display area width  (mm) ← confirm
scr_active_h = 130;    // active display area height (mm) ← confirm
scr_mount_x  = 75;     // screen rear M2.5 hole pattern X (mm) ← verify
scr_mount_y  = 75;     // screen rear M2.5 hole pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w         = 85;     // Pi board width  (mm)
pi_h         = 56;     // Pi board height (mm)
pi_d         = 17;     // Pi board + tallest component (mm)
pi_mnt_x     = 58;     // Pi mount hole pattern X (mm)
pi_mnt_y     = 49;     // Pi mount hole pattern Y (mm)
pi_standoff  = 5;      // standoff height screen-rear → Pi PCB (mm)
pi_offset_x  = 0;      // Pi centre X offset from screen centre (mm)
pi_offset_y  = 5;      // Pi centre Y offset upward from screen centre (mm)

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall         = 4.0;    // wall thickness — increased for rigidity (mm)
chamfer      = 1.5;    // external edge chamfer (mm)
recess       = 1.0;    // screen recess in front bezel (mm)
gap          = 0.3;    // bezel ↔ rear cover fit clearance (mm)

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w       = 3;      // vent slot width  (mm)
vent_l       = 20;     // vent slot length (mm)
vent_sp      = 4;      // slot gap edge-to-edge (mm)
soc_vent_sz  = 30;     // SoC direct-vent area size (mm)

// ── CABLE GLAND PARAMETERS ───────────────────────────────────
gland_count  = 2;      // number of M16 cable glands
gland_dia    = 16.5;   // M16 clearance hole diameter (mm)
gland_spacing= 40;     // gland centre-to-centre (mm)

// ── KICKSTAND PARAMETERS ─────────────────────────────────────
// Separate removable piece — slides onto case bottom via 3 prongs.
// Wedge shape: thin at rear (prong end), thick at front desk-contact end.
// When flat on desk the screen sits at ks_tilt degrees from horizontal.
ks_tilt      = 75;     // screen angle from horizontal when standing (deg)
                       //   75° from horiz ≈ 15° lean-back from vertical
ks_depth     = 60;     // plate reach in -Z from case rear face (mm)
ks_thick     = 5;      // plate thickness at thin (rear) end (mm)

// Prong dimensions — 3 prongs slide into 3 slots in case bottom wall
ks_prong_n   = 3;      // number of prongs
ks_prong_w   = 12;     // prong width  (X, mm)
ks_prong_h   = 14;     // prong insertion height into cavity (mm)
ks_prong_t   = 5;      // prong depth  (Z, mm) — same as slot depth
ks_prong_clr = 0.25;   // diametral clearance for fit (mm)

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia       = 3.4;    // M3 clearance hole (mm)
m3_cs_dia    = 6.5;    // M3 countersink diameter (mm)
m3_cs_depth  = 3.0;    // countersink depth (mm)
insert_dia   = 4.2;    // M3 heat-set insert OD (mm)
insert_h     = 6;      // heat-set insert depth (mm)
boss_od      = 10;     // insert boss outer diameter — prominent (mm)
boss_h       = insert_h + 5;  // boss total height from inner face (mm)

// ── DERIVED DIMENSIONS ───────────────────────────────────────
rear_d       = pi_standoff + pi_d + 10;   // cavity depth = 32 mm
enc_w        = scr_w + 2*wall;            // outer width  = 244 mm
enc_h        = scr_h + 2*wall;            // outer height = 152 mm
enc_d        = rear_d + wall;             // rear cover depth = 36 mm

// Corner inset for boss/screw centres (keeps them inside the wall)
corner_inset = wall + boss_od/2 + 0.5;   // ≈ 9.5 mm

// Pi centre in enclosure coordinates
pi_enc_cx    = wall + scr_w/2 + pi_offset_x;  // 122 mm
pi_enc_cy    = wall + scr_h/2 + pi_offset_y;  //  81 mm
pi_z         = wall + pi_standoff;             //   9 mm (Pi PCB Z from rear face)

// Kickstand geometry
ks_drop      = ks_depth * tan(90 - ks_tilt);  // ≈ 16 mm tip drop

// Prong slot Z position — prongs sit right at the case rear face
ks_prong_z   = 0;      // prong rear face flush with case Z=0

$fn = 48;

// ============================================================
// PRIMITIVES
// ============================================================

module cbox(w, h, d, c=chamfer) {
    hull() {
        translate([c, c, 0]) cube([w-2*c, h-2*c, d    ]);
        translate([0, c, c]) cube([w,     h-2*c, d-2*c]);
        translate([c, 0, c]) cube([w-2*c, h,     d-2*c]);
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

// Heat-set insert boss
module insert_boss() {
    difference() {
        cylinder(d=boss_od, h=boss_h);
        cylinder(d=insert_dia, h=insert_h);
        translate([0,0,insert_h]) cylinder(d=m3_dia, h=boss_h);
    }
}

// Countersunk M3 hole (for bezel face)
module m3_countersunk(depth) {
    cylinder(d=m3_dia, h=depth+0.1);
    translate([0, 0, depth - m3_cs_depth])
        cylinder(d1=m3_dia, d2=m3_cs_dia, h=m3_cs_depth+0.1);
}

// Prong slot — cut from bottom wall, prong inserts up into cavity
module prong_slot() {
    translate([-ks_prong_w/2 - ks_prong_clr,
               -0.1,
               ks_prong_z - ks_prong_clr])
        cube([ks_prong_w + 2*ks_prong_clr,
              ks_prong_h + wall + 0.2,
              ks_prong_t + 2*ks_prong_clr]);
}

// ============================================================
// KICKSTAND  (separate removable piece)
// ============================================================
//
//  Side view (Y-Z plane, unit standing on kickstand):
//
//  Y=0 (case bottom) ─────────────────────────────
//                    │↑↑↑ prongs (insert into case)
//  Y=-ks_thick  ─────┼─────────────────────────────────┐
//                     \   wedge plate (bottom surface   │
//                      \   angled so it lies flat when  │
//  Y=-(ks_thick+ks_drop)\ screen tilts to ks_tilt)     │
//                        └──────────────────────────────┘
//                    Z=0                          Z=-ks_depth
//
module kickstand() {
    ks_front_h = ks_thick + ks_drop;   // total height at the front (desk-contact) edge

    // Main wedge plate
    hull() {
        // Rear (thin) edge, at Z=0 — where prongs attach
        translate([0, -ks_thick, 0])
            cube([enc_w, ks_thick, wall]);
        // Front (thick) edge, at Z=-ks_depth — rests on desk
        translate([0, -ks_front_h, -ks_depth])
            cube([enc_w, ks_front_h, wall]);
    }

    // Three prongs — evenly spaced, rise from Y=0 into case cavity
    for(i = [0:ks_prong_n-1]) {
        px = enc_w * (i+1) / (ks_prong_n+1);
        translate([px - ks_prong_w/2, 0, ks_prong_z]) {
            // Tapered tip so prong slides in easily
            hull() {
                // Base: full-width prong up to the tapered section
                cube([ks_prong_w,
                      ks_prong_h - 2,
                      ks_prong_t]);
                // Tip: narrowed 1 mm per side for 45° insertion chamfer
                translate([1, ks_prong_h - 2, 0])
                    cube([ks_prong_w - 2, 2, ks_prong_t]);
            }
        }
    }
}

// ============================================================
// FRONT BEZEL
// ============================================================
// Removable front frame — held to rear cover by 4× M3 screws
// through countersunk holes at each corner, threading into
// heat-set inserts pressed into the rear cover's corner bosses.
module front_bezel() {
    difference() {
        cbox(enc_w, enc_h, wall + recess);

        // Active display window
        translate([(enc_w - scr_active_w)/2,
                   (enc_h - scr_active_h)/2,
                   -0.1])
            cube([scr_active_w, scr_active_h, wall+recess+0.2]);

        // 1 mm recess pocket — bezel lip grips screen edge
        translate([(enc_w - scr_w)/2,
                   (enc_h - scr_h)/2,
                   wall])
            cube([scr_w, scr_h, recess+0.1]);

        // 4× M3 countersunk screw holes at corners
        for(x = [corner_inset, enc_w - corner_inset])
            for(y = [corner_inset, enc_h - corner_inset])
                translate([x, y, 0])
                    m3_countersunk(wall + recess);
    }
}

// ============================================================
// REAR COVER
// ============================================================
module rear_cover() {
    n_vent       = 6;
    vent_block_w = n_vent*(vent_w+vent_sp) - vent_sp;

    difference() {
        union() {
            cbox(enc_w, enc_h, enc_d);

            // ── Insert bosses: 4 corners, proud on inner rear face ──
            // These are clearly visible tall cylinders that receive the
            // heat-set inserts; M3 screws from the bezel thread into them.
            for(x = [corner_inset, enc_w - corner_inset])
                for(y = [corner_inset, enc_h - corner_inset])
                    translate([x, y, enc_d])
                        rotate([180, 0, 0])
                            insert_boss();
        }

        // ── HOLLOW INTERIOR ───────────────────────────────────
        translate([wall, wall, wall])
            cube([scr_w, scr_h, enc_d]);

        // ── PORT CUTOUTS ──────────────────────────────────────

        // LEFT WALL — USB-C power + HDMI ×2 (Pi left short-edge ports)
        pi_bot = pi_enc_cy - pi_h/2;
        // USB-C power
        translate([-0.1, pi_bot + 3,  pi_z + 2]) cube([wall+0.2, 11, 11]);
        // HDMI 0
        translate([-0.1, pi_bot + 16, pi_z + 2]) cube([wall+0.2, 17,  9]);
        // HDMI 1
        translate([-0.1, pi_bot + 35, pi_z + 2]) cube([wall+0.2, 17,  9]);

        // RIGHT WALL — RJ45 + USB-A ×4 (Pi right short-edge ports)
        pi_top = pi_enc_cy + pi_h/2;
        // RJ45
        translate([enc_w-wall-0.1, pi_top - 24, pi_z + 1])
            cube([wall+0.2, 22, 16]);
        // USB-A ×4
        translate([enc_w-wall-0.1, pi_bot + 2,  pi_z + 1])
            cube([wall+0.2, 50, 15]);

        // NOTE: USB-C touch cutout (screen side) REMOVED per v004 request.
        // GPIO header is internal — access by removing bezel + rear cover.

        // ── COOLING VENTS ─────────────────────────────────────

        // Bottom intake slots (through bottom wall)
        translate([enc_w/2 - vent_block_w/2, -0.1, wall + 8])
            rotate([-90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Top exhaust slots (through top wall)
        translate([enc_w/2 - vent_block_w/2,
                   enc_h - wall + 0.1,
                   wall + 8])
            rotate([90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // SoC direct-vent on rear panel
        translate([pi_enc_cx - soc_vent_sz/2,
                   pi_enc_cy - soc_vent_sz/2,
                   enc_d - wall - 0.1]) {
            n_soc = floor(soc_vent_sz / (vent_w + vent_sp));
            for(i = [0:n_soc-1])
                translate([i*(vent_w+vent_sp),
                           soc_vent_sz/2 - vent_l/2,
                           0])
                    slot(vent_l, vent_w, wall+0.2);
        }

        // ── CABLE GLANDS — rear panel, bottom area ────────────
        for(i = [0:gland_count-1]) {
            cx = enc_w/2 + (i - (gland_count-1)/2) * gland_spacing;
            translate([cx, wall + gland_dia/2 + 4, -0.1])
                cylinder(d=gland_dia, h=wall+0.2);
        }

        // ── KICKSTAND PRONG SLOTS — bottom wall ───────────────
        // 3 slots matching kickstand prong positions and sizes.
        // Slots pass through the bottom wall into the cavity so prongs
        // engage wall + (ks_prong_h - wall) mm inside the cavity.
        for(i = [0:ks_prong_n-1]) {
            px = enc_w * (i+1) / (ks_prong_n+1);
            translate([px, 0, ks_prong_z])
                prong_slot();
        }
    }
}

// ============================================================
// SCENE — three separate bodies, exploded for clarity
// ============================================================

// Front bezel — exploded up, face toward viewer
color("DarkSlateGray", 0.92)
    translate([0, 0, enc_d + 14])
        front_bezel();

// Rear cover — at origin
color("SlateGray", 0.88)
    rear_cover();

// Kickstand — exploded below, separate piece
color("DimGray", 0.85)
    translate([0, -(ks_thick + ks_drop + 20), 0])
        kickstand();
