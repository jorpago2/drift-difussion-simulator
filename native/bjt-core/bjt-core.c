#define Q 1.602176634e-19
#define EPS0 8.8541878128e-12
#define DOUBLE_EPSILON 2.2204460492503131e-16
#define DOUBLE_MIN 4.9406564584124654e-324
#define MAX_EXPONENT 80.0
#define MAX_BIAS_STEP_V 0.1

#define CONTACT_NONE 0
#define CONTACT_EMITTER 1
#define CONTACT_BASE 2
#define CONTACT_COLLECTOR 3

#define ARRAY_POTENTIAL 0
#define ARRAY_ELECTRON 1
#define ARRAY_HOLE 2
#define ARRAY_DOPANT 3
#define ARRAY_VOLUME 4
#define ARRAY_WEST 5
#define ARRAY_EAST 6
#define ARRAY_NORTH 7
#define ARRAY_SOUTH 8
#define ARRAY_OLD_POTENTIAL 9
#define ARRAY_OLD_ELECTRON 10
#define ARRAY_OLD_HOLE 11
#define ARRAY_CANDIDATE_POTENTIAL 12
#define ARRAY_CANDIDATE_ELECTRON 13
#define ARRAY_CANDIDATE_HOLE 14
#define ARRAY_ETA_ELECTRON 15
#define ARRAY_ETA_HOLE 16
#define ARRAY_DIAGONAL 17
#define ARRAY_RHS 18
#define ARRAY_SOLUTION 19
#define ARRAY_RESIDUAL 20
#define ARRAY_PRECONDITIONED 21
#define ARRAY_DIRECTION 22
#define ARRAY_PRODUCT 23
#define ARRAY_COUNT 24

#define PARAM_LENGTH_M 0
#define PARAM_HEIGHT_M 1
#define PARAM_EMITTER_WIDTH_M 2
#define PARAM_BASE_WIDTH_M 3
#define PARAM_EMITTER_DOPING_NORM 4
#define PARAM_BASE_DOPING_NORM 5
#define PARAM_COLLECTOR_DOPING_NORM 6
#define PARAM_THERMAL_VOLTAGE_V 7
#define PARAM_INTRINSIC_M3 8
#define PARAM_RELATIVE_PERMITTIVITY 9
#define PARAM_ELECTRON_MOBILITY 10
#define PARAM_HOLE_MOBILITY 11
#define PARAM_ELECTRON_LIFETIME_S 12
#define PARAM_HOLE_LIFETIME_S 13
#define PARAM_TARGET_VBE_V 14
#define PARAM_TARGET_VCE_V 15
#define PARAM_MAX_ITERATIONS 16
#define PARAM_RESIDUAL_TOLERANCE 17
#define PARAM_CONSERVATION_TOLERANCE 18
#define PARAM_PREVIOUS_VBE_V 19
#define PARAM_PREVIOUS_VCE_V 20
#define PARAM_PREVIOUS_DAMPING 21
#define PARAM_PREVIOUS_TOTAL_ITERATIONS 22

#define DIAG_CONVERGED 0
#define DIAG_ITERATIONS 1
#define DIAG_TOTAL_ITERATIONS 2
#define DIAG_DAMPING 3
#define DIAG_POISSON_RESIDUAL 4
#define DIAG_ELECTRON_RESIDUAL 5
#define DIAG_HOLE_RESIDUAL 6
#define DIAG_KCL_ERROR 7
#define DIAG_KCL_ABSOLUTE_AM 8
#define DIAG_KCL_TOLERANCE_AM 9
#define DIAG_ELECTRON_BALANCE 10
#define DIAG_HOLE_BALANCE 11
#define DIAG_RECOMBINATION_AM 12
#define DIAG_EMITTER_ELECTRON_AM 13
#define DIAG_EMITTER_HOLE_AM 14
#define DIAG_EMITTER_TOTAL_AM 15
#define DIAG_BASE_ELECTRON_AM 16
#define DIAG_BASE_HOLE_AM 17
#define DIAG_BASE_TOTAL_AM 18
#define DIAG_COLLECTOR_ELECTRON_AM 19
#define DIAG_COLLECTOR_HOLE_AM 20
#define DIAG_COLLECTOR_TOTAL_AM 21
#define DIAG_FINAL_VBE_V 22
#define DIAG_FINAL_VCE_V 23
#define DIAG_STATUS_CODE 24
#define DIAG_LINEAR_ITERATIONS 25
#define DIAG_COUNT 26

#ifdef NPN_USE_LIBM
#include <math.h>
#define host_exp exp
#define host_log log
#else
extern double host_exp(double value)
  __attribute__((import_module("env"), import_name("exp")));
extern double host_log(double value)
  __attribute__((import_module("env"), import_name("log")));
#endif

typedef struct {
  double poisson_residual;
  double electron_residual;
  double hole_residual;
  double terminal_kcl_error;
  double terminal_kcl_absolute_am;
  double terminal_kcl_tolerance_am;
  double electron_balance_error;
  double hole_balance_error;
  double integrated_recombination_am;
  double terminal_currents_am[9];
} Metrics;

typedef struct {
  int nx;
  int ny;
  int size;
  int capacity;
  int max_iterations;
  int iterations;
  int total_iterations;
  int linear_iterations;
  int converged;
  int status_code;
  double length_m;
  double height_m;
  double dx_m;
  double dy_m;
  double emitter_width_m;
  double base_width_m;
  double collector_width_m;
  double thermal_voltage_v;
  double intrinsic_m3;
  double relative_permittivity;
  double electron_mobility;
  double hole_mobility;
  double electron_lifetime_s;
  double hole_lifetime_s;
  double residual_tolerance;
  double conservation_tolerance;
  double target_vbe_v;
  double target_vce_v;
  double vbe_v;
  double vce_v;
  double damping;
  double *arrays;
  unsigned char *contact;
  Metrics metrics;
} State;

static double dd_abs(double value) {
  return value < 0.0 ? -value : value;
}

static double dd_max(double left, double right) {
  return left > right ? left : right;
}

static double dd_min(double left, double right) {
  return left < right ? left : right;
}

static double dd_clamp(double value, double low, double high) {
  return value < low ? low : (value > high ? high : value);
}

static int dd_finite(double value) {
  return value == value && value <= 1.7976931348623157e308 &&
    value >= -1.7976931348623157e308;
}

static double dd_sqrt(double value) {
  return __builtin_sqrt(value);
}

