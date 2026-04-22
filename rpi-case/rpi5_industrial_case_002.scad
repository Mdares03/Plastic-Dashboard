// ============================================================
// RPi5 Industrial Enclosure — Luckfox DHX-10.1" Touchscreen
// Version: 002
//   Fixes vs 001:
//     1. Pedestal foot now projects from REAR FACE in -Z direction
//     2. Tilt wedge orientation corrected (leans screen back, not forward)
//     3. Cable glands moved to rear panel face (foot owns the bottom edge)
//     4. GPIO cutout repositioned to match Pi board top-edge location
//     5. Port cutout Z-depths corrected using pi_enc_cx/cy consistently
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w        = 236;    // screen outer width  (mm)
scr_h        = 144;    // screen outer height (mm)
scr_d        = 19;     // screen outer depth  (mm)
scr_active_w = 222;    // active area width   (mm)  ← confirm
scr_active_h = 130;    // active area height  (mm)  ← confirm
scr_mount_x  = 75;     // screen rear M2.5 mount pattern X (mm) ← verify
scr_mount_y  = 75;     // screen rear M2.5 mount pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w         = 85;     // Pi board width  (mm)
pi_h         = 56;     // Pi board height (mm)
pi_d         = 17;     // Pi board depth incl. tallest component (mm)
pi_mnt_x     = 58;     // Pi mount hole pattern X (mm)
pi_mnt_y     = 49;     // Pi mount hole pattern Y (mm)
pi_standoff  = 5;      // standoff height: screen rear → Pi board (mm)
pi_offset_x  = 0;      // Pi centre horizontal offset from screen centre (mm)
pi_offset_y  = 5;      // Pi centre vertical offset upward from screen centre (mm)

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall         = 2.5;    // wall thickness (mm)
chamfer      = 1.5;    // external edge chamfer (mm)
recess       = 1.0;    // screen recess depth in front bezel (mm)
gap          = 0.3;    // bezel ↔ rear cover fit clearance (mm)

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w       = 3;      // vent slot width  (mm)
vent_l       = 20;     // vent slot length (mm)
vent_sp      = 4;      // slot spacing edge-to-edge (mm)
soc_vent_sz  = 30;     // SoC direct-vent zone size (mm, square)

// ── CABLE GLAND PARAMETERS ───────────────────────────────────
gland_count  = 2;      // number of M16 cable glands
gland_dia    = 16.5;   // M16 clearance hole diameter (mm)
gland_spacing= 40;     // centre-to-centre spacing (mm)

// ── PEDESTAL PARAMETERS ──────────────────────────────────────
// ped_tilt = angle of screen from horizontal (deg).
//   75° from horizontal = 15° lean-back from vertical (near-upright monitor stance).
//   The foot is a wedge that, when flat on a desk, holds the rear cover at
//   (90 - ped_tilt)° from vertical.
ped_tilt     = 75;     // screen angle from horizontal (deg)
ped_depth    = 80;     // foot plate depth front-to-back (mm)
ped_width    = 200;    // foot plate width (mm)
ped_thick    = 6;      // foot plate thickness (mm)

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia       = 3.4;    // M3 clearance hole diameter (mm)
insert_dia   = 4.2;    // M3 heat-set insert OD (mm)
insert_h     = 6;      // heat-set insert depth (mm)

// ── DERIVED DIMENSIONS (do not edit) ─────────────────────────
rear_d    = pi_standoff + pi_d + 10;   // rear cavity depth (10 mm cable headroom)
enc_w     = scr_w + 2*wall;            // enclosure outer width
enc_h     = scr_h + 2*wall;            // enclosure outer height
enc_d     = rear_d + wall;             // rear cover total depth

// Pi centre in enclosure coordinates (enclosure origin = rear-cover corner)
pi_enc_cx = wall + scr_w/2 + pi_offset_x;   // = 120.5 with defaults
pi_enc_cy = wall + scr_h/2 + pi_offset_y;   // =  79.5 with defaults

// Z position of Pi board surface (measured from rear of rear cover)
pi_z      = wall + pi_standoff;              // = 7.5 with defaults

