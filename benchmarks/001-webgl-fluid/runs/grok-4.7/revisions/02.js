'use strict';
/*
 * Independent WebGL2 incompressible 2D color-fluid engine.
 * Solver equations attributed to Pavel Dobryakov, MIT License (c) 2017
 * (WebGL-Fluid-Simulation): curl, vorticity confinement, divergence,
 * Jacobi pressure, gradient subtract, semi-Lagrangian advection, Gaussian splat,
 * and shaded display. Orchestration, API, and structure are original.
 * Bloom and sunrays are disabled. No RAF, timers, or input listeners.
 */
(function () {
    var canvas = document.getElementsByTagName('canvas')[0];
    if (!canvas) { throw new Error('canvas element required'); }
    canvas.width = 640;
    canvas.height = 400;

    var config = {
        SIM_RESOLUTION: 128,
        DYE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 1,
        VELOCITY_DISSIPATION: 0.2,
        PRESSURE: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        SPLAT_RADIUS: 0.25,
        SHADING: true,
        BACK_COLOR: { r: 0, g: 0, b: 0 }
    };

    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', params);
    if (!gl) { throw new Error('WebGL2 required'); }
    gl.getExtension('EXT_color_buffer_float');
    var supportLinear = !!gl.getExtension('OES_texture_float_linear');
    gl.clearColor(0, 0, 0, 1);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    var halfFloat = gl.HALF_FLOAT;

    function supportRenderTextureFormat(internalFormat, format, type) {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.deleteFramebuffer(fbo);
        gl.deleteTexture(texture);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return ok;
    }

    function getSupportedFormat(internalFormat, format, type) {
        if (!supportRenderTextureFormat(internalFormat, format, type)) {
            if (internalFormat === gl.R16F) { return getSupportedFormat(gl.RG16F, gl.RG, type); }
            if (internalFormat === gl.RG16F) { return getSupportedFormat(gl.RGBA16F, gl.RGBA, type); }
            return null;
        }
        return { internalFormat: internalFormat, format: format };
    }

    var formatRGBA = getSupportedFormat(gl.RGBA16F, gl.RGBA, halfFloat);
    var formatRG = getSupportedFormat(gl.RG16F, gl.RG, halfFloat);
    var formatR = getSupportedFormat(gl.R16F, gl.RED, halfFloat);
    if (!formatRGBA || !formatRG || !formatR) { throw new Error('half-float render targets unsupported'); }

    var baseVS = [
        '#version 300 es',
        'precision highp float;',
        'layout(location = 0) in vec2 aPosition;',
        'out vec2 vUv;',
        'out vec2 vL;',
        'out vec2 vR;',
        'out vec2 vT;',
        'out vec2 vB;',
        'uniform vec2 texelSize;',
        'void main() {',
        '    vUv = aPosition * 0.5 + 0.5;',
        '    vL = vUv - vec2(texelSize.x, 0.0);',
        '    vR = vUv + vec2(texelSize.x, 0.0);',
        '    vT = vUv + vec2(0.0, texelSize.y);',
        '    vB = vUv - vec2(0.0, texelSize.y);',
        '    gl_Position = vec4(aPosition, 0.0, 1.0);',
        '}'
    ].join('\n');

    function frag(body) {
        return '#version 300 es\nprecision highp float;\nprecision highp sampler2D;\nin vec2 vUv;\nin vec2 vL;\nin vec2 vR;\nin vec2 vT;\nin vec2 vB;\n' + body + '\n';
    }

    // Equations from Dobryakov 2017, rewritten for WebGL2 (out vec4).
    var clearFS = frag([
        'uniform sampler2D uTexture;',
        'uniform float value;',
        'out vec4 fragColor;',
        'void main() {',
        '    fragColor = value * texture(uTexture, vUv);',
        '}'
    ].join('\n'));

    var colorFS = frag([
        'uniform vec4 color;',
        'out vec4 fragColor;',
        'void main() { fragColor = color; }'
    ].join('\n'));

    var displayFS = frag([
        'uniform sampler2D uTexture;',
        'uniform vec2 dyeTexelSize;',
        'out vec4 fragColor;',
        'void main() {',
        '    vec3 c = texture(uTexture, vUv).rgb;',
        '    #ifdef SHADING',
        '    vec2 ts = dyeTexelSize;',
        '    vec3 lc = texture(uTexture, vUv - vec2(ts.x, 0.0)).rgb;',
        '    vec3 rc = texture(uTexture, vUv + vec2(ts.x, 0.0)).rgb;',
        '    vec3 tc = texture(uTexture, vUv + vec2(0.0, ts.y)).rgb;',
        '    vec3 bc = texture(uTexture, vUv - vec2(0.0, ts.y)).rgb;',
        '    float dx = length(rc) - length(lc);',
        '    float dy = length(tc) - length(bc);',
        '    vec3 n = normalize(vec3(dx, dy, length(texelSize)));',
        '    vec3 l = vec3(0.0, 0.0, 1.0);',
        '    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);',
        '    c *= diffuse;',
        '    #endif',
        '    float a = max(c.r, max(c.g, c.b));',
        '    fragColor = vec4(c, a);',
        '}'
    ].join('\n'));

    var splatFS = frag([
        'uniform sampler2D uTarget;',
        'uniform float aspectRatio;',
        'uniform vec3 color;',
        'uniform vec2 point;',
        'uniform float radius;',
        'out vec4 fragColor;',
        'void main() {',
        '    vec2 p = vUv - point.xy;',
        '    p.x *= aspectRatio;',
        '    vec3 splat = exp(-dot(p, p) / radius) * color;',
        '    vec3 base = texture(uTarget, vUv).xyz;',
        '    fragColor = vec4(base + splat, 1.0);',
        '}'
    ].join('\n'));

    var advectFS = frag([
        'uniform sampler2D uVelocity;',
        'uniform sampler2D uSource;',
        'uniform vec2 dyeTexelSize;',
        'uniform float dt;',
        'uniform float dissipation;',
        'out vec4 fragColor;',
        'vec4 bilerp(sampler2D sam, vec2 uv, vec2 tsize) {',
        '    vec2 st = uv / tsize - 0.5;',
        '    vec2 iuv = floor(st);',
        '    vec2 fuv = fract(st);',
        '    vec4 a = texture(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
        '    vec4 b = texture(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
        '    vec4 c = texture(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
        '    vec4 d = texture(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
        '    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
        '}',
        'void main() {',
        '    #ifdef MANUAL_FILTERING',
        '    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
        '    vec4 result = bilerp(uSource, coord, dyeTexelSize);',
        '    #else',
        '    vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texelSize;',
        '    vec4 result = texture(uSource, coord);',
        '    #endif',
        '    float decay = 1.0 + dissipation * dt;',
        '    fragColor = result / decay;',
        '}'
    ].join('\n'));

    var divergenceFS = frag([
        'uniform sampler2D uVelocity;',
        'out vec4 fragColor;',
        'void main() {',
        '    float L = texture(uVelocity, vL).x;',
        '    float R = texture(uVelocity, vR).x;',
        '    float T = texture(uVelocity, vT).y;',
        '    float B = texture(uVelocity, vB).y;',
        '    vec2 C = texture(uVelocity, vUv).xy;',
        '    if (vL.x < 0.0) { L = -C.x; }',
        '    if (vR.x > 1.0) { R = -C.x; }',
        '    if (vT.y > 1.0) { T = -C.y; }',
        '    if (vB.y < 0.0) { B = -C.y; }',
        '    float div = 0.5 * (R - L + T - B);',
        '    fragColor = vec4(div, 0.0, 0.0, 1.0);',
        '}'
    ].join('\n'));

    var curlFS = frag([
        'uniform sampler2D uVelocity;',
        'out vec4 fragColor;',
        'void main() {',
        '    float L = texture(uVelocity, vL).y;',
        '    float R = texture(uVelocity, vR).y;',
        '    float T = texture(uVelocity, vT).x;',
        '    float B = texture(uVelocity, vB).x;',
        '    float vorticity = R - L - T + B;',
        '    fragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
        '}'
    ].join('\n'));

    var vorticityFS = frag([
        'uniform sampler2D uVelocity;',
        'uniform sampler2D uCurl;',
        'uniform float curl;',
        'uniform float dt;',
        'out vec4 fragColor;',
        'void main() {',
        '    float L = texture(uCurl, vL).x;',
        '    float R = texture(uCurl, vR).x;',
        '    float T = texture(uCurl, vT).x;',
        '    float B = texture(uCurl, vB).x;',
        '    float C = texture(uCurl, vUv).x;',
        '    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
        '    force /= length(force) + 0.0001;',
        '    force *= curl * C;',
        '    force.y *= -1.0;',
        '    vec2 vel = texture(uVelocity, vUv).xy;',
        '    fragColor = vec4(vel + force * dt, 0.0, 1.0);',
        '}'
    ].join('\n'));

    var pressureFS = frag([
        'uniform sampler2D uPressure;',
        'uniform sampler2D uDivergence;',
        'out vec4 fragColor;',
        'void main() {',
        '    float L = texture(uPressure, vL).x;',
        '    float R = texture(uPressure, vR).x;',
        '    float T = texture(uPressure, vT).x;',
        '    float B = texture(uPressure, vB).x;',
        '    float divergence = texture(uDivergence, vUv).x;',
        '    float pressure = (L + R + B + T - divergence) * 0.25;',
        '    fragColor = vec4(pressure, 0.0, 0.0, 1.0);',
        '}'
    ].join('\n'));

    var gradientFS = frag([
        'uniform sampler2D uPressure;',
        'uniform sampler2D uVelocity;',
        'out vec4 fragColor;',
        'void main() {',
        '    float L = texture(uPressure, vL).x;',
        '    float R = texture(uPressure, vR).x;',
        '    float T = texture(uPressure, vT).x;',
        '    float B = texture(uPressure, vB).x;',
        '    vec2 velocity = texture(uVelocity, vUv).xy;',
        '    velocity.xy -= vec2(R - L, T - B);',
        '    fragColor = vec4(velocity, 0.0, 1.0);',
        '}'
    ].join('\n'));

    function compile(type, source) {
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed');
        }
        return shader;
    }

    function injectDefines(source, defines) {
        if (!defines || !defines.length) { return source; }
        var lines = '';
        for (var i = 0; i < defines.length; i++) { lines += '#define ' + defines[i] + '\n'; }
        var marker = '#version 300 es\n';
        if (source.indexOf(marker) === 0) { return marker + lines + source.slice(marker.length); }
        return lines + source;
    }

    function createProgram(vsSource, fsSource, defines) {
        var vs = compile(gl.VERTEX_SHADER, vsSource);
        var fs = compile(gl.FRAGMENT_SHADER, injectDefines(fsSource, defines));
        var program = gl.createProgram();
        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'link failed');
        }
        var uniforms = {};
        var n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (var u = 0; u < n; u++) {
            var name = gl.getActiveUniform(program, u).name;
            uniforms[name] = gl.getUniformLocation(program, name);
        }
        return { program: program, uniforms: uniforms };
    }

    var shadingDefines = ['SHADING'];
    var filterDefines = supportLinear ? null : ['MANUAL_FILTERING'];

    var clearProgram = createProgram(baseVS, clearFS);
    var colorProgram = createProgram(baseVS, colorFS);
    var displayProgram = createProgram(baseVS, displayFS, shadingDefines);
    var splatProgram = createProgram(baseVS, splatFS);
    var advectionProgram = createProgram(baseVS, advectFS, filterDefines);
    var divergenceProgram = createProgram(baseVS, divergenceFS);
    var curlProgram = createProgram(baseVS, curlFS);
    var vorticityProgram = createProgram(baseVS, vorticityFS);
    var pressureProgram = createProgram(baseVS, pressureFS);
    var gradientProgram = createProgram(baseVS, gradientFS);

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    var indexBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuf);
    gl.bindVertexArray(null);

    function blit(destination) {
        gl.bindVertexArray(vao);
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    function createFBO(w, h, fmt, filter) {
        gl.activeTexture(gl.TEXTURE0);
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internalFormat, w, h, 0, fmt.format, halfFloat, null);
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, w, h);
        gl.clear(gl.COLOR_BUFFER_BIT);
        var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) { throw new Error('FBO incomplete ' + status); }
        return {
            texture: texture,
            fbo: fbo,
            width: w,
            height: h,
            texelSizeX: 1.0 / w,
            texelSizeY: 1.0 / h,
            attach: function (id) {
                gl.activeTexture(gl.TEXTURE0 + id);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                return id;
            }
        };
    }

    function createDoubleFBO(w, h, fmt, filter) {
        var fbo1 = createFBO(w, h, fmt, filter);
        var fbo2 = createFBO(w, h, fmt, filter);
        return {
            width: w,
            height: h,
            texelSizeX: fbo1.texelSizeX,
            texelSizeY: fbo1.texelSizeY,
            read: fbo1,
            write: fbo2,
            swap: function () {
                var t = this.read;
                this.read = this.write;
                this.write = t;
            }
        };
    }

    function getResolution(resolution) {
        var aspectRatio = canvas.width / canvas.height;
        if (aspectRatio < 1) { aspectRatio = 1.0 / aspectRatio; }
        var min = Math.round(resolution);
        var max = Math.round(resolution * aspectRatio);
        if (canvas.width > canvas.height) { return { width: max, height: min }; }
        return { width: min, height: max };
    }

    var dye, velocity, divergence, curl, pressure;
    var filterMode = supportLinear ? gl.LINEAR : gl.NEAREST;

    function initFramebuffers() {
        var simRes = getResolution(config.SIM_RESOLUTION);
        var dyeRes = getResolution(config.DYE_RESOLUTION);
        dye = createDoubleFBO(dyeRes.width, dyeRes.height, formatRGBA, filterMode);
        velocity = createDoubleFBO(simRes.width, simRes.height, formatRG, filterMode);
        divergence = createFBO(simRes.width, simRes.height, formatR, gl.NEAREST);
        curl = createFBO(simRes.width, simRes.height, formatR, gl.NEAREST);
        pressure = createDoubleFBO(simRes.width, simRes.height, formatR, gl.NEAREST);
    }

    function aspect() { return canvas.width / canvas.height; }

    function correctRadius(radius) {
        var ar = aspect();
        if (ar > 1) { radius *= ar; }
        return radius;
    }

    function splat(x, y, dx, dy, color) {
        var pointX = x;
        var pointY = 1.0 - y;
        var cr = color || [0, 0, 0];
        var r = cr.length !== undefined ? cr[0] : (cr.r || 0);
        var g = cr.length !== undefined ? cr[1] : (cr.g || 0);
        var b = cr.length !== undefined ? cr[2] : (cr.b || 0);

        gl.disable(gl.BLEND);
        gl.viewport(0, 0, velocity.width, velocity.height);
        gl.useProgram(splatProgram.program);
        gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
        gl.uniform1f(splatProgram.uniforms.aspectRatio, aspect());
        gl.uniform2f(splatProgram.uniforms.point, pointX, pointY);
        gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 0.0);
        gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
        blit(velocity.write.fbo);
        velocity.swap();

        gl.viewport(0, 0, dye.width, dye.height);
        gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
        gl.uniform3f(splatProgram.uniforms.color, r, g, b);
        blit(dye.write.fbo);
        dye.swap();
    }

    function step(dt) {
        gl.disable(gl.BLEND);
        gl.viewport(0, 0, velocity.width, velocity.height);

        gl.useProgram(curlProgram.program);
        gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(curl.fbo);

        gl.useProgram(vorticityProgram.program);
        gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
        gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
        gl.uniform1f(vorticityProgram.uniforms.dt, dt);
        blit(velocity.write.fbo);
        velocity.swap();

        gl.useProgram(divergenceProgram.program);
        gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
        blit(divergence.fbo);

        gl.useProgram(clearProgram.program);
        gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
        gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
        blit(pressure.write.fbo);
        pressure.swap();

        gl.useProgram(pressureProgram.program);
        gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
        var iters = config.PRESSURE_ITERATIONS | 0;
        for (var i = 0; i < iters; i++) {
            gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
            blit(pressure.write.fbo);
            pressure.swap();
        }

        gl.useProgram(gradientProgram.program);
        gl.uniform2f(gradientProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        gl.uniform1i(gradientProgram.uniforms.uPressure, pressure.read.attach(0));
        gl.uniform1i(gradientProgram.uniforms.uVelocity, velocity.read.attach(1));
        blit(velocity.write.fbo);
        velocity.swap();

        gl.useProgram(advectionProgram.program);
        gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
        if (!supportLinear) {
            gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
        }
        var velocityId = velocity.read.attach(0);
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
        gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
        gl.uniform1f(advectionProgram.uniforms.dt, dt);
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
        blit(velocity.write.fbo);
        velocity.swap();

        gl.viewport(0, 0, dye.width, dye.height);
        if (!supportLinear) {
            gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        }
        gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
        gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
        gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
        blit(dye.write.fbo);
        dye.swap();
    }

    function render() {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.enable(gl.BLEND);
        var width = gl.drawingBufferWidth || canvas.width;
        var height = gl.drawingBufferHeight || canvas.height;
        gl.viewport(0, 0, width, height);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        gl.useProgram(colorProgram.program);
        var bc = config.BACK_COLOR;
        gl.uniform4f(colorProgram.uniforms.color, (bc.r || 0) / 255, (bc.g || 0) / 255, (bc.b || 0) / 255, 1);
        blit(null);

        gl.useProgram(displayProgram.program);
        if (displayProgram.uniforms.texelSize) {
            gl.uniform2f(displayProgram.uniforms.texelSize, 1.0 / width, 1.0 / height);
        }
        if (displayProgram.uniforms.dyeTexelSize) {
            gl.uniform2f(displayProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
        }
        gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
        blit(null);
        gl.disable(gl.BLEND);
    }

    function reset() { initFramebuffers(); }

    function setConfig(object) {
        if (!object) { return; }
        var keys = ['CURL', 'DENSITY_DISSIPATION', 'VELOCITY_DISSIPATION', 'SPLAT_RADIUS', 'PRESSURE_ITERATIONS', 'PRESSURE'];
        for (var i = 0; i < keys.length; i++) {
            var k = keys[i];
            if (object[k] !== undefined && object[k] !== null) { config[k] = object[k]; }
        }
    }

    initFramebuffers();

    window.fluid = {
        splat: splat,
        step: step,
        render: render,
        reset: reset,
        setConfig: setConfig
    };
})();
