/*
 * Independent reconstruction of the core solver of Pavel Dobryakov's
 * WebGL-Fluid-Simulation (MIT, 2017), based on shipped artifact evidence.
 * Short shader equations are re-derived from the artifact (MIT licensed).
 * Original bloom/sunrays/GUI/input code omitted per spec; SHADING on.
 */
(function () {
'use strict';

var canvas = document.getElementsByTagName('canvas')[0];
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

// ---------------------------------------------------------------- context
function getWebGLContext (canvas) {
    var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
    var gl = canvas.getContext('webgl2', params);
    var isWebGL2 = !!gl;
    if (!isWebGL2)
        gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);

    var halfFloat;
    var supportLinearFiltering;
    if (isWebGL2) {
        gl.getExtension('EXT_color_buffer_float');
        supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
    } else {
        halfFloat = gl.getExtension('OES_texture_half_float');
        supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
    }

    gl.clearColor(0.0, 0.0, 0.0, 1.0);

    var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
    var formatRGBA, formatRG, formatR;
    if (isWebGL2) {
        formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG   = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR    = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
    } else {
        formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatRG   = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
        formatR    = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    }

    // half-float linear filtering is core in WebGL2
    if (isWebGL2) supportLinearFiltering = true;

    return {
        gl: gl,
        ext: {
            formatRGBA: formatRGBA,
            formatRG: formatRG,
            formatR: formatR,
            halfFloatTexType: halfFloatTexType,
            supportLinearFiltering: supportLinearFiltering
        }
    };
}

function getSupportedFormat (gl, internalFormat, format, type) {
    if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
        switch (internalFormat) {
            case gl.R16F:
                return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
            case gl.RG16F:
                return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
            default:
                return null;
        }
    }
    return { internalFormat: internalFormat, format: format };
}

function supportRenderTextureFormat (gl, internalFormat, format, type) {
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
    return gl.checkFramebufferStatus(gl.FRAMEBUFFER) == gl.FRAMEBUFFER_COMPLETE;
}

var ref = getWebGLContext(canvas);
var gl = ref.gl;
var ext = ref.ext;

// ---------------------------------------------------------------- programs
function compileShader (type, source, keywords) {
    if (keywords != null) {
        var prefix = '';
        for (var i = 0; i < keywords.length; i++) prefix += '#define ' + keywords[i] + '\n';
        source = prefix + source;
    }
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw gl.getShaderInfoLog(shader);
    return shader;
}

function createProgram (vertexShader, fragmentShader) {
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindAttribLocation(program, 0, 'aPosition');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw gl.getProgramInfoLog(program);
    return program;
}

function getUniforms (program) {
    var uniforms = {};
    var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < count; i++) {
        var name = gl.getActiveUniform(program, i).name;
        uniforms[name] = gl.getUniformLocation(program, name);
    }
    return uniforms;
}

function Program (vertexShader, fragmentShader) {
    this.program = createProgram(vertexShader, fragmentShader);
    this.uniforms = getUniforms(this.program);
}
Program.prototype.bind = function () {
    gl.useProgram(this.program);
};

var baseVertexShader = compileShader(gl.VERTEX_SHADER, [
    'precision highp float;',
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'varying vec2 vL;',
    'varying vec2 vR;',
    'varying vec2 vT;',
    'varying vec2 vB;',
    'uniform vec2 texelSize;',
    'void main () {',
    '    vUv = aPosition * 0.5 + 0.5;',
    '    vL = vUv - vec2(texelSize.x, 0.0);',
    '    vR = vUv + vec2(texelSize.x, 0.0);',
    '    vT = vUv + vec2(0.0, texelSize.y);',
    '    vB = vUv - vec2(0.0, texelSize.y);',
    '    gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
].join('\n'));

var clearShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'uniform sampler2D uTexture;',
    'uniform float value;',
    'void main () {',
    '    gl_FragColor = value * texture2D(uTexture, vUv);',
    '}'
].join('\n'));

var colorShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'uniform vec4 color;',
    'void main () {',
    '    gl_FragColor = color;',
    '}'
].join('\n'));