// Foot wedge geometry
// foot_drop: how far the far tip drops below Y=0 so the bottom surface
//   becomes horizontal when the unit stands at ped_tilt from horizontal.
foot_drop = ped_depth * tan(90 - ped_tilt);  // ≈ 21.4 mm for ped_tilt=75

$fn = 48;

// ============================================================
// PRIMITIVES
// ============================================================

// Chamfered box — chamfer on all 12 edges via hull of 3 axis-aligned cubes
module cbox(w, h, d, c=chamfer) {
    hull() {
        translate([c,c,0])   cube([w-2*c, h-2*c, d      ]);
        translate([0,c,c])   cube([w,     h-2*c, d-2*c  ]);
        translate([c,0,c])   cube([w-2*c, h,     d-2*c  ]);
    }
}

// Rounded-end vent slot, length along Y, centred at origin
module slot(len, w, d) {
    r = w/2;
    hull() {
        translate([0, -len/2+r, 0]) cylinder(r=r, h=d);
        translate([0,  len/2-r, 0]) cylinder(r=r, h=d);
    }
}

// Row of n vent slots along X
module vent_row(n, len, w, spacing, depth) {
    for(i=[0:n-1])
        translate([i*(w+spacing), 0, 0])
            slot(len, w, depth);
}

// Heat-set insert boss (M3)
module insert_boss(h=insert_h+4) {
    difference() {
        cylinder(d=insert_dia+3, h=h);
        cylinder(d=insert_dia,   h=insert_h);
        translate([0,0,insert_h]) cylinder(d=m3_dia, h=h);
    }
}

// ============================================================
// PEDESTAL FOOT  (integral with rear cover, no supports needed)
// ============================================================
// Geometry in model space (rear cover lying on its back, rear face = Z=0):
//   • Foot extends in the -Z direction from Z=0 (behind the rear face)
//   • Top surface is flush with the enclosure bottom at Y=0
//   • Bottom surface is angled: at Z=0 it is ped_thick below Y=0;
//     at Z=-ped_depth it is (ped_thick + foot_drop) below Y=0.
//   • When the unit stands on the desk the angled surface lies flat and the
//     screen tilts back (90-ped_tilt)° from vertical.
//   • Print orientation: rear cover face-down (foot on bed), zero supports.
module pedestal_foot() {
    foot_x0 = (enc_w - ped_width) / 2;

    translate([foot_x0, 0, 0]) {
        // Main wedge plate
        hull() {
            translate([0, -ped_thick,             0        ])
                cube([ped_width, ped_thick,       wall     ]);
            translate([0, -(ped_thick+foot_drop), -ped_depth])
                cube([ped_width, ped_thick+foot_drop, wall ]);
        }
        // Left and right stiffening ribs
        for(bx = [0, ped_width - ped_thick]) {
            hull() {
                translate([bx, -ped_thick,              0        ])
                    cube([ped_thick, ped_thick,          wall     ]);
                translate([bx, -(ped_thick+foot_drop),  -ped_depth])
                    cube([ped_thick, ped_thick+foot_drop, wall   ]);
                // Toe point keeps underside triangular (no saggy bridge)
                translate([bx, -ped_thick,              -ped_depth])
                    cube([ped_thick, ped_thick,           wall   ]);
            }
        }
    }
}

// ============================================================
// FRONT BEZEL
// ============================================================
module front_bezel() {
    difference() {
        cbox(enc_w, enc_h, wall + recess);

        // Active display window (full cut-through)
        translate([(enc_w-scr_active_w)/2, (enc_h-scr_active_h)/2, -0.1])
            cube([scr_active_w, scr_active_h, wall+recess+0.2]);

        // Recess pocket so bezel lip sits 1 mm over screen edge
        translate([(enc_w-scr_w)/2, (enc_h-scr_h)/2, wall])
            cube([scr_w, scr_h, recess+0.1]);

        // M3 corner screw holes (4×)
        for(x = [wall+6, enc_w-wall-6])
            for(y = [wall+6, enc_h-wall-6])
                translate([x, y, -0.1]) cylinder(d=m3_dia, h=wall+recess+0.2);
    }
}

