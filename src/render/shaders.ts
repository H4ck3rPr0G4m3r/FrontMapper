/**
 * Segment shaders. Each segment texture is RGBA8UI:
 * R = terrain, G = mag, B = water depth, A = flags (bit0 shore, bit1 removed on export).
 * The fragment shader must stay in sync with src/core/colors.ts.
 */
export const VERT = `#version 300 es
in vec2 a_unit;
uniform vec4 u_rect;      // segment x, y, w, h in map pixels
uniform vec2 u_cam;       // map point at the view centre
uniform float u_zoom;     // screen px per map px
uniform vec2 u_view;      // canvas size in CSS px
out vec2 v_local;
void main() {
  vec2 map = u_rect.xy + a_unit * u_rect.zw;
  vec2 screen = (map - u_cam) * u_zoom + u_view * 0.5;
  vec2 clip = screen / u_view * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_local = a_unit * u_rect.zw;
}`;

export const FRAG = `#version 300 es
precision highp float;
precision highp usampler2D;
uniform usampler2D u_tex;
uniform int u_mode;       // 0 game, 1 elevation, 2 export
in vec2 v_local;
out vec4 outColor;

vec3 gameColor(uint t, float m, bool shore, float depth) {
  if (t == 0u) {
    if (shore) return vec3(100.0, 143.0, 255.0);
    float adj = 1.0 - min(depth / 2.0, 10.0);
    return vec3(70.0 + adj, 132.0 + adj, 180.0 + adj);
  }
  if (t == 1u) {
    if (shore) return vec3(204.0, 203.0, 158.0);
    if (m < 10.0) return vec3(190.0, 220.0 - 2.0 * m, 138.0);
    if (m < 20.0) return vec3(200.0 + 2.0 * m, 183.0 + 2.0 * m, 138.0 + 2.0 * m);
    return vec3(240.0);
  }
  return vec3(22.0);
}

vec3 elevationColor(uint t, float m) {
  if (t == 0u) return vec3(20.0, 26.0, 34.0);
  if (t == 1u) return vec3(floor(60.0 + m / 30.0 * 195.0 + 0.5));
  return vec3(0.0);
}

void main() {
  uvec4 s = texelFetch(u_tex, ivec2(floor(v_local)), 0);
  bool shore = (s.a & 1u) != 0u;
  bool removed = (s.a & 2u) != 0u;
  vec3 c;
  if (removed && u_mode != 2) c = vec3(255.0, 40.0, 40.0);
  else if (u_mode == 1) c = elevationColor(s.r, float(s.g));
  else c = gameColor(s.r, float(s.g), shore, float(s.b));
  outColor = vec4(c / 255.0, 1.0);
}`;
