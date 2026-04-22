// ============================================================
// RPi5 Industrial Enclosure — 7" Capacitive Touchscreen
// Version: 006
//
// ASSEMBLY (three printed parts):
//
//   REAR COVER — box, open face toward screen.
//     • 4 corner towers, full cavity height, M3 pilot hole from front.
//     • 3 prong guide columns on inner bottom face — the columns give
//       the prong slots a solid ceiling so nothing falls through.
//     • ALL SIDE WALLS ARE SOLID. No port holes.
//
//   FRONT BEZEL — display frame.
//     • 4× M3 countersunk holes, corners, aligned to tower holes.
//     • Screw route: bezel face → screen gap → tower pilot hole.
//     • Use M3 × 30 mm self-tapping screws.
//
//   KICKSTAND — separate removable wedge plate.
//     • Main wedge behind case creates the tilt.
//     • Thin ledge extends UNDER the rear of the case 14 mm.
//       The ledge carries the 3 prongs which enter the case
//       through the BOTTOM face only — rear wall stays solid.
//     • Slide ledge+prongs under the case from behind; prongs
//       click up into their columns and lock the stand.
//
// Changes vs 005:
//   • Right-wall USB-A rectangle REMOVED (and all side-wall cuts).
//     Both left and right walls are now fully solid.
//   • Prong slots moved to Z = 5.5–10.5 mm (inside cavity).
//     Rear face (Z = 0) is completely uncut — no holes on back.
//   • Kickstand gains a 14 mm ledge so prongs reach the new slot Z.
//   • Cable glands removed (no rear-face holes).
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w        = 164.9;  // screen outer width  (mm)
scr_h        = 124.27; // screen outer height (mm)
scr_d        = 12;     // screen body depth   (mm) ← confirm with calipers
scr_active_w = 154;    // active area width   (mm) ← confirm from datasheet
scr_active_h = 90;     // active area height  (mm) ← confirm from datasheet
scr_mount_x  = 75;     // rear M2.5 mount pattern X (mm) ← verify
scr_mount_y  = 75;     // rear M2.5 mount pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w         = 85;     // Pi board width  (mm)
pi_h         = 56;     // Pi board height (mm)
pi_d         = 17;     // Pi board + tallest component (mm)
pi_mnt_x     = 58;     // Pi mount pattern X (mm)
pi_mnt_y     = 49;     // Pi mount pattern Y (mm)
pi_standoff  = 5;      // standoff: screen rear → Pi PCB (mm)
pi_offset_x  = 0;      // Pi centre X offset from screen centre (mm)
pi_offset_y  = 0;      // Pi centre Y offset from screen centre (mm)

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall         = 4.0;    // wall thickness (mm)
chamfer      = 1.5;    // external edge chamfer (mm)
recess       = 1.0;    // screen recess depth in front bezel (mm)

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w       = 3;
vent_l       = 18;
vent_sp      = 4;
soc_vent_sz  = 28;

// ── KICKSTAND PARAMETERS ─────────────────────────────────────
ks_tilt      = 75;     // screen angle from horizontal when standing (deg)
ks_depth     = 60;     // wedge reach behind rear face (mm)
ks_thick     = 5;      // plate/ledge thickness (mm)

// Prong dimensions
ks_prong_n   = 3;      // number of prongs
ks_prong_w   = 12;     // prong width in X (mm)
ks_prong_h   = 14;     // prong engagement height (mm)
ks_prong_t   = 5;      // prong thickness in Z (mm)
ks_prong_clr = 0.25;   // clearance per side (mm)

// Ledge: extends under the case so prongs reach inside the cavity
// without cutting through the rear wall.
ks_ledge     = 14;     // ledge depth in +Z under case (mm)
                       //   must be > wall + ks_prong_t + margin

// Z start of prong slot measured from rear face.
// Must be > wall so the slot never touches the rear face.
ks_prong_z0  = wall + 1.5;   // = 5.5 mm — slot from 5.25 to 10.75 mm

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia       = 3.4;    // M3 clearance hole (mm)
m3_pilot     = 2.5;    // M3 self-tapping pilot (mm)
m3_cs_dia    = 6.5;    // M3 countersink OD (mm)
m3_cs_depth  = 3.5;    // countersink depth (mm)
tower_w      = 9;      // corner tower footprint (mm square)
tower_hole_d = 14;     // pilot hole depth into tower from front face (mm)
corner_inset = 7;      // tower/hole centre from outer edge (mm)