static double dd_exp_safe(double value) {
  return host_exp(dd_clamp(value, -MAX_EXPONENT, MAX_EXPONENT));
}

static double dd_expm1(double value) {
  double absolute = dd_abs(value);
  if (absolute < 1e-5) {
    double square = value * value;
    return value + 0.5 * square + value * square / 6.0 +
      square * square / 24.0 + value * square * square / 120.0;
  }
  return host_exp(value) - 1.0;
}

static double dd_bernoulli(double value) {
  double absolute = dd_abs(value);
  if (absolute < 1e-5) {
    double square = value * value;
    return 1.0 - value / 2.0 + square / 12.0 - square * square / 720.0;
  }
  if (value > MAX_EXPONENT) return value * host_exp(-value);
  if (value < -MAX_EXPONENT) return -value;
  return value / (host_exp(value) - 1.0);
}

static double *array_at(State *state, int array_index) {
  return state->arrays + array_index * state->capacity;
}

static void fill_array(double *values, int size, double value) {
  int index;
  for (index = 0; index < size; index += 1) values[index] = value;
}

static void copy_array(double *target, const double *source, int size) {
  int index;
  for (index = 0; index < size; index += 1) target[index] = source[index];
}

static int finite_array(const double *values, int size) {
  int index;
  for (index = 0; index < size; index += 1) {
    if (!dd_finite(values[index])) return 0;
  }
  return 1;
}

static void neutral_carrier_pair(
  double dopant,
  double *electron,
  double *hole,
  double *potential
) {
  double root = dd_sqrt(dopant * dopant + 4.0);
  if (dopant >= 0.0) {
    *electron = 0.5 * (dopant + root);
    *hole = 1.0 / *electron;
  } else {
    *hole = 0.5 * (-dopant + root);
    *electron = 1.0 / *hole;
  }
  *potential = host_log(*electron);
}

static int neighbor_index(State *state, int index, int direction) {
  int ix = index % state->nx;
  int iy = index / state->nx;
  if (direction == 0) return ix > 0 ? index - 1 : -1;
  if (direction == 1) return ix + 1 < state->nx ? index + 1 : -1;
  if (direction == 2) return iy > 0 ? index - state->nx : -1;
  return iy + 1 < state->ny ? index + state->nx : -1;
}

static double neighbor_geometry(State *state, int index, int direction) {
  if (direction == 0) return array_at(state, ARRAY_WEST)[index];
  if (direction == 1) return array_at(state, ARRAY_EAST)[index];
  if (direction == 2) return array_at(state, ARRAY_NORTH)[index];
  return array_at(state, ARRAY_SOUTH)[index];
}

static double contact_voltage(State *state, unsigned char contact_id) {
  if (contact_id == CONTACT_BASE) return state->vbe_v;
  if (contact_id == CONTACT_COLLECTOR) return state->vce_v;
  return 0.0;
}

static void create_geometry(State *state, const double *parameters) {
  double *dopant = array_at(state, ARRAY_DOPANT);
  double *volume = array_at(state, ARRAY_VOLUME);
  double *west = array_at(state, ARRAY_WEST);
  double *east = array_at(state, ARRAY_EAST);
  double *north = array_at(state, ARRAY_NORTH);
  double *south = array_at(state, ARRAY_SOUTH);
  double emitter_doping = parameters[PARAM_EMITTER_DOPING_NORM];
  double base_doping = parameters[PARAM_BASE_DOPING_NORM];
  double collector_doping = parameters[PARAM_COLLECTOR_DOPING_NORM];
  double base_contact_start = state->emitter_width_m + 0.4 * state->base_width_m;
  double base_contact_end = state->emitter_width_m + 0.6 * state->base_width_m;
  int ix;
  int iy;
  fill_array(west, state->size, 0.0);
  fill_array(east, state->size, 0.0);
  fill_array(north, state->size, 0.0);
  fill_array(south, state->size, 0.0);
  for (iy = 0; iy < state->ny; iy += 1) {
    double control_height = state->dy_m *
      (iy == 0 || iy == state->ny - 1 ? 0.5 : 1.0);
    for (ix = 0; ix < state->nx; ix += 1) {
      int index = iy * state->nx + ix;
      double x_m = ix * state->dx_m;
      double control_width = state->dx_m *
        (ix == 0 || ix == state->nx - 1 ? 0.5 : 1.0);
      volume[index] = control_width * control_height;
      if (x_m < state->emitter_width_m) dopant[index] = emitter_doping;
      else if (x_m < state->emitter_width_m + state->base_width_m) {
        dopant[index] = -base_doping;
      } else dopant[index] = collector_doping;
      state->contact[index] = CONTACT_NONE;
      if (ix == 0) state->contact[index] = CONTACT_EMITTER;
      else if (ix == state->nx - 1) state->contact[index] = CONTACT_COLLECTOR;
      else if (iy == 0 && x_m >= base_contact_start && x_m <= base_contact_end) {
        state->contact[index] = CONTACT_BASE;
      }
      if (ix > 0) west[index] = control_height / state->dx_m;
      if (ix + 1 < state->nx) east[index] = control_height / state->dx_m;
      if (iy > 0) north[index] = control_width / state->dy_m;
      if (iy + 1 < state->ny) south[index] = control_width / state->dy_m;
    }
  }
}

static void enforce_contact_potential(State *state, double *potential) {
  double *dopant = array_at(state, ARRAY_DOPANT);
  int index;
  for (index = 0; index < state->size; index += 1) {
    double electron;
    double hole;
    double equilibrium_potential;
    if (state->contact[index] == CONTACT_NONE) continue;
    neutral_carrier_pair(dopant[index], &electron, &hole, &equilibrium_potential);
    potential[index] = equilibrium_potential +
      contact_voltage(state, state->contact[index]) / state->thermal_voltage_v;
  }
}

static void enforce_contacts(State *state) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron_values = array_at(state, ARRAY_ELECTRON);
  double *hole_values = array_at(state, ARRAY_HOLE);
  double *dopant = array_at(state, ARRAY_DOPANT);
  int index;
  for (index = 0; index < state->size; index += 1) {
    double electron;
    double hole;
    double equilibrium_potential;
    if (state->contact[index] == CONTACT_NONE) continue;
    neutral_carrier_pair(dopant[index], &electron, &hole, &equilibrium_potential);
    electron_values[index] = electron;
    hole_values[index] = hole;
    potential[index] = equilibrium_potential +
      contact_voltage(state, state->contact[index]) / state->thermal_voltage_v;
  }
}

