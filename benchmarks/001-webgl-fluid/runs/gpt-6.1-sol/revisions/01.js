/*
 * Independent, externally clocked WebGL2 fluid engine.
 * Solver and shading equations adapted from the shipped script.js,
 * lines 452, 464-478, 773-838 and 993-1015. Original equations:
 * Copyright (c) 2017 Pavel Dobryakov, MIT License.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
(function () {
    'use strict';
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Fluid engine requires an existing canvas.');
    canvas.width = 640;
    canvas.height = 400;
    const gl = canvas.getContext('webgl2', {
        alpha: true, depth: false, stencil: false, antialias: false,
        premultipliedAlpha: true, preserveDrawingBuffer: false
    });
    if (!gl) throw new Error('Fluid engine requires WebGL2.');
    if (!gl.getExtension('EXT_color_buffer_float'))
        throw new Error('Fluid engine requires EXT_color_buffer_float.');
    // WebGL2 half-float textures are linearly filterable. No float32 textures used.
    gl.getExtension('OES_texture_float_linear');
    const cfg = {
        CURL: 30,
        DENSITY_DISSIPATION: 1,
        VELOCITY_DISSIPATION: 0.2,
        SPLAT_RADIUS: 0.25,
        PRESSURE_ITERATIONS: 20
    };
    const aspect = canvas.width / canvas.height;
    function dimensions(shortSide) {
        return canvas.width > canvas.height
            ? [Math.round(shortSide * aspect), shortSide]
            : [shortSide, Math.round(shortSide / aspect)];
    }
    const simSize = dimensions(128), dyeSize = dimensions(512);
    const grid = [1 / simSize[0], 1 / simSize[1]];
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);

    function compile(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const message = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error('Fluid shader compilation: ' + message);
        }
        return shader;
    }
    const vertex = compile(gl.VERTEX_SHADER, `#version 300 es
precision highp float;
uniform vec2 grid;
out vec2 uv;
out vec2 leftUV;
out vec2 rightUV;
out vec2 topUV;
out vec2 bottomUV;
void main() {
    vec2 p = vec2(-1.0, -1.0);
    if (gl_VertexID == 1) p = vec2(3.0, -1.0);
    if (gl_VertexID == 2) p = vec2(-1.0, 3.0);
    uv = p * 0.5 + 0.5;
    leftUV = uv - vec2(grid.x, 0.0);
    rightUV = uv + vec2(grid.x, 0.0);
    topUV = uv + vec2(0.0, grid.y);
    bottomUV = uv - vec2(0.0, grid.y);
    gl_Position = vec4(p, 0.0, 1.0);
}`);
    function program(body, precision) {
        const fragment = compile(gl.FRAGMENT_SHADER, `#version 300 es
precision ${precision || 'highp'} float;
precision ${precision || 'highp'} sampler2D;
in highp vec2 uv;
in highp vec2 leftUV;
in highp vec2 rightUV;
in highp vec2 topUV;
in highp vec2 bottomUV;
out vec4 result;
` + body);
        const handle = gl.createProgram();
        gl.attachShader(handle, vertex);
        gl.attachShader(handle, fragment);
        gl.linkProgram(handle);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(handle, gl.LINK_STATUS))
            throw new Error('Fluid program link: ' + gl.getProgramInfoLog(handle));
        const uniforms = Object.create(null);
        for (let i = 0, n = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i < n; ++i) {
            const name = gl.getActiveUniform(handle, i).name;
            uniforms[name] = gl.getUniformLocation(handle, name);
        }
        return {handle: handle, uniforms: uniforms};
    }
    const passes = {
        inject: program(`
uniform sampler2D field;
uniform vec2 point;
uniform vec3 impulse;
uniform float radius;
uniform float aspectRatio;
void main() {
    vec2 p = uv - point;
    p.x *= aspectRatio;
    vec3 added = exp(-dot(p, p) / radius) * impulse;
    result = vec4(texture(field, uv).xyz + added, 1.0);
}`),
        curl: program(`
uniform sampler2D velocity;
void main() {
    float L = texture(velocity, leftUV).y;
    float R = texture(velocity, rightUV).y;
    float T = texture(velocity, topUV).x;
    float B = texture(velocity, bottomUV).x;
    float spin = 0.5 * (R - L - T + B);
    result = vec4(spin, 0.0, 0.0, 1.0);
}`, 'mediump'),
        confine: program(`
uniform sampler2D velocity;
uniform sampler2D spin;
uniform float strength;
uniform float dt;
void main() {
    float L = texture(spin, leftUV).r;
    float R = texture(spin, rightUV).r;
    float T = texture(spin, topUV).r;
    float B = texture(spin, bottomUV).r;
    float C = texture(spin, uv).r;
    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
    force /= length(force) + 0.0001;
    force *= strength * C;
    force.y *= -1.0;
    result = vec4(texture(velocity, uv).xy + force * dt, 0.0, 1.0);
}`),
        divergence: program(`
uniform sampler2D velocity;
void main() {
    float L = texture(velocity, leftUV).x;
    float R = texture(velocity, rightUV).x;
    float T = texture(velocity, topUV).y;
    float B = texture(velocity, bottomUV).y;
    vec2 C = texture(velocity, uv).xy;
    if (leftUV.x < 0.0) L = -C.x;
    if (rightUV.x > 1.0) R = -C.x;
    if (topUV.y > 1.0) T = -C.y;
    if (bottomUV.y < 0.0) B = -C.y;
    float d = 0.5 * (R - L + T - B);
    result = vec4(d, 0.0, 0.0, 1.0);
}`, 'mediump'),
        fadePressure: program(`
uniform sampler2D field;
uniform float retention;
void main() { result = retention * texture(field, uv); }
`, 'mediump'),
        jacobi: program(`
uniform sampler2D pressure;
uniform sampler2D divergence;
void main() {
    float L = texture(pressure, leftUV).r;
    float R = texture(pressure, rightUV).r;
    float T = texture(pressure, topUV).r;
    float B = texture(pressure, bottomUV).r;
    float d = texture(divergence, uv).r;
    result = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`, 'mediump'),
        project: program(`
uniform sampler2D pressure;
uniform sampler2D velocity;
void main() {
    float L = texture(pressure, leftUV).r;
    float R = texture(pressure, rightUV).r;
    float T = texture(pressure, topUV).r;
    float B = texture(pressure, bottomUV).r;
    vec2 v = texture(velocity, uv).xy;
    v -= vec2(R - L, T - B);
    result = vec4(v, 0.0, 1.0);
}`, 'mediump'),
        advect: program(`
uniform sampler2D velocity;
uniform sampler2D field;
uniform vec2 grid;
uniform float dt;
uniform float dissipation;
void main() {
    vec2 back = uv - dt * texture(velocity, uv).xy * grid;
    result = texture(field, back) / (1.0 + dissipation * dt);
}`),
        display: program(`
uniform sampler2D field;
uniform vec2 grid;
void main() {
    vec3 c = texture(field, uv).rgb;
    vec3 L = texture(field, leftUV).rgb;
    vec3 R = texture(field, rightUV).rgb;
    vec3 T = texture(field, topUV).rgb;
    vec3 B = texture(field, bottomUV).rgb;
    float dx = length(R) - length(L);
    float dy = length(T) - length(B);
    vec3 normal = normalize(vec3(dx, dy, length(grid)));
    float diffuse = clamp(normal.z + 0.7, 0.7, 1.0);
    c *= diffuse;
    result = vec4(c, max(c.r, max(c.g, c.b)));
}`)
    };
    gl.deleteShader(vertex);

    const surfaces = [];
    // Prefer the artifact's compact half-float channel formats, falling back
    // to RGBA16F only if a particular driver cannot render the compact format.
    function surface(size, internal, format, linear) {
        const texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internal, size[0], size[1], 0, format, gl.HALF_FLOAT, null);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            if (internal !== gl.RGBA16F) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size[0], size[1], 0, gl.RGBA, gl.HALF_FLOAT, null);
            }
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
                throw new Error('Fluid half-float framebuffer is unsupported.');
        }
        const s = {texture: texture, framebuffer: framebuffer, width: size[0], height: size[1]};
        surfaces.push(s);
        return s;
    }
    function pair(size, internal, format, linear) {
        return {
            front: surface(size, internal, format, linear),
            back: surface(size, internal, format, linear),
            swap: function () { const s = this.front; this.front = this.back; this.back = s; }
        };
    }
    const velocity = pair(simSize, gl.RG16F, gl.RG, true);
    const dye = pair(dyeSize, gl.RGBA16F, gl.RGBA, true);
    const pressure = pair(simSize, gl.R16F, gl.RED, false);
    const spin = surface(simSize, gl.R16F, gl.RED, false);
    const div = surface(simSize, gl.R16F, gl.RED, false);

    // A small independent command layer: textures and scalar/vector uniforms
    // are explicit; target dimensions determine each pass viewport.
    function draw(p, target, textures, values, blending) {
        gl.bindVertexArray(vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
        gl.viewport(0, 0, target ? target.width : canvas.width, target ? target.height : canvas.height);
        if (blending) {
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.FUNC_ADD);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        } else gl.disable(gl.BLEND);
        gl.useProgram(p.handle);
        const locations = p.uniforms;
        if (locations.grid !== undefined) gl.uniform2fv(locations.grid, grid);
        let unit = 0;
        for (const name of Object.keys(textures)) {
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, textures[name].texture);
            if (locations[name] !== undefined) gl.uniform1i(locations[name], unit);
            ++unit;
        }
        for (const name of Object.keys(values || {})) {
            if (locations[name] === undefined) continue;
            const value = values[name], location = locations[name];
            if (typeof value === 'number') gl.uniform1f(location, value);
            else if (value.length === 2) gl.uniform2fv(location, value);
            else if (value.length === 3) gl.uniform3fv(location, value);
            else if (value.length === 4) gl.uniform4fv(location, value);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function reset() {
        gl.disable(gl.BLEND);
        gl.disable(gl.SCISSOR_TEST);
        gl.colorMask(true, true, true, true);
        gl.clearColor(0, 0, 0, 1);
        for (const s of surfaces) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, s.framebuffer);
            gl.viewport(0, 0, s.width, s.height);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }
    function splat(x, y, dx, dy, color) {
        if (![x, y, dx, dy].every(Number.isFinite))
            throw new TypeError('splat coordinates and impulses must be finite.');
        if (!color || color.length < 3 || ![color[0], color[1], color[2]].every(Number.isFinite))
            throw new TypeError('splat color must contain three finite linear intensities.');
        // Public coordinates and impulses are y-down, internal UV/velocity y-up.
        // dx and dy are already in cells/second: no pointer scaling or force.
        const uniforms = {
            point: [x, 1 - y], impulse: [dx, -dy, 0],
            radius: cfg.SPLAT_RADIUS / 100 * (aspect > 1 ? aspect : 1),
            aspectRatio: aspect
        };
        draw(passes.inject, velocity.back, {field: velocity.front}, uniforms);
        velocity.swap();
        uniforms.impulse = [color[0], color[1], color[2]];
        draw(passes.inject, dye.back, {field: dye.front}, uniforms);
        dye.swap();
    }
    function step(dt) {
        if (dt === undefined) dt = 1 / 60;
        if (!Number.isFinite(dt) || dt < 0) throw new TypeError('step dt must be finite and nonnegative.');
        if (dt === 0) return;
        draw(passes.curl, spin, {velocity: velocity.front});
        draw(passes.confine, velocity.back, {velocity: velocity.front, spin: spin}, {strength: cfg.CURL, dt: dt});
        velocity.swap();
        draw(passes.divergence, div, {velocity: velocity.front});
        draw(passes.fadePressure, pressure.back, {field: pressure.front}, {retention: 0.8});
        pressure.swap();
        for (let i = 0; i < cfg.PRESSURE_ITERATIONS; ++i) {
            draw(passes.jacobi, pressure.back, {pressure: pressure.front, divergence: div});
            pressure.swap();
        }
        draw(passes.project, velocity.back, {pressure: pressure.front, velocity: velocity.front});
        velocity.swap();
        draw(passes.advect, velocity.back, {velocity: velocity.front, field: velocity.front},
             {dt: dt, dissipation: cfg.VELOCITY_DISSIPATION});
        velocity.swap();
        draw(passes.advect, dye.back, {velocity: velocity.front, field: dye.front},
             {dt: dt, dissipation: cfg.DENSITY_DISSIPATION});
        dye.swap();
    }
    function render() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.disable(gl.SCISSOR_TEST);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        // Artifact shading takes OUTPUT pixel spacing, not dye-grid spacing.
        // No bloom, sunrays, or gamma conversion in the core display path.
        draw(passes.display, null, {field: dye.front},
             {grid: [1 / canvas.width, 1 / canvas.height]}, true);
    }
    function setConfig(object) {
        if (!object || typeof object !== 'object') throw new TypeError('setConfig expects an object.');
        const next = Object.assign({}, cfg);
        for (const name of Object.keys(cfg)) {
            if (!Object.prototype.hasOwnProperty.call(object, name)) continue;
            const value = object[name];
            if (typeof value !== 'number' || !Number.isFinite(value))
                throw new TypeError('Configuration ' + name + ' must be finite.');
            if (name === 'SPLAT_RADIUS' && value <= 0) throw new RangeError('SPLAT_RADIUS must be positive.');
            if ((name === 'DENSITY_DISSIPATION' || name === 'VELOCITY_DISSIPATION' || name === 'PRESSURE_ITERATIONS') && value < 0)
                throw new RangeError(name + ' must be nonnegative.');
            next[name] = name === 'PRESSURE_ITERATIONS' ? Math.floor(value) : value;
        }
        Object.assign(cfg, next);
    }
    reset();
    window.fluid = {splat: splat, step: step, render: render, reset: reset, setConfig: setConfig};
})();
