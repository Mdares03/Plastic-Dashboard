// ============================================================
// RPi5 Industrial Enclosure for Luckfox DHX-10.1" Touchscreen
// Version: 001
// ============================================================

// ── SCREEN PARAMETERS ───────────────────────────────────────
scr_w       = 236;      // screen outer width  (mm)
scr_h       = 144;      // screen outer height (mm)
scr_d       = 19;       // screen outer depth  (mm)
scr_active_w = 222;     // active area width   (mm)  ← confirm
scr_active_h = 130;     // active area height  (mm)  ← confirm
scr_mount_x  = 75;      // screen M2.5 mount pattern X (mm) ← verify
scr_mount_y  = 75;      // screen M2.5 mount pattern Y (mm) ← verify

// ── RASPBERRY PI 5 PARAMETERS ────────────────────────────────
pi_w        = 85;       // Pi board width  (mm)
pi_h        = 56;       // Pi board height (mm)
pi_d        = 17;       // Pi board depth incl. tallest component (mm)
pi_mnt_x    = 58;       // Pi mount hole pattern X (mm)
pi_mnt_y    = 49;       // Pi mount hole pattern Y (mm)
pi_standoff = 5;        // standoff height between screen rear and Pi (mm)
// Pi offset from screen center (positive = up, right)
pi_offset_x = 0;        // horizontal offset of Pi center from screen center
pi_offset_y = 5;        // vertical offset upward from screen center

// ── ENCLOSURE PARAMETERS ─────────────────────────────────────
wall        = 2.5;      // wall thickness (mm)
chamfer     = 1.5;      // external edge chamfer (mm)
recess      = 1.0;      // screen recess depth in front bezel (mm)
gap         = 0.3;      // fit clearance between bezel and rear cover

// ── VENT PARAMETERS ──────────────────────────────────────────
vent_w      = 3;        // vent slot width  (mm)
vent_l      = 20;       // vent slot length (mm)
vent_sp     = 4;        // slot pitch (edge to edge) (mm)
soc_vent_sz = 30;       // SoC vent zone size (mm sq)

// ── CABLE GLAND PARAMETERS ───────────────────────────────────
gland_count = 2;        // number of cable glands
gland_dia   = 16.5;     // M16 clearance hole diameter (mm)
gland_spacing = 40;     // spacing between gland centers (mm)

// ── PEDESTAL PARAMETERS ──────────────────────────────────────
ped_tilt    = 75;       // tilt angle from vertical (deg) — screen tilts back
ped_depth   = 80;       // foot depth front-to-back (mm)
ped_width   = 200;      // foot width (mm)
ped_thick   = 6;        // foot plate thickness (mm)
ped_brace_h = 30;       // height of triangular brace

// ── ASSEMBLY PARAMETERS ──────────────────────────────────────
m3_dia      = 3.4;      // M3 clearance hole
insert_dia  = 4.2;      // M3 heat-set insert OD
insert_h    = 6;        // heat-set insert depth

// ── DERIVED DIMENSIONS ───────────────────────────────────────
// Total rear cavity depth = standoffs + Pi + cable headroom
rear_d      = pi_standoff + pi_d + 10;  // 10 mm cable headroom
// Outer enclosure size
enc_w       = scr_w + 2*wall;
enc_h       = scr_h + 2*wall;
enc_d       = rear_d + wall;            // rear cover depth

// Pi center position relative to screen center
pi_cx = scr_w/2 + pi_offset_x;
pi_cy = scr_h/2 + pi_offset_y;

$fn = 48;

// ============================================================
// MODULES
// ============================================================

// Chamfered box (external chamfer via intersection with offset cube)
module cbox(w, h, d, c=chamfer) {
    hull() {
        translate([c,c,0])       cube([w-2*c, h-2*c, d]);
        translate([0,c,c])       cube([w,     h-2*c, d-2*c]);
        translate([c,0,c])       cube([w-2*c, h,     d-2*c]);
    }
}

// Rounded slot (for vents)
module slot(len, w, d) {
    r = w/2;
    hull() {
        translate([0, -len/2+r, 0]) cylinder(r=r, h=d);
        translate([0,  len/2-r, 0]) cylinder(r=r, h=d);
    }
}

// M2.5 mounting hole
module m25_hole(d=10) {
    cylinder(d=2.7, h=d);
}

// Heat-set insert boss + M3 hole
module insert_boss(h=insert_h+4) {
    difference() {
        cylinder(d=insert_dia+3, h=h);
        cylinder(d=insert_dia,   h=insert_h);
        translate([0,0,insert_h]) cylinder(d=m3_dia, h=h);
    }
}

// Single vent slot row (horizontal slots)
module vent_row(count, slot_len, slot_w, pitch, depth) {
    for(i=[0:count-1]) {
        translate([i*(slot_w+pitch), 0, 0])
            slot(slot_len, slot_w, depth+0.1);
    }
}

// ============================================================
// FRONT BEZEL
// ============================================================
module front_bezel() {
    difference() {
        // Outer chamfered shell
        cbox(enc_w, enc_h, wall + recess);

        // Active display window (recessed by 1 mm, then open)
        translate([(enc_w - scr_active_w)/2,
                   (enc_h - scr_active_h)/2,
                   -0.1])
            cube([scr_active_w, scr_active_h, wall + recess + 0.2]);

        // Bezel lip sits 1 mm over screen edge — recess pocket
        translate([(enc_w - scr_w)/2,
                   (enc_h - scr_h)/2,
                   wall])
            cube([scr_w, scr_h, recess + 0.1]);

        // Corner M3 screw holes (through bezel flange, 4 corners)
        for(x=[wall+6, enc_w-wall-6])
            for(y=[wall+6, enc_h-wall-6])
                translate([x, y, -0.1])
                    cylinder(d=m3_dia, h=wall+recess+0.2);
    }
}