static double carrier_conductance(
  double potential_here,
  double potential_neighbor,
  double geometry,
  int electron
) {
  double difference = potential_neighbor - potential_here;
  if (electron) {
    return geometry * dd_exp_safe(potential_neighbor) * dd_bernoulli(difference);
  }
  return geometry * dd_exp_safe(-potential_here) * dd_bernoulli(difference);
}

static double matrix_conductance(
  State *state,
  int index,
  int neighbor,
  double geometry,
  const double *potential,
  int electron_variable,
  double geometry_multiplier
) {
  if (potential) {
    return carrier_conductance(
      potential[index],
      potential[neighbor],
      geometry,
      electron_variable
    );
  }
  return geometry_multiplier * geometry;
}

static void apply_matrix(
  State *state,
  const double *diagonal,
  const double *vector,
  double *output,
  const double *potential,
  int electron_variable,
  double geometry_multiplier
) {
  int index;
  fill_array(output, state->size, 0.0);
  for (index = 0; index < state->size; index += 1) {
    double value;
    int direction;
    if (state->contact[index] != CONTACT_NONE) continue;
    value = diagonal[index] * vector[index];
    for (direction = 0; direction < 4; direction += 1) {
      int neighbor = neighbor_index(state, index, direction);
      double conductance;
      if (neighbor < 0 || state->contact[neighbor] != CONTACT_NONE) continue;
      conductance = matrix_conductance(
        state,
        index,
        neighbor,
        neighbor_geometry(state, index, direction),
        potential,
        electron_variable,
        geometry_multiplier
      );
      value -= conductance * vector[neighbor];
    }
    output[index] = value;
  }
}

static void apply_ssor_preconditioner(
  State *state,
  const double *diagonal,
  const double *residual,
  double *output,
  const double *potential,
  int electron_variable,
  double geometry_multiplier
) {
  int index;
  fill_array(output, state->size, 0.0);
  for (index = 0; index < state->size; index += 1) {
    int ix;
    int iy;
    double value;
    if (state->contact[index] != CONTACT_NONE) continue;
    ix = index % state->nx;
    iy = index / state->nx;
    value = residual[index];
    if (ix > 0 && state->contact[index - 1] == CONTACT_NONE) {
      value += matrix_conductance(
        state,
        index,
        index - 1,
        array_at(state, ARRAY_WEST)[index],
        potential,
        electron_variable,
        geometry_multiplier
      ) * output[index - 1];
    }
    if (iy > 0 && state->contact[index - state->nx] == CONTACT_NONE) {
      value += matrix_conductance(
        state,
        index,
        index - state->nx,
        array_at(state, ARRAY_NORTH)[index],
        potential,
        electron_variable,
        geometry_multiplier
      ) * output[index - state->nx];
    }
    output[index] = value / diagonal[index];
  }
  for (index = state->size - 1; index >= 0; index -= 1) {
    int ix;
    int iy;
    double value;
    if (state->contact[index] != CONTACT_NONE) continue;
    ix = index % state->nx;
    iy = index / state->nx;
    value = diagonal[index] * output[index];
    if (ix + 1 < state->nx && state->contact[index + 1] == CONTACT_NONE) {
      value += matrix_conductance(
        state,
        index,
        index + 1,
        array_at(state, ARRAY_EAST)[index],
        potential,
        electron_variable,
        geometry_multiplier
      ) * output[index + 1];
    }
    if (iy + 1 < state->ny && state->contact[index + state->nx] == CONTACT_NONE) {
      value += matrix_conductance(
        state,
        index,
        index + state->nx,
        array_at(state, ARRAY_SOUTH)[index],
        potential,
        electron_variable,
        geometry_multiplier
      ) * output[index + state->nx];
    }
    output[index] = value / diagonal[index];
  }
}

static double dot_free(State *state, const double *left, const double *right) {
  double value = 0.0;
  int index;
  for (index = 0; index < state->size; index += 1) {
    if (state->contact[index] == CONTACT_NONE) value += left[index] * right[index];
  }
  return value;
}

static int solve_pcg(
  State *state,
  const double *diagonal,
  const double *rhs,
  double *solution,
  int preserve_initial,
  int maximum_iterations,
  double tolerance,
  const double *potential,
  int electron_variable,
  double geometry_multiplier
) {
  double *residual = array_at(state, ARRAY_RESIDUAL);
  double *preconditioned = array_at(state, ARRAY_PRECONDITIONED);
  double *direction = array_at(state, ARRAY_DIRECTION);
  double *product = array_at(state, ARRAY_PRODUCT);
  double rhs_norm_2 = 0.0;
  double rz;
  double reference;
  int index;
  int iteration;
  if (!preserve_initial) fill_array(solution, state->size, 0.0);
  for (index = 0; index < state->size; index += 1) {
    if (state->contact[index] != CONTACT_NONE) solution[index] = 0.0;
  }
  apply_matrix(
    state,
    diagonal,
    solution,
    product,
    potential,
    electron_variable,
    geometry_multiplier
  );
  for (index = 0; index < state->size; index += 1) {
    if (state->contact[index] != CONTACT_NONE) {
      residual[index] = 0.0;
      continue;
    }
    residual[index] = rhs[index] - product[index];
    rhs_norm_2 += rhs[index] * rhs[index];
  }
  apply_ssor_preconditioner(
    state,
    diagonal,
    residual,
    preconditioned,
    potential,
    electron_variable,
    geometry_multiplier
  );
  copy_array(direction, preconditioned, state->size);
  rz = dot_free(state, residual, preconditioned);
  reference = dd_sqrt(dd_max(rhs_norm_2, DOUBLE_MIN));
  for (iteration = 0; iteration < maximum_iterations; iteration += 1) {
    double denominator = 0.0;
    double alpha;
    double residual_norm_2 = 0.0;
    double next_rz;
    double beta;
    apply_matrix(
      state,
      diagonal,
      direction,
      product,
      potential,
      electron_variable,
      geometry_multiplier
    );
    for (index = 0; index < state->size; index += 1) {
      if (state->contact[index] == CONTACT_NONE) {
        denominator += direction[index] * product[index];
      }
    }
    if (!dd_finite(denominator) || denominator <= 0.0 || !dd_finite(rz)) {
      state->linear_iterations += iteration + 1;
      return 0;
    }
    alpha = rz / denominator;
    for (index = 0; index < state->size; index += 1) {
      if (state->contact[index] != CONTACT_NONE) continue;
      solution[index] += alpha * direction[index];
      residual[index] -= alpha * product[index];
      residual_norm_2 += residual[index] * residual[index];
    }
    if (dd_sqrt(residual_norm_2) / reference < tolerance) {
      state->linear_iterations += iteration + 1;
      return 1;
    }
    apply_ssor_preconditioner(
      state,
      diagonal,
      residual,
      preconditioned,
      potential,
      electron_variable,
      geometry_multiplier
    );
    next_rz = dot_free(state, residual, preconditioned);
    beta = next_rz / rz;
    for (index = 0; index < state->size; index += 1) {
      if (state->contact[index] == CONTACT_NONE) {
        direction[index] = preconditioned[index] + beta * direction[index];
      }
    }
    rz = next_rz;
  }
  state->linear_iterations += maximum_iterations;
  return 0;
}