// display: shading block per artifact displayShaderSource (SHADING only)
var displayShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float;',
    'precision highp sampler2D;',
    'varying vec2 vUv;',
    'varying vec2 vL;',
    'varying vec2 vR;',
    'varying vec2 vT;',
    'varying vec2 vB;',
    'uniform sampler2D uTexture;',
    'uniform vec2 texelSize;',
    'void main () {',
    '    vec3 c = texture2D(uTexture, vUv).rgb;',
    '#ifdef SHADING',
    '    vec3 lc = texture2D(uTexture, vL).rgb;',
    '    vec3 rc = texture2D(uTexture, vR).rgb;',
    '    vec3 tc = texture2D(uTexture, vT).rgb;',
    '    vec3 bc = texture2D(uTexture, vB).rgb;',
    '    float dx = length(rc) - length(lc);',
    '    float dy = length(tc) - length(bc);',
    '    vec3 n = normalize(vec3(dx, dy, length(texelSize)));',
    '    vec3 l = vec3(0.0, 0.0, 1.0);',
    '    float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0);',
    '    c *= diffuse;',
    '#endif',
    '    float a = max(c.r, max(c.g, c.b));',
    '    gl_FragColor = vec4(c, a);',
    '}'
].join('\n'), config.SHADING ? ['SHADING'] : null);

var splatShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float;',
    'precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uTarget;',
    'uniform float aspectRatio;',
    'uniform vec3 color;',
    'uniform vec2 point;',
    'uniform float radius;',
    'void main () {',
    '    vec2 p = vUv - point.xy;',
    '    p.x *= aspectRatio;',
    '    vec3 splat = exp(-dot(p, p) / radius) * color;',
    '    vec3 base = texture2D(uTarget, vUv).xyz;',
    '    gl_FragColor = vec4(base + splat, 1.0);',
    '}'
].join('\n'));

var advectionShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float;',
    'precision highp sampler2D;',
    'varying vec2 vUv;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uSource;',
    'uniform vec2 texelSize;',
    'uniform vec2 dyeTexelSize;',
    'uniform float dt;',
    'uniform float dissipation;',
    'vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {',
    '    vec2 st = uv / tsize - 0.5;',
    '    vec2 iuv = floor(st);',
    '    vec2 fuv = fract(st);',
    '    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);',
    '    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);',
    '    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);',
    '    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);',
    '    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);',
    '}',
    'void main () {',
    '#ifdef MANUAL_FILTERING',
    '    vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;',
    '    vec4 result = bilerp(uSource, coord, dyeTexelSize);',
    '#else',
    '    vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;',
    '    vec4 result = texture2D(uSource, coord);',
    '#endif',
    '    float decay = 1.0 + dissipation * dt;',
    '    gl_FragColor = result / decay;',
    '}'
].join('\n'), ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);

var divergenceShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL;',
    'varying highp vec2 vR;',
    'varying highp vec2 vT;',
    'varying highp vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '    float L = texture2D(uVelocity, vL).x;',
    '    float R = texture2D(uVelocity, vR).x;',
    '    float T = texture2D(uVelocity, vT).y;',
    '    float B = texture2D(uVelocity, vB).y;',
    '    vec2 C = texture2D(uVelocity, vUv).xy;',
    '    if (vL.x < 0.0) { L = -C.x; }',
    '    if (vR.x > 1.0) { R = -C.x; }',
    '    if (vT.y > 1.0) { T = -C.y; }',
    '    if (vB.y < 0.0) { B = -C.y; }',
    '    float div = 0.5 * (R - L + T - B);',
    '    gl_FragColor = vec4(div, 0.0, 0.0, 1.0);',
    '}'
].join('\n'));

var curlShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL;',
    'varying highp vec2 vR;',
    'varying highp vec2 vT;',
    'varying highp vec2 vB;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '    float L = texture2D(uVelocity, vL).y;',
    '    float R = texture2D(uVelocity, vR).y;',
    '    float T = texture2D(uVelocity, vT).x;',
    '    float B = texture2D(uVelocity, vB).x;',
    '    float vorticity = R - L - T + B;',
    '    gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);',
    '}'
].join('\n'));

var vorticityShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision highp float;',
    'precision highp sampler2D;',
    'varying vec2 vUv;',
    'varying vec2 vL;',
    'varying vec2 vR;',
    'varying vec2 vT;',
    'varying vec2 vB;',
    'uniform sampler2D uVelocity;',
    'uniform sampler2D uCurl;',
    'uniform float curl;',
    'uniform float dt;',
    'void main () {',
    '    float L = texture2D(uCurl, vL).x;',
    '    float R = texture2D(uCurl, vR).x;',
    '    float T = texture2D(uCurl, vT).x;',
    '    float B = texture2D(uCurl, vB).x;',
    '    float C = texture2D(uCurl, vUv).x;',
    '    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));',
    '    force /= length(force) + 0.0001;',
    '    force *= curl * C;',
    '    force.y *= -1.0;',
    '    vec2 vel = texture2D(uVelocity, vUv).xy;',
    '    gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);',
    '}'
].join('\n'));

var pressureShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL;',
    'varying highp vec2 vR;',
    'varying highp vec2 vT;',
    'varying highp vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uDivergence;',
    'void main () {',
    '    float L = texture2D(uPressure, vL).x;',
    '    float R = texture2D(uPressure, vR).x;',
    '    float T = texture2D(uPressure, vT).x;',
    '    float B = texture2D(uPressure, vB).x;',
    '    float divergence = texture2D(uDivergence, vUv).x;',
    '    float pressure = (L + R + B + T - divergence) * 0.25;',
    '    gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);',
    '}'
].join('\n'));

var gradientSubtractShader = compileShader(gl.FRAGMENT_SHADER, [
    'precision mediump float;',
    'precision mediump sampler2D;',
    'varying highp vec2 vUv;',
    'varying highp vec2 vL;',
    'varying highp vec2 vR;',
    'varying highp vec2 vT;',
    'varying highp vec2 vB;',
    'uniform sampler2D uPressure;',
    'uniform sampler2D uVelocity;',
    'void main () {',
    '    float L = texture2D(uPressure, vL).x;',
    '    float R = texture2D(uPressure, vR).x;',
    '    float T = texture2D(uPressure, vT).x;',
    '    float B = texture2D(uPressure, vB).x;',
    '    vec2 velocity = texture2D(uVelocity, vUv).xy;',
    '    velocity -= vec2(R - L, T - B);',
    '    gl_FragColor = vec4(velocity, 0.0, 1.0);',
    '}'
].join('\n'));

// ---------------------------------------------------------------- blit
var blit = (function () {
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(0);
    return function (destination) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
        gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    };
})();

// ---------------------------------------------------------------- FBOs
function createFBO (w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT); // cleared initial state, no random splats

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

function createDoubleFBO (w, h, internalFormat, format, type, param) {
    var fbo1 = createFBO(w, h, internalFormat, format, type, param);
    var fbo2 = createFBO(w, h, internalFormat, format, type, param);
    return {
        width: w,
        height: h,
        texelSizeX: fbo1.texelSizeX,
        texelSizeY: fbo1.texelSizeY,
        get read () { return fbo1; },
        set read (v) { fbo1 = v; },
        get write () { return fbo2; },
        set write (v) { fbo2 = v; },
        swap: function () { var t = fbo1; fbo1 = fbo2; fbo2 = t; }
    };
}

function getResolution (resolution) {
    var aspectRatio = gl.drawingBufferWidth / gl.drawingBufferHeight;
    if (aspectRatio < 1) aspectRatio = 1.0 / aspectRatio;
    var min = Math.round(resolution);
    var max = Math.round(resolution * aspectRatio);
    if (gl.drawingBufferWidth > gl.drawingBufferHeight)
        return { width: max, height: min };
    else
        return { width: min, height: max };
}

var dye, velocity, divergence, curl, pressure;

function initFramebuffers () {
    var simRes = getResolution(config.SIM_RESOLUTION);
    var dyeRes = getResolution(config.DYE_RESOLUTION);
    var texType = ext.halfFloatTexType;
    var rgba = ext.formatRGBA;
    var rg = ext.formatRG;
    var r = ext.formatR;
    var filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;

    dye      = createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, texType, filtering);
    velocity = createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, texType, filtering);
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    curl       = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
    pressure   = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, texType, gl.NEAREST);
}

var clearProgram           = new Program(baseVertexShader, clearShader);
var colorProgram           = new Program(baseVertexShader, colorShader);
var splatProgram           = new Program(baseVertexShader, splatShader);
var advectionProgram       = new Program(baseVertexShader, advectionShader);
var divergenceProgram      = new Program(baseVertexShader, divergenceShader);
var curlProgram            = new Program(baseVertexShader, curlShader);
var vorticityProgram       = new Program(baseVertexShader, vorticityShader);
var pressureProgram        = new Program(baseVertexShader, pressureShader);
var gradienSubtractProgram = new Program(baseVertexShader, gradientSubtractShader);
var displayProgram         = new Program(baseVertexShader, displayShader);

initFramebuffers();