// ============================================================
// REAR COVER
// ============================================================
module rear_cover() {
    difference() {
        union() {
            // Main body
            cbox(enc_w, enc_h, enc_d);

            // Pedestal foot (integral)
            pedestal_foot();

            // Heat-set insert bosses at 4 corners (inside)
            for(x=[wall+6, enc_w-wall-6])
                for(y=[wall+6, enc_h-wall-6])
                    translate([x, y, enc_d])
                        rotate([180,0,0])
                            insert_boss();
        }

        // Hollow interior
        translate([wall, wall, wall])
            cube([scr_w, scr_h, enc_d]);

        // ── PORT CUTOUTS ──────────────────────────────────────

        // USB-C power + 2× HDMI on LEFT edge (Pi left side)
        // Pi left edge X position in enclosure coords
        pi_left_x = pi_cx - pi_w/2 + wall;
        // USB-C power (Pi left edge, near bottom of Pi)
        translate([-0.1,
                   pi_cy - 8 + wall,
                   wall + pi_standoff + 2])
            cube([wall+0.2, 10, 10]);
        // HDMI #1
        translate([-0.1,
                   pi_cx - pi_w/2 + wall + 15,
                   wall + pi_standoff + 2])
            cube([wall+0.2, 16, 8]);
        // HDMI #2
        translate([-0.1,
                   pi_cx - pi_w/2 + wall + 34,
                   wall + pi_standoff + 2])
            cube([wall+0.2, 16, 8]);

        // Ethernet RJ45 on RIGHT edge
        translate([enc_w - wall - 0.1,
                   pi_cy + pi_h/2 - 22 + wall,
                   wall + pi_standoff + 1])
            cube([wall+0.2, 22, 16]);

        // USB-A ×4 on RIGHT edge
        translate([enc_w - wall - 0.1,
                   pi_cy - pi_h/2 + wall + 2,
                   wall + pi_standoff + 1])
            cube([wall+0.2, 50, 14]);

        // GPIO header on TOP edge
        translate([pi_cx - 30 + wall,
                   enc_h - wall - 0.1,
                   wall + pi_standoff])
            cube([52, wall+0.2, 12]);

        // USB-C touch on left side edge of SCREEN (not Pi)
        translate([-0.1, enc_h/2 - 6, wall + scr_d - 5])
            cube([wall+0.2, 12, 8]);

        // ── COOLING VENTS ──────────────────────────────────────

        // Bottom intake slots
        translate([enc_w/2 - (5*(vent_w+vent_sp))/2, -0.1, wall+8])
            rotate([-90, 0, 0])
                vent_row(5, vent_l, vent_w, vent_sp, wall+0.2);

        // Top exhaust slots
        translate([enc_w/2 - (5*(vent_w+vent_sp))/2,
                   enc_h - wall + 0.1,
                   wall+8])
            rotate([90, 0, 0])
                vent_row(5, vent_l, vent_w, vent_sp, wall+0.2);

        // SoC direct vent (rear panel, over Pi SoC area)
        // SoC assumed ~center of Pi board
        translate([pi_cx - soc_vent_sz/2 + wall,
                   pi_cy - soc_vent_sz/2 + wall,
                   enc_d - wall - 0.1]) {
            count_soc = floor(soc_vent_sz / (vent_w + vent_sp));
            for(i=[0:count_soc-1])
                translate([i*(vent_w+vent_sp), soc_vent_sz/2-vent_l/2, 0])
                    slot(vent_l, vent_w, wall+0.2);
        }

        // ── CABLE GLANDS ──────────────────────────────────────
        for(i=[0:gland_count-1]) {
            cx = enc_w/2 + (i - (gland_count-1)/2) * gland_spacing;
            translate([cx, -0.1, wall + gland_dia/2 + 4])
                rotate([-90,0,0])
                    cylinder(d=gland_dia, h=wall+0.2);
        }
    }
}

// ============================================================
// PEDESTAL FOOT (integral with rear cover)
// ============================================================
module pedestal_foot() {
    // The foot projects from the bottom of the rear cover.
    // It's a wedge that creates the tilt angle.
    // When the assembly stands on the foot, the screen tilts back ped_tilt°.
    //
    // tilt_angle from vertical → wedge front height > back height.
    // foot_front_h = ped_depth * tan(90-ped_tilt)
    foot_front_h = ped_depth * tan(90 - ped_tilt);

    foot_x0 = (enc_w - ped_width) / 2;

    translate([foot_x0, 0, 0]) {
        // Wedge base plate
        hull() {
            // Front edge (taller)
            translate([0, -ped_depth, 0])
                cube([ped_width, 0.1, foot_front_h + ped_thick]);
            // Back edge (at enc base, flush)
            translate([0, 0, 0])
                cube([ped_width, 0.1, ped_thick]);
        }

        // Triangular side braces for rigidity
        for(bx=[0, ped_width-ped_thick]) {
            translate([bx, -ped_depth, 0])
                linear_extrude(ped_thick)
                    polygon([[0,0],
                             [ped_depth, 0],
                             [ped_depth, foot_front_h]]);
        }
    }
}

// ============================================================
// RENDER — exploded assembly view
// ============================================================
// Front bezel at Z=0 (face down for printing, shown face up)
color("DarkSlateGray", 0.9)
    translate([0, 0, enc_d + 5])
        front_bezel();

// Rear cover
color("SlateGray", 0.9)
    rear_cover();