static double neighbor_sum(
  State *state,
  const double *values,
  int index,
  double multiplier
) {
  double sum = 0.0;
  int direction;
  for (direction = 0; direction < 4; direction += 1) {
    int neighbor = neighbor_index(state, index, direction);
    if (neighbor < 0) continue;
    sum += multiplier * neighbor_geometry(state, index, direction) *
      (values[index] - values[neighbor]);
  }
  return sum;
}

static double geometry_sum(State *state, int index, double multiplier) {
  double sum = 0.0;
  int direction;
  for (direction = 0; direction < 4; direction += 1) {
    if (neighbor_index(state, index, direction) >= 0) {
      sum += multiplier * neighbor_geometry(state, index, direction);
    }
  }
  return sum;
}

static double srh_normalized(State *state, double electron, double hole) {
  return (electron * hole - 1.0) /
    (
      state->hole_lifetime_s * (electron + 1.0) +
      state->electron_lifetime_s * (hole + 1.0)
    );
}

static double srh_electron_derivative(State *state, double electron, double hole) {
  double constant = state->hole_lifetime_s +
    state->electron_lifetime_s * (hole + 1.0);
  double denominator = state->hole_lifetime_s * electron + constant;
  return (hole * constant + state->hole_lifetime_s) /
    (denominator * denominator);
}

static double srh_hole_derivative(State *state, double electron, double hole) {
  double constant = state->hole_lifetime_s * (electron + 1.0) +
    state->electron_lifetime_s;
  double denominator = constant + state->electron_lifetime_s * hole;
  return (electron * constant + state->electron_lifetime_s) /
    (denominator * denominator);
}

static int solve_poisson(State *state, int equilibrium) {
  double *state_potential = array_at(state, ARRAY_POTENTIAL);
  double *state_electron = array_at(state, ARRAY_ELECTRON);
  double *state_hole = array_at(state, ARRAY_HOLE);
  double *potential = array_at(state, ARRAY_CANDIDATE_POTENTIAL);
  double *eta_electron = array_at(state, ARRAY_ETA_ELECTRON);
  double *eta_hole = array_at(state, ARRAY_ETA_HOLE);
  double *diagonal = array_at(state, ARRAY_DIAGONAL);
  double *rhs = array_at(state, ARRAY_RHS);
  double *solution = array_at(state, ARRAY_SOLUTION);
  double *dopant = array_at(state, ARRAY_DOPANT);
  double *volume = array_at(state, ARRAY_VOLUME);
  double previous_residual = 1.7976931348623157e308;
  int index;
  int newton_iteration;
  copy_array(potential, state_potential, state->size);
  for (index = 0; index < state->size; index += 1) {
    eta_electron[index] = equilibrium
      ? 0.0
      : host_log(state_electron[index]) - state_potential[index];
    eta_hole[index] = equilibrium
      ? 0.0
      : host_log(state_hole[index]) + state_potential[index];
  }
  for (newton_iteration = 0; newton_iteration < 50; newton_iteration += 1) {
    double residual_norm = 0.0;
    double maximum_correction = 0.0;
    double step;
    enforce_contact_potential(state, potential);
    fill_array(diagonal, state->size, 0.0);
    fill_array(rhs, state->size, 0.0);
    for (index = 0; index < state->size; index += 1) {
      double electron;
      double hole;
      double electrostatic;
      double source_scale;
      double charge;
      double residual;
      double scale;
      if (state->contact[index] != CONTACT_NONE) {
        diagonal[index] = 1.0;
        continue;
      }
      electron = dd_exp_safe(potential[index] + eta_electron[index]);
      hole = dd_exp_safe(-potential[index] + eta_hole[index]);
      electrostatic = neighbor_sum(
        state,
        potential,
        index,
        state->relative_permittivity
      );
      source_scale = volume[index] * Q * state->intrinsic_m3 /
        (EPS0 * state->thermal_voltage_v);
      charge = hole - electron + dopant[index];
      residual = electrostatic - source_scale * charge;
      diagonal[index] = geometry_sum(
        state,
        index,
        state->relative_permittivity
      ) + source_scale * (electron + hole);
      rhs[index] = -residual;
      scale = dd_max(1.0, dd_max(dd_abs(electrostatic), dd_abs(source_scale * charge)));
      residual_norm = dd_max(residual_norm, dd_abs(residual) / scale);
    }
    if (!solve_pcg(
      state,
      diagonal,
      rhs,
      solution,
      0,
      900,
      1e-12,
      (const double *)0,
      0,
      state->relative_permittivity
    )) return 0;
    for (index = 0; index < state->size; index += 1) {
      if (state->contact[index] == CONTACT_NONE) {
        maximum_correction = dd_max(maximum_correction, dd_abs(solution[index]));
      }
    }
    step = dd_min(1.0, 1.0 / dd_max(1.0, maximum_correction));
    if (residual_norm > previous_residual * 1.2) step *= 0.5;
    for (index = 0; index < state->size; index += 1) {
      if (state->contact[index] == CONTACT_NONE) {
        potential[index] += step * solution[index];
      }
    }
    previous_residual = residual_norm;
    if (maximum_correction * step < 1e-10 && residual_norm < 1e-9) break;
  }
  return finite_array(potential, state->size);
}

static void enforce_contact_slotboom(
  State *state,
  const double *potential,
  double *variable,
  int electron_variable
) {
  double *dopant = array_at(state, ARRAY_DOPANT);
  int index;
  for (index = 0; index < state->size; index += 1) {
    double electron;
    double hole;
    double equilibrium_potential;
    if (state->contact[index] == CONTACT_NONE) continue;
    neutral_carrier_pair(dopant[index], &electron, &hole, &equilibrium_potential);
    variable[index] = electron_variable
      ? electron * dd_exp_safe(-potential[index])
      : hole * dd_exp_safe(potential[index]);
  }
}