// ---------------------------------------------------------------- solver
function step (dt) {
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, velocity.width, velocity.height);

    curlProgram.bind();
    gl.uniform2f(curlProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(curl.fbo);

    vorticityProgram.bind();
    gl.uniform2f(vorticityProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(vorticityProgram.uniforms.uCurl, curl.attach(1));
    gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
    gl.uniform1f(vorticityProgram.uniforms.dt, dt);
    blit(velocity.write.fbo);
    velocity.swap();

    divergenceProgram.bind();
    gl.uniform2f(divergenceProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read.attach(0));
    blit(divergence.fbo);

    clearProgram.bind();
    gl.uniform1i(clearProgram.uniforms.uTexture, pressure.read.attach(0));
    gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE);
    blit(pressure.write.fbo);
    pressure.swap();

    pressureProgram.bind();
    gl.uniform2f(pressureProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence.attach(0));
    for (var i = 0; i < config.PRESSURE_ITERATIONS; i++) {
        gl.uniform1i(pressureProgram.uniforms.uPressure, pressure.read.attach(1));
        blit(pressure.write.fbo);
        pressure.swap();
    }

    gradienSubtractProgram.bind();
    gl.uniform2f(gradienSubtractProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read.attach(0));
    gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read.attach(1));
    blit(velocity.write.fbo);
    velocity.swap();

    advectionProgram.bind();
    gl.uniform2f(advectionProgram.uniforms.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    var velocityId = velocity.read.attach(0);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocityId);
    gl.uniform1i(advectionProgram.uniforms.uSource, velocityId);
    gl.uniform1f(advectionProgram.uniforms.dt, dt);
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.VELOCITY_DISSIPATION);
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dye.width, dye.height);
    if (!ext.supportLinearFiltering)
        gl.uniform2f(advectionProgram.uniforms.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read.attach(0));
    gl.uniform1i(advectionProgram.uniforms.uSource, dye.read.attach(1));
    gl.uniform1f(advectionProgram.uniforms.dissipation, config.DENSITY_DISSIPATION);
    blit(dye.write.fbo);
    dye.swap();
}

function render () {
    var width = gl.drawingBufferWidth;
    var height = gl.drawingBufferHeight;
    gl.viewport(0, 0, width, height);

    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    // background
    colorProgram.bind();
    gl.uniform4f(colorProgram.uniforms.color, config.BACK_COLOR.r, config.BACK_COLOR.g, config.BACK_COLOR.b, 1);
    blit(null);

    // shaded dye display
    displayProgram.bind();
    gl.uniform2f(displayProgram.uniforms.texelSize, 1.0 / width, 1.0 / height);
    gl.uniform1i(displayProgram.uniforms.uTexture, dye.read.attach(0));
    blit(null);
}

function correctRadius (radius) {
    var aspectRatio = canvas.width / canvas.height;
    if (aspectRatio > 1) radius *= aspectRatio;
    return radius;
}

function splatInternal (x, y, dx, dy, color) {
    gl.disable(gl.BLEND);
    gl.viewport(0, 0, velocity.width, velocity.height);
    splatProgram.bind();
    gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read.attach(0));
    gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(splatProgram.uniforms.point, x, y);
    gl.uniform3f(splatProgram.uniforms.color, dx, dy, 0.0);
    gl.uniform1f(splatProgram.uniforms.radius, correctRadius(config.SPLAT_RADIUS / 100.0));
    blit(velocity.write.fbo);
    velocity.swap();

    gl.viewport(0, 0, dye.width, dye.height);
    gl.uniform1i(splatProgram.uniforms.uTarget, dye.read.attach(0));
    gl.uniform3f(splatProgram.uniforms.color, color[0], color[1], color[2]);
    blit(dye.write.fbo);
    dye.swap();
}

function clearFBO (f) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
    gl.viewport(0, 0, f.width, f.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
}

function reset () {
    gl.disable(gl.BLEND);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    clearFBO(velocity.read);
    clearFBO(velocity.write);
    clearFBO(dye.read);
    clearFBO(dye.write);
    clearFBO(pressure.read);
    clearFBO(pressure.write);
    clearFBO(divergence);
    clearFBO(curl);
}

function setConfig (obj) {
    if (obj == null) return;
    var keys = ['CURL', 'DENSITY_DISSIPATION', 'VELOCITY_DISSIPATION', 'SPLAT_RADIUS', 'PRESSURE_ITERATIONS'];
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (obj[k] !== undefined) config[k] = obj[k];
    }
}

// ---------------------------------------------------------------- public API
// API: x,y normalized 0..1 with TOP-LEFT origin; dx,dy velocity impulses in
// simulation grid cells per second, positive dy downward (converted here to
// the GL texcoord frame used by the original math). No SPLAT_FORCE scaling.
window.fluid = {
    splat: function (x, y, dx, dy, color) {
        splatInternal(x, 1.0 - y, dx, -dy, color);
    },
    step: function (dt) {
        step(dt);
    },
    render: function () {
        render();
    },
    reset: function () {
        reset();
    },
    setConfig: function (obj) {
        setConfig(obj);
    }
};
})();
