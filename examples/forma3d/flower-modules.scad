// Petal primitive: a soft teardrop, flattened along Z.
module petal(len = 12, base_r = 2.8, tip_r = 0.6, flat = 0.65) {
    scale([1, 1, flat])
    hull() {
        sphere(r = base_r);
        translate([0, 0, len]) sphere(r = tip_r);
    }
}

// One ring. Required values deliberately remain parameters.
module ring(n, radius, len, base_r, tilt, z, phase, col) {
    color(col)
    for (i = [0 : n - 1]) {
        angle = i * 360 / n + phase;
        rotate([0, 0, angle])
        translate([radius, 0, z])
        rotate([tilt, 0, 0])
            petal(len, base_r);
    }
}

// Centre bud.
module bud() {
    color([0.55, 0.05, 0.45])
    for (i = [0 : 7]) {
        rotate([0, 0, i * 45])
        translate([1.6, 0, 3])
        rotate([20, 0, 0])
        scale([1, 1, 0.55])
        hull() {
            sphere(r = 1.5);
            translate([0, 0, 5]) sphere(r = 0.4);
        }
    }
    color([0.35, 0.0, 0.30])
    cylinder(h = 6, r1 = 2.4, r2 = 0.9, center = false);
}

module stem() {
    color([0.22, 0.42, 0.18])
    translate([0, 0, -55])
        cylinder(h = 55, r1 = 1.3, r2 = 1.0, center = false);
}
