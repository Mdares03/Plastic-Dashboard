// ============================================================
// RPi5 Industrial Enclosure — Luckfox DHX-10.1" Touchscreen
// Version: 003
//   Fixes vs 002:
//     1. Kickstand completely redesigned — shorter, thinner, clearly
//        attached to rear cover bottom, triangular gussets on each side
//     2. GPIO top-wall cutout removed (GPIO is fully internal; access
//        requires removing the rear cover, correct for industrial use)
//     3. Pi cavity depth verified and annotated
//     4. Bezel two-piece connection: corner bosses on rear cover +
//        matching through-holes on bezel — intentional removable joint
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w        = 236;    // screen outer width  (mm)
scr_h        = 144;    // screen outer height (mm)
scr_d        = 19;     // screen outer depth  (mm)
scr_active_w = 222;    // active area width   (mm)  ← confirm with screen datasheet
scr_active_h = 130;    // active area height  (mm)  ← confirm with screen datasheet
scr_mount_x  = 75;     // screen rear M2.5 hole pattern X (mm) ← verify
scr_mount_y  = 75;     // screen rear M2.5 hole pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w         = 85;     // Pi board width  (mm)
pi_h         = 56;     // Pi board height (mm)
pi_d         = 17;     // Pi board + tallest component height (mm)
pi_mnt_x     = 58;     // Pi mount hole pattern X (mm)
pi_mnt_y     = 49;     // Pi mount hole pattern Y (mm)
pi_standoff  = 5;      // standoff height: screen rear face → Pi PCB (mm)
pi_offset_x  = 0;      // Pi centre X offset from screen centre (mm)
pi_offset_y  = 5;      // Pi centre Y offset upward from screen centre (mm)

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall         = 2.5;    // wall thickness throughout (mm)
chamfer      = 1.5;    // external edge chamfer size (mm)
recess       = 1.0;    // screen recess depth in front bezel (mm)
gap          = 0.3;    // bezel ↔ rear cover fit clearance (mm)

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w       = 3;      // vent slot width  (mm)
vent_l       = 20;     // vent slot length (mm)
vent_sp      = 4;      // slot gap edge-to-edge (mm)
soc_vent_sz  = 30;     // SoC direct-vent zone size (mm, square)

// ── CABLE GLAND PARAMETERS ───────────────────────────────────
gland_count  = 2;      // number of M16 cable glands
gland_dia    = 16.5;   // M16 clearance hole diameter (mm)
gland_spacing= 40;     // centre-to-centre spacing (mm)

// ── KICKSTAND PARAMETERS ─────────────────────────────────────
// The kickstand is a flat plate + two triangular gussets, integral
// with the rear cover bottom.  When the unit stands on the kickstand
// the plate lies flat on the desk and the screen tilts back
// (90 - ks_tilt) degrees from vertical.
ks_tilt      = 75;     // screen angle from horizontal when standing (deg)
                       //   75° from horiz = 15° lean-back from vertical
ks_depth     = 55;     // plate reach behind rear face (mm) — shorter than 002
ks_width     = 180;    // plate span across enclosure width (mm)
ks_thick     = 5;      // plate thickness (mm)
ks_gusset_h  = 30;     // gusset height up the rear cover face (mm)

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia       = 3.4;    // M3 clearance hole (mm)
insert_dia   = 4.2;    // M3 heat-set insert OD (mm)
insert_h     = 6;      // heat-set insert depth (mm)
boss_od      = insert_dia + 3.5; // insert boss outer diameter (mm)
corner_inset = wall + boss_od/2 + 1; // corner boss/hole X and Y inset (mm)

// ── DERIVED DIMENSIONS ───────────────────────────────────────
//
// Rear cavity depth check:
//   pi_standoff (5) + pi_d (17) + cable headroom (10) = 32 mm  → rear_d
//   rear_d is the full depth of the rear cover cavity.
//   The screen body (scr_d=19 mm) is NOT included in rear_d;
//   the rear cover encloses only the space BEHIND the screen rear face.
//
rear_d       = pi_standoff + pi_d + 10;  // = 32 mm, Pi fits with 10 mm to spare
enc_w        = scr_w + 2*wall;           // enclosure outer width  (241 mm)
enc_h        = scr_h + 2*wall;           // enclosure outer height (149 mm)
enc_d        = rear_d + wall;            // rear cover total depth  ( 34.5 mm)