static int solve_carrier(
  State *state,
  const double *potential,
  const double *electron,
  const double *hole,
  int solve_electron
) {
  double *variable = array_at(
    state,
    solve_electron ? ARRAY_CANDIDATE_ELECTRON : ARRAY_CANDIDATE_HOLE
  );
  double *diagonal = array_at(state, ARRAY_DIAGONAL);
  double *rhs = array_at(state, ARRAY_RHS);
  double *volume = array_at(state, ARRAY_VOLUME);
  double mobility = solve_electron
    ? state->electron_mobility
    : state->hole_mobility;
  int index;
  for (index = 0; index < state->size; index += 1) {
    variable[index] = solve_electron
      ? electron[index] * dd_exp_safe(-potential[index])
      : hole[index] * dd_exp_safe(potential[index]);
  }
  enforce_contact_slotboom(state, potential, variable, solve_electron);
  fill_array(diagonal, state->size, 0.0);
  fill_array(rhs, state->size, 0.0);
  for (index = 0; index < state->size; index += 1) {
    double srh;
    double density_per_variable;
    double derivative;
    double constant;
    double source_scale;
    double sum = 0.0;
    int direction;
    if (state->contact[index] != CONTACT_NONE) {
      diagonal[index] = 1.0;
      rhs[index] = variable[index];
      continue;
    }
    srh = srh_normalized(state, electron[index], hole[index]);
    density_per_variable = solve_electron
      ? dd_exp_safe(potential[index])
      : dd_exp_safe(-potential[index]);
    derivative = (
      solve_electron
        ? srh_electron_derivative(state, electron[index], hole[index])
        : srh_hole_derivative(state, electron[index], hole[index])
    ) * density_per_variable;
    constant = srh - derivative * variable[index];
    source_scale = volume[index] / (mobility * state->thermal_voltage_v);
    for (direction = 0; direction < 4; direction += 1) {
      int neighbor = neighbor_index(state, index, direction);
      double conductance;
      if (neighbor < 0) continue;
      conductance = carrier_conductance(
        potential[index],
        potential[neighbor],
        neighbor_geometry(state, index, direction),
        solve_electron
      );
      sum += conductance;
      if (state->contact[neighbor] != CONTACT_NONE) {
        rhs[index] += conductance * variable[neighbor];
      }
    }
    diagonal[index] = sum + source_scale * derivative;
    rhs[index] -= source_scale * constant;
  }
  if (!solve_pcg(
    state,
    diagonal,
    rhs,
    variable,
    1,
    1200,
    1e-12,
    potential,
    solve_electron,
    1.0
  )) return 0;
  for (index = 0; index < state->size; index += 1) {
    if (state->contact[index] != CONTACT_NONE) {
      variable[index] = solve_electron ? electron[index] : hole[index];
      continue;
    }
    variable[index] *= solve_electron
      ? dd_exp_safe(potential[index])
      : dd_exp_safe(-potential[index]);
    if (!dd_finite(variable[index]) || variable[index] <= 0.0) return 0;
  }
  return 1;
}

static double electron_flux(
  State *state,
  int here,
  int neighbor,
  double geometry
) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double difference = potential[neighbor] - potential[here];
  double eta_difference =
    (host_log(electron[neighbor]) - potential[neighbor]) -
    (host_log(electron[here]) - potential[here]);
  return geometry * electron[here] * dd_bernoulli(-difference) *
    dd_expm1(eta_difference);
}

static double hole_flux(
  State *state,
  int here,
  int neighbor,
  double geometry
) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *hole = array_at(state, ARRAY_HOLE);
  double difference = potential[neighbor] - potential[here];
  double eta_difference =
    (host_log(hole[neighbor]) + potential[neighbor]) -
    (host_log(hole[here]) + potential[here]);
  return -geometry * hole[here] * dd_bernoulli(difference) *
    dd_expm1(eta_difference);
}

static void terminal_currents(State *state, double *currents) {
  int index;
  int current_index;
  for (current_index = 0; current_index < 9; current_index += 1) {
    currents[current_index] = 0.0;
  }
  for (index = 0; index < state->size; index += 1) {
    unsigned char contact_id = state->contact[index];
    int direction;
    int terminal_offset;
    if (contact_id == CONTACT_NONE) continue;
    terminal_offset = (contact_id - 1) * 3;
    for (direction = 0; direction < 4; direction += 1) {
      int neighbor = neighbor_index(state, index, direction);
      double geometry;
      double electron_am;
      double hole_am;
      if (neighbor < 0 || state->contact[neighbor] == contact_id) continue;
      geometry = neighbor_geometry(state, index, direction);
      electron_am = Q * state->electron_mobility * state->thermal_voltage_v *
        state->intrinsic_m3 * electron_flux(state, index, neighbor, geometry);
      hole_am = Q * state->hole_mobility * state->thermal_voltage_v *
        state->intrinsic_m3 * hole_flux(state, index, neighbor, geometry);
      currents[terminal_offset] += electron_am;
      currents[terminal_offset + 1] += hole_am;
    }
  }
  currents[2] = currents[0] + currents[1];
  currents[5] = currents[3] + currents[4];
  currents[8] = currents[6] + currents[7];
}

