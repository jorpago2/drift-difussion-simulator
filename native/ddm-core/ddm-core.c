static double ddm_abs(double value) {
  return value < 0.0 ? -value : value;
}

static double ddm_clamp(double value, double low, double high) {
  return value < low ? low : (value > high ? high : value);
}

__attribute__((export_name("poisson_relax")))
double poisson_relax(
  int nx,
  int ny,
  int potential_ptr,
  int electron_ptr,
  int hole_ptr,
  int dopant_ptr,
  int eps_rel_ptr,
  int material_ptr,
  int contact_mask_ptr,
  int contact_potential_ptr,
  double poisson_scale,
  double omega,
  int sweeps
) {
  double *potential = (double *)(unsigned long)potential_ptr;
  double *electron = (double *)(unsigned long)electron_ptr;
  double *hole = (double *)(unsigned long)hole_ptr;
  double *dopant = (double *)(unsigned long)dopant_ptr;
  double *eps_rel = (double *)(unsigned long)eps_rel_ptr;
  double *contact_potential = (double *)(unsigned long)contact_potential_ptr;
  unsigned char *material = (unsigned char *)(unsigned long)material_ptr;
  unsigned char *contact_mask = (unsigned char *)(unsigned long)contact_mask_ptr;
  double max_delta = 0.0;

  for (int sweep = 0; sweep < sweeps; sweep += 1) {
    for (int y = 0; y < ny; y += 1) {
      for (int x = 0; x < nx; x += 1) {
        int i = y * nx + x;

        if (contact_mask[i] != 0) {
          double delta = contact_potential[i] - potential[i];
          potential[i] = contact_potential[i];
          double abs_delta = ddm_abs(delta);
          if (abs_delta > max_delta) max_delta = abs_delta;
          continue;
        }

        double eps_center = eps_rel[i];
        double weighted_potential = 0.0;
        double weight = 0.0;

        if (x > 0) {
          int j = i - 1;
          double edge = 0.5 * (eps_center + eps_rel[j]);
          weighted_potential += edge * potential[j];
          weight += edge;
        }
        if (x + 1 < nx) {
          int j = i + 1;
          double edge = 0.5 * (eps_center + eps_rel[j]);
          weighted_potential += edge * potential[j];
          weight += edge;
        }
        if (y > 0) {
          int j = i - nx;
          double edge = 0.5 * (eps_center + eps_rel[j]);
          weighted_potential += edge * potential[j];
          weight += edge;
        }
        if (y + 1 < ny) {
          int j = i + nx;
          double edge = 0.5 * (eps_center + eps_rel[j]);
          weighted_potential += edge * potential[j];
          weight += edge;
        }
        if (weight <= 0.0) continue;

        double charge_norm = material[i] == 1 ? hole[i] - electron[i] + dopant[i] : 0.0;
        double target = (weighted_potential + poisson_scale * charge_norm) / weight;
        double delta = ddm_clamp((target - potential[i]) * omega, -1.0, 1.0);
        potential[i] += delta;

        double abs_delta = ddm_abs(delta);
        if (abs_delta > max_delta) max_delta = abs_delta;
      }
    }
  }

  return max_delta;
}