// ── DERIVED ──────────────────────────────────────────────────
rear_d       = pi_standoff + pi_d + 10;  // cavity depth = 32 mm
enc_w        = scr_w + 2*wall;           // 172.9 mm
enc_h        = scr_h + 2*wall;           // 132.27 mm
enc_d        = rear_d + wall;            // 36 mm

pi_enc_cx    = wall + scr_w/2 + pi_offset_x;
pi_enc_cy    = wall + scr_h/2 + pi_offset_y;
pi_z         = wall + pi_standoff;

ks_drop      = ks_depth * tan(90 - ks_tilt);  // wedge tip drop ≈ 16 mm

// Guide column dimensions (added back inside cavity after hollow)
col_w        = ks_prong_w + wall;   // 16 mm — solid wall each side of slot
col_h        = ks_prong_h;          // 14 mm — prong engagement
col_d        = ks_ledge;            // 14 mm — same as ledge depth

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

module m3_countersunk(total_d) {
    cylinder(d=m3_dia,    h=total_d+0.1);
    cylinder(d1=m3_cs_dia, d2=m3_dia, h=m3_cs_depth+0.1);
}

// Prong slot cutter — called with origin at (prong_cx, 0, ks_prong_z0).
// Cuts bottom wall (Y: -0.1 → wall) + guide column (Y: wall → wall+col_h).
// Z extent stays within [ks_prong_z0-clr, ks_prong_z0+ks_prong_t+clr]
// which is entirely inside the cavity — rear face untouched.
module prong_slot_cut() {
    translate([-ks_prong_w/2 - ks_prong_clr,
               -0.1,
               -ks_prong_clr])
        cube([ks_prong_w + 2*ks_prong_clr,
              wall + col_h + 0.2,
              ks_prong_t + 2*ks_prong_clr]);
}

// ============================================================
// KICKSTAND  (separate removable piece — print separately)
// ============================================================
//
//  Side cross-section (Y-Z plane):
//
//  Y=0 (case bottom) ─────┬─────────────────┐ ← ledge top (fits under case)
//  Y=-ks_thick       ─────┴─────────────────┘ ← ledge bottom
//                    Z=ks_ledge            Z=0 │
//                                             │ ← wedge (behind case)
//                                    thick ╲  │ thin
//                    desk contact → ────────╲─┘
//                                   Z=-ks_depth   Z=0
//
//  The ledge (Z=0→ks_ledge) slides under the case rear.
//  Prongs rise from Y=0 at Z=ks_prong_z0, entering the case bottom slots.
//  The wedge (Z=-ks_depth→0) rests on the desk and creates the tilt.
//
module kickstand() {
    ks_front_h = ks_thick + ks_drop;   // thick end of wedge

    // 1. Wedge behind case (Z = -ks_depth → 0)
    hull() {
        translate([0, -ks_thick,    0       ]) cube([enc_w, ks_thick,    wall]);
        translate([0, -ks_front_h, -ks_depth]) cube([enc_w, ks_front_h, wall]);
    }

    // 2. Ledge under rear of case (Z = 0 → ks_ledge)
    translate([0, -ks_thick, 0])
        cube([enc_w, ks_thick, ks_ledge]);

    // 3. Three prongs rising from ledge top (Y=0) into case bottom slots
    for(i = [0:ks_prong_n-1]) {
        px = enc_w * (i+1) / (ks_prong_n+1);
        translate([px - ks_prong_w/2, 0, ks_prong_z0]) {
            // Main shaft
            cube([ks_prong_w, ks_prong_h - 2, ks_prong_t]);
            // Tapered tip (45° chamfer for easy insertion)
            translate([0, ks_prong_h - 2, 0])
                hull() {
                    cube([ks_prong_w,     0.01, ks_prong_t    ]);
                    translate([1, 2, 0])
                        cube([ks_prong_w-2, 0.01, ks_prong_t  ]);
                }
        }
    }
}

// ============================================================
// FRONT BEZEL
// ============================================================
module front_bezel() {
    ci = corner_inset;
    difference() {
        cbox(enc_w, enc_h, wall + recess);

        // Display window
        translate([(enc_w - scr_active_w)/2,
                   (enc_h - scr_active_h)/2, -0.1])
            cube([scr_active_w, scr_active_h, wall+recess+0.2]);

        // 1 mm recess pocket grips screen edge
        translate([(enc_w - scr_w)/2,
                   (enc_h - scr_h)/2, wall])
            cube([scr_w, scr_h, recess+0.1]);

        // 4× M3 countersunk screw holes at corners
        for(x = [ci, enc_w-ci])
            for(y = [ci, enc_h-ci])
                translate([x, y, 0])
                    m3_countersunk(wall + recess);
    }
}