static void equation_metrics(State *state) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double *hole = array_at(state, ARRAY_HOLE);
  double *dopant = array_at(state, ARRAY_DOPANT);
  double *volume = array_at(state, ARRAY_VOLUME);
  double terminal_total_am;
  double electron_terminal_am;
  double hole_terminal_am;
  double characteristic_current_am;
  double absolute_tolerance_am;
  double current_scale_am;
  double balance_scale_am;
  int index;
  state->metrics.poisson_residual = 0.0;
  state->metrics.electron_residual = 0.0;
  state->metrics.hole_residual = 0.0;
  state->metrics.integrated_recombination_am = 0.0;
  for (index = 0; index < state->size; index += 1) {
    double charge;
    double electrostatic;
    double poisson_source;
    double srh;
    double electron_source;
    double hole_source;
    double electron_flux_sum = 0.0;
    double hole_flux_sum = 0.0;
    double electron_magnitude = 1.0;
    double hole_magnitude = 1.0;
    int direction;
    if (state->contact[index] != CONTACT_NONE) continue;
    charge = hole[index] - electron[index] + dopant[index];
    electrostatic = neighbor_sum(
      state,
      potential,
      index,
      state->relative_permittivity
    );
    poisson_source = volume[index] * Q * state->intrinsic_m3 /
      (EPS0 * state->thermal_voltage_v) * charge;
    state->metrics.poisson_residual = dd_max(
      state->metrics.poisson_residual,
      dd_abs(electrostatic - poisson_source) /
        dd_max(1.0, dd_max(dd_abs(electrostatic), dd_abs(poisson_source)))
    );
    srh = srh_normalized(state, electron[index], hole[index]);
    electron_source = volume[index] /
      (state->electron_mobility * state->thermal_voltage_v) * srh;
    hole_source = volume[index] /
      (state->hole_mobility * state->thermal_voltage_v) * srh;
    for (direction = 0; direction < 4; direction += 1) {
      int neighbor = neighbor_index(state, index, direction);
      double geometry;
      double electron_face;
      double hole_face;
      if (neighbor < 0) continue;
      geometry = neighbor_geometry(state, index, direction);
      electron_face = electron_flux(state, index, neighbor, geometry);
      hole_face = hole_flux(state, index, neighbor, geometry);
      electron_flux_sum += electron_face;
      hole_flux_sum += hole_face;
      electron_magnitude = dd_max(electron_magnitude, dd_abs(electron_face));
      hole_magnitude = dd_max(hole_magnitude, dd_abs(hole_face));
    }
    state->metrics.electron_residual = dd_max(
      state->metrics.electron_residual,
      dd_abs(electron_flux_sum - electron_source) /
        dd_max(electron_magnitude, dd_abs(electron_source))
    );
    state->metrics.hole_residual = dd_max(
      state->metrics.hole_residual,
      dd_abs(hole_flux_sum + hole_source) /
        dd_max(hole_magnitude, dd_abs(hole_source))
    );
    state->metrics.integrated_recombination_am +=
      Q * state->intrinsic_m3 * srh * volume[index];
  }
  terminal_currents(state, state->metrics.terminal_currents_am);
  terminal_total_am = state->metrics.terminal_currents_am[2] +
    state->metrics.terminal_currents_am[5] +
    state->metrics.terminal_currents_am[8];
  electron_terminal_am = state->metrics.terminal_currents_am[0] +
    state->metrics.terminal_currents_am[3] +
    state->metrics.terminal_currents_am[6];
  hole_terminal_am = state->metrics.terminal_currents_am[1] +
    state->metrics.terminal_currents_am[4] +
    state->metrics.terminal_currents_am[7];
  characteristic_current_am = Q * state->intrinsic_m3 * state->thermal_voltage_v *
    (state->electron_mobility + state->hole_mobility) *
    state->height_m / state->length_m;
  absolute_tolerance_am = dd_max(
    1e-18,
    dd_max(
      characteristic_current_am * state->residual_tolerance,
      4.0 * characteristic_current_am *
        dd_sqrt(DOUBLE_EPSILON * state->size)
    )
  );
  current_scale_am = dd_max(
    dd_abs(state->metrics.terminal_currents_am[2]),
    dd_max(
      dd_abs(state->metrics.terminal_currents_am[5]),
      dd_max(
        dd_abs(state->metrics.terminal_currents_am[8]),
        absolute_tolerance_am / state->conservation_tolerance
      )
    )
  );
  balance_scale_am = dd_max(
    dd_abs(state->metrics.integrated_recombination_am),
    dd_max(
      dd_abs(electron_terminal_am),
      dd_max(
        dd_abs(hole_terminal_am),
        absolute_tolerance_am / state->conservation_tolerance
      )
    )
  );
  state->metrics.terminal_kcl_error = dd_abs(terminal_total_am) / current_scale_am;
  state->metrics.terminal_kcl_absolute_am = dd_abs(terminal_total_am);
  state->metrics.terminal_kcl_tolerance_am = absolute_tolerance_am;
  state->metrics.electron_balance_error = dd_abs(
    electron_terminal_am + state->metrics.integrated_recombination_am
  ) / balance_scale_am;
  state->metrics.hole_balance_error = dd_abs(
    hole_terminal_am - state->metrics.integrated_recombination_am
  ) / balance_scale_am;
}

static int metrics_converged(State *state) {
  return state->metrics.poisson_residual < state->residual_tolerance &&
    state->metrics.electron_residual < state->residual_tolerance &&
    state->metrics.hole_residual < state->residual_tolerance &&
    state->metrics.terminal_kcl_error < state->conservation_tolerance &&
    state->metrics.electron_balance_error < state->conservation_tolerance &&
    state->metrics.hole_balance_error < state->conservation_tolerance;
}

static void predict_bias_shift(
  State *state,
  double base_voltage_change_v,
  double collector_voltage_change_v
) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double base_end_m = state->emitter_width_m + state->base_width_m;
  int ix;
  int iy;
  for (iy = 0; iy < state->ny; iy += 1) {
    for (ix = 0; ix < state->nx; ix += 1) {
      int index = iy * state->nx + ix;
      double x_m = ix * state->dx_m;
      double base_weight;
      double collector_weight;
      if (x_m < state->emitter_width_m) {
        base_weight = x_m / state->emitter_width_m;
      } else if (x_m <= base_end_m) {
        base_weight = 1.0;
      } else {
        base_weight = dd_max(
          0.0,
          (state->length_m - x_m) / state->collector_width_m
        );
      }
      collector_weight = x_m <= base_end_m
        ? 0.0
        : (x_m - base_end_m) / state->collector_width_m;
      potential[index] += (
        base_voltage_change_v * base_weight +
        collector_voltage_change_v * collector_weight
      ) / state->thermal_voltage_v;
    }
  }
}

static void mix_state(State *state, double damping) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double *hole = array_at(state, ARRAY_HOLE);
  double *old_potential = array_at(state, ARRAY_OLD_POTENTIAL);
  double *old_electron = array_at(state, ARRAY_OLD_ELECTRON);
  double *old_hole = array_at(state, ARRAY_OLD_HOLE);
  double *candidate_potential = array_at(state, ARRAY_CANDIDATE_POTENTIAL);
  double *candidate_electron = array_at(state, ARRAY_CANDIDATE_ELECTRON);
  double *candidate_hole = array_at(state, ARRAY_CANDIDATE_HOLE);
  int index;
  for (index = 0; index < state->size; index += 1) {
    if (state->contact[index] != CONTACT_NONE) continue;
    potential[index] = old_potential[index] +
      damping * (candidate_potential[index] - old_potential[index]);
    electron[index] = host_exp(
      host_log(old_electron[index]) +
      damping * (host_log(candidate_electron[index]) - host_log(old_electron[index]))
    );
    hole[index] = host_exp(
      host_log(old_hole[index]) +
      damping * (host_log(candidate_hole[index]) - host_log(old_hole[index]))
    );
  }
}

