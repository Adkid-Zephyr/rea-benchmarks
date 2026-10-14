from pathlib import Path
import json,hashlib
R=Path(__file__).resolve().parents[1]
s=(R/'reference/script.js').read_text()
# Keep original solver unchanged. Remove promo/listeners and autonomous update only.
s=s[:s.index('// Promo code')]+s[s.index('// Simulation code'):]
s=s.replace('startGUI();','').replace('multipleSplats(parseInt(Math.random() * 20) + 5);','').replace('\nupdate();','\n')
s=s[:s.index("canvas.addEventListener('mousedown'")]+s[s.index('function updatePointerDownData'):]
s=s.replace('DYE_RESOLUTION: 1024','DYE_RESOLUTION: 512').replace('BLOOM: true','BLOOM: false').replace('SUNRAYS: true','SUNRAYS: false')
s=s.replace("createTextureAsync('LDR_LLL1_0.png')","createTextureAsync('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')")
s=s.replace("    ga('send', 'event', isWebGL2 ? 'webgl2' : 'webgl', formatRGBA == null ? 'not supported' : 'supported');",'')
# Encapsulated adapter: normalized top-left input mapped to original bottom-left shader coordinates.
adapter='''\nwindow.fluid={splat(x,y,dx,dy,c){splat(x,1-y,dx,-dy,{r:c[0],g:c[1],b:c[2]});},step(dt){step(dt);},render(){render(null);},reset(){for(const f of [velocity.read,velocity.write,dye.read,dye.write,pressure.read,pressure.write,divergence,curl]){gl.bindFramebuffer(gl.FRAMEBUFFER,f.fbo);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}gl.bindFramebuffer(gl.FRAMEBUFFER,null);},setConfig(c){Object.assign(config,c);updateKeywords();}};\nrender(null);\n'''
(R/'web/reference.js').write_text(s+adapter)
html='''<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#000}canvas{width:100%;height:100%;display:block}</style></head><body><canvas width="640" height="400"></canvas><script src="reference.js"></script></body></html>'''
(R/'web/reference.html').write_text(html)
print('reference adapter bytes',len(s+adapter))