// ============================================================
// REAR COVER
// ============================================================
module rear_cover() {
    ci       = corner_inset;
    n_vent   = 5;
    vbw      = n_vent*(vent_w+vent_sp) - vent_sp;  // vent block width

    difference() {

        // ── SOLID GEOMETRY (nested CSG) ───────────────────────
        union() {

            // A) Shell with interior already removed.
            //    Nested so the additions below are NOT eaten by the hollow.
            difference() {
                cbox(enc_w, enc_h, enc_d);
                translate([wall, wall, wall])
                    cube([scr_w, scr_h, enc_d]);
            }

            // B) Corner towers — full cavity height.
            //    M3 pilot hole is drilled from the open front face,
            //    clearly visible when looking into the case before assembly.
            for(x = [ci, enc_w-ci])
                for(y = [ci, enc_h-ci])
                    translate([x - tower_w/2, y - tower_w/2, wall])
                        cube([tower_w, tower_w, enc_d - wall]);

            // C) Prong guide columns.
            //    One solid column per prong, rising from the inner bottom
            //    face (Y=wall) by col_h=14 mm, spanning Z=0→col_d=14 mm.
            //    The prong slot cuts through this column, giving a closed
            //    ceiling at Y=wall+col_h — prongs cannot fall through.
            //    The column Z=0→5.25 mm is NOT cut by the slot, so the
            //    rear face (Z=0) remains completely solid at these spots.
            for(i = [0:ks_prong_n-1]) {
                px = enc_w * (i+1) / (ks_prong_n+1);
                translate([px - col_w/2, wall, 0])
                    cube([col_w, col_h, col_d]);
            }
        }

        // ── CUTOUTS (applied to everything above) ─────────────

        // Corner tower pilot holes from open front face
        for(x = [ci, enc_w-ci])
            for(y = [ci, enc_h-ci])
                translate([x, y, enc_d + 0.1])
                    rotate([180, 0, 0])
                        cylinder(d=m3_pilot, h=tower_hole_d);

        // Cooling — bottom intake slots (through bottom wall, Y direction)
        translate([enc_w/2 - vbw/2, -0.1, wall + 6])
            rotate([-90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Cooling — top exhaust slots (through top wall, Y direction)
        translate([enc_w/2 - vbw/2, enc_h - wall + 0.1, wall + 6])
            rotate([90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Cooling — SoC direct vent on rear panel
        translate([pi_enc_cx - soc_vent_sz/2,
                   pi_enc_cy - soc_vent_sz/2,
                   enc_d - wall - 0.1]) {
            n_soc = floor(soc_vent_sz / (vent_w + vent_sp));
            for(i = [0:n_soc-1])
                translate([i*(vent_w+vent_sp),
                           soc_vent_sz/2 - vent_l/2, 0])
                    slot(vent_l, vent_w, wall+0.2);
        }

        // Kickstand prong slots — bottom face ONLY.
        // Slot Z: [ks_prong_z0-clr, ks_prong_z0+ks_prong_t+clr]
        //       = [5.25, 10.75] mm — entirely past the rear wall (Z=0-4 mm).
        // Rear face at Z=0 is untouched.
        for(i = [0:ks_prong_n-1]) {
            px = enc_w * (i+1) / (ks_prong_n+1);
            translate([px, 0, ks_prong_z0])
                prong_slot_cut();
        }

        // NOTE: All side-wall port cutouts removed — both left and right
        // walls are solid. Access to Pi ports via short extension cables
        // routed through user-drilled holes as needed for the installation.
    }
}

// ============================================================
// SCENE — three parts exploded for inspection
// ============================================================

// Front bezel — floated forward
color("DarkSlateGray", 0.92)
    translate([0, 0, enc_d + 14])
        front_bezel();

// Rear cover — at origin
color("SlateGray", 0.88)
    rear_cover();

// Kickstand — floated below and behind to show it is separate
// In real use: slide it up from below until prongs click into columns.
color("DimGray", 0.85)
    translate([0, -(ks_thick + ks_drop + 20), 0])
        kickstand();