// Pi centre in enclosure XY coordinates (wall-offset from screen centre)
pi_enc_cx    = wall + scr_w/2 + pi_offset_x;   // 120.5 mm with defaults
pi_enc_cy    = wall + scr_h/2 + pi_offset_y;   //  79.5 mm with defaults

// Z of Pi PCB surface, measured from rear cover rear face
pi_z         = wall + pi_standoff;              //   7.5 mm with defaults

// Kickstand tip drop: how far below Y=0 the far edge must sit so the
// bottom surface is horizontal when the unit tilts to ks_tilt from horizontal
ks_drop      = ks_depth * tan(90 - ks_tilt);   // ≈ 14.7 mm for ks_tilt=75

$fn = 48;

// ============================================================
// PRIMITIVES
// ============================================================

// Chamfered rectangular box (all 12 edges, chamfer = c)
module cbox(w, h, d, c=chamfer) {
    hull() {
        translate([c, c, 0]) cube([w-2*c, h-2*c, d      ]);
        translate([0, c, c]) cube([w,     h-2*c, d-2*c  ]);
        translate([c, 0, c]) cube([w-2*c, h,     d-2*c  ]);
    }
}

// Rounded-end vent slot: length along Y, width w, extrudes in +Z by d
module slot(len, w, d) {
    r = w/2;
    hull() {
        translate([0, -len/2+r, 0]) cylinder(r=r, h=d);
        translate([0,  len/2-r, 0]) cylinder(r=r, h=d);
    }
}

// Row of n vent slots stepping in X
module vent_row(n, len, w, spacing, depth) {
    for(i = [0:n-1])
        translate([i*(w+spacing), 0, 0])
            slot(len, w, depth);
}

// M3 heat-set insert boss (sits proud from an inner face)
module insert_boss(total_h = insert_h + 4) {
    difference() {
        cylinder(d=boss_od, h=total_h);
        cylinder(d=insert_dia, h=insert_h);
        translate([0,0,insert_h]) cylinder(d=m3_dia, h=total_h);
    }
}

// ============================================================
// KICKSTAND
// ============================================================
// Geometry (all in rear-cover model space, rear face = Z=0 plane):
//
//   Side view (Y-Z plane):
//
//   Y=ks_gusset_h ─┐
//                   │  ← gusset strip on rear face
//   Y=0  ───────────┼──────────────────────────────────── rear cover bottom
//                   │╲   ← gusset triangle
//           plate ──┼─╲──────────────────────────────────────────
//           (ks_thick)│  ╲  (sloping, thicker at tip)
//                      ╲  ╲___________________________________
//   Y=-(ks_thick+ks_drop)                                Z=-ks_depth
//
// The plate and gussets are extruded across ks_width in X.
// The gussets (hull triangles) brace the plate against the rear face,
// preventing the kickstand from snapping off at the root.
//
module kickstand() {
    ks_x0 = (enc_w - ks_width) / 2;

    translate([ks_x0, 0, 0]) {

        // ── Main plate ────────────────────────────────────────
        // Wedge: root at Z=0 is ks_thick tall;
        //        tip  at Z=-ks_depth is (ks_thick+ks_drop) tall.
        // Top surface flush with enclosure bottom (Y=0).
        hull() {
            // Root strip — along rear face
            translate([0, -ks_thick, 0])
                cube([ks_width, ks_thick, wall]);
            // Tip strip — at full reach, thicker to keep plate horizontal
            translate([0, -(ks_thick + ks_drop), -ks_depth])
                cube([ks_width, ks_thick + ks_drop, wall]);
        }

        // ── Triangular gussets (left + right ends) ────────────
        // Each gusset is a hull of three patches:
        //   A  – vertical strip up the rear face (height = ks_gusset_h)
        //   B  – small square at plate root (Y=-ks_thick, Z=0)
        //   C  – small square at plate tip  (Y=-(ks_thick+ks_drop), Z=-ks_depth)
        for(bx = [0, ks_width - ks_thick]) {
            hull() {
                // A: attachment strip going up the rear face
                translate([bx, 0, -wall])
                    cube([ks_thick, ks_gusset_h, wall]);
                // B: plate root corner
                translate([bx, -ks_thick, -wall])
                    cube([ks_thick, ks_thick, wall]);
                // C: plate tip corner
                translate([bx, -(ks_thick + ks_drop), -ks_depth])
                    cube([ks_thick, ks_thick, wall]);
            }
        }
    }
}