// ============================================================
// REAR COVER
// ============================================================
module rear_cover() {
    n_vent = 6;
    vent_block_w = n_vent*(vent_w+vent_sp) - vent_sp;  // total width of vent array

    difference() {
        union() {
            cbox(enc_w, enc_h, enc_d);
            pedestal_foot();

            // M3 insert bosses at 4 corners (inner face)
            for(x = [wall+6, enc_w-wall-6])
                for(y = [wall+6, enc_h-wall-6])
                    translate([x, y, enc_d])
                        rotate([180,0,0]) insert_boss();
        }

        // ── HOLLOW INTERIOR ───────────────────────────────────
        translate([wall, wall, wall]) cube([scr_w, scr_h, enc_d]);

        // ── LEFT WALL: USB-C power + HDMI ×2 ─────────────────
        // These are on the Pi's left short-edge (56 mm face), facing X=0.
        // Cutout Y-centre is set near the Pi's lower half.
        // Z positions follow port heights above PCB surface.
        // (Short ribbon extensions needed to reach the wall at X=0.)
        //
        // USB-C power
        translate([-0.1,
                   pi_enc_cy - pi_h/2 + 3,
                   pi_z + 2])
            cube([wall+0.2, 11, 11]);
        // HDMI 0
        translate([-0.1,
                   pi_enc_cy - pi_h/2 + 16,
                   pi_z + 2])
            cube([wall+0.2, 17, 9]);
        // HDMI 1
        translate([-0.1,
                   pi_enc_cy - pi_h/2 + 35,
                   pi_z + 2])
            cube([wall+0.2, 17, 9]);

        // ── RIGHT WALL: RJ45 + USB-A ×4 ──────────────────────
        // RJ45 (top of Pi right edge in board orientation)
        translate([enc_w-wall-0.1,
                   pi_enc_cy + pi_h/2 - 24,
                   pi_z + 1])
            cube([wall+0.2, 22, 16]);
        // USB-A ×4 (two stacked pairs, below RJ45 on right edge)
        translate([enc_w-wall-0.1,
                   pi_enc_cy - pi_h/2 + 2,
                   pi_z + 1])
            cube([wall+0.2, 50, 15]);

        // ── TOP WALL: GPIO header (40-pin) ────────────────────
        // GPIO is on the Pi's top long edge (85 mm edge at Y = pi_enc_cy + pi_h/2).
        // Cutout aligns with the header strip X-extent (51 mm) centred on Pi.
        // Z-extent: board surface + header height (~11 mm).
        translate([pi_enc_cx - 26,
                   pi_enc_cy + pi_h/2 - 0.1,
                   pi_z])
            cube([52, wall+0.2, 11]);

        // ── USB-C TOUCH: screen side edge (left, near screen depth) ───
        translate([-0.1,
                   enc_h/2 - 6,
                   wall + scr_d - 5])
            cube([wall+0.2, 12, 8]);

        // ── COOLING VENTS ─────────────────────────────────────

        // Bottom intake slots (6 × 3×20 mm, 4 mm spacing)
        translate([enc_w/2 - vent_block_w/2,
                   -0.1,
                   wall + 8])
            rotate([-90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Top exhaust slots
        translate([enc_w/2 - vent_block_w/2,
                   enc_h - wall + 0.1,
                   wall + 8])
            rotate([90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // SoC direct-vent array on rear panel, centred over Pi SoC
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

        // ── CABLE GLANDS: rear panel face, bottom area ────────
        // Two M16 glands through the rear face (Z=0 plane).
        // Positioned below the Pi, above the foot junction.
        for(i = [0:gland_count-1]) {
            cx = enc_w/2 + (i - (gland_count-1)/2) * gland_spacing;
            translate([cx,
                       wall + gland_dia/2 + 4,
                       -0.1])
                cylinder(d=gland_dia, h=wall+0.2);
        }
    }
}

// ============================================================
// RENDER — exploded assembly (front bezel floats above rear cover)
// ============================================================
color("DarkSlateGray", 0.9)
    translate([0, 0, enc_d + 10])
        front_bezel();

color("SlateGray", 0.85)
    rear_cover();