static int solve_bias_point(State *state, double target_vbe_v, double target_vce_v) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double *hole = array_at(state, ARRAY_HOLE);
  double *old_potential = array_at(state, ARRAY_OLD_POTENTIAL);
  double *old_electron = array_at(state, ARRAY_OLD_ELECTRON);
  double *old_hole = array_at(state, ARRAY_OLD_HOLE);
  double *candidate_potential = array_at(state, ARRAY_CANDIDATE_POTENTIAL);
  double *candidate_electron = array_at(state, ARRAY_CANDIDATE_ELECTRON);
  double *candidate_hole = array_at(state, ARRAY_CANDIDATE_HOLE);
  double previous_score = 1.7976931348623157e308;
  double damping = dd_min(1.0, dd_max(0.0625, state->damping));
  int previous_total_iterations = state->total_iterations;
  int iteration;
  predict_bias_shift(
    state,
    target_vbe_v - state->vbe_v,
    target_vce_v - state->vce_v
  );
  state->vbe_v = target_vbe_v;
  state->vce_v = target_vce_v;
  state->converged = 0;
  state->iterations = 0;
  enforce_contacts(state);
  for (iteration = 1; iteration <= state->max_iterations; iteration += 1) {
    double score;
    copy_array(old_potential, potential, state->size);
    copy_array(old_electron, electron, state->size);
    copy_array(old_hole, hole, state->size);
    if (!solve_poisson(state, 0)) {
      state->status_code = 30;
      return 0;
    }
    if (!solve_carrier(
      state,
      candidate_potential,
      old_electron,
      old_hole,
      1
    )) {
      state->status_code = 31;
      return 0;
    }
    if (!solve_carrier(
      state,
      candidate_potential,
      candidate_electron,
      old_hole,
      0
    )) {
      state->status_code = 32;
      return 0;
    }
    mix_state(state, damping);
    enforce_contacts(state);
    equation_metrics(state);
    score = dd_max(
      state->metrics.poisson_residual,
      dd_max(
        state->metrics.electron_residual,
        state->metrics.hole_residual
      )
    );
    if (score > previous_score * 1.5 && damping > 0.0625) {
      copy_array(potential, old_potential, state->size);
      copy_array(electron, old_electron, state->size);
      copy_array(hole, old_hole, state->size);
      damping *= 0.5;
      continue;
    }
    state->iterations = iteration;
    state->total_iterations = previous_total_iterations + iteration;
    state->damping = damping;
    previous_score = score;
    if (metrics_converged(state)) {
      state->converged = 1;
      state->status_code = 0;
      return 1;
    }
    if (iteration % 8 == 0 && score < 1e-3 && damping < 1.0) {
      damping = dd_min(1.0, damping * 1.25);
    }
  }
  state->status_code = 33;
  return 0;
}

static int continuation_steps(double start, double target) {
  double difference = dd_abs(target - start);
  int steps;
  if (difference < 1e-15) return 0;
  steps = (int)(difference / MAX_BIAS_STEP_V);
  if (steps * MAX_BIAS_STEP_V < difference - 1e-15) steps += 1;
  return steps;
}

static void initialize_equilibrium(State *state) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double *hole = array_at(state, ARRAY_HOLE);
  double *dopant = array_at(state, ARRAY_DOPANT);
  int index;
  state->vbe_v = 0.0;
  state->vce_v = 0.0;
  state->converged = 0;
  state->iterations = 0;
  state->total_iterations = 0;
  state->damping = 0.5;
  for (index = 0; index < state->size; index += 1) {
    neutral_carrier_pair(
      dopant[index],
      electron + index,
      hole + index,
      potential + index
    );
  }
  enforce_contacts(state);
}

static int solve_equilibrium(State *state) {
  double *potential = array_at(state, ARRAY_POTENTIAL);
  double *electron = array_at(state, ARRAY_ELECTRON);
  double *hole = array_at(state, ARRAY_HOLE);
  double *candidate_potential = array_at(state, ARRAY_CANDIDATE_POTENTIAL);
  int index;
  initialize_equilibrium(state);
  if (!solve_poisson(state, 1)) {
    state->status_code = 20;
    return 0;
  }
  copy_array(potential, candidate_potential, state->size);
  for (index = 0; index < state->size; index += 1) {
    electron[index] = dd_exp_safe(potential[index]);
    hole[index] = dd_exp_safe(-potential[index]);
  }
  enforce_contacts(state);
  equation_metrics(state);
  state->converged = metrics_converged(state);
  if (!state->converged) {
    state->status_code = 21;
    return 0;
  }
  state->status_code = 0;
  return 1;
}

static void write_diagnostics(State *state, double *diagnostics) {
  int index;
  for (index = 0; index < DIAG_COUNT; index += 1) diagnostics[index] = 0.0;
  diagnostics[DIAG_CONVERGED] = state->converged ? 1.0 : 0.0;
  diagnostics[DIAG_ITERATIONS] = state->iterations;
  diagnostics[DIAG_TOTAL_ITERATIONS] = state->total_iterations;
  diagnostics[DIAG_DAMPING] = state->damping;
  diagnostics[DIAG_POISSON_RESIDUAL] = state->metrics.poisson_residual;
  diagnostics[DIAG_ELECTRON_RESIDUAL] = state->metrics.electron_residual;
  diagnostics[DIAG_HOLE_RESIDUAL] = state->metrics.hole_residual;
  diagnostics[DIAG_KCL_ERROR] = state->metrics.terminal_kcl_error;
  diagnostics[DIAG_KCL_ABSOLUTE_AM] = state->metrics.terminal_kcl_absolute_am;
  diagnostics[DIAG_KCL_TOLERANCE_AM] = state->metrics.terminal_kcl_tolerance_am;
  diagnostics[DIAG_ELECTRON_BALANCE] = state->metrics.electron_balance_error;
  diagnostics[DIAG_HOLE_BALANCE] = state->metrics.hole_balance_error;
  diagnostics[DIAG_RECOMBINATION_AM] = state->metrics.integrated_recombination_am;
  for (index = 0; index < 9; index += 1) {
    diagnostics[DIAG_EMITTER_ELECTRON_AM + index] =
      state->metrics.terminal_currents_am[index];
  }
  diagnostics[DIAG_FINAL_VBE_V] = state->vbe_v;
  diagnostics[DIAG_FINAL_VCE_V] = state->vce_v;
  diagnostics[DIAG_STATUS_CODE] = state->status_code;
  diagnostics[DIAG_LINEAR_ITERATIONS] = state->linear_iterations;
}