// ============================================================
// FRONT BEZEL
// ============================================================
// Two-piece design: bezel + rear cover join with M3 screws through
// the bezel corners into heat-set inserts in the rear cover bosses.
// The bezel is intentionally removable for Pi access.
module front_bezel() {
    difference() {
        cbox(enc_w, enc_h, wall + recess);

        // Active display window (full depth cut)
        translate([(enc_w - scr_active_w)/2,
                   (enc_h - scr_active_h)/2,
                   -0.1])
            cube([scr_active_w, scr_active_h, wall+recess+0.2]);

        // 1 mm recess pocket — bezel lip grips screen edge
        translate([(enc_w - scr_w)/2,
                   (enc_h - scr_h)/2,
                   wall])
            cube([scr_w, scr_h, recess+0.1]);

        // M3 screw clearance holes at 4 corners
        for(x = [corner_inset, enc_w - corner_inset])
            for(y = [corner_inset, enc_h - corner_inset])
                translate([x, y, -0.1])
                    cylinder(d=m3_dia, h=wall+recess+0.2);
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
            // Main body
            cbox(enc_w, enc_h, enc_d);

            // Kickstand (integral, no supports needed — prints face-down)
            kickstand();

            // Insert bosses at 4 corners (inner rear face, flush with enc_d)
            for(x = [corner_inset, enc_w - corner_inset])
                for(y = [corner_inset, enc_h - corner_inset])
                    translate([x, y, enc_d])
                        rotate([180, 0, 0])
                            insert_boss();
        }

        // ── HOLLOW INTERIOR ───────────────────────────────────
        // Cavity = full screen footprint, from wall to enc_d (open toward bezel)
        translate([wall, wall, wall])
            cube([scr_w, scr_h, enc_d]);

        // ── PORT CUTOUTS ──────────────────────────────────────
        // NOTE: The Pi's port edges are internal (Pi centred on screen).
        // Cutouts in the enclosure walls are reference openings for
        // short cable extensions routed to the wall. Adjust Y/Z offsets
        // to match your exact cable routing once screen mount is verified.

        // LEFT WALL — USB-C power + HDMI ×2
        // Approximate Y positions relative to Pi bottom edge
        pi_bot  = pi_enc_cy - pi_h/2;
        // USB-C power
        translate([-0.1, pi_bot + 3,  pi_z + 2]) cube([wall+0.2, 11, 11]);
        // HDMI 0
        translate([-0.1, pi_bot + 16, pi_z + 2]) cube([wall+0.2, 17,  9]);
        // HDMI 1
        translate([-0.1, pi_bot + 35, pi_z + 2]) cube([wall+0.2, 17,  9]);

        // RIGHT WALL — RJ45 + USB-A ×4
        pi_top  = pi_enc_cy + pi_h/2;
        // RJ45
        translate([enc_w-wall-0.1, pi_top - 24, pi_z + 1])
            cube([wall+0.2, 22, 16]);
        // USB-A ×4 (two stacked pairs)
        translate([enc_w-wall-0.1, pi_bot + 2,  pi_z + 1])
            cube([wall+0.2, 50, 15]);

        // BOTTOM WALL — USB-C touch connector on screen side edge
        // (screen's own USB-C touch port, not Pi — sits at screen depth)
        translate([-0.1,
                   enc_h/2 - 6,
                   wall + scr_d - 5])
            cube([wall+0.2, 12, 8]);

        // ── COOLING VENTS ─────────────────────────────────────

        // Bottom intake — 6 slots through bottom wall
        translate([enc_w/2 - vent_block_w/2, -0.1, wall + 8])
            rotate([-90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // Top exhaust — 6 slots through top wall
        translate([enc_w/2 - vent_block_w/2,
                   enc_h - wall + 0.1,
                   wall + 8])
            rotate([90, 0, 0])
                vent_row(n_vent, vent_l, vent_w, vent_sp, wall+0.2);

        // SoC direct-vent — slot array in rear panel centred over Pi SoC
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
        // Two M16 glands through the rear face (Z=0 plane).
        // Positioned below Pi, above kickstand root.
        for(i = [0:gland_count-1]) {
            cx = enc_w/2 + (i - (gland_count-1)/2) * gland_spacing;
            translate([cx, wall + gland_dia/2 + 4, -0.1])
                cylinder(d=gland_dia, h=wall+0.2);
        }
    }
}

// ============================================================
// SCENE — exploded assembly view
//   Front bezel floats above rear cover to show the joint
// ============================================================
color("DarkSlateGray", 0.9)
    translate([0, 0, enc_d + 12])
        front_bezel();

color("SlateGray", 0.85)
    rear_cover();