__attribute__((export_name("npn_solve")))
int npn_solve(
  int capacity,
  int nx,
  int ny,
  int previous_valid,
  int arrays_pointer,
  int contact_pointer,
  int diagnostics_pointer,
  int parameters_pointer
) {
  State state;
  double *parameters = (double *)(unsigned long)parameters_pointer;
  double *diagnostics = (double *)(unsigned long)diagnostics_pointer;
  int collector_steps;
  int base_steps;
  int step;
  double collector_start;
  double collector_difference;
  double base_start;
  double base_difference;
  state.nx = nx;
  state.ny = ny;
  state.size = nx * ny;
  state.capacity = capacity;
  state.arrays = (double *)(unsigned long)arrays_pointer;
  state.contact = (unsigned char *)(unsigned long)contact_pointer;
  state.length_m = parameters[PARAM_LENGTH_M];
  state.height_m = parameters[PARAM_HEIGHT_M];
  state.dx_m = state.length_m / (nx - 1);
  state.dy_m = state.height_m / (ny - 1);
  state.emitter_width_m = parameters[PARAM_EMITTER_WIDTH_M];
  state.base_width_m = parameters[PARAM_BASE_WIDTH_M];
  state.collector_width_m =
    state.length_m - state.emitter_width_m - state.base_width_m;
  state.thermal_voltage_v = parameters[PARAM_THERMAL_VOLTAGE_V];
  state.intrinsic_m3 = parameters[PARAM_INTRINSIC_M3];
  state.relative_permittivity = parameters[PARAM_RELATIVE_PERMITTIVITY];
  state.electron_mobility = parameters[PARAM_ELECTRON_MOBILITY];
  state.hole_mobility = parameters[PARAM_HOLE_MOBILITY];
  state.electron_lifetime_s = parameters[PARAM_ELECTRON_LIFETIME_S];
  state.hole_lifetime_s = parameters[PARAM_HOLE_LIFETIME_S];
  state.target_vbe_v = parameters[PARAM_TARGET_VBE_V];
  state.target_vce_v = parameters[PARAM_TARGET_VCE_V];
  state.max_iterations = (int)parameters[PARAM_MAX_ITERATIONS];
  state.residual_tolerance = parameters[PARAM_RESIDUAL_TOLERANCE];
  state.conservation_tolerance = parameters[PARAM_CONSERVATION_TOLERANCE];
  state.iterations = 0;
  state.total_iterations = 0;
  state.linear_iterations = 0;
  state.converged = 0;
  state.status_code = 10;
  state.metrics.poisson_residual = 1.0 / 0.0;
  state.metrics.electron_residual = 1.0 / 0.0;
  state.metrics.hole_residual = 1.0 / 0.0;
  state.metrics.terminal_kcl_error = 1.0 / 0.0;
  state.metrics.terminal_kcl_absolute_am = 1.0 / 0.0;
  state.metrics.terminal_kcl_tolerance_am = 0.0 / 0.0;
  state.metrics.electron_balance_error = 1.0 / 0.0;
  state.metrics.hole_balance_error = 1.0 / 0.0;
  state.metrics.integrated_recombination_am = 0.0 / 0.0;
  for (step = 0; step < 9; step += 1) {
    state.metrics.terminal_currents_am[step] = 0.0 / 0.0;
  }
  if (
    capacity < state.size ||
    nx < 3 ||
    ny < 3 ||
    state.length_m <= 0.0 ||
    state.height_m <= 0.0 ||
    state.collector_width_m <= 0.0 ||
    state.thermal_voltage_v <= 0.0 ||
    state.intrinsic_m3 <= 0.0 ||
    state.relative_permittivity <= 0.0 ||
    state.electron_mobility <= 0.0 ||
    state.hole_mobility <= 0.0 ||
    state.electron_lifetime_s <= 0.0 ||
    state.hole_lifetime_s <= 0.0 ||
    state.max_iterations <= 0
  ) {
    write_diagnostics(&state, diagnostics);
    return state.status_code;
  }
  create_geometry(&state, parameters);
  if (previous_valid) {
    state.vbe_v = parameters[PARAM_PREVIOUS_VBE_V];
    state.vce_v = parameters[PARAM_PREVIOUS_VCE_V];
    state.damping = parameters[PARAM_PREVIOUS_DAMPING];
    state.total_iterations = (int)parameters[PARAM_PREVIOUS_TOTAL_ITERATIONS];
    state.converged = 1;
    state.status_code = 0;
    enforce_contacts(&state);
  } else if (!solve_equilibrium(&state)) {
    write_diagnostics(&state, diagnostics);
    return state.status_code;
  }
  collector_start = state.vce_v;
  collector_difference = state.target_vce_v - collector_start;
  collector_steps = continuation_steps(collector_start, state.target_vce_v);
  for (step = 1; step <= collector_steps; step += 1) {
    double collector_voltage =
      collector_start + collector_difference * step / collector_steps;
    if (!solve_bias_point(&state, state.vbe_v, collector_voltage)) {
      write_diagnostics(&state, diagnostics);
      return state.status_code;
    }
  }
  base_start = state.vbe_v;
  base_difference = state.target_vbe_v - base_start;
  base_steps = continuation_steps(base_start, state.target_vbe_v);
  for (step = 1; step <= base_steps; step += 1) {
    double base_voltage = base_start + base_difference * step / base_steps;
    if (!solve_bias_point(&state, base_voltage, state.vce_v)) {
      write_diagnostics(&state, diagnostics);
      return state.status_code;
    }
  }
  equation_metrics(&state);
  state.converged = metrics_converged(&state);
  if (!state.converged && state.status_code == 0) state.status_code = 34;
  write_diagnostics(&state, diagnostics);
  return state.status_code;
}

__attribute__((export_name("npn_array_count")))
int npn_array_count(void) {
  return ARRAY_COUNT;
}

__attribute__((export_name("npn_diagnostic_count")))
int npn_diagnostic_count(void) {
  return DIAG_COUNT;
}
