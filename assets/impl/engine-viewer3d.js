/* ==========================================================================
   engine-viewer3d.js — 3D / CAD 引擎（全部在浏览器本地完成，零网络请求）
   覆盖 slug：
     A. 3D 查看器     3d-model-viewer / stl-viewer / obj-viewer / glb-viewer / gltf-viewer
     B. 其他查看器    dxf-viewer / gerber-viewer / pcb-viewer / excellon-drill-viewer /
                      molecule-viewer / pdb-viewer / smiles-to-structure /
                      3mf-to-stl / stl-to-3mf / step-viewer / step-to-stl / step-to-obj /
                      fbx-to-glb / fbx-to-stl
     C. 模型互转      stl-to-obj / obj-to-stl / glb-to-obj / glb-to-stl / obj-to-glb
     D. 图像→3D/CAD   image-to-stl / png-to-stl / jpg-to-stl / lithophane-maker /
                      image-to-dxf / png-to-dxf / jpg-to-dxf / text-to-dxf / svg-to-dxf /
                      dxf-to-svg / gerber-to-svg / 3d-photo-maker
   说明：
     - three.js 系列（r128 UMD）按需懒加载，先 three 再 OrbitControls/loader。
     - STL / OBJ / GLB / 3MF / Gerber / DXF / Excellon / PDB / SMILES 的解析与转换
       全部自己实现（见 E.pure 导出的纯函数，可在 Node 中直接单测）。
     - STEP / FBX 采用「诚实降级」：能解就渲染/导出，解不出来就明确告知原因，
       绝不伪造模型。
   ========================================================================== */
(function () {
  'use strict';

  const E = {};
  window.TOOL_ENGINES = window.TOOL_ENGINES || {};

  /* ======================================================================
     0. 通用工具
     ====================================================================== */

  const _libPending = {};
  // 按需注入 vendor 脚本。name 支持 "THREE" 或 "THREE.OrbitControls" 这类点路径。
  function lib(src, name) {
    return new Promise((res, rej) => {
      const get = () => name.split('.').reduce((o, k) => (o == null ? o : o[k]), window);
      let cur = null;
      try { cur = get(); } catch (e) { cur = null; }
      if (cur) return res(cur);
      const key = src;
      if (_libPending[key]) { _libPending[key].push(res); return; }
      _libPending[key] = [res];
      const s = document.createElement('script');
      s.src = '../assets/vendor/' + src;
      s.onload = () => {
        const waiters = _libPending[key] || []; _libPending[key] = null;
        let v = null; try { v = get(); } catch (e) { v = null; }
        waiters.forEach(f => { if (v) f(v); else rej(new Error('已加载 ' + src + ' 但未找到 ' + name)); });
      };
      s.onerror = () => {
        const waiters = _libPending[key] || []; _libPending[key] = null;
        const err = new Error('无法加载本地库 ' + src);
        waiters.forEach(f => rej(err));
      };
      document.head.appendChild(s);
    });
  }
  const waitTick = () => new Promise(r => setTimeout(r, 0));
  const $h = (el, sel) => el.querySelector(sel);
  // 拖拽 / 点击上传绑定（本引擎的拖拽区使用自己的 id，而非 TUI.drop 的 #tDrop/#tFile）
  function wireDrop(host, dropSel, fileSel, cb) {
    const dz = typeof dropSel === 'string' ? $h(host, dropSel) : dropSel;
    const fi = typeof fileSel === 'string' ? $h(host, fileSel) : fileSel;
    if (!dz || !fi) return;
    const fire = list => { const arr = [...list].filter(Boolean); if (arr.length) cb(arr); };
    dz.addEventListener('click', e => { if (!e.target.closest('button')) fi.click(); });
    fi.addEventListener('change', () => { const list = fi.files; fire(list); fi.value = ''; });
    dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('over'));
    dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); fire(e.dataTransfer.files); });
  }
  const fmtN = n => (n == null ? '—' : Number(n).toLocaleString('en-US'));
  const f6 = v => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function esc(s) { return window.TUI ? window.TUI.esc(s) : String(s == null ? '' : s); }
  function dl(blob, name) {
    if (window.downloadBlob) window.downloadBlob(blob, name);
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
    }
  }
  function toast(m) { if (window.toast) window.toast(m); }
  function concatU8(list) {
    let n = 0; for (const a of list) n += a.length;
    const out = new Uint8Array(n); let o = 0;
    for (const a of list) { out.set(a, o); o += a.length; }
    return out;
  }
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const decLatin = new TextDecoder('latin1');

  /* ======================================================================
     1. 纯函数：三角网格（mesh = {pos:Float32Array, tris:Uint32Array}）
     ====================================================================== */

  function meshStats(m) {
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    const p = m.pos;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      if (x < minx) minx = x; if (y < miny) miny = y; if (z < minz) minz = z;
      if (x > maxx) maxx = x; if (y > maxy) maxy = y; if (z > maxz) maxz = z;
    }
    if (!isFinite(minx)) { minx = miny = minz = maxx = maxy = maxz = 0; }
    return {
      verts: p.length / 3, tris: m.tris.length / 3,
      min: [minx, miny, minz], max: [maxx, maxy, maxz],
      size: [maxx - minx, maxy - miny, maxz - minz]
    };
  }

  function triNormal(p, a, b, c) {
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const e1x = p[b] - ax, e1y = p[b + 1] - ay, e1z = p[b + 2] - az;
    const e2x = p[c] - ax, e2y = p[c + 1] - ay, e2z = p[c + 2] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [nx / l, ny / l, nz / l];
  }

  function computeVertexNormals(m) {
    const n = new Float32Array(m.pos.length);
    const p = m.pos;
    for (let t = 0; t < m.tris.length; t += 3) {
      const a = m.tris[t] * 3, b = m.tris[t + 1] * 3, c = m.tris[t + 2] * 3;
      const f = triNormal(p, a, b, c);
      n[a] += f[0]; n[a + 1] += f[1]; n[a + 2] += f[2];
      n[b] += f[0]; n[b + 1] += f[1]; n[b + 2] += f[2];
      n[c] += f[0]; n[c + 1] += f[1]; n[c + 2] += f[2];
    }
    for (let i = 0; i < n.length; i += 3) {
      const l = Math.sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]) || 1;
      n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
    }
    return n;
  }

  /* ---------- STL ---------- */
  function looksLikeAsciiSTL(u8) {
    const head = decLatin.decode(u8.subarray(0, Math.min(u8.length, 2048)));
    if (!/^\s*solid/i.test(head)) return false;
    return /facet\s+normal|outer\s+loop|vertex/i.test(head);
  }
  function parseSTLBinary(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + n * 50 > u8.byteLength) throw new Error('二进制 STL 长度与三角面数不符（文件可能被截断）');
    const pos = new Float32Array(n * 9);
    const tris = new Uint32Array(n * 3);
    let off = 84, vi = 0;
    for (let i = 0; i < n; i++) {
      off += 12; // 跳过面法线（渲染时按顶点重算更稳）
      for (let k = 0; k < 3; k++) {
        pos[vi++] = dv.getFloat32(off, true);
        pos[vi++] = dv.getFloat32(off + 4, true);
        pos[vi++] = dv.getFloat32(off + 8, true);
        off += 12;
      }
      off += 2;
      tris[i * 3] = i * 3; tris[i * 3 + 1] = i * 3 + 1; tris[i * 3 + 2] = i * 3 + 2;
    }
    return { pos, tris };
  }
  function parseSTLAscii(text) {
    const vals = [];
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m;
    while ((m = re.exec(text))) vals.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    const nv = Math.floor(vals.length / 3);
    const pos = new Float32Array(vals.slice(0, nv * 3));
    const nt = Math.floor(nv / 3);
    const tris = new Uint32Array(nt * 3);
    for (let i = 0; i < nt * 3; i++) tris[i] = i;
    return { pos, tris };
  }
  function parseSTL(buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let ascii;
    if (u8.byteLength >= 84) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === u8.byteLength) ascii = false;
      else ascii = looksLikeAsciiSTL(u8);
    } else ascii = looksLikeAsciiSTL(u8);
    return ascii ? parseSTLAscii(dec.decode(u8)) : parseSTLBinary(u8);
  }
  function meshToSTLBinary(m, name) {
    const nt = m.tris.length / 3;
    const buf = new ArrayBuffer(84 + 50 * nt);
    const dv = new DataView(buf); const u8 = new Uint8Array(buf);
    const hdr = String(name || 'exported by free-tools-site (local)').slice(0, 79);
    for (let i = 0; i < hdr.length; i++) u8[i] = hdr.charCodeAt(i) & 0xff;
    dv.setUint32(80, nt, true);
    let off = 84; const p = m.pos;
    for (let t = 0; t < nt; t++) {
      const a = m.tris[t * 3] * 3, b = m.tris[t * 3 + 1] * 3, c = m.tris[t * 3 + 2] * 3;
      const n = triNormal(p, a, b, c);
      dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true); off += 12;
      const seq = [a, b, c];
      for (let k = 0; k < 3; k++) {
        const s = seq[k];
        dv.setFloat32(off, p[s], true); dv.setFloat32(off + 4, p[s + 1], true); dv.setFloat32(off + 8, p[s + 2], true); off += 12;
      }
      dv.setUint16(off, 0, true); off += 2;
    }
    return buf;
  }
  function meshToSTLAscii(m, name) {
    const p = m.pos, L = [];
    L.push('solid ' + (name || 'model'));
    for (let t = 0; t < m.tris.length; t += 3) {
      const a = m.tris[t] * 3, b = m.tris[t + 1] * 3, c = m.tris[t + 2] * 3;
      const n = triNormal(p, a, b, c);
      L.push('  facet normal ' + f6(n[0]) + ' ' + f6(n[1]) + ' ' + f6(n[2]));
      L.push('    outer loop');
      [a, b, c].forEach(s => L.push('      vertex ' + f6(p[s]) + ' ' + f6(p[s + 1]) + ' ' + f6(p[s + 2])));
      L.push('    endloop');
      L.push('  endfacet');
    }
    L.push('endsolid ' + (name || 'model'));
    return L.join('\n');
  }

  /* ---------- OBJ ---------- */
  function meshToOBJ(m, name) {
    const p = m.pos, L = [];
    L.push('# ' + (name || 'model') + ' — converted locally in your browser');
    L.push('# vertices: ' + (p.length / 3) + '  triangles: ' + (m.tris.length / 3));
    for (let i = 0; i < p.length; i += 3) L.push('v ' + f6(p[i]) + ' ' + f6(p[i + 1]) + ' ' + f6(p[i + 2]));
    const nrm = computeVertexNormals(m);
    for (let i = 0; i < nrm.length; i += 3) L.push('vn ' + f6(nrm[i]) + ' ' + f6(nrm[i + 1]) + ' ' + f6(nrm[i + 2]));
    L.push('g ' + (name || 'model'));
    L.push('s 1');
    for (let t = 0; t < m.tris.length; t += 3) {
      const a = m.tris[t] + 1, b = m.tris[t + 1] + 1, c = m.tris[t + 2] + 1;
      L.push('f ' + a + '//' + a + ' ' + b + '//' + b + ' ' + c + '//' + c);
    }
    return L.join('\n') + '\n';
  }
  function parseOBJFull(text) {
    const v = [], vt = [], vn = [], groups = [];
    let cur = { name: 'default', faces: [] };
    groups.push(cur);
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li].trim();
      if (!raw || raw[0] === '#') continue;
      const sp = raw.split(/\s+/);
      const head = sp[0];
      if (head === 'v') { v.push(+sp[1], +sp[2], +sp[3]); }
      else if (head === 'vt') { vt.push(+sp[1], +(sp[2] || 0)); }
      else if (head === 'vn') { vn.push(+sp[1], +sp[2], +sp[3]); }
      else if (head === 'o' || head === 'g') { cur = { name: sp.slice(1).join(' ') || 'object', faces: [] }; groups.push(cur); }
      else if (head === 'f') {
        const idx = [];
        for (let i = 1; i < sp.length; i++) {
          const parts = sp[i].split('/');
          let id = parseInt(parts[0], 10);
          if (isNaN(id)) continue;
          if (id < 0) id = (v.length / 3) + id; else id = id - 1;
          idx.push(id);
        }
        for (let i = 1; i + 1 < idx.length; i++) cur.faces.push([idx[0], idx[i], idx[i + 1]]);
      }
    }
    return { v, vt, vn, groups };
  }
  function meshFromOBJ(text) {
    const o = parseOBJFull(text);
    const faces = [];
    o.groups.forEach(g => g.faces.forEach(f => faces.push(f)));
    // 只保留被引用到的顶点（OBJ 常有序号跳跃）
    const used = new Map(); const pos = [];
    const tris = new Uint32Array(faces.length * 3);
    faces.forEach((f, i) => {
      for (let k = 0; k < 3; k++) {
        const id = f[k];
        let ni = used.get(id);
        if (ni == null) { ni = pos.length / 3; used.set(id, ni); pos.push(o.v[id * 3], o.v[id * 3 + 1], o.v[id * 3 + 2]); }
        tris[i * 3 + k] = ni;
      }
    });
    return { pos: new Float32Array(pos), tris };
  }

  /* ---------- GLB / glTF ---------- */
  const COMP = { 5120: ['Int8', 1], 5121: ['Uint8', 1], 5122: ['Int16', 2], 5123: ['Uint16', 2], 5125: ['Uint32', 4], 5126: ['Float32', 4] };
  const NUMC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

  function parseGLB(buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (u8.byteLength < 20) throw new Error('GLB 文件太小');
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('不是 GLB 文件（缺少 glTF 魔数）');
    const version = dv.getUint32(4, true);
    let off = 12, json = null, bin = null;
    while (off + 8 <= u8.byteLength) {
      const clen = dv.getUint32(off, true);
      const ctype = dv.getUint32(off + 4, true);
      const data = u8.subarray(off + 8, Math.min(off + 8 + clen, u8.byteLength));
      if (ctype === 0x4E4F534A) json = JSON.parse(dec.decode(data));
      else if (ctype === 0x004E4942) bin = data;
      off += 8 + clen;
    }
    if (!json) throw new Error('GLB 缺少 JSON chunk');
    return { json, bin: bin || new Uint8Array(0), version };
  }

  function readAccessor(json, binDv, idx) {
    const acc = json.accessors[idx];
    const n = NUMC[acc.type] || 1;
    const comp = COMP[acc.componentType];
    if (!comp) throw new Error('暂不支持的 accessor componentType: ' + acc.componentType);
    const size = comp[1];
    let stride = n * size, base = 0;
    if (acc.bufferView != null) {
      const bv = json.bufferViews[acc.bufferView];
      base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
      if (bv.byteStride) stride = bv.byteStride;
    }
    const out = new Float32Array(acc.count * n);
    const method = 'get' + comp[0];
    for (let i = 0; i < acc.count; i++) {
      const row = base + i * stride;
      for (let c = 0; c < n; c++) out[i * n + c] = binDv[method](row + c * size, true);
    }
    return { data: out, n, count: acc.count };
  }

  const IDENT4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function mat4Mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function trsMatrix(node) {
    if (node.matrix) return node.matrix.slice();
    const t = node.translation || [0, 0, 0];
    const q = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const [x, y, z, w] = q;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return [
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1
    ];
  }
  function mat4Apply(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14]
    ];
  }
  function meshFromGLB(buf) {
    const { json, bin } = parseGLB(buf);
    const binDv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const pos = [], tris = [];
    let base = 0;
    const visit = (ni, parent) => {
      const node = json.nodes[ni];
      const world = mat4Mul(parent, trsMatrix(node));
      if (node.mesh != null) {
        for (const prim of json.meshes[node.mesh].primitives) {
          if (prim.attributes.POSITION == null) continue;
          const P = readAccessor(json, binDv, prim.attributes.POSITION);
          const map = new Array(P.count);
          for (let i = 0; i < P.count; i++) {
            const w = mat4Apply(world, P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]);
            map[i] = base++;
            pos.push(w[0], w[1], w[2]);
          }
          if (prim.indices != null) {
            const I = readAccessor(json, binDv, prim.indices);
            for (let i = 0; i < I.count; i += 3) tris.push(map[I.data[i]], map[I.data[i + 1]], map[I.data[i + 2]]);
          } else {
            for (let i = 0; i + 2 < P.count; i += 3) tris.push(map[i], map[i + 1], map[i + 2]);
          }
        }
      }
      (node.children || []).forEach(ci => visit(ci, world));
    };
    const scene = json.scenes ? json.scenes[json.scene || 0] : null;
    let roots;
    if (scene && scene.nodes) roots = scene.nodes;
    else roots = (json.nodes || []).map((_, i) => i);
    if (!roots.length && json.nodes) roots = json.nodes.map((_, i) => i);
    roots.forEach(r => visit(r, IDENT4));
    return { pos: new Float32Array(pos), tris: new Uint32Array(tris) };
  }

  function buildGLB(positions, normals, indices, name, material) {
    const posBytes = new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength);
    const useU16 = positions.length / 3 <= 65535;
    const idxArr = useU16 ? new Uint16Array(indices.length) : new Uint32Array(indices.length);
    for (let i = 0; i < indices.length; i++) idxArr[i] = indices[i];
    const idxBytes = new Uint8Array(idxArr.buffer, idxArr.byteOffset, idxArr.byteLength);
    const normBytes = normals ? new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength) : null;
    const padLen = n => (4 - (n % 4)) % 4;

    let binLen = posBytes.length;
    if (normBytes) binLen += normBytes.length;
    binLen += idxBytes.length;
    const bin = new Uint8Array(binLen + padLen(binLen));
    let o = 0;
    bin.set(posBytes, o); const posOff = o; o += posBytes.length;
    let nrmOff = -1;
    if (normBytes) { bin.set(normBytes, o); nrmOff = o; o += normBytes.length; }
    bin.set(idxBytes, o); const idxOff = o;

    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
    const bufferViews = [{ buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 }];
    const accessors = [{ bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max }];
    const attributes = { POSITION: 0 };
    if (nrmOff >= 0) {
      bufferViews.push({ buffer: 0, byteOffset: nrmOff, byteLength: normBytes.length, target: 34962 });
      accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' });
      attributes.NORMAL = accessors.length - 1;
    }
    bufferViews.push({ buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 });
    accessors.push({ bufferView: bufferViews.length - 1, componentType: useU16 ? 5123 : 5125, count: indices.length, type: 'SCALAR' });

    const gltf = {
      asset: { version: '2.0', generator: 'free-tools-site local converter' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, name: name || 'model' }],
      meshes: [{ name: name || 'model', primitives: [{ attributes, indices: accessors.length - 1, material: 0 }] }],
      materials: [material || { pbrMetallicRoughness: { baseColorFactor: [0.82, 0.84, 0.87, 1], metallicFactor: 0.15, roughnessFactor: 0.72 } }],
      buffers: [{ byteLength: binLen }],
      bufferViews,
      accessors
    };
    const jsonStr = JSON.stringify(gltf);
    const jsonBytesRaw = enc.encode(jsonStr);
    const jsonPad = padLen(jsonBytesRaw.length);
    const jsonLen = jsonBytesRaw.length + jsonPad;
    const total = 12 + 8 + jsonLen + 8 + bin.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true);
    out.set(jsonBytesRaw, 20);
    for (let i = 0; i < jsonPad; i++) out[20 + jsonBytesRaw.length + i] = 0x20;
    const binStart = 20 + jsonLen;
    dv.setUint32(binStart, bin.length, true); dv.setUint32(binStart + 4, 0x004E4942, true);
    out.set(bin, binStart + 8);
    return out.buffer;
  }
  function meshToGLB(m, name) {
    return buildGLB(m.pos, computeVertexNormals(m), m.tris, name);
  }

  /* ---------- zip（3MF 容器） ---------- */
  let _crcT = null;
  function crc32(u8) {
    if (!_crcT) {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
      }
      _crcT = t;
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = _crcT[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const stream = new Blob([u8]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  async function inflateRaw(u8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持 DecompressionStream，无法解压 zip');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function zipWrite(entries) { // [{name, data:Uint8Array}]
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const nameU8 = enc.encode(e.name);
      const crc = crc32(e.data);
      let method = 0, comp = e.data;
      const def = await deflateRaw(e.data);
      if (def && def.length < e.data.length) { method = 8; comp = def; }
      const lh = new Uint8Array(30 + nameU8.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, method, true); dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, comp.length, true); dv.setUint32(22, e.data.length, true);
      dv.setUint16(26, nameU8.length, true); dv.setUint16(28, 0, true);
      lh.set(nameU8, 30);
      parts.push(lh, comp);
      central.push({ nameU8, crc, method, csize: comp.length, usize: e.data.length, offset });
      offset += lh.length + comp.length;
    }
    const cdParts = []; let cdSize = 0;
    for (const c of central) {
      const ch = new Uint8Array(46 + c.nameU8.length);
      const dv = new DataView(ch.buffer);
      dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
      dv.setUint16(8, 0x0800, true); dv.setUint16(10, c.method, true); dv.setUint16(12, 0, true);
      dv.setUint16(14, 0x21, true); dv.setUint32(16, c.crc, true); dv.setUint32(20, c.csize, true);
      dv.setUint32(24, c.usize, true); dv.setUint16(28, c.nameU8.length, true);
      dv.setUint16(30, 0, true); dv.setUint16(32, 0, true); dv.setUint16(34, 0, true);
      dv.setUint16(36, 0, true); dv.setUint32(38, 0, true); dv.setUint32(42, c.offset, true);
      ch.set(c.nameU8, 46);
      cdParts.push(ch); cdSize += ch.length;
    }
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true); dv.setUint16(4, 0, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, central.length, true); dv.setUint16(10, central.length, true);
    dv.setUint32(12, cdSize, true); dv.setUint32(16, offset, true); dv.setUint16(20, 0, true);
    return concatU8(parts.concat(cdParts, [eocd]));
  }
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    const min = Math.max(0, u8.length - 22 - 65535);
    for (let i = u8.length - 22; i >= min; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('不是有效的 zip / 3MF（找不到 EOCD）');
    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < total; i++) {
      if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const lNameLen = dv.getUint16(lo + 26, true);
      const lExtraLen = dv.getUint16(lo + 28, true);
      const ds = lo + 30 + lNameLen + lExtraLen;
      const comp = u8.subarray(ds, ds + csize);
      if (method === 0) out[name] = comp;
      else if (method === 8) out[name] = await inflateRaw(comp);
      else throw new Error('不支持的 zip 压缩方法: ' + method);
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /* ---------- 3MF ---------- */
  function meshFrom3MFModel(xml) {
    const vertices = [];
    const vre = /<vertex\s+[^>]*x="([^"]+)"[^>]*y="([^"]+)"[^>]*z="([^"]+)"/g;
    let m;
    while ((m = vre.exec(xml))) vertices.push(+m[1], +m[2], +m[3]);
    const tris = [];
    const tre = /<triangle\s+[^>]*v1="(\d+)"[^>]*v2="(\d+)"[^>]*v3="(\d+)"/g;
    while ((m = tre.exec(xml))) tris.push(+m[1], +m[2], +m[3]);
    // 组件/引用（<item objectid=.. transform=..>）——尽力应用首个 build item 的变换
    const items = [];
    const ire = /<item\s+[^>]*\/?>/g;
    while ((m = ire.exec(xml))) {
      const tag = m[0];
      const om = /objectid="(\d+)"/.exec(tag);
      const tm = /transform="([^"]+)"/.exec(tag);
      if (om) items.push({ id: +om[1], transform: tm ? tm[1].trim().split(/\s+/).map(Number) : null });
    }
    return { pos: new Float32Array(vertices), tris: new Uint32Array(tris), items };
  }
  async function meshFrom3MF(buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    const files = await unzip(u8);
    let modelName = null;
    for (const k of Object.keys(files)) {
      if (/3dmodel\.model$/i.test(k)) { modelName = k; break; }
    }
    if (!modelName) for (const k of Object.keys(files)) if (/\.model$/i.test(k)) { modelName = k; break; }
    if (!modelName) throw new Error('3MF 包内没有找到 3D/3dmodel.model');
    const xml = dec.decode(files[modelName]);
    const mesh = meshFrom3MFModel(xml);
    if (!mesh.pos.length || !mesh.tris.length) throw new Error('3MF 模型未包含可解析的顶点/三角面');
    return mesh;
  }
  async function meshTo3MF(m, name) {
    const P = [];
    for (let i = 0; i < m.pos.length; i += 3) {
      P.push('     <vertex x="' + f6(m.pos[i]) + '" y="' + f6(m.pos[i + 1]) + '" z="' + f6(m.pos[i + 2]) + '"/>');
    }
    const T = [];
    for (let i = 0; i < m.tris.length; i += 3) {
      T.push('     <triangle v1="' + m.tris[i] + '" v2="' + m.tris[i + 1] + '" v3="' + m.tris[i + 2] + '"/>');
    }
    const model = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
      ' <metadata name="Title">' + esc(name || 'model') + '</metadata>\n' +
      ' <resources>\n  <object id="1" type="model" name="' + esc(name || 'model') + '">\n   <mesh>\n' +
      '    <vertices>\n' + P.join('\n') + '\n    </vertices>\n' +
      '    <triangles>\n' + T.join('\n') + '\n    </triangles>\n' +
      '   </mesh>\n  </object>\n </resources>\n <build><item objectid="1"/></build>\n</model>\n';
    const contentTypes = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>' +
      '</Types>';
    const rels = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>' +
      '</Relationships>';
    return zipWrite([
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rels) },
      { name: '3D/3dmodel.model', data: enc.encode(model) }
    ]);
  }

  /* ======================================================================
     2. 纯函数：CAD / 2D 格式
     ====================================================================== */

  /* ---------- ACI 颜色（简化表：基础色 + 灰阶） ---------- */
  const ACI = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff',
    7: '#ffffff', 8: '#808080', 9: '#c0c0c0', 10: '#ff0000', 11: '#ff7f7f', 12: '#cc0000',
    30: '#ff7f00', 40: '#00ff7f', 50: '#ffff7f', 60: '#7f7fff', 70: '#ff7fff',
    250: '#333333', 251: '#5b5b5b', 252: '#848484', 253: '#adadad', 254: '#d6d6d6', 255: '#ffffff'
  };
  function aciToRgb(i) {
    if (ACI[i]) return ACI[i];
    if (i >= 250) { const v = Math.round((i - 250) / 5 * 255); const h = v.toString(16).padStart(2, '0'); return '#' + h + h + h; }
    // 简化：用 HSL 近似 1..249 的色环
    const hue = ((i - 1) * 15) % 360;
    return hslToHex(hue, 0.75, 0.55);
  }
  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    const to = v => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return '#' + to(r) + to(g) + to(b);
  }

  /* ---------- DXF ---------- */
  function dxfPairs(text) {
    const lines = text.split(/\r\n|\r|\n/);
    const out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      if (isNaN(code)) continue;
      out.push([code, lines[i + 1].replace(/\s+$/, '')]);
    }
    return out;
  }
  function parseDXF(text) {
    const pairs = dxfPairs(text);
    const layers = { 0: { color: '#ffffff', aci: 7 } };
    const blocks = {};
    const entities = [];
    const counts = {};
    const unsupported = {};
    let i = 0, section = null, inBlocks = false, curBlock = null;
    let ent = null;
    let polyParent = null;
    const handleBulge = (pts, bulges) => {
      const out = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        out.push(a);
        const bulge = bulges[k] || 0;
        if (Math.abs(bulge) > 1e-9 && k + 1 < pts.length + (polyClosed ? 1 : 0)) {
          const dx = b[0] - a[0], dy = b[1] - a[1];
          const d = Math.hypot(dx, dy);
          if (d > 1e-9) {
            const theta = 4 * Math.atan(bulge);
            const r = d / (2 * Math.sin(theta / 2));
            const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
            const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2))) * (bulge > 0 ? 1 : -1);
            const nx = -dy / d, ny = dx / d;
            const cx = mx + nx * h, cy = my + ny * h;
            let a0 = Math.atan2(a[1] - cy, a[0] - cx);
            let a1 = Math.atan2(b[1] - cy, b[0] - cx);
            let sweep = theta;
            const steps = Math.max(4, Math.min(48, Math.round(Math.abs(sweep) * 12)));
            for (let s = 1; s < steps; s++) {
              const t = a0 + sweep * (s / steps);
              out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
            }
          }
        }
      }
      return out;
    };
    const commit = () => {
      if (!ent) return;
      if (ent.type === 'VERTEX') {
        // 老式 POLYLINE 的顶点：收集进父级多段线，不单独计入图元
        if (ent.parent && ent.x != null && ent.y != null) {
          ent.parent.pts.push([ent.x, ent.y]);
          ent.parent.bulges.push(ent.bulge || 0);
        }
        ent = null; return;
      }
      counts[ent.type] = (counts[ent.type] || 0) + 1;
      entities.push(ent);
      ent = null;
    };
    const ensure = t => { if (!ent) ent = { type: t, layer: '0', color: null }; return ent; };
    const push = target => {
      const seq = inBlocks ? curBlock.ents : null;
      if (seq) seq.push(target); else entities.push(target);
    };

    while (i < pairs.length) {
      const [code, valRaw] = pairs[i];
      const val = valRaw.trim();
      if (code === 0) {
        if (val === 'SECTION') { section = (pairs[i + 1] && pairs[i + 1][0] === 2) ? pairs[i + 1][1].trim() : null; i += 2; inBlocks = section === 'BLOCKS'; curBlock = null; continue; }
        if (val === 'ENDSEC') { if (ent) commit(); section = null; inBlocks = false; curBlock = null; i++; continue; }
        if (val === 'BLOCK') { curBlock = { name: '?', ents: [] }; i++; continue; }
        if (val === 'ENDBLK') { if (curBlock) blocks[curBlock.name] = curBlock.ents; curBlock = null; i++; continue; }
        if (val === 'SEQEND') { polyParent = null; i++; continue; }
        if (val === 'POLYLINE') {
          commit();
          ent = { type: 'POLYLINE', layer: '0', color: null, pts: [], closed: false, bulges: [] };
          polyParent = ent;
          i++; continue;
        }
        if (val === 'VERTEX') {
          commit();
          ent = { type: 'VERTEX', layer: polyParent ? polyParent.layer : '0', color: polyParent ? polyParent.color : null, x: null, y: null, bulge: 0, parent: polyParent };
          i++; continue;
        }
        if (val === 'LWPOLYLINE') { commit(); ent = { type: 'LWPOLYLINE', layer: '0', color: null, pts: [], closed: false, bulges: [] }; i++; continue; }
        commit();
        const known = ['LINE', 'CIRCLE', 'ARC', 'TEXT', 'MTEXT', 'ELLIPSE', 'SPLINE', 'POINT', 'INSERT', '3DFACE', 'SOLID', 'POLYLINE', 'LWPOLYLINE'];
        if (known.indexOf(val) >= 0) ent = { type: val, layer: '0', color: null, pts: [] };
        else { unsupported[val] = (unsupported[val] || 0) + 1; ent = null; }
        i++; continue;
      }
      if (section === 'TABLES' && ent == null) {
        // 简单抓取 LAYER 表：靠 code 2 名称 + code 62 颜色，用最近一次 0/LAYER 判断
        if (code === 2 && /^[^ ]+$/.test(val) && i > 0) {
          // 记录候选，稍后配合 62
          const prevName = val;
          for (let j = i; j < Math.min(i + 12, pairs.length); j++) {
            if (pairs[j][0] === 62) { layers[prevName] = { color: aciToRgb(parseInt(pairs[j][1], 10) || 7), aci: parseInt(pairs[j][1], 10) || 7 }; break; }
            if (pairs[j][0] === 0) break;
          }
        }
        i++; continue;
      }
      if (!ent) { i++; continue; }
      const n = parseFloat(val);
      switch (ent.type) {
        case 'LINE':
          if (code === 10) ent.x1 = n; else if (code === 20) ent.y1 = n;
          else if (code === 11) ent.x2 = n; else if (code === 21) ent.y2 = n;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'CIRCLE':
        case 'ARC':
          if (code === 10) ent.cx = n; else if (code === 20) ent.cy = n; else if (code === 40) ent.r = n;
          else if (code === 50) ent.a0 = n; else if (code === 51) ent.a1 = n;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'ELLIPSE':
          if (code === 10) ent.cx = n; else if (code === 20) ent.cy = n;
          else if (code === 11) ent.mx = n; else if (code === 21) ent.my = n;
          else if (code === 40) ent.ratio = n; else if (code === 41) ent.a0 = n; else if (code === 42) ent.a1 = n;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'TEXT':
        case 'MTEXT':
          if (code === 10) ent.x = n; else if (code === 20) ent.y = n; else if (code === 1) ent.text = val;
          else if (code === 40) ent.h = n; else if (code === 50) ent.rot = n;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'SPLINE':
          if (code === 10) ent.pts.push([n, ent.pts.length && ent.pts[ent.pts.length - 1].length === 1 ? NaN : ent.pts.length ? null : null]);
          if (code === 10) { ent.pts[ent.pts.length - 1] = [n]; }
          else if (code === 20 && ent.pts.length) { const last = ent.pts[ent.pts.length - 1]; if (last.length === 1) last.push(n); }
          else if (code === 70) ent.flags = parseInt(val, 10);
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'VERTEX':
          if (code === 10) ent.x = n; else if (code === 20) ent.y = n; else if (code === 42) ent.bulge = n;
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE':
          if (code === 10) { ent.pts.push([n, null]); ent.bulges.push(0); }
          else if (code === 20 && ent.pts.length) { ent.pts[ent.pts.length - 1][1] = n; }
          else if (code === 42 && ent.pts.length) { ent.bulges[ent.pts.length - 1] = n; }
          else if (code === 70) ent.closed = (parseInt(val, 10) & 1) === 1;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        case 'INSERT':
          if (code === 10) ent.x = n; else if (code === 20) ent.y = n;
          else if (code === 41) ent.sx = n; else if (code === 42) ent.sy = n; else if (code === 50) ent.rot = n;
          else if (code === 2) ent.block = val;
          else if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
          break;
        default:
          if (code === 8) ent.layer = val; else if (code === 62) ent.color = parseInt(val, 10);
      }
      i++;
    }
    if (ent) commit();

    // 归一化：展开 bulges、椭圆、样条 → 折线；解析 INSERT
    const norm = [];
    entities.forEach(e => {
      const color = e.color != null && e.color !== 0 && e.color !== 256
        ? aciToRgb(e.color)
        : (layers[e.layer] ? layers[e.layer].color : '#ffffff');
      if (e.type === 'LINE' && e.x1 != null) norm.push({ type: 'line', x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, color });
      else if (e.type === 'CIRCLE') norm.push({ type: 'circle', cx: e.cx, cy: e.cy, r: e.r, color });
      else if (e.type === 'ARC') norm.push({ type: 'arc', cx: e.cx, cy: e.cy, r: e.r, a0: e.a0 || 0, a1: e.a1 || 360, color });
      else if (e.type === 'ELLIPSE') {
        const mx = e.mx || 0, my = e.my || 0, ratio = e.ratio || 1;
        const a0 = e.a0 || 0, a1 = e.a1 == null ? Math.PI * 2 : e.a1;
        const pts = [];
        for (let s = 0; s <= 64; s++) {
          const t = a0 + (a1 - a0) * s / 64;
          pts.push([e.cx + mx * Math.cos(t) - my * ratio * Math.sin(t), e.cy + mx * Math.sin(t) + my * ratio * Math.cos(t)]);
        }
        norm.push({ type: 'polyline', pts, closed: false, color });
      } else if (e.type === 'SPLINE') {
        const pts = (e.pts || []).filter(p => p && p.length === 2 && p[1] != null);
        if (pts.length > 1) norm.push({ type: 'polyline', pts, closed: (e.flags & 1) === 1, color, note: '仅取控制点折线' });
      } else if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        const pts = e.pts.filter(p => p[1] != null);
        if (pts.length > 1) {
          const expanded = handleBulge(pts, e.bulges);
          norm.push({ type: 'polyline', pts: e.closed ? expanded.concat([expanded[0]]) : expanded, closed: e.closed, color });
        }
      } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
        norm.push({ type: 'text', x: e.x, y: e.y, h: e.h || 2.5, rot: (e.rot || 0) * Math.PI / 180, text: e.text || '', color });
      } else if (e.type === 'INSERT' && e.block && blocks[e.block]) {
        const sx = e.sx == null ? 1 : e.sx, sy = e.sy == null ? 1 : e.sy, rot = (e.rot || 0) * Math.PI / 180;
        const cos = Math.cos(rot), sin = Math.sin(rot);
        const tf = (x, y) => [e.x + (x * cos - y * sin) * sx, e.y + (x * sin + y * cos) * sy];
        blocks[e.block].forEach(b => {
          if (b.type === 'LINE' && b.x1 != null) { const p1 = tf(b.x1, b.y1), p2 = tf(b.x2, b.y2); norm.push({ type: 'line', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], color }); }
          else if ((b.type === 'LWPOLYLINE' || b.type === 'POLYLINE') && b.pts) {
            const pts = b.pts.filter(p => p[1] != null).map(p => tf(p[0], p[1]));
            if (pts.length > 1) norm.push({ type: 'polyline', pts, closed: b.closed, color });
          }
        });
        counts['INSERT(已展开=1层)'] = (counts['INSERT(已展开=1层)'] || 0) + 1;
      } else if (e.type === 'POINT' && e.x1 != null) {
        norm.push({ type: 'point', x: e.x1, y: e.y1, color });
      }
    });

    // bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
    norm.forEach(e => {
      if (e.type === 'line') { acc(e.x1, e.y1); acc(e.x2, e.y2); }
      else if (e.type === 'circle' || e.type === 'arc') { acc(e.cx - e.r, e.cy - e.r); acc(e.cx + e.r, e.cy + e.r); }
      else if (e.type === 'polyline') e.pts.forEach(p => acc(p[0], p[1]));
      else if (e.type === 'text' || e.type === 'point') acc(e.x, e.y);
    });
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
    return { entities: norm, layers, counts, unsupported, bounds: { minX, minY, maxX, maxY } };
  }

  function dxfEntityToSegs(e, out) {
    if (e.type === 'line') out.push([e.x1, e.y1, e.x2, e.y2, e.color]);
    else if (e.type === 'circle') {
      const N = 64;
      for (let i = 0; i < N; i++) {
        const t0 = i / N * Math.PI * 2, t1 = (i + 1) / N * Math.PI * 2;
        out.push([e.cx + e.r * Math.cos(t0), e.cy + e.r * Math.sin(t0), e.cx + e.r * Math.cos(t1), e.cy + e.r * Math.sin(t1), e.color]);
      }
    } else if (e.type === 'arc') {
      let a0 = (e.a0 || 0) * Math.PI / 180, a1 = (e.a1 || 360) * Math.PI / 180;
      if (a1 <= a0) a1 += Math.PI * 2;
      const N = Math.max(6, Math.round((a1 - a0) / (Math.PI * 2) * 64));
      for (let i = 0; i < N; i++) {
        const t0 = a0 + (a1 - a0) * i / N, t1 = a0 + (a1 - a0) * (i + 1) / N;
        out.push([e.cx + e.r * Math.cos(t0), e.cy + e.r * Math.sin(t0), e.cx + e.r * Math.cos(t1), e.cy + e.r * Math.sin(t1), e.color]);
      }
    } else if (e.type === 'polyline') {
      for (let i = 0; i + 1 < e.pts.length; i++) out.push([e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1], e.color]);
    } else if (e.type === 'text') {
      const s = (e.h || 2.5) * 0.6;
      out.push([e.x, e.y, e.x + s, e.y, e.color]);
      out.push([e.x, e.y, e.x, e.y + s, e.color]);
    }
  }

  function dxfToSvgText(text, opts) {
    opts = opts || {};
    const parsed = parseDXF(text);
    const b = parsed.bounds;
    const pad = Math.max(1, (b.maxX - b.minX) * 0.03);
    const W = (b.maxX - b.minX) || 1, H = (b.maxY - b.minY) || 1;
    const lw = opts.strokeWidth == null ? Math.max(0.05, Math.max(W, H) / 1000) : opts.strokeWidth;
    const bg = opts.bg || '#0b0b0b';
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (b.minX - pad) + ' ' + (-b.maxY - pad) + ' ' + (W + pad * 2) + ' ' + (H + pad * 2) + '">');
    if (bg && bg !== 'none') parts.push('<rect x="' + (b.minX - pad) + '" y="' + (-b.maxY - pad) + '" width="' + (W + pad * 2) + '" height="' + (H + pad * 2) + '" fill="' + bg + '"/>');
    parts.push('<g transform="scale(1,-1)" fill="none" stroke-linecap="round">');
    parsed.entities.forEach(e => {
      const c = opts.mono ? (opts.monoColor || '#d7f452') : e.color;
      if (e.type === 'line') parts.push('<line x1="' + e.x1 + '" y1="' + e.y1 + '" x2="' + e.x2 + '" y2="' + e.y2 + '" stroke="' + c + '" stroke-width="' + lw + '"/>');
      else if (e.type === 'circle') parts.push('<circle cx="' + e.cx + '" cy="' + e.cy + '" r="' + e.r + '" stroke="' + c + '" stroke-width="' + lw + '"/>');
      else if (e.type === 'arc') {
        const a0 = (e.a0 || 0), a1 = (e.a1 || 360);
        const p0 = [e.cx + e.r * Math.cos(a0 * Math.PI / 180), e.cy + e.r * Math.sin(a0 * Math.PI / 180)];
        const p1 = [e.cx + e.r * Math.cos(a1 * Math.PI / 180), e.cy + e.r * Math.sin(a1 * Math.PI / 180)];
        let sweep = a1 - a0; while (sweep <= 0) sweep += 360;
        const large = sweep > 180 ? 1 : 0;
        parts.push('<path d="M ' + p0[0] + ' ' + p0[1] + ' A ' + e.r + ' ' + e.r + ' 0 ' + large + ' 0 ' + p1[0] + ' ' + p1[1] + '" stroke="' + c + '" stroke-width="' + lw + '"/>');
      } else if (e.type === 'polyline') {
        parts.push('<polyline points="' + e.pts.map(p => p[0] + ',' + p[1]).join(' ') + '" stroke="' + c + '" stroke-width="' + lw + '"/>');
      } else if (e.type === 'text') {
        const t = esc(e.text);
        parts.push('<g transform="translate(' + e.x + ',' + e.y + ') scale(1,-1) rotate(' + (-(e.rot || 0) * 180 / Math.PI) + ')"><text x="0" y="0" fill="' + c + '" font-size="' + (e.h || 2.5) + '" font-family="monospace">' + t + '</text></g>');
      }
    });
    parts.push('</g></svg>');
    return { svg: parts.join('\n'), stats: { entities: parsed.entities.length, ...parsed.counts } };
  }

  /* ---------- Gerber（RS-274X） ---------- */
  function parseGerber(text) {
    const segs = [], flashes = [], arcs = [], regions = [];
    const apertures = {};
    let unit = 'mm', unitFactor = 1;
    let xInt = 3, xDec = 3, yInt = 3, yDec = 3;
    let polarity = 'D';
    let curD = null;
    let X = 0, Y = 0;
    let interp = 1;
    let inRegion = false, regionPts = null;
    let hasExplicitDecimal = false;
    const stats = { draws: 0, moves: 0, flashes: 0, arcs: 0, regions: 0, apertures: 0, unsupported: {} };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };

    const coord = (raw, decArg) => {
      if (raw == null) return null;
      let s = String(raw).trim();
      let sign = 1;
      if (s[0] === '+') s = s.slice(1); else if (s[0] === '-') { sign = -1; s = s.slice(1); }
      if (s.indexOf('.') >= 0) { hasExplicitDecimal = true; return sign * parseFloat(s) * unitFactor; }
      const dec = decArg != null ? decArg : xDec;
      const ip = s.length > dec ? s.slice(0, s.length - dec) : '0';
      const fp = s.length > dec ? s.slice(s.length - dec) : s.padStart(dec, '0');
      return sign * parseFloat((ip || '0') + '.' + (fp || '0')) * unitFactor;
    };

    const extended = (body) => {
      const b = body.replace(/\*/g, '').trim();
      let m;
      if ((m = /^FS([LT]?)([AI]?)X(\d)(\d)Y(\d)(\d)/.exec(b))) {
        xInt = +m[3]; xDec = +m[4]; yInt = +m[5]; yDec = +m[6];
      } else if ((m = /^MO(MM|IN)/.exec(b))) {
        unit = m[1] === 'MM' ? 'mm' : 'inch';
        unitFactor = unit === 'mm' ? 1 : 25.4;
      } else if ((m = /^ADD(\d+)([A-Za-z]),?([\dXx.\-]*)/.exec(b))) {
        const d = +m[1], type = m[2].toUpperCase();
        const params = (m[3] || '').split(/[Xx]/).map(v => parseFloat(v)).filter(v => !isNaN(v));
        apertures[d] = { type, params, dcode: d };
        stats.apertures++;
      } else if ((m = /^LP([DC])/.exec(b))) {
        polarity = m[1];
      } else if (/^AM/.test(b)) {
        stats.unsupported['AM(光圈宏)'] = (stats.unsupported['AM(光圈宏)'] || 0) + 1;
      }
    };

    const command = (cmd) => {
      if (!cmd) return;
      let m;
      if ((m = /G(\d+)/.exec(cmd))) {
        const g = +m[1];
        if (g === 1) interp = 1;
        else if (g === 2) interp = 2;
        else if (g === 3) interp = 3;
        else if (g === 36) { inRegion = true; regionPts = []; stats.regions++; }
        else if (g === 37) { if (regionPts && regionPts.length > 2) regions.push({ pts: regionPts, polarity }); inRegion = false; regionPts = null; }
      }
      if (/D(\d+)/.test(cmd)) {
        const dms = cmd.match(/D(\d+)/g);
        dms.forEach(ds => {
          const d = +ds.slice(1);
          if (d >= 10) { curD = d; }
          else if (d === 1 || d === 2 || d === 3) {
            const xm = /X([+-]?\d*\.?\d+)/.exec(cmd);
            const ym = /Y([+-]?\d*\.?\d+)/.exec(cmd);
            const nx = xm ? coord(xm[1], xDec) : X;
            const ny = ym ? coord(ym[1], yDec) : Y;
            const ap = curD != null ? apertures[curD] : null;
            if (d === 2) {
              stats.moves++;
              if (inRegion && regionPts) { regionPts.push([nx, ny]); }
            } else if (d === 1) {
              if (interp === 2 || interp === 3) {
                const im = /I(-?\d*\.?\d+)/.exec(cmd), jm = /J(-?\d*\.?\d+)/.exec(cmd);
                const ioff = im ? coord(im[1], xDec) : 0, joff = jm ? coord(jm[1], yDec) : 0;
                const cx = X + ioff, cy = Y + joff;
                const r = Math.hypot(ioff, joff) || 1e-9;
                let a0 = Math.atan2(Y - cy, X - cx);
                let a1 = Math.atan2(ny - cy, nx - cx);
                let sweep = a1 - a0;
                if (interp === 2) { while (sweep > 0) sweep -= Math.PI * 2; }
                else { while (sweep < 0) sweep += Math.PI * 2; }
                const steps = Math.max(6, Math.round(Math.abs(sweep) / (Math.PI * 2) * 64));
                const pts = [];
                for (let s = 0; s <= steps; s++) { const t = a0 + sweep * s / steps; pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]); }
                arcs.push({ pts, polarity, ap: curD, w: apWidth(ap, unitFactor) });
                pts.forEach(p => acc(p[0], p[1]));
                stats.arcs++;
                if (inRegion && regionPts) pts.forEach(p => regionPts.push(p));
              } else {
                const w = apWidth(ap, unitFactor);
                segs.push({ x1: X, y1: Y, x2: nx, y2: ny, w, ap: curD, polarity });
                stats.draws++;
                acc(X, Y); acc(nx, ny);
                if (inRegion && regionPts) regionPts.push([nx, ny]);
              }
            } else if (d === 3) {
              flashes.push({ x: nx, y: ny, ap, dcode: curD, polarity });
              stats.flashes++;
              const r = flashRadius(ap, unitFactor);
              acc(nx - r, ny - r); acc(nx + r, ny + r);
            }
            X = nx; Y = ny;
          }
        });
        return;
      }
      // 纯坐标 + 隐式 D01（部分文件省略 D 码，默认画线）
      const xm = /X([+-]?\d*\.?\d+)/.exec(cmd);
      const ym = /Y([+-]?\d*\.?\d+)/.exec(cmd);
      if ((xm || ym) && !/D[123]\b/.test(cmd) && curD != null) {
        const nx = xm ? coord(xm[1], xDec) : X;
        const ny = ym ? coord(ym[1], yDec) : Y;
        const ap = apertures[curD];
        segs.push({ x1: X, y1: Y, x2: nx, y2: ny, w: apWidth(ap, unitFactor), ap: curD, polarity });
        stats.draws++; acc(X, Y); acc(nx, ny);
        X = nx; Y = ny;
      }
    };
    function apWidth(ap, uf) {
      if (!ap) return 0.15;
      const u = ap.type === 'C' ? (ap.params[0] || 0.15)
        : ap.type === 'R' ? Math.min(ap.params[0] || 0.15, ap.params[1] || 0.15)
          : ap.type === 'O' ? Math.min(ap.params[0] || 0.15, ap.params[1] || 0.15)
            : ap.type === 'P' ? 2 * (ap.params[0] || 0.1) : (ap.params[0] || 0.15);
      return u * uf;
    }
    function flashRadius(ap, uf) {
      if (!ap) return 0.1;
      if (ap.type === 'R' || ap.type === 'O') return Math.max(ap.params[0] || 0.1, ap.params[1] || 0.1) / 2 * uf;
      if (ap.type === 'P') return (ap.params[0] || 0.1) * uf;
      return (ap.params[0] || 0.1) / 2 * uf;
    }

    let i = 0;
    const s = text;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      const ch = s[i];
      if (ch === '%') {
        const j = s.indexOf('%', i + 1);
        if (j < 0) break;
        extended(s.slice(i + 1, j));
        i = j + 1; continue;
      }
      const j = s.indexOf('*', i);
      if (j < 0) break;
      const cmd = s.slice(i, j).trim();
      if (cmd) command(cmd);
      i = j + 1;
    }
    if (inRegion && regionPts && regionPts.length > 2) regions.push({ pts: regionPts, polarity });

    let area = 0;
    flashes.forEach(f => { const r = flashRadius(f.ap, unitFactor); area += Math.PI * r * r; });
    regions.forEach(r => { area += Math.abs(polyArea(r.pts)); });
    const bounds = { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0, maxX: isFinite(maxX) ? maxX : 1, maxY: isFinite(maxY) ? maxY : 1 };
    return {
      segs, flashes, arcs, regions, apertures, unit, bounds, stats,
      size: [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY],
      area,
      note: hasExplicitDecimal ? null : ('文件未使用小数点，按 %FS 声明的 ' + xInt + ':' + xDec + ' 位格式解析')
    };
  }
  function polyArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]);
    return a / 2;
  }
  function hexToStroke(polarity, color) { return polarity === 'C' ? null : color; }

  function gerberToSvgText(layers) {
    // layers: [{name, color, parsed}]
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    layers.forEach(L => { const b = L.parsed.bounds; minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); });
    if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
    const pad = Math.max(0.5, (maxX - minX) * 0.03);
    const W = (maxX - minX) || 1, H = (maxY - minY) || 1;
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (minX - pad) + ' ' + (-maxY - pad) + ' ' + (W + pad * 2) + ' ' + (H + pad * 2) + '">');
    parts.push('<g transform="scale(1,-1)" fill="none" stroke-linecap="round" stroke-linejoin="round">');
    layers.forEach(L => {
      const p = L.parsed, c = L.color;
      const g = [];
      p.arcs.concat([]).forEach(a => { g.push('<path d="' + a.pts.map((pt, i) => (i ? 'L' : 'M') + pt[0] + ' ' + pt[1]).join(' ') + '" stroke="' + c + '" stroke-width="' + Math.max(0.02, a.w) + '"/>'); });
      p.segs.forEach(sg => { g.push('<line x1="' + sg.x1 + '" y1="' + sg.y1 + '" x2="' + sg.x2 + '" y2="' + sg.y2 + '" stroke="' + c + '" stroke-width="' + Math.max(0.02, sg.w) + '"/>'); });
      p.regions.forEach(r => { g.push('<polygon points="' + r.pts.map(pt => pt[0] + ',' + pt[1]).join(' ') + '" fill="' + c + '" fill-opacity="0.85" stroke="none"/>'); });
      p.flashes.forEach(f => {
        const ap = f.ap, u = L.parsed.unit === 'inch' ? 25.4 : 1;
        if (!ap) return;
        if (ap.type === 'R') g.push('<rect x="' + (f.x - ap.params[0] * u / 2) + '" y="' + (f.y - ap.params[1] * u / 2) + '" width="' + (ap.params[0] * u) + '" height="' + (ap.params[1] * u) + '" fill="' + c + '" stroke="none"/>');
        else if (ap.type === 'O') g.push('<rect x="' + (f.x - ap.params[0] * u / 2) + '" y="' + (f.y - ap.params[1] * u / 2) + '" width="' + (ap.params[0] * u) + '" height="' + (ap.params[1] * u) + '" rx="' + (Math.min(ap.params[0], ap.params[1]) * u / 2) + '" fill="' + c + '" stroke="none"/>');
        else if (ap.type === 'P') {
          const n = ap.params[1] || 6, r = ap.params[0] * u, pts = [];
          for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2 + Math.PI / 2; pts.push((f.x + r * Math.cos(t)) + ',' + (f.y + r * Math.sin(t))); }
          g.push('<polygon points="' + pts.join(' ') + '" fill="' + c + '" stroke="none" transform="rotate(' + (ap.params[2] || 0) + ' ' + f.x + ' ' + f.y + ')"/>');
        } else g.push('<circle cx="' + f.x + '" cy="' + f.y + '" r="' + ((ap.params[0] || 0.1) * u / 2) + '" fill="' + c + '" stroke="none"/>');
      });
      parts.push('<g>' + g.join('') + '</g>');
    });
    parts.push('</g></svg>');
    return parts.join('\n');
  }

  /* ---------- Excellon 钻孔 ---------- */
  function parseExcellon(text) {
    const lines = text.split(/\r\n|\r|\n/).map(l => l.trim());
    let unit = 'inch', decimals = null, inHeader = false, curTool = null;
    const tools = {}, holes = [];
    let lastPos = null;
    const stats = { plated: 0, slots: 0, toolChanges: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = (x, y) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
    const toMm = v => v * (unit === 'inch' ? 25.4 : 1);
    const parseC = (tok) => {
      if (tok == null) return null;
      if (tok.indexOf('.') >= 0) return parseFloat(tok);
      const d = decimals == null ? (unit === 'inch' ? 4 : 3) : decimals;
      const s = tok.replace(/^[+-]/, '');
      const sign = tok[0] === '-' ? -1 : 1;
      const ip = s.length > d ? s.slice(0, s.length - d) : '0';
      const fp = s.length > d ? s.slice(s.length - d) : s.padStart(d, '0');
      return sign * parseFloat((ip || '0') + '.' + fp);
    };
    for (const raw of lines) {
      if (!raw || raw[0] === ';') continue;
      let m;
      if (/^M48/.test(raw)) { inHeader = true; continue; }
      if (/^%$/.test(raw) || /^M95/.test(raw)) { inHeader = false; continue; }
      if (/^METRIC/.test(raw)) { unit = 'mm'; if (decimals == null) decimals = 3; continue; }
      if (/^INCH/.test(raw)) { unit = 'inch'; if (decimals == null) decimals = 4; continue; }
      if ((m = /^;.*FORMAT\s*=\s*\{?(\d)[:.](\d)/i.exec(raw))) { decimals = +m[2]; continue; }
      if (/^(FMAT|VER|DETECT|FILE_FORMAT|TYPE|HEADER|END_HEADER|M71|M72)/.test(raw)) continue;
      if ((m = /^T0*(\d+)C([\d.]+)/.exec(raw))) { tools[+m[1]] = { d: toMm(parseFloat(m[2])), raw: parseFloat(m[2]) }; continue; }
      if ((m = /^T0*(\d+)$/.exec(raw))) { curTool = +m[1]; stats.toolChanges++; continue; }
      if (/^M30/.test(raw)) break;
      if (/^G85/.test(raw)) {
        const xm = /X([+-]?[\d.]+)/.exec(raw), ym = /Y([+-]?[\d.]+)/.exec(raw);
        if (xm || ym) {
          const x = toMm(parseC(xm ? xm[1] : null) || 0), y = toMm(parseC(ym ? ym[1] : null) || 0);
          if (lastPos) { holes.push({ x1: lastPos.x, y1: lastPos.y, x2: x, y2: y, d: curTool != null && tools[curTool] ? tools[curTool].d : 0.8, tool: curTool, slot: true }); stats.slots++; }
          lastPos = { x, y }; acc(x, y);
        }
        continue;
      }
      if (/^G0*[0-9]/.test(raw) && !/X|Y/.test(raw)) continue;
      const xm = /X([+-]?[\d.]+)/.exec(raw), ym = /Y([+-]?[\d.]+)/.exec(raw);
      if (xm || ym) {
        const x = toMm(parseC(xm ? xm[1] : null) || 0), y = toMm(parseC(ym ? ym[1] : null) || 0);
        holes.push({ x, y, d: curTool != null && tools[curTool] ? tools[curTool].d : 0.8, tool: curTool });
        lastPos = { x, y }; acc(x, y);
      }
    }
    let area = 0;
    holes.forEach(h => { if (!h.slot) area += Math.PI * (h.d / 2) * (h.d / 2); });
    const toolCounts = {};
    holes.forEach(h => { if (h.tool != null) toolCounts[h.tool] = (toolCounts[h.tool] || 0) + 1; });
    const bounds = { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0, maxX: isFinite(maxX) ? maxX : 1, maxY: isFinite(maxY) ? maxY : 1 };
    return { unit, tools, holes, toolCounts, bounds, stats, area, size: [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY] };
  }

  /* ---------- PDB ---------- */
  const CPK = {
    H: '#ffffff', C: '#909090', N: '#3050f8', O: '#ff0d0d', F: '#90e050', CL: '#1ff01f',
    BR: '#a62929', I: '#940094', S: '#e6c53a', P: '#ff8000', B: '#ffb5b5', SI: '#f0c8a0',
    FE: '#e06633', CA: '#3dff00', MG: '#8aff00', ZN: '#7d80b0', NA: '#ab5cf2', K: '#8f40d4',
    MN: '#9c7ac7', CU: '#c88033', SE: '#ffa100', AS: '#bd80e3', NI: '#50d050'
  };
  const VDW = { H: 1.2, C: 1.7, N: 1.55, O: 1.52, F: 1.47, CL: 1.75, BR: 1.85, I: 1.98, S: 1.8, P: 1.8, default: 1.7 };
  const COV = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, F: 0.57, CL: 1.02, BR: 1.2, I: 1.39, S: 1.05, P: 1.07, default: 0.77 };
  function elementFromName(name) {
    const s = String(name || '').replace(/[^A-Za-z]/g, '');
    if (!s) return 'C';
    if (/^(CL|BR)/i.test(s)) return s.slice(0, 2).toUpperCase();
    return s[0].toUpperCase();
  }
  function parsePDB(text) {
    const atoms = [], conect = {};
    const lines = text.split(/\r\n|\r|\n/);
    for (const ln of lines) {
      const rec = ln.slice(0, 6).trim();
      if (rec === 'ATOM' || rec === 'HETATM') {
        const name = ln.slice(12, 16).trim() || ln.slice(12, 16);
        const resName = ln.slice(17, 20).trim();
        const chain = ln.slice(21, 22).trim() || 'A';
        const resSeq = parseInt(ln.slice(22, 26), 10);
        const x = parseFloat(ln.slice(30, 38));
        const y = parseFloat(ln.slice(38, 46));
        const z = parseFloat(ln.slice(46, 54));
        let el = ln.length >= 78 ? ln.slice(76, 78).trim() : '';
        if (!el) el = elementFromName(name);
        el = el.toUpperCase().replace(/[^A-Z]/g, '') || 'C';
        if (isNaN(x) || isNaN(y) || isNaN(z)) continue;
        atoms.push({ i: atoms.length, serial: parseInt(ln.slice(6, 11), 10), name, resName, chain, resSeq, x, y, z, el, het: rec === 'HETATM' });
      } else if (rec === 'CONECT') {
        const nums = ln.slice(6).trim().split(/\s+/).map(v => parseInt(v, 10)).filter(v => !isNaN(v));
        if (nums.length) conect[nums[0]] = nums.slice(1);
      }
    }
    // serial → 索引
    const bySerial = {};
    atoms.forEach(a => { bySerial[a.serial] = a.i; });
    const bonds = [];
    const seen = {};
    let usedConect = false;
    Object.keys(conect).forEach(k => {
      const a = bySerial[+k];
      if (a == null) return;
      conect[k].forEach(o => {
        const b = bySerial[o];
        if (b == null || b === a) return;
        const key = Math.min(a, b) + ':' + Math.max(a, b);
        if (seen[key]) return;
        seen[key] = 1; bonds.push([a, b]); usedConect = true;
      });
    });
    if (!usedConect) {
      const n = atoms.length;
      const cell = 2.2;
      const grid = {};
      const key = (ix, iy, iz) => ix + ',' + iy + ',' + iz;
      atoms.forEach(a => {
        const ix = Math.floor(a.x / cell), iy = Math.floor(a.y / cell), iz = Math.floor(a.z / cell);
        const k = key(ix, iy, iz);
        (grid[k] = grid[k] || []).push(a.i);
      });
      for (let i = 0; i < n; i++) {
        const a = atoms[i];
        const ix = Math.floor(a.x / cell), iy = Math.floor(a.y / cell), iz = Math.floor(a.z / cell);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid[key(ix + dx, iy + dy, iz + dz)];
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            const b = atoms[j];
            const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
            const r = (COV[a.el] || COV.default) + (COV[b.el] || COV.default) + 0.45;
            if (d2 < r * r) { const kk = i + ':' + j; if (!seen[kk]) { seen[kk] = 1; bonds.push([i, j]); } }
          }
        }
      }
    }
    const residues = new Set(), chains = new Set();
    atoms.forEach(a => { residues.add(a.chain + ':' + a.resSeq + ':' + a.resName); chains.add(a.chain); });
    let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    atoms.forEach(a => {
      minx = Math.min(minx, a.x); miny = Math.min(miny, a.y); minz = Math.min(minz, a.z);
      maxx = Math.max(maxx, a.x); maxy = Math.max(maxy, a.y); maxz = Math.max(maxz, a.z);
    });
    if (!atoms.length) { minx = miny = minz = maxx = maxy = maxz = 0; }
    const center = [(minx + maxx) / 2, (miny + maxy) / 2, (minz + maxz) / 2];
    return {
      atoms, bonds, structures: { residues: [...residues], chains: [...chains] },
      counts: { atoms: atoms.length, bonds: bonds.length, residues: residues.size, chains: chains.size, het: atoms.filter(a => a.het).length },
      bounds: { min: [minx, miny, minz], max: [maxx, maxy, maxz] }, center
    };
  }

  /* ---------- SMILES（简化解析 + 布局） ---------- */
  const MASS = {
    H: 1.008, He: 4.0026, Li: 6.94, Be: 9.0122, B: 10.81, C: 12.011, N: 14.007, O: 15.999,
    F: 18.998, Ne: 20.18, Na: 22.99, Mg: 24.305, Al: 26.982, Si: 28.085, P: 30.974, S: 32.06,
    Cl: 35.45, Ar: 39.948, K: 39.098, Ca: 40.078, Sc: 44.956, Ti: 47.867, V: 50.942, Cr: 51.996,
    Mn: 54.938, Fe: 55.845, Co: 58.933, Ni: 58.693, Cu: 63.546, Zn: 65.38, Ga: 69.723, Ge: 72.63,
    As: 74.922, Se: 78.971, Br: 79.904, Kr: 83.798, Rb: 85.468, Sr: 87.62, Y: 88.906, Zr: 91.224,
    Mo: 95.95, Ag: 107.87, Cd: 112.41, In: 114.82, Sn: 118.71, Sb: 121.76, Te: 127.6, I: 126.904,
    Xe: 131.29, Cs: 132.91, Ba: 137.33, Pt: 195.08, Au: 196.97, Hg: 200.59, Pb: 207.2, Bi: 208.98
  };
  const ORGANIC = ['Cl', 'Br', 'B', 'C', 'N', 'O', 'S', 'P', 'F', 'I'];
  function parseSMILES(smiles) {
    const s = String(smiles || '').trim();
    const atoms = [], bonds = [];
    const stack = [], ringMap = {};
    let prev = -1, pendingOrder = 1, pendingArom = false;
    const unsupported = [];
    let i = 0;
    const valenceOf = { B: 3, C: 4, N: 3, O: 2, S: 2, P: 3, F: 1, Cl: 1, Br: 1, I: 1 };
    while (i < s.length) {
      const ch = s[i];
      if (ch === '(') { stack.push(prev); i++; continue; }
      if (ch === ')') { prev = stack.length ? stack.pop() : prev; i++; continue; }
      if (ch === '-' || ch === '=' || ch === '#' || ch === ':' || ch === '/' || ch === '\\') {
        pendingOrder = ch === '=' ? 2 : ch === '#' ? 3 : 1;
        pendingArom = ch === ':';
        if (ch === '/' || ch === '\\') unsupported.push('顺反异构(/, \\) 已忽略');
        i++; continue;
      }
      if (ch === '.') { prev = -1; i++; continue; }
      if (/[0-9]/.test(ch)) {
        let num = ch; i++;
        if (ch === '0' && s[i] === '0') { /* 少见 */ }
        if (ch === '%' || (s[i] >= '0' && s[i] <= '9' && s[i - 1] === '%')) { /* noop */ }
        if (atoms.length === 0) continue;
        const cur = atoms.length - 1;
        if (prev < 0 && cur < 0) continue;
        const other = prev >= 0 ? prev : cur;
        if (ringMap[num] == null) ringMap[num] = { atom: cur, order: pendingOrder, arom: pendingArom };
        else {
          const r = ringMap[num];
          bonds.push({ a: r.atom, b: cur, order: r.order, arom: r.arom || pendingArom, ring: true });
          delete ringMap[num];
        }
        pendingOrder = 1; pendingArom = false;
        prev = cur;
        continue;
      }
      let el = null, arom = false, hCount = null, charge = 0, bracket = false;
      if (ch === '[') {
        const j = s.indexOf(']', i);
        if (j < 0) { unsupported.push('方括号未闭合'); break; }
        const inner = s.slice(i + 1, j);
        bracket = true;
        const mm = /^(\d*)([A-Za-z][a-z]?|[*])(@{1,2}|@TH\d)?([Hh]\d*)?([+-]\d*|[+-]*)?/.exec(inner);
        if (mm) {
          const sym = mm[2];
          el = /^[a-z]$/.test(sym) ? sym.toUpperCase() : sym;
          arom = /^[a-z]/.test(sym);
          if (mm[4]) hCount = mm[4].length > 1 ? parseInt(mm[4].slice(1), 10) : 1;
          if (mm[5]) { const cm = /([+-])(\d*)/.exec(mm[5]); if (cm) charge = (cm[1] === '-' ? -1 : 1) * (cm[2] ? parseInt(cm[2], 10) : 1); }
          if (mm[3]) unsupported.push('立体化学(' + mm[3] + ') 已忽略');
        } else { el = 'C'; }
        i = j + 1;
      } else if (/[A-Z]/.test(ch)) {
        let sym = ch;
        if (/[a-z]/.test(s[i + 1] || '') && ORGANIC.indexOf(s.slice(i, i + 2)) >= 0) { sym = s.slice(i, i + 2); i++; }
        el = sym;
        i++;
      } else if (/[a-z]/.test(ch) && 'bcnops'.indexOf(ch) >= 0) {
        el = ch.toUpperCase(); arom = true; i++;
      } else if (ch === '*') {
        el = '*'; i++;
      } else {
        unsupported.push('无法识别的字符 "' + ch + '"');
        i++; continue;
      }
      const idx = atoms.length;
      atoms.push({ i: idx, el, arom, h: hCount, charge, bracket, x: 0, y: 0 });
      if (prev >= 0) bonds.push({ a: prev, b: idx, order: pendingOrder, arom: pendingArom || (arom && atoms[prev].arom) });
      pendingOrder = 1; pendingArom = false;
      prev = idx;
    }
    // 环闭合残留 → 提示
    Object.keys(ringMap).forEach(k => unsupported.push('环闭合数字 ' + k + ' 未配对'));
    return { atoms, bonds, unsupported: [...new Set(unsupported)] };
  }

  function smilesFormula(mol) {
    // 计算隐式氢
    const deg = {}, border = {};
    mol.atoms.forEach(a => { deg[a.i] = 0; border[a.i] = 0; });
    mol.bonds.forEach(b => {
      const o = b.arom ? 1 : b.order;
      border[b.a] = (border[b.a] || 0) + o;
      border[b.b] = (border[b.b] || 0) + o;
      deg[b.a]++; deg[b.b]++;
    });
    const target = { B: 3, C: 4, N: 3, O: 2, S: 2, P: 3, F: 1, Cl: 1, Br: 1, I: 1 };
    const counts = {};
    let hTotal = 0;
    mol.atoms.forEach(a => {
      counts[a.el] = (counts[a.el] || 0) + 1;
      let h = 0;
      if (a.h != null) h = a.h;
      else if (a.el === '*' || MASS[a.el] == null) h = 0;
      else {
        const tv = target[a.el];
        if (tv == null) {
          if (/^[a-z]/.test(a.el)) h = 0; else h = 0;
        } else if (a.arom) {
          // 芳香：c 取 3 (余 1 H)，n/o/s 视为 0 H（近似）
          if (a.el === 'C') h = Math.max(0, 3 - (border[a.i] || 0));
          else h = 0;
        } else {
          h = Math.max(0, tv - (border[a.i] || 0));
        }
      }
      hTotal += h;
      a.hTotal = h;
    });
    if (hTotal > 0) counts.H = (counts.H || 0) + hTotal;
    // Hill 排序：C 优先，H 次之，其余字母序
    const keys = Object.keys(counts).filter(k => k !== 'H');
    keys.sort((a, b) => (a === 'C' ? -1 : b === 'C' ? 1 : a < b ? -1 : 1));
    const order = [];
    if (counts.C) order.push(['C', counts.C]);
    if (counts.H) order.push(['H', counts.H]);
    keys.filter(k => k !== 'C').forEach(k => order.push([k, counts[k]]));
    const formula = order.map(([k, v]) => k + (v > 1 ? v : '')).join('');
    let mw = 0;
    order.forEach(([k, v]) => { mw += (MASS[k] || 0) * v; });
    return { formula, mw, counts, hTotal };
  }

  function buildAdj(mol) {
    const adj = mol.atoms.map(() => []);
    mol.bonds.forEach((b, i) => {
      adj[b.a].push({ n: b.b, bond: i });
      adj[b.b].push({ n: b.a, bond: i });
    });
    return adj;
  }
  function findRings(mol) {
    const adj = buildAdj(mol);
    const ringsMap = {};
    mol.bonds.forEach((b, bi) => {
      // 移除该键后，两端间最短路径 + 该键 = 一个环
      const start = b.a, goal = b.b;
      const prev = {}; prev[start] = -1;
      const q = [start]; let found = false; let guard = 0;
      while (q.length && guard++ < 4000) {
        const u = q.shift();
        if (u === goal) { found = true; break; }
        for (const e of adj[u]) {
          if (e.bond === bi) continue;
          if (prev[e.n] === undefined) { prev[e.n] = u; q.push(e.n); }
        }
      }
      if (!found) return;
      const path = [];
      let cur = goal;
      while (cur !== -1 && cur !== undefined) { path.push(cur); cur = prev[cur]; }
      if (path.length < 3 || path.length > 9) return;
      const key = path.slice().sort((x, y) => x - y).join(',');
      if (!ringsMap[key]) ringsMap[key] = path;
    });
    return Object.keys(ringsMap).map(k => ringsMap[k]);
  }

  function layoutSMILES(mol) {
    const n = mol.atoms.length;
    if (!n) return mol;
    const adj = buildAdj(mol);
    const rings = findRings(mol);
    const isRingAtom = new Array(n).fill(false);
    rings.forEach(r => r.forEach(a => { isRingAtom[a] = true; }));

    // 初始：环放正多边形（按环大小与索引排列），其余用 BFS 树
    const placed = new Array(n).fill(false);
    rings.forEach((r, ri) => {
      // 环紧邻时稍微错开
      const R = Math.max(1.1, 0.9 / Math.sin(Math.PI / r.length));
      const offset = ri * 0.9;
      r.forEach((a, k) => {
        if (placed[a]) return;
        const t = k / r.length * Math.PI * 2 + offset;
        mol.atoms[a].x = R * Math.cos(t) + ri * 1.4;
        mol.atoms[a].y = R * Math.sin(t);
        placed[a] = true;
      });
    });
    // 从已放置原子出发做 BFS，按 120° 延伸
    const queue = [];
    for (let i = 0; i < n; i++) if (placed[i]) queue.push(i);
    if (!queue.length) { mol.atoms[0].x = 0; mol.atoms[0].y = 0; placed[0] = true; queue.push(0); }
    const seen = new Array(n).fill(false);
    for (let qi = 0; qi < queue.length; qi++) {
      const u = queue[qi];
      if (seen[u]) continue;
      seen[u] = true;
      const neighbors = adj[u];
      neighbors.forEach((e, k) => {
        const v = e.n;
        if (placed[v]) return;
        // 参考方向：从 u 指向其已放置邻居的平均反向
        let bx = 0, by = 0, cnt = 0;
        neighbors.forEach(o => { if (o.n !== v && placed[o.n]) { bx += mol.atoms[u].x - mol.atoms[o.n].x; by += mol.atoms[u].y - mol.atoms[o.n].y; cnt++; } });
        let ang;
        if (cnt) { ang = Math.atan2(by, bx) + (k % 2 ? 1 : -1) * (Math.PI / 3); }
        else ang = Math.PI * 2 * (k / Math.max(1, neighbors.length)) + qi * 0.7;
        mol.atoms[v].x = mol.atoms[u].x + Math.cos(ang);
        mol.atoms[v].y = mol.atoms[u].y + Math.sin(ang);
        placed[v] = true;
        queue.push(v);
      });
    }
    for (let i = 0; i < n; i++) if (!placed[i]) { mol.atoms[i].x = Math.cos(i) * 2; mol.atoms[i].y = Math.sin(i) * 2; }

    // 力导向微调（键长弹簧 + 非键斥力），环内原子轻微约束
    const P = mol.atoms;
    const ideal = 1.0;
    for (let iter = 0; iter < 320; iter++) {
      const fx = new Array(n).fill(0), fy = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1e-6) { dx = (Math.random() - 0.5) * 0.1; dy = (Math.random() - 0.5) * 0.1; d2 = dx * dx + dy * dy; }
        const rep = 0.28 / d2;
        const d = Math.sqrt(d2);
        fx[i] -= dx / d * rep; fy[i] -= dy / d * rep;
        fx[j] += dx / d * rep; fy[j] += dy / d * rep;
      }
      mol.bonds.forEach(b => {
        const a = P[b.a], c = P[b.b];
        let dx = c.x - a.x, dy = c.y - a.y;
        const d = Math.hypot(dx, dy) || 1e-6;
        const f = (d - ideal) * 0.35;
        dx /= d; dy /= d;
        fx[b.a] += dx * f; fy[b.a] += dy * f;
        fx[b.b] -= dx * f; fy[b.b] -= dy * f;
      });
      for (let i = 0; i < n; i++) { P[i].x += clamp(fx[i], -0.15, 0.15); P[i].y += clamp(fy[i], -0.15, 0.15); }
    }
    return mol;
  }

  function drawSMILES(canvas, mol, opts) {
    opts = opts || {};
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const bg = opts.bg || '#141414';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!mol.atoms.length) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    mol.atoms.forEach(a => { minx = Math.min(minx, a.x); miny = Math.min(miny, a.y); maxx = Math.max(maxx, a.x); maxy = Math.max(maxy, a.y); });
    const bw = (maxx - minx) || 1, bh = (maxy - miny) || 1;
    const pad = 40;
    const sc = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
    const ox = (W - bw * sc) / 2 - minx * sc;
    const oy = (H - bh * sc) / 2 + maxy * sc;
    const P = a => [a.x * sc + ox, -a.y * sc + oy];

    // 键
    const bondColor = opts.bondColor || '#c9c9c9';
    mol.bonds.forEach(b => {
      const A = mol.atoms[b.a], B = mol.atoms[b.b];
      const p = P(A), q = P(B);
      let dx = q[0] - p[0], dy = q[1] - p[1];
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d;
      const off = 3.2;
      const order = b.arom ? 1 : b.order;
      ctx.strokeStyle = bondColor; ctx.lineWidth = 1.8;
      const shrink = 9;
      const p1 = [p[0] + dx / d * shrink, p[1] + dy / d * shrink];
      const p2 = [q[0] - dx / d * shrink, q[1] - dy / d * shrink];
      if (order === 1) {
        if (b.arom) { ctx.setLineDash([5, 4]); } else ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        const lines = order === 2 ? [-off / 2, off / 2] : [-off, 0, off];
        lines.forEach(o => {
          ctx.beginPath();
          ctx.moveTo(p1[0] + nx * o, p1[1] + ny * o);
          ctx.lineTo(p2[0] + nx * o, p2[1] + ny * o);
          ctx.stroke();
        });
      }
    });
    // 原子
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    mol.atoms.forEach(a => {
      const showLabel = a.el !== 'C' || a.charge !== 0 || a.bracket;
      if (!showLabel) return;
      let label = a.el === '*' ? 'R' : a.el;
      if (a.hTotal) label += 'H' + (a.hTotal > 1 ? a.hTotal : '');
      if (a.charge) label += (a.charge > 0 ? '+' : '−') + (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '');
      const p = P(a);
      ctx.fillStyle = bg;
      const w = ctx.measureText(label).width;
      ctx.fillRect(p[0] - w / 2 - 3, p[1] - 9, w + 6, 18);
      ctx.fillStyle = CPK[a.el] || '#e5e5e5';
      if (a.el === 'C' && bg === '#141414') ctx.fillStyle = '#dcdcdc';
      ctx.fillText(label, p[0], p[1] + 1);
    });
  }

  /* ---------- 图像 → 网格 / 轮廓 ---------- */
  function grayFromImage(img, maxDim) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(2, Math.round(iw * scale)), h = Math.max(2, Math.round(ih * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      g[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    return { w, h, g, data: d };
  }
  function loadImageFile(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => { res(im); };
      im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('无法读取该图片')); };
      im.src = url;
    });
  }

  function buildHeightMesh(gray, o) {
    const { w, h, g } = gray;
    const invert = !!o.invert;
    const mirror = !!o.mirror;
    const width = o.width, base = o.base, amp = o.amplitude;
    const solid = o.solid !== false;
    const dx = width / (w - 1);
    const dh = width * ((h - 1) / (w - 1)) || width;
    const dy = dh / (h - 1);
    const pos = [], tris = [];
    const heightAt = (i, j) => {
      const v = g[j * w + i];
      return base + (invert ? v : 1 - v) * amp;
    };
    const topIdx = new Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = (mirror ? (w - 1 - i) : i) * dx;
      const y = (h - 1 - j) * dy;
      topIdx[j * w + i] = pos.length / 3;
      pos.push(x, y, heightAt(i, j));
    }
    for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
      const a = topIdx[j * w + i], b = topIdx[j * w + i + 1], c = topIdx[(j + 1) * w + i + 1], d = topIdx[(j + 1) * w + i];
      tris.push(a, d, c, a, c, b);
    }
    if (solid) {
      const botIdx = new Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const x = (mirror ? (w - 1 - i) : i) * dx;
        const y = (h - 1 - j) * dy;
        botIdx[j * w + i] = pos.length / 3;
        pos.push(x, y, 0);
      }
      for (let j = 0; j + 1 < h; j++) for (let i = 0; i + 1 < w; i++) {
        const a = botIdx[j * w + i], b = botIdx[j * w + i + 1], c = botIdx[(j + 1) * w + i + 1], d = botIdx[(j + 1) * w + i];
        tris.push(a, b, c, a, c, d);
      }
      const wall = (ta, tb, ba, bb) => { tris.push(ta, ba, bb, ta, bb, tb); };
      for (let i = 0; i + 1 < w; i++) wall(topIdx[i], topIdx[i + 1], botIdx[i], botIdx[i + 1]);
      for (let i = 0; i + 1 < w; i++) {
        const j = h - 1;
        wall(topIdx[j * w + i + 1], topIdx[j * w + i], botIdx[j * w + i + 1], botIdx[j * w + i]);
      }
      for (let j = 0; j + 1 < h; j++) {
        wall(topIdx[(j + 1) * w], topIdx[j * w], botIdx[(j + 1) * w], botIdx[j * w]);
        wall(topIdx[j * w + w - 1], topIdx[(j + 1) * w + w - 1], botIdx[j * w + w - 1], botIdx[(j + 1) * w + w - 1]);
      }
    }
    return { pos: new Float32Array(pos), tris: new Uint32Array(tris) };
  }

  function buildLithophaneMesh(gray, o) {
    const { w, h, g } = gray;
    const minT = o.minT, maxT = o.maxT, size = o.size;
    const invert = !!o.invert;
    const pos = [], tris = [];
    const sample = (u, v) => {
      // u,v ∈ [0,1]
      const x = clamp(Math.round(u * (w - 1)), 0, w - 1);
      const y = clamp(Math.round(v * (h - 1)), 0, h - 1);
      return g[y * w + x];
    };
    const thick = (u, v) => {
      const lum = sample(u, v);
      const t = invert ? lum : 1 - lum;
      return minT + t * (maxT - minT);
    };
    if (o.shape === 'circle') {
      const R = size / 2;
      const rings = Math.max(24, o.res);
      const seg = Math.max(48, o.res * 2);
      const idxTop = [], idxBot = [];
      for (let r = 0; r <= rings; r++) {
        idxTop[r] = []; idxBot[r] = [];
        for (let s = 0; s < seg; s++) {
          const t = s / seg * Math.PI * 2;
          const rr = R * r / rings;
          const x = r === 0 ? 0 : rr * Math.cos(t);
          const y = r === 0 ? 0 : rr * Math.sin(t);
          const u = 0.5 + (x / size), v = 0.5 - (y / size);
          idxTop[r][s] = pos.length / 3; pos.push(x, y, thick(u, v));
          idxBot[r][s] = pos.length / 3; pos.push(x, y, 0);
        }
      }
      for (let r = 0; r < rings; r++) for (let s = 0; s < seg; s++) {
        const s2 = (s + 1) % seg;
        const a = idxTop[r][s], b = idxTop[r][s2], c = idxTop[r + 1][s2], d = idxTop[r + 1][s];
        if (r === 0) { tris.push(a, c, d); }
        else tris.push(a, c, d, a, d, b);
        const a2 = idxBot[r][s], b2 = idxBot[r][s2], c2 = idxBot[r + 1][s2], d2 = idxBot[r + 1][s];
        if (r === 0) tris.push(a2, d2, c2);
        else tris.push(a2, b2, d2, a2, d2, c2);
      }
      for (let s = 0; s < seg; s++) {
        const s2 = (s + 1) % seg;
        const ta = idxTop[rings][s], tb = idxTop[rings][s2], ba = idxBot[rings][s], bb = idxBot[rings][s2];
        tris.push(ta, ba, bb, ta, bb, tb);
      }
    } else {
      const n = o.res, S = size;
      const idxTop = [], idxBot = [];
      for (let j = 0; j <= n; j++) {
        idxTop[j] = []; idxBot[j] = [];
        for (let i = 0; i <= n; i++) {
          const x = (i / n - 0.5) * S, y = (0.5 - j / n) * S;
          idxTop[j][i] = pos.length / 3; pos.push(x, y, thick(i / n, j / n));
          idxBot[j][i] = pos.length / 3; pos.push(x, y, 0);
        }
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = idxTop[j][i], b = idxTop[j][i + 1], c = idxTop[j + 1][i + 1], d = idxTop[j + 1][i];
        tris.push(a, c, d, a, b, c);
        const a2 = idxBot[j][i], b2 = idxBot[j][i + 1], c2 = idxBot[j + 1][i + 1], d2 = idxBot[j + 1][i];
        tris.push(a2, d2, c2, a2, c2, b2);
      }
      for (let i = 0; i < n; i++) {
        let a = idxTop[0][i], b = idxTop[0][i + 1], ba = idxBot[0][i], bb = idxBot[0][i + 1];
        tris.push(a, ba, bb, a, bb, b);
        a = idxTop[n][i + 1]; b = idxTop[n][i]; ba = idxBot[n][i + 1]; bb = idxBot[n][i];
        tris.push(a, ba, bb, a, bb, b);
      }
      for (let j = 0; j < n; j++) {
        let a = idxTop[j][0], b = idxTop[j + 1][0], ba = idxBot[j][0], bb = idxBot[j + 1][0];
        tris.push(a, b, bb, a, bb, ba);
        a = idxTop[j][n]; b = idxTop[j + 1][n]; ba = idxBot[j][n]; bb = idxBot[j + 1][n];
        tris.push(a, bb, b, a, ba, bb);
      }
    }
    return { pos: new Float32Array(pos), tris: new Uint32Array(tris) };
  }

  function sobel(g, w, h) {
    const mag = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1] + g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1];
      const gy = -g[i - w - 1] - 2 * g[i - w] - g[i - w + 1] + g[i + w - 1] + 2 * g[i + w] + g[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
    }
    return mag;
  }

  function traceContours(binary, w, h) {
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && binary[y * w + x] === 1;
    const edges = new Map(); // "x,y" -> [[x2,y2], ...] 出边
    const addEdge = (x1, y1, x2, y2) => {
      const k = x1 + ',' + y1;
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push([x2, y2]);
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      if (!inside(x, y + 1)) addEdge(x, y + 1, x + 1, y + 1);          // 下边 → 右
      if (!inside(x + 1, y)) addEdge(x + 1, y + 1, x + 1, y);          // 右边 → 上
      if (!inside(x, y - 1)) addEdge(x + 1, y, x, y);                  // 上边 → 左
      if (!inside(x - 1, y)) addEdge(x, y, x, y + 1);                  // 左边 → 下
    }
    const used = new Set();
    const key2 = (a, b) => a[0] + ',' + a[1] + '>' + b[0] + ',' + b[1];
    const loops = [];
    for (const [startKey, outs] of edges) {
      for (const firstOut of outs) {
        const s = startKey.split(',').map(Number);
        let a = s, b = firstOut;
        if (used.has(key2(a, b))) continue;
        const loop = [[a[0], a[1]]];
        let guard = 0;
        while (guard++ < w * h * 4 + 16) {
          used.add(key2(a, b));
          loop.push([b[0], b[1]]);
          const k = b[0] + ',' + b[1];
          const cand = edges.get(k) || [];
          let nxt = null;
          const prevDir = [b[0] - a[0], b[1] - a[1]];
          // 优先选择不是反向、且未被使用的出边（右转优先 → 贴合同一区域）
          const scored = cand.filter(c => !used.has(key2(b, c))).map(c => {
            const d = [c[0] - b[0], c[1] - b[1]];
            const back = (d[0] === -prevDir[0] && d[1] === -prevDir[1]) ? 1 : 0;
            // 转向：cross>0 为右转（在图像坐标下）
            const cross = prevDir[0] * d[1] - prevDir[1] * d[0];
            return { c, back, cross };
          });
          if (!scored.length) break;
          scored.sort((u, v) => (u.back - v.back) || (v.cross - u.cross));
          nxt = scored[0].c;
          a = b; b = nxt;
          if (b[0] === loop[0][0] && b[1] === loop[0][1]) break;
        }
        if (loop.length > 3) loops.push(loop);
      }
    }
    return loops;
  }

  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    if (l2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }
  function dpSimplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length);
    keep[0] = 1; keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      if (b - a < 2) continue;
      const p1 = pts[a], p2 = pts[b];
      let maxD = -1, maxI = -1;
      for (let i = a + 1; i < b; i++) {
        const d = segDist(pts[i], p1, p2);
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > tol) { keep[maxI] = 1; stack.push([a, maxI], [maxI, b]); }
    }
    const out = [];
    for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
    return out;
  }

  // 闭合回路的简化：先找两个对角锚点，再分两半做 DP（避免首尾同点导致的退化）
  function dpSimplifyClosed(pts, tol) {
    const n = pts.length;
    if (n < 4) return pts.slice();
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[i][0]; cy += pts[i][1]; }
    cx /= n; cy /= n;
    let a = 0, best = -1;
    for (let i = 0; i < n; i++) {
      const d = (pts[i][0] - cx) * (pts[i][0] - cx) + (pts[i][1] - cy) * (pts[i][1] - cy);
      if (d > best) { best = d; a = i; }
    }
    let b = a, bd = -1;
    for (let i = 0; i < n; i++) {
      const d = (pts[i][0] - pts[a][0]) * (pts[i][0] - pts[a][0]) + (pts[i][1] - pts[a][1]) * (pts[i][1] - pts[a][1]);
      if (d > bd) { bd = d; b = i; }
    }
    const p1 = [], p2 = [];
    for (let i = a, g = 0; g <= n; g++, i = (i + 1) % n) { p1.push(pts[i]); if (i === b) break; }
    for (let i = b, g = 0; g <= n; g++, i = (i + 1) % n) { p2.push(pts[i]); if (i === a) break; }
    const s1 = dpSimplify(p1, tol), s2 = dpSimplify(p2, tol);
    const out = s1.slice(0, -1).concat(s2.slice(0, -1));
    return out.length >= 3 ? out : pts.slice();
  }

  function loopArea(pts) {
    let a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]);
    return a / 2;
  }
  function pointInPoly(pt, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }

  function dxfWrapLwPolylines(polys) {
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    polys.forEach(p => {
      L.push('0', 'LWPOLYLINE', '8', '0', '90', String(p.pts.length), '70', p.closed ? '1' : '0');
      p.pts.forEach(pt => { L.push('10', f6(pt[0]), '20', f6(pt[1])); });
    });
    L.push('0', 'ENDSEC', '0', 'EOF');
    return L.join('\n') + '\n';
  }

  function dxfFromContours(loops, opts) {
    const out = [];
    loops.forEach(l => out.push({ pts: l, closed: true }));
    return dxfWrapLwPolylines(out);
  }

  /* ---------- SVG → DXF ---------- */
  function svgPathToSubpaths(d, samples) {
    samples = samples || 16;
    const toks = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
    const subs = [];
    let cur = null, x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, cmd = null, i = 0;
    const num = () => parseFloat(toks[i++]);
    const startSub = (X, Y) => { cur = { pts: [[X, Y]], closed: false }; subs.push(cur); };
    while (i < toks.length) {
      const t = toks[i];
      if (/[A-Za-z]/.test(t)) { cmd = t; i++; } else if (!cmd) { i++; continue; }
      const rel = cmd >= 'a' && cmd <= 'z';
      const C = cmd.toUpperCase();
      if (C === 'M') {
        const nx = num(), ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        sx = x; sy = y;
        startSub(x, y);
      } else if (C === 'L') {
        const nx = num(), ny = num();
        const ox = x, oy = y;
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        if (cur) cur.pts.push([x, y]);
      } else if (C === 'H') {
        const nx = num(); x = rel ? x + nx : nx;
        if (cur) cur.pts.push([x, y]);
      } else if (C === 'V') {
        const ny = num(); y = rel ? y + ny : ny;
        if (cur) cur.pts.push([x, y]);
      } else if (C === 'C' || C === 'S' || C === 'Q' || C === 'T') {
        let c1x, c1y, c2x, c2y, ex, ey;
        if (C === 'C') {
          c1x = num(); c1y = num(); c2x = num(); c2y = num(); ex = num(); ey = num();
          if (rel) { c1x += x; c1y += y; c2x += x; c2y += y; ex += x; ey += y; }
        } else if (C === 'S') {
          c2x = num(); c2y = num(); ex = num(); ey = num();
          if (rel) { c2x += x; c2y += y; ex += x; ey += y; }
          c1x = 2 * x - px; c1y = 2 * y - py;
        } else if (C === 'Q') {
          c1x = num(); c1y = num(); ex = num(); ey = num();
          if (rel) { c1x += x; c1y += y; ex += x; ey += y; }
          c2x = c1x; c2y = c1y;
        } else {
          ex = num(); ey = num();
          if (rel) { ex += x; ey += y; }
          c1x = 2 * x - px; c1y = 2 * y - py; c2x = c1x; c2y = c1y;
        }
        const ox = x, oy = y;
        for (let s = 1; s <= samples; s++) {
          const t2 = s / samples;
          let bx, by;
          if (C === 'Q' || C === 'T') {
            bx = (1 - t2) * (1 - t2) * ox + 2 * (1 - t2) * t2 * c1x + t2 * t2 * ex;
            by = (1 - t2) * (1 - t2) * oy + 2 * (1 - t2) * t2 * c1y + t2 * t2 * ey;
          } else {
            const mt = 1 - t2;
            bx = mt * mt * mt * ox + 3 * mt * mt * t2 * c1x + 3 * mt * t2 * t2 * c2x + t2 * t2 * t2 * ex;
            by = mt * mt * mt * oy + 3 * mt * mt * t2 * c1y + 3 * mt * t2 * t2 * c2y + t2 * t2 * t2 * ey;
          }
          if (cur) cur.pts.push([bx, by]);
        }
        px = c2x; py = c2y;
        x = ex; y = ey;
      } else if (C === 'A') {
        const rx = num(), ry = num(), rot = num(), laf = num(), sf = num(), ex0 = num(), ey0 = num();
        const ex = rel ? x + ex0 : ex0, ey = rel ? y + ey0 : ey0;
        arcToPolyline(x, y, rx, ry, rot, laf, sf, ex, ey, samples, cur);
        x = ex; y = ey;
      } else if (C === 'Z') {
        if (cur) { cur.pts.push([sx, sy]); cur.closed = true; }
        x = sx; y = sy;
      } else { i++; }
      if (C !== 'C' && C !== 'S') { px = x; py = y; }
    }
    return subs.filter(s => s.pts.length > 1);
  }
  function arcToPolyline(x1, y1, rx, ry, rotDeg, laf, sf, x2, y2, samples, cur) {
    if (!cur) return;
    if (rx === 0 || ry === 0) { cur.pts.push([x2, y2]); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = rotDeg * Math.PI / 180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    const x1p = cosP * dx2 + sinP * dy2, y1p = -sinP * dx2 + cosP * dy2;
    let lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const sign = laf === sf ? -1 : 1;
    let num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, num / (den || 1e-9)));
    const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
    const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
    const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const dot = ux * vx + uy * vy;
      const len = Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1e-9;
      let a = Math.acos(clamp(dot / len, -1, 1));
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    let a0 = ang(1, 0, ux, uy);
    let dA = ang(ux, uy, vx, vy);
    if (!sf && dA > 0) dA -= Math.PI * 2;
    if (sf && dA < 0) dA += Math.PI * 2;
    const steps = Math.max(6, samples);
    for (let s = 1; s <= steps; s++) {
      const t = a0 + dA * s / steps;
      const ex = cx + rx * Math.cos(t) * cosP - ry * Math.sin(t) * sinP;
      const ey = cy + rx * Math.cos(t) * sinP + ry * Math.sin(t) * cosP;
      cur.pts.push([ex, ey]);
    }
  }
  function svgToDxfText(svgText, samples) {
    let doc;
    if (typeof DOMParser !== 'undefined') doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    else throw new Error('此环境不支持 DOMParser');
    const svg = doc.querySelector('svg');
    if (!svg) throw new Error('不是有效的 SVG');
    let vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || vb.some(isNaN)) {
      const W = parseFloat(svg.getAttribute('width')) || 100;
      const H = parseFloat(svg.getAttribute('height')) || 100;
      vb = [0, 0, W, H];
    }
    const sx = 1, sy = -1; // y 轴翻转（SVG 向下，DXF 向上）
    const polys = [];
    const lines = [];
    const circles = [];
    const arcs = [];
    const apply = (el) => {
      const tr = el.getAttribute('transform');
      if (tr) unsupportedTransforms.push(tr);
    };
    const unsupportedTransforms = [];
    let count = 0;
    svg.querySelectorAll('path').forEach(el => {
      apply(el);
      svgPathToSubpaths(el.getAttribute('d') || '', samples || 16).forEach(sp => {
        count++;
        polys.push(sp.pts.map(p => [p[0], p[1] * sy]));
      });
    });
    svg.querySelectorAll('line').forEach(el => {
      apply(el);
      count++;
      lines.push([+el.getAttribute('x1') || 0, (+(el.getAttribute('y1')) || 0) * sy, +el.getAttribute('x2') || 0, (+(el.getAttribute('y2')) || 0) * sy]);
    });
    svg.querySelectorAll('polyline,polygon').forEach(el => {
      apply(el);
      const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      const p = [];
      for (let i = 0; i + 1 < pts.length; i += 2) p.push([pts[i], pts[i + 1] * sy]);
      if (p.length > 1) { count++; polys.push(p); }
    });
    svg.querySelectorAll('rect').forEach(el => {
      apply(el);
      const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;
      const w = +el.getAttribute('width') || 0, h = +el.getAttribute('height') || 0;
      count++;
      polys.push([[x, y * sy], [x + w, y * sy], [x + w, (y + h) * sy], [x, (y + h) * sy]]);
    });
    svg.querySelectorAll('circle').forEach(el => {
      apply(el);
      count++;
      circles.push([+el.getAttribute('cx') || 0, (+el.getAttribute('cy') || 0) * sy, +el.getAttribute('r') || 0]);
    });
    svg.querySelectorAll('ellipse').forEach(el => {
      apply(el);
      const cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0;
      const rx = +el.getAttribute('rx') || 0, ry = +el.getAttribute('ry') || 0;
      count++;
      const p = [];
      for (let k = 0; k <= (samples || 16) * 2; k++) { const t = k / ((samples || 16) * 2) * Math.PI * 2; p.push([cx + rx * Math.cos(t), (cy + ry * Math.sin(t)) * sy]); }
      polys.push(p);
    });
    const L = ['0', 'SECTION', '2', 'ENTITIES'];
    polys.forEach(p => {
      if (p.length < 2) return;
      L.push('0', 'LWPOLYLINE', '8', '0', '90', String(p.length), '70', '0');
      p.forEach(pt => { L.push('10', f6(pt[0]), '20', f6(pt[1])); });
    });
    lines.forEach(l => L.push('0', 'LINE', '8', '0', '10', f6(l[0]), '20', f6(l[1]), '11', f6(l[2]), '21', f6(l[3])));
    circles.forEach(c => L.push('0', 'CIRCLE', '8', '0', '10', f6(c[0]), '20', f6(c[1]), '40', f6(c[2])));
    L.push('0', 'ENDSEC', '0', 'EOF');
    return { dxf: L.join('\n') + '\n', count, viewBox: vb, unsupportedTransforms };
  }

  /* ---------- STEP（尽力而为） ---------- */
  function parseSTEP(text) {
    const entities = {};
    const re = /#(\d+)\s*=\s*([A-Z_0-9]+)\s*\(([\s\S]*?)\)\s*;/g;
    let m, count = 0;
    while ((m = re.exec(text))) {
      entities[+m[1]] = { type: m[2], body: m[3] };
      count++;
      if (count > 400000) break;
    }
    const typeCounts = {};
    Object.keys(entities).forEach(k => { const t = entities[k].type; typeCounts[t] = (typeCounts[t] || 0) + 1; });

    const num = s => parseFloat(s);
    const points = {};
    const pointRefs = [];
    Object.keys(entities).forEach(k => {
      const e = entities[k];
      if (e.type === 'CARTESIAN_POINT') {
        // 形如 CARTESIAN_POINT('',(0.,0.,0.)) —— 取最后一组括号内的坐标
        const groups = e.body.match(/\(([^()]*)\)/g);
        if (!groups || !groups.length) return;
        const inner = groups[groups.length - 1].slice(1, -1);
        const parts = inner.split(',').map(v => num(v.trim()));
        if (parts.length >= 3 && parts.slice(0, 3).every(v => !isNaN(v))) {
          points[k] = parts.slice(0, 3);
          pointRefs.push(+k);
        }
      }
    });
    // POLY_LOOP → 三角扇形
    const tris = [];
    let faceCount = 0, boundCount = 0;
    Object.keys(entities).forEach(k => {
      const e = entities[k];
      if (e.type === 'POLY_LOOP') {
        const ids = (e.body.match(/#(\d+)/g) || []).map(v => +v.slice(1));
        const pts = ids.map(id => points[id]).filter(Boolean);
        if (pts.length >= 3) {
          for (let i = 1; i + 1 < pts.length; i++) tris.push(pts[0], pts[i], pts[i + 1]);
        }
      } else if (e.type === 'FACE_OUTER_BOUND' || e.type === 'FACE_BOUND') boundCount++;
      else if (e.type === 'ADVANCED_FACE') faceCount++;
    });
    // 边（CIRCLE/EDGE_CURVE 的顶点）→ 线框，用于「有点/边」时的可视化
    const edges = [];
    Object.keys(entities).forEach(k => {
      const e = entities[k];
      if (e.type === 'LINE' || e.type === 'EDGE_CURVE' || e.type === 'CIRCLE' || e.type === 'B_SPLINE_CURVE_WITH_KNOTS') {
        const ids = (e.body.match(/#(\d+)/g) || []).map(v => +v.slice(1));
        const pts = ids.map(id => points[id]).filter(Boolean);
        if (pts.length >= 2) edges.push(pts);
      }
    });
    const allPts = pointRefs.map(id => points[id]);
    const unsupportedTypes = ['B_SPLINE_SURFACE', 'B_SPLINE_SURFACE_WITH_KNOTS', 'CYLINDRICAL_SURFACE', 'CONICAL_SURFACE',
      'TOROIDAL_SURFACE', 'SPHERICAL_SURFACE', 'SURFACE_OF_REVOLUTION', 'SWEPT_SURFACE', 'RATIONAL_B_SPLINE_SURFACE',
      'ADVANCED_FACE', 'CLOSED_SHELL', 'MANIFOLD_SOLID_BREP', 'BREP_WITH_VOIDS'];
    const usedUnsupported = unsupportedTypes.filter(t => typeCounts[t]).map(t => ({ type: t, n: typeCounts[t] }));
    return {
      entities, typeCounts, points, pointRefs, tris, edges, allPts,
      faceCount, boundCount,
      isStep: /ISO-10303-21/i.test(text) || /HEADER/.test(text),
      schema: (/'([A-Z_0-9]{3,})'/.exec(text) || [])[1] || null,
      unsupported: usedUnsupported,
      stats: { entities: Object.keys(entities).length, points: pointRefs.length, tris: tris.length / 3, edges: edges.length }
    };
  }
  function meshFromSTEP(parsed) {
    const pos = [], tris = [];
    const map = new Map();
    const add = p => {
      const k = p[0].toFixed(6) + ',' + p[1].toFixed(6) + ',' + p[2].toFixed(6);
      let i = map.get(k);
      if (i == null) { i = pos.length / 3; map.set(k, i); pos.push(p[0], p[1], p[2]); }
      return i;
    };
    for (let i = 0; i < parsed.tris.length; i += 3) {
      tris.push(add(parsed.tris[i]), add(parsed.tris[i + 1]), add(parsed.tris[i + 2]));
    }
    return { pos: new Float32Array(pos), tris: new Uint32Array(tris) };
  }

  /* ---------- FBX（ASCII 尽力而为） ---------- */
  function parseFBX(buf) {
    const u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    const magic = decLatin.decode(u8.subarray(0, 21));
    if (/^Kaydara FBX Binary\s*\x00/.test(magic)) {
      return { binary: true, error: '检测到二进制 FBX（Kaydara FBX Binary）。浏览器端没有 FBX SDK，无法解析二进制 FBX。建议先用 Blender 另存为 OBJ 或 glTF 再继续。' };
    }
    const text = dec.decode(u8);
    if (!/FBXHeaderExtension|Vertices:|Geometry:|Objects:/.test(text)) {
      return { binary: false, error: '看起来不是 ASCII FBX（未找到 Vertices/Geometry 块），无法解析。' };
    }
    const mV = /Vertices:\s*\*\d+\s*\{([\s\S]*?)\}/.exec(text);
    const mI = /PolygonVertexIndex:\s*\*\d+\s*\{([\s\S]*?)\}/.exec(text);
    if (!mV || !mI) {
      return { binary: false, error: '这是 ASCII FBX，但没有找到 Vertices / PolygonVertexIndex 数据块（可能是骨骼/动画文件或使用了特殊编码）。' };
    }
    const nums = str => str.trim().split(/[\s,]+/).map(Number).filter(v => !isNaN(v));
    const v = nums(mV[1]);
    const rawIdx = nums(mI[1]);
    const pos = [], tris = [];
    for (let i = 0; i + 2 < v.length; i += 3) pos.push(v[i], v[i + 1], v[i + 2]);
    let poly = [];
    const flush = () => {
      for (let i = 1; i + 1 < poly.length; i++) tris.push(poly[0], poly[i], poly[i + 1]);
      poly = [];
    };
    rawIdx.forEach(id => {
      if (id < 0) { poly.push(-id - 1); flush(); }
      else poly.push(id);
    });
    if (poly.length > 2) flush();
    const gv = /GeometryVersion:\s*(\d+)/.exec(text);
    const mats = (text.match(/Material\s*:\s*"[^"]*",\s*""\s*\{|Material:\s*(\d+)/g) || []).length;
    return {
      binary: false, pos: new Float32Array(pos), tris: new Uint32Array(tris),
      meta: { verticesDeclared: (/(\d+)/.exec(text.match(/Vertices:\s*\*(\d+)/) || []) || [])[1], geometryVersion: gv ? gv[1] : null, materials: mats }
    };
  }

  /* ======================================================================
     3. three.js 场景支撑
     ====================================================================== */
  const CLEANUPS = [];
  let _cleanupBound = false;
  function registerCleanup(fn) {
    CLEANUPS.push(fn);
    if (!_cleanupBound) {
      _cleanupBound = true;
      window.addEventListener('pagehide', () => { CLEANUPS.splice(0).forEach(f => { try { f(); } catch (e) { } }); });
    }
  }

  async function ensureThree(withControls, loaderName) {
    const THREE = await lib('three.min.js', 'THREE');
    if (withControls) await lib('OrbitControls.js', 'THREE.OrbitControls');
    if (loaderName) await lib(loaderName, 'THREE.' + loaderName.replace('.js', '').replace(/^[a-z]/, c => c.toUpperCase()));
    return THREE;
  }

  async function loadThreeLib(loaderFile, globalName) {
    await lib('three.min.js', 'THREE');
    return lib(loaderFile, globalName);
  }

  function meshToThreeGeometry(THREE, mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.pos, 3));
    if (mesh.pos.length / 3 > 65535) g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.tris), 1));
    else g.setIndex(new THREE.BufferAttribute(new Uint16Array(mesh.tris), 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }

  // 通用 3D 场景（查看器 / 转换预览复用）
  async function makeScene3D(container, opts) {
    opts = opts || {};
    const THREE = await ensureThree(true);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 420, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bgColors = { dark: 0x141414, light: 0xdcdfe3, white: 0xffffff };
    scene.background = new THREE.Color(bgColors[opts.bg || 'dark']);

    const cam = new THREE.PerspectiveCamera(45, (container.clientWidth || 640) / (container.clientHeight || 420), 0.01, 100000);
    cam.position.set(3, 2.4, 4);

    const controls = new THREE.OrbitControls(cam, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const ambient = new THREE.AmbientLight(0xffffff, 0.62);
    const key = new THREE.DirectionalLight(0xffffff, 0.95); key.position.set(1, 1.4, 0.8);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.6); fill.position.set(-1.1, -0.6, -0.9);
    scene.add(ambient, key, fill);

    const root = new THREE.Group();
    scene.add(root);
    let grid = null, axes = null, autoRotate = false;
    let lastFit = { size: 1, center: new THREE.Vector3() };
    let disposed = false;

    function setWireframe(on) {
      root.traverse(o => {
        if (o.isMesh && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { if ('wireframe' in m) m.wireframe = !!on; });
        }
      });
    }
    function ensureHelpers() {
      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    }
    function fit(obj, sizeExtra) {
      const box = new THREE.Box3().setFromObject(obj);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      root.position.set(-center.x, -center.y, -center.z);
      lastFit = { size: maxDim, center: center.clone(), dims: size.clone() };
      const dist = maxDim * (sizeExtra || 1.7);
      cam.near = Math.max(0.001, maxDim / 500);
      cam.far = maxDim * 800;
      cam.position.set(dist * 0.78, dist * 0.55, dist * 0.78);
      cam.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
      grid = new THREE.GridHelper(maxDim * 3, 30, 0x3a3a3a, 0x242424);
      grid.position.y = -size.y / 2 - maxDim * 0.002;
      scene.add(grid);
      if (axes) { scene.remove(axes); axes.geometry.dispose(); axes.material.dispose(); }
      axes = new THREE.AxesHelper(maxDim * 0.7);
      scene.add(axes);
      grid.visible = !!opts.showGrid;
      axes.visible = !!opts.showAxes;
    }
    let raf = 0;
    function loop() {
      raf = requestAnimationFrame(loop);
      if (disposed) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (autoRotate) root.rotation.y += 0.006;
      controls.update();
      renderer.render(scene, cam);
    }
    loop();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
    if (ro) ro.observe(container);
    function resize() {
      const w = container.clientWidth || 640, h = container.clientHeight || 420;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);

    return {
      THREE, scene, camera: cam, controls, renderer, root,
      add(o) { root.add(o); },
      setWireframe, fit,
      setGrid(on) { if (grid) grid.visible = !!on; opts.showGrid = !!on; },
      setAxes(on) { if (axes) axes.visible = !!on; opts.showAxes = !!on; },
      setAutoRotate(on) { autoRotate = !!on; if (!on) root.rotation.y = 0; },
      setBg(name) { scene.background = new THREE.Color(bgColors[name] || bgColors.dark); },
      screenshot(name) {
        renderer.render(scene, cam);
        const url = renderer.domElement.toDataURL('image/png');
        const b64 = url.split(',')[1];
        const bin = atob(b64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        dl(new Blob([arr], { type: 'image/png' }), (name || 'screenshot') + '.png');
      },
      resetView() { root.rotation.set(0, 0, 0); cam.position.set(lastFit.size * 1.33, lastFit.size * 0.94, lastFit.size * 1.33); controls.target.set(0, 0, 0); controls.update(); },
      resize,
      dispose() {
        disposed = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', resize);
        if (ro) ro.disconnect();
        try { controls.dispose(); } catch (e) { }
        scene.traverse(o => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
        });
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }

  /* ======================================================================
     4. 查看器：共用 viewer()
     ====================================================================== */
  function extOf(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function objStats(THREE, obj) {
    let verts = 0, tris = 0;
    obj.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        const g = o.geometry;
        verts += g.attributes.position.count;
        if (g.index) tris += g.index.count / 3;
        else if (g.attributes.position.count % 3 === 0) tris += g.attributes.position.count / 3;
        else tris += Math.floor(g.attributes.position.count / 3);
      }
    });
    return { verts, tris };
  }
  function ensureStandardMaterials(THREE, obj, color) {
    obj.traverse(o => {
      if (o.isMesh) {
        const old = o.material;
        if (old) { (Array.isArray(old) ? old : [old]).forEach(m => m && m.dispose && m.dispose()); }
        o.material = new THREE.MeshStandardMaterial({ color: color || 0xb9c2cc, metalness: 0.18, roughness: 0.62, side: THREE.DoubleSide });
        if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      }
    });
  }

  const VIEWER_SPEC = {
    '3d-model-viewer': { title: '3D 模型查看器', accept: '.stl,.obj,.glb,.gltf,.3mf', exts: ['stl', 'obj', 'glb', 'gltf', '3mf'], generic: true },
    'stl-viewer': { title: 'STL 查看器', accept: '.stl', exts: ['stl'] },
    'obj-viewer': { title: 'OBJ 查看器', accept: '.obj', exts: ['obj'] },
    'glb-viewer': { title: 'GLB 查看器', accept: '.glb', exts: ['glb'] },
    'gltf-viewer': { title: 'glTF 查看器', accept: '.gltf,.glb', exts: ['gltf', 'glb'] }
  };

  async function viewer(host, slug, cfg) {
    cfg = cfg || {};
    const spec = VIEWER_SPEC[slug] || VIEWER_SPEC['3d-model-viewer'];
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '520px';
    stage.innerHTML =
      '<div class="drop" id="vDrop" style="flex:1">' +
      '<div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>' + esc(cfg.dropTitle || ('拖入 ' + spec.exts.map(e => e.toUpperCase()).join(' / ') + ' 文件')) + '</h3>' +
      '<p>拖拽文件到这里，或点击选择 · 全程本地解析</p>' +
      '<button class="btn-lime" id="vPick">' + window.icon('cube', 16) + ' 选择文件 <span>→</span></button>' +
      '<div class="fmts">' + spec.exts.map(e => '<b>' + e.toUpperCase() + '</b>').join(' / ') + ' · 支持拖拽与粘贴</div>' +
      '<input type="file" id="vFile" accept="' + spec.accept + '" hidden>' +
      '</div>' +
      '<div id="vWrap" class="hide" style="position:relative;flex:1;min-height:440px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010">' +
      '<div id="vCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;font-size:12.5px">' +
      '<span><b id="vName"></b>&nbsp; <span id="vMeta"></span></span><span class="linkbtn" id="vNew" style="cursor:pointer">换个模型</span></div>' +
      '</div>' +
      '<div class="progress" id="vProg"><i></i></div>';

    pane.innerHTML =
      window.TUI.head(spec.title, '本地解析 + 三角面统计。支持线框 / 网格 / 坐标轴 / 自动旋转 / 截图。') +
      '<div class="plabel">显示</div>' +
      window.TUI.chk('vWire', '线框模式', false) +
      window.TUI.chk('vGrid', '网格地面', true) +
      window.TUI.chk('vAxes', '坐标轴', false) +
      window.TUI.chk('vSpin', '自动旋转', false) +
      '<div class="plabel">背景</div>' +
      '<div class="shapes" id="vBg"><button class="shape on" data-v="dark">深色</button><button class="shape" data-v="light">浅色</button><button class="shape" data-v="white">白</button></div>' +
      '<div class="statgrid" id="vStats"></div>' +
      '<div class="shapes" style="margin-top:14px;flex-wrap:wrap">' +
      '<button class="btn-ghost btn-sm" id="vReset">重置视角</button>' +
      '<button class="btn-ghost btn-sm" id="vShot">截图 PNG</button>' +
      '</div>' +
      '<div class="runnote">数据不出本机。STL / OBJ / GLB / glTF / 3MF 由浏览器直接解析。</div>';

    const hs = (s) => $h(host, s);
    let sc = null, disposed = false;
    const cleanup = () => { disposed = true; if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);

    const statsEl = hs('#vStats');
    function statGrid(o) {
      statsEl.innerHTML = Object.keys(o).map(k => '<div class="stat"><b>' + esc(o[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
    }
    statGrid({ '状态': '等待文件' });

    function bindChk(id, onFn, on) {
      const el = hs('#' + id);
      el.addEventListener('click', () => {
        el.classList.toggle('on');
        onFn(el.classList.contains('on'));
        if ($h(host, '#vWrap').classList.contains('hide')) return;
        if (sc) { sc.setGrid(hs('#vGrid').classList.contains('on')); sc.setAxes(hs('#vAxes').classList.contains('on')); }
      });
    }
    let cur = { wire: false, grid: true, axes: false, spin: false, bg: 'dark' };
    bindChk('vWire', on => { cur.wire = on; if (sc) sc.setWireframe(on); });
    bindChk('vGrid', on => { cur.grid = on; if (sc) sc.setGrid(on); });
    bindChk('vAxes', on => { cur.axes = on; if (sc) sc.setAxes(on); });
    bindChk('vSpin', on => { cur.spin = on; if (sc) sc.setAutoRotate(on); });
    hs('#vBg').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      [...$h(host, '#vBg').children].forEach(x => x.classList.remove('on'));
      b.classList.add('on'); cur.bg = b.dataset.v;
      if (sc) sc.setBg(cur.bg);
    });
    hs('#vReset').addEventListener('click', () => { if (sc) sc.resetView(); });
    hs('#vShot').addEventListener('click', () => {
      if (!sc) { toast('先加载一个模型'); return; }
      sc.screenshot((hs('#vName').textContent || 'model').replace(/\.[^.]+$/, ''));
    });
    hs('#vNew').addEventListener('click', () => {
      cleanup();
      hs('#vWrap').classList.add('hide'); hs('#vDrop').classList.remove('hide');
      statGrid({ '状态': '等待文件' });
    });
    hs('#vPick').addEventListener('click', e => { e.stopPropagation(); hs('#vFile').click(); });
    wireDrop(host, '#vDrop', '#vFile', files => load(files[0]));
    window.addEventListener('paste', e => {
      const f = [...((e.clipboardData && e.clipboardData.files) || [])][0];
      if (f && /\.(stl|obj|glb|gltf|3mf)$/i.test(f.name)) load(f);
    });

    async function load(file) {
      if (!file) return;
      const ext = extOf(file.name) || spec.exts[0];
      if (spec.exts.indexOf(ext) < 0) { toast('不支持的文件类型 .' + ext); return; }
      const prog = hs('#vProg');
      window.TUI.prog(prog, 8);
      try {
        if (!sc) {
          hs('#vDrop').classList.add('hide');
          hs('#vWrap').classList.remove('hide');
          sc = await makeScene3D(hs('#vCanvasHost'), { bg: cur.bg, showGrid: cur.grid, showAxes: cur.axes });
          sc.setBg(cur.bg);
          registerCleanup(() => { if (sc) sc.dispose(); });
        }
        window.TUI.prog(prog, 30);
        await waitTick();
        let obj = null, stat = {};
        if (ext === 'stl') {
          const buf = await window.TUI.readBuf(file);
          await loadThreeLib('stlLoader.js', 'THREE.STLLoader');
          const geo = new sc.THREE.STLLoader().parse(buf);
          if (!geo.attributes.position || geo.attributes.position.count === 0) throw new Error('STL 没有三角面数据');
          geo.computeVertexNormals();
          obj = new sc.THREE.Mesh(geo, new sc.THREE.MeshStandardMaterial({ color: 0xbdc6d1, metalness: 0.15, roughness: 0.6, side: sc.THREE.DoubleSide, flatShading: false }));
        } else if (ext === 'obj') {
          const text = await window.TUI.readText(file);
          await loadThreeLib('objLoader.js', 'THREE.OBJLoader');
          obj = new sc.THREE.OBJLoader().parse(text);
          ensureStandardMaterials(sc.THREE, obj);
        } else if (ext === 'glb') {
          const buf = await window.TUI.readBuf(file);
          obj = await parseGLTFLike(sc.THREE, buf, '');
        } else if (ext === 'gltf') {
          const text = await window.TUI.readText(file);
          obj = await parseGLTFLike(sc.THREE, text, '');
        } else if (ext === '3mf') {
          const buf = await window.TUI.readBuf(file);
          const mesh = await meshFrom3MF(buf);
          obj = new sc.THREE.Mesh(meshToThreeGeometry(sc.THREE, mesh), new sc.THREE.MeshStandardMaterial({ color: 0xbdc6d1, metalness: 0.15, roughness: 0.6, side: sc.THREE.DoubleSide }));
        }
        window.TUI.prog(prog, 75);
        await waitTick();
        let nObj = 0;
        obj.traverse(o => { if (o.isMesh) nObj++; });
        if (!nObj) throw new Error('文件里没有可渲染的网格');
        sc.add(obj);
        sc.fit(obj);
        sc.setWireframe(cur.wire); sc.setGrid(cur.grid); sc.setAxes(cur.axes); sc.setAutoRotate(cur.spin);
        const st = objStats(sc.THREE, obj);
        const box = new sc.THREE.Box3().setFromObject(obj);
        const size = box.getSize(new sc.THREE.Vector3());
        stat = {
          '三角面': fmtN(Math.round(st.tris)),
          '顶点': fmtN(Math.round(st.verts)),
          '尺寸 X': size.x.toFixed(2),
          '尺寸 Y': size.y.toFixed(2),
          '尺寸 Z': size.z.toFixed(2),
          '文件大小': window.fmtSize ? window.fmtSize(file.size) : file.size + ' B'
        };
        statsEl.innerHTML = Object.keys(stat).map(k => '<div class="stat"><b>' + esc(stat[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
        hs('#vName').textContent = file.name;
        hs('#vMeta').textContent = Math.round(st.tris) + ' 个三角面 · ' + (window.fmtSize ? window.fmtSize(file.size) : '');
        window.TUI.prog(prog, 100);
        setTimeout(() => { prog.style.display = 'none'; }, 400);
      } catch (err) {
        prog.style.display = 'none';
        console.error(err);
        toast(err.message || '解析失败');
        if (!sc) hs('#vDrop').classList.remove('hide');
      }
    }
    async function parseGLTFLike(THREE, data, path) {
      await loadThreeLib('gltfLoader.js', 'THREE.GLTFLoader');
      const loader = new THREE.GLTFLoader();
      const gltf = await new Promise((res, rej) => loader.parse(data, path || '', res, rej));
      const sceneObj = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!sceneObj) throw new Error('glTF 里没有 scene');
      sceneObj.traverse(o => { if (o.isMesh && o.material && o.material.map == null) { /* keep */ } });
      return sceneObj;
    }
  }

  /* ======================================================================
     5. 模型互转 converter()
     ====================================================================== */
  const CONVERT_SPEC = {
    'stl-to-obj': { from: 'stl', to: 'obj', title: 'STL → OBJ', accept: '.stl' },
    'obj-to-stl': { from: 'obj', to: 'stl', title: 'OBJ → STL', accept: '.obj' },
    'glb-to-obj': { from: 'glb', to: 'obj', title: 'GLB → OBJ', accept: '.glb' },
    'glb-to-stl': { from: 'glb', to: 'stl', title: 'GLB → STL', accept: '.glb' },
    'obj-to-glb': { from: 'obj', to: 'glb', title: 'OBJ → GLB', accept: '.obj' },
    'stl-to-3mf': { from: 'stl', to: '3mf', title: 'STL → 3MF', accept: '.stl' },
    '3mf-to-stl': { from: '3mf', to: 'stl', title: '3MF → STL', accept: '.3mf' },
    'fbx-to-stl': { from: 'fbx', to: 'stl', title: 'FBX → STL（ASCII 尽力而为）', accept: '.fbx' },
    'fbx-to-glb': { from: 'fbx', to: 'glb', title: 'FBX → GLB（ASCII 尽力而为）', accept: '.fbx' },
    'step-to-stl': { from: 'step', to: 'stl', title: 'STEP → STL（尽力而为）', accept: '.step,.stp' },
    'step-to-obj': { from: 'step', to: 'obj', title: 'STEP → OBJ（尽力而为）', accept: '.step,.stp' }
  };

  async function readMeshFromFile(file, from) {
    const T = window.TUI;
    if (from === 'stl') return { mesh: parseSTL(await T.readBuf(file)), binary: true };
    if (from === 'obj') return { mesh: meshFromOBJ(await T.readText(file)) };
    if (from === 'glb') return { mesh: meshFromGLB(await T.readBuf(file)) };
    if (from === '3mf') return { mesh: await meshFrom3MF(await T.readBuf(file)) };
    if (from === 'fbx') {
      const r = parseFBX(await T.readBuf(file));
      if (r.error) { const e = new Error(r.error); e.honest = true; throw e; }
      return { mesh: { pos: r.pos, tris: r.tris }, meta: r.meta };
    }
    if (from === 'step') {
      const parsed = parseSTEP(await T.readText(file));
      const mesh = meshFromSTEP(parsed);
      return { mesh, stepParsed: parsed };
    }
    throw new Error('不支持读取 ' + from);
  }

  async function converter(host, slug, cfg) {
    const spec = CONVERT_SPEC[slug];
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="cDrop" style="flex:1">' +
      '<div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>' + esc(spec.title) + '</h3>' +
      '<p>拖拽 .' + spec.from + ' 文件，立即在本地转换成 .' + spec.to + '</p>' +
      '<button class="btn-lime" id="cPick">选择文件 <span>→</span></button>' +
      '<div class="fmts"><b>' + spec.from.toUpperCase() + '</b> · 全部本地处理，不上传</div>' +
      '<input type="file" id="cFile" accept="' + spec.accept + '" hidden>' +
      '</div>' +
      '<div id="cWrap" class="hide" style="flex:1;display:flex;flex-direction:column;gap:12px">' +
      '<div style="position:relative;flex:1;min-height:320px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010">' +
      '<div id="cCanvasHost" style="position:absolute;inset:0"></div></div>' +
      '<div class="filebar"><span><b id="cName"></b> <span id="cMeta"></span></span><span class="linkbtn" id="cNew" style="cursor:pointer">换文件</span></div>' +
      '</div>' +
      '<div class="progress" id="cProg"><i></i></div>';
    pane.innerHTML =
      window.TUI.head(spec.title, '解析 → 转换 → 对比 → 下载，全部在你的浏览器内完成。') +
      '<div id="cResult" class="resultbox"><div class="row"><span>状态</span><b>等待文件</b></div></div>' +
      '<div class="warnbox hide" id="cWarn"></div>' +
      '<div class="shapes" style="margin-top:14px;flex-wrap:wrap">' +
      '<button class="btn-lime btn-sm" id="cDown" disabled>下载 .' + spec.to + '</button>' +
      '<button class="btn-ghost btn-sm" id="cShot">截图</button>' +
      '</div>' +
      '<div class="runnote" id="cNote">GLB / 3MF 的容器结构（JSON chunk、zip 中央目录、CRC32）均为手写实现。</div>';

    const hs = s => $h(host, s);
    const prog = hs('#cProg');
    let sc = null, outBlob = null, outName = null, curMesh = null;
    const cleanup = () => { if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);

    const setRows = rows => {
      hs('#cResult').innerHTML = rows.map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + r[1] + '</b></div>').join('');
    };
    hs('#cPick').addEventListener('click', e => { e.stopPropagation(); hs('#cFile').click(); });
    hs('#cNew').addEventListener('click', () => { outBlob = null; hs('#cWrap').classList.add('hide'); hs('#cDrop').classList.remove('hide'); hs('#cDown').disabled = true; });
    wireDrop(host, '#cDrop', '#cFile', files => run(files[0]));
    hs('#cDown').addEventListener('click', () => { if (outBlob) dl(outBlob, outName); });
    hs('#cShot').addEventListener('click', () => { if (sc) sc.screenshot((outName || 'model').replace(/\.[^.]+$/, '')); });

    async function run(file) {
      if (!file) return;
      hs('#cDrop').classList.add('hide');
      hs('#cWrap').classList.remove('hide');
      window.TUI.prog(prog, 10);
      try {
        const t0 = performance.now();
        const res = await readMeshFromFile(file, spec.from);
        const mesh = res.mesh;
        window.TUI.prog(prog, 55);
        await waitTick();
        if (!mesh.pos.length || !mesh.tris.length) {
          const e = new Error('解析成功，但没有可用的三角面数据');
          e.honest = spec.from === 'step' || spec.from === 'fbx';
          throw e;
        }

        if (spec.from === 'step') {
          const sp = res.stepParsed;
          if (!sp.tris.length) {
            const names = (sp.unsupported || []).slice(0, 4).map(u => u.type + '×' + u.n).join('、') || '未知实体';
            const e = new Error('该 STEP 使用了 ' + names + ' 等实体，浏览器端简化解析器尚不支持（需要真正的 CAD 内核如 OpenCASCADE）。已为你显示可解析的 ' + sp.stats.points + ' 个点 / ' + sp.stats.edges + ' 条边。');
            e.honest = true;
            throw e;
          }
        }
        if (spec.from === 'fbx' && res.meta) {
          hs('#cNote').textContent = 'ASCII FBX：顶点声明 ' + (res.meta.verticesDeclared || '—') + '，GeometryVersion ' + (res.meta.geometryVersion || '—') + '。';
        }

        const st = meshStats(mesh);
        // 输出
        if (spec.to === 'obj') {
          const text = meshToOBJ(mesh, file.name.replace(/\.[^.]+$/, ''));
          outBlob = new Blob([text], { type: 'text/plain' });
          outName = file.name.replace(/\.[^.]+$/, '') + '.obj';
        } else if (spec.to === 'stl') {
          const buf = meshToSTLBinary(mesh, file.name);
          outBlob = new Blob([buf], { type: 'model/stl' });
          outName = file.name.replace(/\.[^.]+$/, '') + '.stl';
        } else if (spec.to === 'glb') {
          const buf = meshToGLB(mesh, file.name.replace(/\.[^.]+$/, ''));
          outBlob = new Blob([buf], { type: 'model/gltf-binary' });
          outName = file.name.replace(/\.[^.]+$/, '') + '.glb';
        } else if (spec.to === '3mf') {
          const u8 = await meshTo3MF(mesh, file.name.replace(/\.[^.]+$/, ''));
          outBlob = new Blob([u8], { type: 'model/3mf' });
          outName = file.name.replace(/\.[^.]+$/, '') + '.3mf';
        }
        window.TUI.prog(prog, 88);
        await waitTick();

        hs('#cDown').disabled = false;
        hs('#cName').textContent = file.name;
        hs('#cMeta').textContent = '→ ' + outName + ' · ' + (window.fmtSize ? window.fmtSize(outBlob.size) : outBlob.size + ' B');
        setRows([
          ['源文件', esc(file.name) + ' · ' + (window.fmtSize ? window.fmtSize(file.size) : '')],
          ['输出文件', esc(outName) + ' · ' + (window.fmtSize ? window.fmtSize(outBlob.size) : '')],
          ['顶点数', fmtN(st.verts)],
          ['三角面数', fmtN(st.tris)],
          ['包围盒 (X×Y×Z)', st.size.map(v => v.toFixed(2)).join(' × ')],
          ['耗时', (performance.now() - t0).toFixed(0) + ' ms']
        ]);

        // 预览
        if (sc) { try { sc.dispose(); } catch (e) { } sc = null; }
        hs('#cCanvasHost').innerHTML = '';
        sc = await makeScene3D(hs('#cCanvasHost'), { bg: 'dark', showGrid: true });
        const geo = meshToThreeGeometry(sc.THREE, mesh);
        sc.add(new sc.THREE.Mesh(geo, new sc.THREE.MeshStandardMaterial({ color: 0xc2cbd6, metalness: 0.15, roughness: 0.62, side: sc.THREE.DoubleSide })));
        sc.fit(sc.root);
        window.TUI.prog(prog, 100);
        setTimeout(() => { prog.style.display = 'none'; }, 400);
      } catch (err) {
        prog.style.display = 'none';
        if (!err.honest) console.error(err);
        hs('#cWarn').classList.remove('hide');
        hs('#cWarn').textContent = err.message || '转换失败';
        setRows([['状态', '<span style="color:#e8a33d">' + esc(err.message || '转换失败') + '</span>']]);
        hs('#cDown').disabled = true;
      }
    }
  }

  /* ======================================================================
     6. DXF 查看器
     ====================================================================== */
  async function dxfViewer(host) {
    const THREE = await ensureThree(true);
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '560px';
    stage.innerHTML =
      '<div class="drop" id="dDrop" style="flex:1">' +
      '<div class="ic">' + window.icon('cube', 30) + '</div><h3>拖入 DXF 图纸</h3>' +
      '<p>LINE / CIRCLE / ARC / LWPOLYLINE / POLYLINE / TEXT / ELLIPSE / SPLINE（控制点）/ INSERT（展开一层）</p>' +
      '<button class="btn-lime" id="dPick">选择 DXF 文件 <span>→</span></button>' +
      '<div class="fmts"><b>DXF</b> · 正交相机俯视 · 滚轮缩放 / 拖拽平移</div>' +
      '<input type="file" id="dFile" accept=".dxf" hidden></div>' +
      '<div id="dWrap" class="hide" style="position:relative;flex:1;min-height:480px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#0d0d0d">' +
      '<div id="dCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;font-size:12.5px">' +
      '<span><b id="dName"></b> <span id="dMeta"></span></span><button class="linkbtn" id="dFit" style="cursor:pointer">适应窗口</button></div></div>';
    pane.innerHTML = window.TUI.head('DXF 查看器', '本地点线解析，按图层 ACI 颜色着色。') +
      window.TUI.chk('dAxes', '显示十字中心', false) +
      '<div class="statgrid" id="dStats"></div>' +
      '<div class="warnbox hide" id="dWarn"></div>' +
      '<div class="runnote">SPLINE 仅取控制点折线（浏览器端不做 NURBS 采样）。</div>';
    const hs = s => $h(host, s);
    let sc = null, parsed = null;
    const cleanup = () => { if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);
    hs('#dPick').addEventListener('click', e => { e.stopPropagation(); hs('#dFile').click(); });
    wireDrop(host, '#dDrop', '#dFile', f => load(f[0]));
    hs('#dFit').addEventListener('click', () => { if (sc && parsed) fitTo(parsed); });

    function fitTo(p) {
      const b = p.bounds;
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      const w = (b.maxX - b.minX) || 1, h = (b.maxY - b.minY) || 1;
      const host2 = hs('#dCanvasHost');
      const aspect = (host2.clientWidth || 640) / (host2.clientHeight || 480);
      let vw = w * 1.15, vh = h * 1.15;
      if (vw / vh > aspect) vh = vw / aspect; else vw = vh * aspect;
      cam.left = cx - vw / 2; cam.right = cx + vw / 2; cam.top = cy + vh / 2; cam.bottom = cy - vh / 2;
      cam.updateProjectionMatrix();
    }
    let cam = null;
    async function load(file) {
      if (!file) return;
      try {
        const text = await window.TUI.readText(file);
        const p = parseDXF(text);
        if (!p.entities.length) throw new Error('DXF 里没有可识别的图元（可能只有 3D 实体或使用了不支持的编码）');
        parsed = p;
        hs('#dDrop').classList.add('hide');
        hs('#dWrap').classList.remove('hide');

        if (sc) { try { sc.dispose(); } catch (e) { } sc = null; }
        hs('#dCanvasHost').innerHTML = '';
        const host2 = hs('#dCanvasHost');
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(host2.clientWidth || 640, host2.clientHeight || 480, false);
        renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%'; renderer.domElement.style.display = 'block';
        host2.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0d0d0d);
        cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
        cam.position.set(0, 0, 10);
        cam.up.set(0, 1, 0);
        cam.lookAt(0, 0, 0);
        const controls = new THREE.OrbitControls(cam, renderer.domElement);
        controls.enableRotate = false;
        controls.screenSpacePanning = true;
        controls.enableDamping = true;

        // 构建线段（顶点色）
        const segs = [];
        p.entities.forEach(e => dxfEntityToSegs(e, segs));
        const posArr = new Float32Array(segs.length * 6);
        const colArr = new Float32Array(segs.length * 6);
        const tmpColor = new THREE.Color();
        segs.forEach((s, i) => {
          posArr[i * 6] = s[0]; posArr[i * 6 + 1] = s[1]; posArr[i * 6 + 2] = 0;
          posArr[i * 6 + 3] = s[2]; posArr[i * 6 + 4] = s[3]; posArr[i * 6 + 5] = 0;
          tmpColor.set(s[4] || '#ffffff');
          colArr[i * 6] = tmpColor.r; colArr[i * 6 + 1] = tmpColor.g; colArr[i * 6 + 2] = tmpColor.b;
          colArr[i * 6 + 3] = tmpColor.r; colArr[i * 6 + 4] = tmpColor.g; colArr[i * 6 + 5] = tmpColor.b;
        });
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
        const mat = new THREE.LineBasicMaterial({ vertexColors: true });
        scene.add(new THREE.LineSegments(geo, mat));
        const axes = new THREE.AxesHelper(Math.max((p.bounds.maxX - p.bounds.minX), (p.bounds.maxY - p.bounds.minY)) * 0.12);
        axes.visible = hs('#dAxes').classList.contains('on');
        scene.add(axes);

        fitTo(p);
        // 恢复中心
        const b = p.bounds;
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        cam.position.set(cx, cy, 10); controls.target.set(cx, cy, 0); controls.update();

        let raf = 0;
        const loop = () => { raf = requestAnimationFrame(loop); if (document.hidden) return; controls.update(); renderer.render(scene, cam); };
        loop();
        const resize = () => {
          const w = host2.clientWidth || 640, h2 = host2.clientHeight || 480;
          renderer.setSize(w, h2, false);
          fitTo(p);
        };
        window.addEventListener('resize', resize);
        sc = {
          dispose() {
            cancelAnimationFrame(raf); window.removeEventListener('resize', resize);
            try { controls.dispose(); } catch (e) { }
            geo.dispose(); mat.dispose(); axes.geometry.dispose(); axes.material.dispose();
            renderer.dispose();
            if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
          }
        };
        registerCleanup(() => { if (sc) sc.dispose(); });

        hs('#dAxes').addEventListener('click', () => { setTimeout(() => { axes.visible = hs('#dAxes').classList.contains('on'); }, 0); });

        hs('#dName').textContent = file.name;
        hs('#dMeta').textContent = p.entities.length + ' 图元';
        const rows = { '图元数': fmtN(p.entities.length), '线段数': fmtN(segs.length), '图层数': Object.keys(p.layers).length };
        Object.keys(p.counts).slice(0, 8).forEach(k => { rows[k] = fmtN(p.counts[k]); });
        rows['范围'] = (b.maxX - b.minX).toFixed(1) + ' × ' + (b.maxY - b.minY).toFixed(1);
        hs('#dStats').innerHTML = Object.keys(rows).map(k => '<div class="stat"><b>' + esc(rows[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
        const uns = Object.keys(p.unsupported || {});
        if (uns.length) {
          hs('#dWarn').classList.remove('hide');
          hs('#dWarn').textContent = '忽略了 ' + uns.slice(0, 6).map(k => k + '×' + p.unsupported[k]).join('、') + ' 等未支持的实体。';
        }
      } catch (err) {
        console.error(err); toast(err.message || 'DXF 解析失败');
      }
    }
  }

  /* ======================================================================
     7. Canvas 2D 视图（pan/zoom 通用）
     ====================================================================== */
  function makeView2D(container, opts) {
    opts = opts || {};
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.style.cursor = 'grab';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    let scale = 1, tx = 0, ty = 0, dragging = false, lx = 0, ly = 0;
    let panning = false, dpr = 1;
    const flipY = !!opts.flipY;
    let drawFn = null;
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = container.clientWidth || 640, h = container.clientHeight || 480;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      requestDraw();
    }
    function applyTransform(c) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.translate(tx, ty);
      c.scale(scale, flipY ? -scale : scale);
    }
    function requestDraw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = opts.bg || '#0d0d0d';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!drawFn) return;
      ctx.save();
      applyTransform(ctx);
      try { drawFn(ctx, { scale: scale, tx: tx, ty: ty, flipY: flipY, applyTransform: applyTransform }); }
      catch (e) { console.error(e); }
      ctx.restore();
    }
    function fit(b, padFrac) {
      const w = canvas.clientWidth || container.clientWidth || 640;
      const h = canvas.clientHeight || container.clientHeight || 480;
      const pad = padFrac == null ? 0.07 : padFrac;
      const bw = (b.maxX - b.minX) || 1, bh = (b.maxY - b.minY) || 1;
      scale = Math.min(w / (bw * (1 + pad * 2)), h / (bh * (1 + pad * 2)));
      const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
      tx = w / 2 - scale * cx;
      ty = flipY ? h / 2 + scale * cy : h / 2 - scale * cy;
      requestDraw();
    }
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const wx = (mx - tx) / scale;
      const wy = flipY ? -(my - ty) / scale : (my - ty) / scale;
      scale = clamp(scale * factor, 1e-6, 1e7);
      tx = mx - scale * wx;
      ty = flipY ? my + scale * wy : my - scale * wy;
      requestDraw();
    }, { passive: false });
    canvas.addEventListener('pointerdown', e => {
      panning = true; lx = e.clientX; ly = e.clientY;
      canvas.style.cursor = 'grabbing';
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { }
    });
    canvas.addEventListener('pointermove', e => {
      if (!panning) return;
      tx += e.clientX - lx; ty += e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      requestDraw();
    });
    const endPan = () => { panning = false; canvas.style.cursor = 'grab'; };
    canvas.addEventListener('pointerup', endPan);
    canvas.addEventListener('pointercancel', endPan);
    window.addEventListener('resize', resize);
    resize();
    return {
      canvas: canvas, ctx: ctx,
      setDraw(fn) { drawFn = fn; requestDraw(); },
      fit: fit, requestDraw: requestDraw,
      getScale() { return scale; },
      setBg(c) { opts.bg = c; requestDraw(); },
      dispose() {
        window.removeEventListener('resize', resize);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
      }
    };
  }

  /* ======================================================================
     8. Gerber 查看器（gerber-viewer / pcb-viewer）
     ====================================================================== */
  const LAYER_COLORS = ['#d7f452', '#5b8def', '#e8a33d', '#ef4444', '#a3e635', '#9aa6f2', '#00e5ff', '#ff7bd5', '#f59e0b', '#22d3ee'];

  function paintGerber(ctx, g, color) {
    const u = g.unit === 'inch' ? 25.4 : 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const dark = [], clear = [];
    g.regions.forEach(r => { (r.polarity === 'C' ? clear : dark).push(() => {
      if (!r.pts.length) return;
      ctx.beginPath();
      r.pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }); });
    g.arcs.forEach(a => { (a.polarity === 'C' ? clear : dark).push(() => {
      if (a.pts.length < 2) return;
      ctx.beginPath();
      a.pts.forEach((p, i) => { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.01, a.w || 0.1); ctx.stroke();
    }); });
    g.segs.forEach(s => { (s.polarity === 'C' ? clear : dark).push(() => {
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(0.01, s.w || 0.1); ctx.stroke();
    }); });
    g.flashes.forEach(f => { (f.polarity === 'C' ? clear : dark).push(() => {
      const ap = f.ap;
      ctx.fillStyle = color;
      if (!ap) { ctx.beginPath(); ctx.arc(f.x, f.y, 0.15, 0, Math.PI * 2); ctx.fill(); return; }
      if (ap.type === 'R') {
        ctx.fillRect(f.x - ap.params[0] * u / 2, f.y - ap.params[1] * u / 2, ap.params[0] * u, ap.params[1] * u);
      } else if (ap.type === 'O') {
        const w = ap.params[0] * u, h = ap.params[1] * u, r = Math.min(w, h) / 2;
        const x = f.x - w / 2, y = f.y - h / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2); ctx.closePath(); ctx.fill();
      } else if (ap.type === 'P') {
        const n = Math.round(ap.params[1] || 6), r = ap.params[0] * u;
        const rot = (ap.params[2] || 0) * Math.PI / 180;
        ctx.beginPath();
        for (let k = 0; k < n; k++) { const t = k / n * Math.PI * 2 + Math.PI / 2 + rot; const px = f.x + r * Math.cos(t), py = f.y + r * Math.sin(t); if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(f.x, f.y, Math.max(0.01, (ap.params[0] || 0.1) * u / 2), 0, Math.PI * 2); ctx.fill();
      }
    }); });
    dark.forEach(f => f());
    if (clear.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      clear.forEach(f => f());
      ctx.restore();
    }
  }

  async function gerberViewer(host, slug) {
    const isPcb = slug === 'pcb-viewer';
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '560px';
    stage.innerHTML =
      '<div class="drop" id="gDrop" style="flex:1">' +
      '<div class="ic">' + window.icon('cube', 30) + '</div><h3>拖入 Gerber（RS-274X）文件</h3>' +
      '<p>' + (isPcb ? '可一次拖入顶层 / 底层 / 阻焊等多层，叠加观察 PCB。' : '支持多文件叠加，不同层用不同颜色。') + '</p>' +
      '<button class="btn-lime" id="gPick">选择文件（可多选） <span>→</span></button>' +
      '<div class="fmts"><b>.gbr .ger .gtl .gbl .gts .gbs .gto .gko .pho</b> · 本地解析</div>' +
      '<input type="file" id="gFile" accept=".gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gbo,.gko,.pho,.art,.txt" multiple hidden></div>' +
      '<div id="gWrap" class="hide" style="position:relative;flex:1;min-height:480px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#060606">' +
      '<div id="gCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.6);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;font-size:12.5px">' +
      '<span id="gMeta"></span><span><button class="linkbtn" id="gFit">适应窗口</button> <button class="linkbtn" id="gMore">继续添加</button></span></div></div>';
    pane.innerHTML = window.TUI.head(isPcb ? 'PCB / Gerber 查看器' : 'Gerber 查看器',
      '解析 %FS 格式、%MO 单位、%ADD 光圈、D01/D02/D03、G01/G02/G03、%LPD/%LPC 极性。') +
      '<div class="plabel">图层</div><div id="gLayers" style="display:flex;flex-direction:column;gap:6px"></div>' +
      '<div class="statgrid" id="gStats" style="margin-top:12px"></div>' +
      '<div class="plabel">背景</div>' +
      '<div class="shapes" id="gBg"><button class="shape on" data-v="dark">深色</button><button class="shape" data-v="light">浅色</button>'
      + '<button class="shape" data-v="black">纯黑</button></div>' +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-ghost btn-sm" id="gSvg">导出 SVG</button><button class="btn-ghost btn-sm" id="gClear">清空</button></div>' +
      '<div class="warnbox hide" id="gWarn"></div>' +
      '<div class="runnote">面积统计为「闪绘光圈面积 + 多边形区域面积」的近似值。</div>';

    const hs = s => $h(host, s);
    const layers = [];
    let view = null;

    function ensureView() {
      if (view) return view;
      hs('#gDrop').classList.add('hide');
      hs('#gWrap').classList.remove('hide');
      view = makeView2D(hs('#gCanvasHost'), { flipY: true, bg: '#060606' });
      registerCleanup(() => { if (view) view.dispose(); });
      view.setDraw(ctx => {
        const W = view.canvas.width, H = view.canvas.height;
        layers.filter(L => L.on).forEach(L => {
          let off = L._off;
          if (!off || off.width !== W || off.height !== H) {
            off = document.createElement('canvas'); off.width = W; off.height = H; L._off = off;
          }
          const oc = off.getContext('2d');
          oc.setTransform(1, 0, 0, 1, 0, 0);
          oc.clearRect(0, 0, W, H);
          oc.save();
          // 复用主画布当前的 dpr / 平移 / 缩放 / 翻转变换
          oc.setTransform(ctx.getTransform());
          paintGerber(oc, L.parsed, L.color);
          oc.restore();
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(off, 0, 0);
          ctx.restore();
        });
      });
      return view;
    }
    function combinedBounds() {
      let b = null;
      layers.filter(L => L.on).forEach(L => {
        const q = L.parsed.bounds;
        if (!b) b = { minX: q.minX, minY: q.minY, maxX: q.maxX, maxY: q.maxY };
        else { b.minX = Math.min(b.minX, q.minX); b.minY = Math.min(b.minY, q.minY); b.maxX = Math.max(b.maxX, q.maxX); b.maxY = Math.max(b.maxY, q.maxY); }
      });
      return b || { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    }
    function refresh() {
      const list = hs('#gLayers');
      list.innerHTML = layers.map((L, i) => '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">' +
        '<input type="checkbox" data-i="' + i + '" ' + (L.on ? 'checked' : '') + '>' +
        '<span style="width:12px;height:12px;border-radius:3px;background:' + L.color + ';flex-shrink:0"></span>' +
        '<span style="color:#cfcfcf;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(L.name) + '</span></label>').join('');
      [...list.querySelectorAll('input')].forEach(inp => inp.addEventListener('change', () => {
        layers[+inp.dataset.i].on = inp.checked; view && view.requestDraw(); updateStats();
      }));
      updateStats();
    }
    function updateStats() {
      const act = layers.filter(L => L.on);
      let segs = 0, fl = 0, ar = 0, rg = 0, area = 0, ap = 0;
      act.forEach(L => { segs += L.parsed.segs.length; fl += L.parsed.flashes.length; ar += L.parsed.arcs.length; rg += L.parsed.regions.length; area += L.parsed.area; ap += L.parsed.stats.apertures; });
      const b = combinedBounds();
      const rows = {
        '图层': act.length + '/' + layers.length,
        '画线': fmtN(segs), '闪绘': fmtN(fl), '圆弧': fmtN(ar), '区域': fmtN(rg),
        '光圈数': fmtN(ap),
        '尺寸 (mm)': (b.maxX - b.minX).toFixed(2) + ' × ' + (b.maxY - b.minY).toFixed(2),
        '近似面积 (mm²)': area.toFixed(2)
      };
      hs('#gStats').innerHTML = Object.keys(rows).map(k => '<div class="stat"><b>' + esc(rows[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
      hs('#gMeta').textContent = act.length + ' 层 · ' + fmtN(segs + fl + ar) + ' 个绘图对象';
      const notes = [];
      layers.forEach(L => { if (L.parsed.note) notes.push(L.name + '：' + L.parsed.note); });
      const un = {};
      layers.forEach(L => Object.keys(L.parsed.stats.unsupported).forEach(k => { un[k] = (un[k] || 0) + L.parsed.stats.unsupported[k]; }));
      if (Object.keys(un).length) notes.push('忽略：' + Object.keys(un).map(k => k + '×' + un[k]).join('、'));
      const warn = hs('#gWarn');
      if (notes.length) { warn.classList.remove('hide'); warn.textContent = notes.join(' ｜ '); } else warn.classList.add('hide');
    }

    async function addFiles(files) {
      for (const f of [...files]) {
        try {
          const text = await window.TUI.readText(f);
          const parsed = parseGerber(text);
          if (!parsed.segs.length && !parsed.flashes.length && !parsed.arcs.length && !parsed.regions.length) {
            toast('该文件没有解析出绘图对象：' + f.name); continue;
          }
          layers.push({ name: f.name, color: LAYER_COLORS[layers.length % LAYER_COLORS.length], parsed: parsed, on: true, size: f.size });
        } catch (e) { console.error(e); toast('解析失败：' + f.name + ' — ' + e.message); }
      }
      if (!layers.length) return;
      ensureView();
      refresh();
      view.fit(combinedBounds());
    }
    hs('#gPick').addEventListener('click', e => { e.stopPropagation(); hs('#gFile').click(); });
    hs('#gMore').addEventListener('click', () => hs('#gFile').click());
    wireDrop(host, '#gDrop', '#gFile', files => addFiles(files));
    hs('#gFit').addEventListener('click', () => view && view.fit(combinedBounds()));
    hs('#gClear').addEventListener('click', () => {
      layers.length = 0; refresh();
      hs('#gWrap').classList.add('hide'); hs('#gDrop').classList.remove('hide');
      if (view) { view.dispose(); view = null; }
    });
    hs('#gBg').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      [...$h(host, '#gBg').children].forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      const c = { dark: '#060606', light: '#e8e8e8', black: '#000000' }[b.dataset.v];
      if (view) view.setBg(c);
    });
    hs('#gSvg').addEventListener('click', () => {
      if (!layers.length) { toast('先添加文件'); return; }
      const svg = gerberToSvgText(layers.map(L => ({ name: L.name, color: L.color, parsed: L.parsed })));
      dl(new Blob([svg], { type: 'image/svg+xml' }), 'gerber.svg');
    });
  }

  async function gerberToSvgTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="sDrop" style="flex:1"><div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>拖入 Gerber 文件</h3><p>解析后生成矢量 SVG（可缩放、可导入矢量软件）</p>' +
      '<button class="btn-lime" id="sPick">选择文件（可多选） <span>→</span></button>' +
      '<div class="fmts"><b>RS-274X</b> · 本地转换</div>' +
      '<input type="file" id="sFile" accept=".gbr,.ger,.gtl,.gbl,.gts,.gbs,.gto,.gko,.pho" multiple hidden></div>' +
      '<div id="sWrap" class="hide" style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div id="sPrev" style="flex:1;min-height:380px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#060606;display:flex;align-items:center;justify-content:center"></div>' +
      '</div><div class="progress" id="sProg"><i></i></div>';
    pane.innerHTML = window.TUI.head('Gerber → SVG', '把 Gerber 图层转成带 viewBox 的 SVG。') +
      window.TUI.chk('sMono', '单色输出（lime）', false) +
      '<div id="sResult" class="resultbox"><div class="row"><span>状态</span><b>等待文件</b></div></div>' +
      '<div class="shapes" style="margin-top:14px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="sDown" disabled>下载 SVG</button></div>' +
      '<div class="warnbox hide" id="sWarn"></div>';
    const hs = s => $h(host, s);
    let svg = null;
    hs('#sPick').addEventListener('click', e => { e.stopPropagation(); hs('#sFile').click(); });
    wireDrop(host, '#sDrop', '#sFile', files => run(files));
    hs('#sMono').addEventListener('click', () => { if (svg) render(); });
    hs('#sDown').addEventListener('click', () => { if (svg) dl(new Blob([svg], { type: 'image/svg+xml' }), 'gerber.svg'); });
    let parsedLayers = null;
    function render() {
      if (!parsedLayers) return;
      const mono = hs('#sMono').classList.contains('on');
      const ls = parsedLayers.map((L, i) => ({ name: L.name, color: mono ? '#d7f452' : L.color, parsed: L.parsed }));
      svg = gerberToSvgText(ls);
      const holder = hs('#sPrev');
      holder.innerHTML = '';
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      img.style.maxWidth = '94%'; img.style.maxHeight = '94%';
      holder.appendChild(img);
    }
    async function run(files) {
      const arr = [...files].filter(Boolean);
      if (!arr.length) return;
      window.TUI.prog(hs('#sProg'), 20);
      parsedLayers = [];
      for (const f of arr) {
        try {
          const parsed = parseGerber(await window.TUI.readText(f));
          parsedLayers.push({ name: f.name, color: LAYER_COLORS[parsedLayers.length % LAYER_COLORS.length], parsed: parsed });
        } catch (e) { console.error(e); }
      }
      if (!parsedLayers.length) { hs('#sResult').innerHTML = '<div class="row"><span>状态</span><b style="color:#e8a33d">没有可转换的 Gerber</b></div>'; return; }
      window.TUI.prog(hs('#sProg'), 80);
      render();
      const b = parsedLayers[0].parsed.bounds;
      hs('#sDrop').classList.add('hide'); hs('#sWrap').classList.remove('hide');
      const total = parsedLayers.reduce((a, L) => a + L.parsed.segs.length + L.parsed.flashes.length + L.parsed.arcs.length, 0);
      hs('#sResult').innerHTML = [
        ['图层', String(parsedLayers.length)],
        ['绘图对象', fmtN(total)],
        ['尺寸 (mm)', (b.maxX - b.minX).toFixed(2) + ' × ' + (b.maxY - b.minY).toFixed(2)],
        ['SVG 体积', window.fmtSize(new Blob([svg]).size)]
      ].map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
      hs('#sDown').disabled = false;
      window.TUI.prog(hs('#sProg'), 100);
      setTimeout(() => { hs('#sProg').style.display = 'none'; }, 400);
    }
  }

  /* ======================================================================
     9. Excellon 钻孔查看器
     ====================================================================== */
  async function excellonViewer(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '540px';
    stage.innerHTML =
      '<div class="drop" id="eDrop" style="flex:1"><div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>拖入 Excellon 钻孔文件</h3><p>解析 INCH/METRIC、T01C0.035 刀具、X/Y 坐标、G85 槽孔</p>' +
      '<button class="btn-lime" id="ePick">选择文件 <span>→</span></button>' +
      '<div class="fmts"><b>.drl .txt .xln .exc</b> · 本地解析</div>' +
      '<input type="file" id="eFile" accept=".drl,.txt,.xln,.exc,.ncd" hidden></div>' +
      '<div id="eWrap" class="hide" style="position:relative;flex:1;min-height:460px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#060606">' +
      '<div id="eCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.6);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;font-size:12.5px">' +
      '<span id="eMeta"></span><button class="linkbtn" id="eFit">适应窗口</button></div></div>';
    pane.innerHTML = window.TUI.head('Excellon 钻孔查看器', '钻孔圆点 + 槽孔 + 刀具表统计。') +
      '<div class="plabel">刀具表</div><div id="eTools" class="outbox" style="font-size:12.5px">—</div>' +
      '<div class="statgrid" id="eStats"></div>' +
      '<div class="warnbox hide" id="eWarn"></div>' +
      '<div class="runnote">若文件坐标不含小数点，将按单位推断默认小数位（inch 4 位 / mm 3 位），结果以圆点位置与刀具直径为参考。</div>';
    const hs = s => $h(host, s);
    let view = null, parsed = null;
    function drawDrill(ctx, p) {
      ctx.lineCap = 'round';
      ctx.fillStyle = 'rgba(215,244,82,.28)';
      ctx.strokeStyle = 'rgba(215,244,82,.5)';
      p.holes.forEach(h => {
        if (h.slot) {
          ctx.beginPath(); ctx.moveTo(h.x1, h.y1); ctx.lineTo(h.x2, h.y2);
          ctx.lineWidth = Math.max(0.05, h.d); ctx.strokeStyle = 'rgba(215,244,82,.35)'; ctx.stroke();
          ctx.beginPath(); ctx.arc(h.x1, h.y1, h.d / 2, 0, Math.PI * 2); ctx.fillStyle = 'rgba(215,244,82,.4)'; ctx.fill();
          ctx.beginPath(); ctx.arc(h.x2, h.y2, h.d / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(0.03, h.d / 2), 0, Math.PI * 2); ctx.fillStyle = 'rgba(215,244,82,.45)'; ctx.fill();
          ctx.strokeStyle = 'rgba(215,244,82,.9)'; ctx.lineWidth = 0.01; ctx.stroke();
        }
      });
    }
    hs('#ePick').addEventListener('click', e => { e.stopPropagation(); hs('#eFile').click(); });
    wireDrop(host, '#eDrop', '#eFile', files => run(files[0]));
    hs('#eFit').addEventListener('click', () => view && view.fit(parsed.bounds));
    async function run(file) {
      if (!file) return;
      try {
        const text = await window.TUI.readText(file);
        const p = parseExcellon(text);
        if (!p.holes.length) throw new Error('没有解析到任何钻孔坐标');
        parsed = p;
        hs('#eDrop').classList.add('hide'); hs('#eWrap').classList.remove('hide');
        if (!view) { view = makeView2D(hs('#eCanvasHost'), { flipY: true, bg: '#060606' }); registerCleanup(() => view && view.dispose()); }
        view.setDraw(ctx => drawDrill(ctx, p));
        view.fit(p.bounds);
        const rows = {
          '钻孔数': fmtN(p.holes.length),
          '槽孔': fmtN(p.stats.slots),
          '刀具数': fmtN(Object.keys(p.tools).length),
          '单位': p.unit === 'mm' ? 'mm' : 'inch',
          '尺寸 (mm)': (p.bounds.maxX - p.bounds.minX).toFixed(2) + ' × ' + (p.bounds.maxY - p.bounds.minY).toFixed(2),
          '近似孔面积': p.area.toFixed(2) + ' mm²'
        };
        hs('#eStats').innerHTML = Object.keys(rows).map(k => '<div class="stat"><b>' + esc(rows[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
        const tkeys = Object.keys(p.tools).sort((a, b) => a - b);
        hs('#eTools').innerHTML = tkeys.length ? tkeys.map(k =>
          'T' + String(k).padStart(2, '0') + ' · ⌀' + p.tools[k].d.toFixed(3) + ' mm · ' + (p.toolCounts[k] || 0) + ' 孔').join('<br>') : '未声明刀具表';
        hs('#eMeta').textContent = file.name + ' · ' + p.holes.length + ' 孔';
        hs('#eWarn').classList.add('hide');
      } catch (err) { console.error(err); toast(err.message || '钻孔文件解析失败'); hs('#eWarn').classList.remove('hide'); hs('#eWarn').textContent = err.message; }
    }
  }

  /* ======================================================================
     10. 分子查看器（molecule-viewer / pdb-viewer）
     ====================================================================== */
  async function previewInto(container, mesh, opts) {
    container.innerHTML = '';
    const sc = await makeScene3D(container, opts || { bg: 'dark', showGrid: true });
    const geo = meshToThreeGeometry(sc.THREE, mesh);
    const m = new sc.THREE.Mesh(geo, new sc.THREE.MeshStandardMaterial({ color: 0xc2cbd6, metalness: 0.12, roughness: 0.7, side: sc.THREE.DoubleSide }));
    sc.add(m);
    sc.fit(sc.root);
    return sc;
  }

  const MODE_R = { ball: 0.32, space: 1.0, line: 0.1 };
  function buildMolecule(THREE, mol, mode, chain, residue) {
    const group = new THREE.Group();
    const sphereGeo = new THREE.SphereGeometry(1, mode === 'space' ? 18 : 12, mode === 'space' ? 14 : 8);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
    const matCache = new Map();
    const mat = (color, dim) => {
      const key = color + '|' + (dim ? 1 : 0);
      let m = matCache.get(key);
      if (!m) {
        m = new THREE.MeshStandardMaterial({
          color: new THREE.Color(color), metalness: 0.15, roughness: 0.5,
          transparent: !!dim, opacity: dim ? 0.16 : 1
        });
        matCache.set(key, m);
      }
      return m;
    };
    const hl = a => (!chain || a.chain === chain) && (!residue || String(a.resSeq) === String(residue));
    const c = mol.center;
    if (mode === 'line') {
      const pts = [];
      const cols = [];
      const tmp = new THREE.Color();
      mol.bonds.forEach(bd => {
        const ia = Array.isArray(bd) ? bd[0] : bd.a;
        const ib = Array.isArray(bd) ? bd[1] : bd.b;
        const A = mol.atoms[ia], B = mol.atoms[ib];
        if (!A || !B) return;
        pts.push(A.x - c[0], A.y - c[1], A.z - c[2], B.x - c[0], B.y - c[1], B.z - c[2]);
        [A, B].forEach(a => { tmp.set(CPK[a.el] || '#cccccc'); const d = hl(a) ? 1 : 0.35; cols.push(tmp.r * d, tmp.g * d, tmp.b * d); });
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cols), 3));
      group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })));
      return group;
    }
    const bondR = mode === 'space' ? 0 : 0.11;
    const baseR = MODE_R[mode];
    mol.atoms.forEach(a => {
      const r = mode === 'space' ? (VDW[a.el] || VDW.default) * baseR * 0.5 : baseR;
      const col = CPK[a.el] || '#cccccc';
      const mesh = new THREE.Mesh(sphereGeo, mat(col, !hl(a)));
      mesh.position.set(a.x - c[0], a.y - c[1], a.z - c[2]);
      mesh.scale.setScalar(r);
      group.add(mesh);
    });
    if (bondR > 0) {
      const up = new THREE.Vector3(0, 1, 0);
      mol.bonds.forEach(bd => {
        const ia = Array.isArray(bd) ? bd[0] : bd.a;
        const ib = Array.isArray(bd) ? bd[1] : bd.b;
        const A = mol.atoms[ia], B = mol.atoms[ib];
        if (!A || !B) return;
        const ax = A.x - c[0], ay = A.y - c[1], az = A.z - c[2];
        const bx = B.x - c[0], by = B.y - c[1], bz = B.z - c[2];
        const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
        const len = dir.length();
        if (len < 1e-6) return;
        const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        const mesh = new THREE.Mesh(cylGeo, mat('#b9b9b9', !(hl(A) && hl(B))));
        mesh.position.copy(mid);
        mesh.quaternion.setFromUnitVectors(up, dir.normalize());
        mesh.scale.set(bondR, len, bondR);
        group.add(mesh);
      });
    }
    return group;
  }

  async function moleculeViewer(host, slug) {
    const { stage, pane } = window.TUI.shell(host, true);
    const isPdb = slug === 'pdb-viewer';
    stage.style.minHeight = '560px';
    stage.innerHTML =
      '<div class="drop" id="mDrop" style="flex:1;align-items:center">' +
      '<div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>拖入 ' + (isPdb ? 'PDB' : '分子') + '文件</h3>' +
      '<p>ATOM / HETATM 记录 · CPK 配色 · 球棍 / 空间填充 / 线框</p>' +
      '<button class="btn-lime" id="mPick">选择文件 <span>→</span></button>' +
      '<div class="fmts"><b>.pdb .ent</b> · 也可以直接粘贴 PDB 文本</div>' +
      '<input type="file" id="mFile" accept=".pdb,.ent,.txt" hidden>' +
      '<div class="plabel" style="margin-top:16px;align-self:stretch;text-align:left">或粘贴 PDB 文本</div>' +
      '<textarea id="mPaste" rows="3" placeholder="ATOM      1  N   MET A   1      38.428  13.778  42.680  1.00 52.00           N" style="align-self:stretch;width:100%"></textarea>' +
      '<button class="btn-ghost btn-sm" id="mPasteGo" style="margin-top:8px">用粘贴内容渲染</button></div>' +
      '<div id="mWrap" class="hide" style="position:relative;flex:1;min-height:480px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010">' +
      '<div id="mCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;display:flex;justify-content:space-between;font-size:12.5px">' +
      '<span><b id="mName"></b> <span id="mMeta"></span></span><button class="linkbtn" id="mShot">截图</button></div></div>';
    pane.innerHTML = window.TUI.head(isPdb ? 'PDB 查看器' : '分子查看器', '按元素 CPK 配色，支持按链 / 残基高亮。') +
      '<div class="plabel">显示模式</div>' +
      '<div class="shapes" id="mMode"><button class="shape on" data-v="ball">球棍</button><button class="shape" data-v="space">空间填充</button><button class="shape" data-v="line">线框</button></div>' +
      '<div class="plabel">高亮链</div><select id="mChain"></select>' +
      '<div class="plabel">高亮残基序号</div><input id="mRes" placeholder="留空 = 全部">' +
      window.TUI.chk('mSpin', '自动旋转', false) +
      '<div class="statgrid" id="mStats"></div>' +
      '<div class="runnote" id="mNote">未提供 CONECT 时，键由原子间距离自动推断（共价半径 + 容差）。</div>';
    const hs = s => $h(host, s);
    let sc = null, mol = null, mode = 'ball', chain = '', residue = '';
    const cleanup = () => { if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);
    hs('#mPick').addEventListener('click', e => { e.stopPropagation(); hs('#mFile').click(); });
    wireDrop(host, '#mDrop', '#mFile', async files => { const f = files[0]; if (f) run(await window.TUI.readText(f), f.name); });
    hs('#mPasteGo').addEventListener('click', () => { const t = hs('#mPaste').value; if (t.trim()) run(t, 'pasted.pdb'); else toast('先粘贴 PDB 文本'); });
    hs('#mMode').addEventListener('click', e => {
      const b = e.target.closest('.shape'); if (!b) return;
      [...$h(host, '#mMode').children].forEach(x => x.classList.remove('on'));
      b.classList.add('on'); mode = b.dataset.v; rebuild();
    });
    hs('#mChain').addEventListener('change', () => { chain = hs('#mChain').value; rebuild(); });
    hs('#mRes').addEventListener('change', () => { residue = hs('#mRes').value.trim(); rebuild(); });
    hs('#mSpin').addEventListener('click', () => setTimeout(() => { if (sc) sc.setAutoRotate(hs('#mSpin').classList.contains('on')); }, 0));
    hs('#mShot').addEventListener('click', () => { if (sc) sc.screenshot((hs('#mName').textContent || 'molecule').replace(/\.[^.]+$/, '')); });

    function rebuild() {
      if (!mol || !sc) return;
      while (sc.root.children.length) {
        const c = sc.root.children[0];
        sc.root.remove(c);
        c.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      sc.add(buildMolecule(sc.THREE, mol, mode, chain === '__none' ? '' : chain, residue));
      sc.fit(sc.root);
    }
    async function run(text, name) {
      try {
        const m = parsePDB(text);
        if (!m.atoms.length) throw new Error('没有解析到任何 ATOM / HETATM 记录');
        mol = m; chain = ''; residue = '';
        hs('#mDrop').classList.add('hide'); hs('#mWrap').classList.remove('hide');
        if (!sc) {
          sc = await makeScene3D(hs('#mCanvasHost'), { bg: 'dark', showGrid: false, showAxes: false });
          registerCleanup(() => { if (sc) sc.dispose(); });
        }
        rebuild();
        const ch = m.structures.chains;
        hs('#mChain').innerHTML = '<option value="">全部</option>' + ch.map(c => '<option value="' + esc(c) + '">链 ' + esc(c) + '</option>').join('');
        hs('#mName').textContent = name;
        hs('#mMeta').textContent = m.counts.atoms + ' 原子 · ' + m.counts.residues + ' 残基';
        const rows = {
          '原子数': fmtN(m.counts.atoms), '键数': fmtN(m.counts.bonds),
          '残基数': fmtN(m.counts.residues), '链数': fmtN(m.counts.chains),
          '异原子(HETATM)': fmtN(m.counts.het),
          '包围盒 (Å)': m.bounds.max.map((v, i) => (v - m.bounds.min[i]).toFixed(1)).join(' × ')
        };
        hs('#mStats').innerHTML = Object.keys(rows).map(k => '<div class="stat"><b>' + esc(rows[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
        if (m.counts.atoms > 4000) hs('#mNote').textContent = '原子较多（' + m.counts.atoms + '），空间填充模式可能较慢，建议用线框模式。';
        else hs('#mNote').textContent = '未提供 CONECT 时，键由原子间距离自动推断（共价半径 + 容差）。';
      } catch (err) { console.error(err); toast(err.message || 'PDB 解析失败'); }
    }
  }

  /* ======================================================================
     11. SMILES → 结构式
     ====================================================================== */
  async function smilesTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div class="canvaswrap" style="flex:1;min-height:380px;display:flex;align-items:center;justify-content:center;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#141414">' +
      '<canvas id="smCanvas" width="880" height="520" style="max-width:100%;max-height:100%"></canvas></div>' +
      '<div class="pdesc">输入 SMILES 后点击「生成结构式」。' + '<b>简化实现</b>：不处理立体化学与复杂稠环的美观布局。</div></div>';
    pane.innerHTML = window.TUI.head('SMILES → 结构式', '简化解析器：原子 / 键 / 分支 / 环闭合 / 芳香 / 断开。') +
      window.TUI.field('SMILES', window.TUI.input('smIn', 'c1ccccc1O', '例如 c1ccccc1O（苯酚）、CC(=O)O（乙酸）')) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn-lime btn-sm" id="smGo">生成结构式</button>' +
      '<button class="btn-ghost btn-sm" id="smPng">下载 PNG</button></div>' +
      '<div class="plabel">示例</div>' +
      '<div class="shapes" id="smEx">' +
      ['c1ccccc1', 'c1ccccc1O', 'CC(=O)O', 'CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'N[C@@H](CC1=CNC2=C1C=CC=C2)C(=O)O', 'C1CCCCC1', 'O=C(O)c1ccccc1O', 'c1ccc2ccccc2c1']
        .map(s => '<button class="shape" data-v="' + esc(s) + '">' + esc(s.length > 18 ? s.slice(0, 17) + '…' : s) + '</button>').join('') + '</div>' +
      '<div class="resultbox" id="smRes"><div class="row"><span>状态</span><b>等待输入</b></div></div>' +
      '<div class="warnbox hide" id="smWarn"></div>';
    const hs = s => $h(host, s);
    hs('#smEx').addEventListener('click', e => { const b = e.target.closest('.shape'); if (!b) return; hs('#smIn').value = b.dataset.v; run(); });
    hs('#smGo').addEventListener('click', run);
    hs('#smIn').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    hs('#smPng').addEventListener('click', () => {
      const c = hs('#smCanvas');
      c.toBlob(b => dl(b, 'structure.png'), 'image/png');
    });
    function run() {
      const s = hs('#smIn').value.trim();
      if (!s) { toast('请输入 SMILES'); return; }
      try {
        const mol = parseSMILES(s);
        if (!mol.atoms.length) throw new Error('没有解析出任何原子');
        layoutSMILES(mol);
        const info = smilesFormula(mol);
        drawSMILES(hs('#smCanvas'), mol, { bg: '#141414' });
        hs('#smRes').innerHTML = [
          ['分子式', esc(info.formula || '—')],
          ['分子量', info.mw.toFixed(3) + ' g/mol'],
          ['原子数', String(mol.atoms.length)],
          ['键数', String(mol.bonds.length)],
          ['环数(检测)', String(findRings(mol).length)],
          ['氢原子(估算)', String(info.hTotal)]
        ].map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + r[1] + '</b></div>').join('');
        const w = hs('#smWarn');
        if (mol.unsupported.length) { w.classList.remove('hide'); w.textContent = '简化实现忽略：' + [...new Set(mol.unsupported)].join('、'); }
        else { w.classList.remove('hide'); w.textContent = '简化实现：立体化学（@ / @TH）被忽略；复杂稠环的布局为力导向近似，可能与教科书画法不同。'; }
      } catch (err) { console.error(err); toast(err.message); }
    }
    run();
  }

  /* ======================================================================
     12. 图像 → STL / 石板画
     ====================================================================== */
  function imageMeshToolParams(mode) {
    if (mode === 'litho') {
      return '<div class="plabel">形状</div><div class="shapes" id="lShape"><button class="shape on" data-v="square">方形</button><button class="shape" data-v="circle">圆形</button></div>' +
        window.TUI.field('尺寸 (mm)', window.TUI.input('lSize', '100', '', 'number')) +
        window.TUI.field('最小厚度 (mm)', window.TUI.input('lMin', '0.8', '', 'number')) +
        window.TUI.field('最大厚度 (mm)', window.TUI.input('lMax', '3.0', '', 'number')) +
        '<div class="plabel">分辨率</div>' + window.TUI.range('lRes', 48, 220, 120, 4) +
        window.TUI.chk('lInv', '反转明暗（默认：越暗越厚）', false) +
        '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="iGo">生成 STL</button><button class="btn-ghost btn-sm" id="iDown" disabled>下载 STL</button></div>';
    }
    return '<div class="plabel">网格分辨率</div>' + window.TUI.range('iRes', 64, 512, 200, 8) +
      window.TUI.field('成品宽度 (mm)', window.TUI.input('iWidth', '100', '', 'number')) +
      window.TUI.field('浮雕高度 (mm)', window.TUI.input('iAmp', '8', '', 'number')) +
      window.TUI.field('底座厚度 (mm)', window.TUI.input('iBase', '2', '', 'number')) +
      '<div class="plabel">模式</div><div class="shapes" id="iMode"><button class="shape on" data-v="solid">实心底座 + 浮雕</button><button class="shape" data-v="sheet">薄片浮雕</button></div>' +
      window.TUI.chk('iInv', '反转亮度', false) +
      window.TUI.chk('iMirror', '左右镜像', false) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="iGo">生成 STL</button><button class="btn-ghost btn-sm" id="iDown" disabled>下载 STL</button></div>';
  }

  async function imageMeshTool(host, slug) {
    const isLitho = slug === 'lithophane-maker';
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="iDrop" style="flex:1"><div class="ic">' + window.icon('image', 30) + '</div>' +
      '<h3>' + (isLitho ? '拖入照片做石板画' : '拖入图片生成浮雕 STL') + '</h3>' +
      '<p>' + (isLitho ? '按透光度反推厚度，输出可直接打印的 STL' : '灰度 → 位移网格，输出可打印的 STL') + '</p>' +
      '<button class="btn-lime" id="iPick">选择图片 <span>→</span></button>' +
      '<div class="fmts"><b>PNG · JPG · WebP</b> · 本地生成</div>' +
      '<input type="file" id="iFile" accept="image/*" hidden></div>' +
      '<div id="iWrap" class="hide" style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div style="position:relative;flex:1;min-height:340px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010">' +
      '<div id="iCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;font-size:12.5px"><b id="iName"></b></div>' +
      '</div></div><div class="progress" id="iProg"><i></i></div>';
    pane.innerHTML = window.TUI.head(isLitho ? '石板画 (Lithophane)' : (slug === 'image-to-stl' ? '图片 → STL' : '图片 → STL'), isLitho ? '厚度 = 最小 + 暗度 × (最大−最小)，自动换算为 mm。' : '灰度高度图 → 位移网格，分块生成不卡死。') +
      imageMeshToolParams(isLitho ? 'litho' : 'relief') +
      '<div class="resultbox" id="iRes"><div class="row"><span>状态</span><b>等待图片</b></div></div>' +
      '<div class="runnote">' + (isLitho ? '白色区域薄、深色区域厚，逆光观看显现图像。' : '这是从亮度生成的位移模型，不是照片的 3D 重建。') + '</div>';

    const hs = s => $h(host, s);
    let img = null, sc = null, blob = null, name = 'model.stl';
    const cleanup = () => { if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);
    hs('#iPick').addEventListener('click', e => { e.stopPropagation(); hs('#iFile').click(); });
    wireDrop(host, '#iDrop', '#iFile', files => load(files[0]));
    hs('#iDown').addEventListener('click', () => { if (blob) dl(blob, name); });
    const seg = hs('#iMode');
    if (seg) seg.addEventListener('click', e => { const b = e.target.closest('.shape'); if (!b) return; [...seg.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); });
    const segL = hs('#lShape');
    if (segL) segL.addEventListener('click', e => { const b = e.target.closest('.shape'); if (!b) return; [...segL.children].forEach(x => x.classList.remove('on')); b.classList.add('on'); });
    hs('#iGo') && hs('#iGo').addEventListener('click', generate);

    async function load(file) {
      if (!file) return;
      try {
        img = await loadImageFile(file);
        hs('#iDrop').classList.add('hide'); hs('#iWrap').classList.remove('hide');
        hs('#iName').textContent = file.name + ' · ' + img.naturalWidth + '×' + img.naturalHeight;
        generate();
      } catch (e) { console.error(e); toast(e.message); }
    }
    function val(id, d) { const e = hs('#' + id); return e ? (parseFloat(e.value) || d) : d; }
    async function generate() {
      if (!img) return;
      const prog = hs('#iProg');
      window.TUI.prog(prog, 5);
      await waitTick();
      let mesh, extra = {};
      try {
        if (isLitho) {
          const res = clamp(Math.round(val('lRes', 120)), 32, 260);
          const gray = grayFromImage(img, res * 2);
          window.TUI.prog(prog, 30);
          await waitTick();
          const size = val('lSize', 100);
          const minT = val('lMin', 0.8), maxT = val('lMax', 3.0);
          const shape = $h(host, '#lShape .shape.on').dataset.v;
          mesh = buildLithophaneMesh(gray, { minT: minT, maxT: maxT, size: size, res: res, invert: hs('#lInv').classList.contains('on'), shape: shape });
          extra = { '形状': shape === 'circle' ? '圆形' : '方形', '尺寸': size + ' mm', '厚度': minT + '–' + maxT + ' mm' };
        } else {
          const res = clamp(Math.round(val('iRes', 200)), 32, 512);
          const gray = grayFromImage(img, res);
          window.TUI.prog(prog, 30);
          await waitTick();
          const modeSel = $h(host, '#iMode .shape.on');
          const solid = !modeSel || modeSel.dataset.v === 'solid';
          mesh = buildHeightMesh(gray, {
            amplitude: val('iAmp', 8), base: val('iBase', 2), width: val('iWidth', 100),
            invert: hs('#iInv').classList.contains('on'), mirror: hs('#iMirror').classList.contains('on'), solid: solid
          });
          extra = { '模式': solid ? '实心底座' : '薄片', '分辨率': res + '×' + res, '成品宽度': val('iWidth', 100) + ' mm' };
        }
        window.TUI.prog(prog, 70);
        await waitTick();
        const st = meshStats(mesh);
        const buf = meshToSTLBinary(mesh, 'lithophane');
        blob = new Blob([buf], { type: 'model/stl' });
        name = (img.src ? 'model' : 'model') + (isLitho ? '-lithophane' : '-relief') + '.stl';
        const rows = {
          '三角面数': fmtN(st.tris), '顶点数': fmtN(st.verts),
          '尺寸 (X×Y×Z mm)': st.size.map(v => v.toFixed(1)).join(' × '),
          'STL 体积': window.fmtSize(blob.size)
        };
        Object.keys(extra).forEach(k => { rows[k] = extra[k]; });
        hs('#iRes').innerHTML = Object.keys(rows).map(k => '<div class="row"><span>' + esc(k) + '</span><b>' + esc(rows[k]) + '</b></div>').join('');
        hs('#iDown').disabled = false;
        if (sc) { try { sc.dispose(); } catch (e) { } sc = null; }
        sc = await previewInto(hs('#iCanvasHost'), mesh, { bg: 'dark', showGrid: true });
        registerCleanup(() => { if (sc) sc.dispose(); });
        window.TUI.prog(prog, 100);
        setTimeout(() => { prog.style.display = 'none'; }, 400);
      } catch (e) {
        console.error(e); toast(e.message || '生成失败');
        prog.style.display = 'none';
      }
    }
  }

  /* ======================================================================
     13. 图像 → DXF（轮廓追踪）
     ====================================================================== */
  function boxBlur(g, w, h) {
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy;
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        s += g[Y * w + X]; c++;
      }
      out[y * w + x] = s / c;
    }
    return out;
  }
  function contoursFromGray(gray, o) {
    let g = gray.g;
    if (o.blur) g = boxBlur(g, gray.w, gray.h);
    const mag = sobel(g, gray.w, gray.h);
    const bin = new Uint8Array(gray.w * gray.h);
    const thr = o.threshold;
    for (let i = 0; i < bin.length; i++) bin[i] = mag[i] > thr ? 1 : 0;
    let loops = traceContours(bin, gray.w, gray.h);
    if (!loops.length) return { loops: [], w: gray.w, h: gray.h };
    // 先用「原始边界步数」过滤小噪点（比简化后的点数更能代表轮廓大小）
    loops = loops.filter(lp => lp.length >= o.minPoints);
    // 再简化（闭合回路用双锚点 DP，避免首尾同点退化）
    loops = loops.map(lp => {
      const closed = lp.length > 3 && lp[0][0] === lp[lp.length - 1][0] && lp[0][1] === lp[lp.length - 1][1] ? lp.slice(0, -1) : lp;
      return dpSimplifyClosed(closed, o.tolerance);
    }).filter(lp => lp.length >= 3);
    if (o.onlyOuter) loops = loops.filter((lp, i) => {
      const pt = lp[0];
      for (let j = 0; j < loops.length; j++) {
        if (j === i) continue;
        if (Math.abs(loopArea(loops[j])) > Math.abs(loopArea(lp)) && pointInPoly(pt, loops[j])) return false;
      }
      return true;
    });
    return { loops, w: gray.w, h: gray.h };
  }
  function loopsToDxf(loops, opt) {
    const scale = opt.scale || 1, h = opt.height || 0;
    const polys = loops.map(lp => ({
      closed: true,
      pts: lp.map(p => [p[0] * scale, (h - p[1]) * scale])
    }));
    return dxfWrapLwPolylines(polys);
  }
  function previewLoops(canvas, loops, w, h) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0d0d0d'; ctx.fillRect(0, 0, W, H);
    if (!loops.length) return;
    const sc = Math.min((W - 20) / w, (H - 20) / h);
    const ox = (W - w * sc) / 2, oy = (H - h * sc) / 2;
    ctx.strokeStyle = '#d7f452'; ctx.lineWidth = 1;
    loops.forEach(lp => {
      ctx.beginPath();
      lp.forEach((p, i) => { const X = ox + p[0] * sc, Y = oy + p[1] * sc; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.closePath(); ctx.stroke();
    });
  }

  async function imageToDxfTool(host, slug) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="xDrop" style="flex:1"><div class="ic">' + window.icon('image', 30) + '</div>' +
      '<h3>拖入图片 → 轮廓 DXF</h3><p>Sobel 边缘检测 + Moore 邻域轮廓追踪 + Douglas-Peucker 简化</p>' +
      '<button class="btn-lime" id="xPick">选择图片 <span>→</span></button>' +
      '<div class="fmts"><b>PNG · JPG · WebP</b> · 输出 <b>DXF</b>（LWPOLYLINE）</div>' +
      '<input type="file" id="xFile" accept="image/*" hidden></div>' +
      '<div id="xWrap" class="hide" style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div class="canvaswrap" style="flex:1;min-height:380px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
      '<canvas id="xCanvas" width="900" height="520" style="max-width:100%;max-height:100%"></canvas></div>' +
      '<div class="filebar"><b id="xName"></b></div></div><div class="progress" id="xProg"><i></i></div>';
    pane.innerHTML = window.TUI.head('图片 → DXF', '输出可导入 CAD / 激光切割机的轮廓线。') +
      '<div class="plabel">边缘阈值</div>' + window.TUI.range('xThr', 0.05, 1.2, 0.35, 0.05) +
      '<div class="plabel">最小轮廓点数</div>' + window.TUI.range('xMin', 3, 200, 24, 1) +
      '<div class="plabel">简化容差 (px)</div>' + window.TUI.range('xTol', 0.2, 8, 1.4, 0.2) +
      '<div class="plabel">处理尺寸 (px)</div>' + window.TUI.range('xSize', 200, 1400, 700, 20) +
      window.TUI.field('输出比例 (mm/px)', window.TUI.input('xScale', '0.2', '', 'number')) +
      window.TUI.chk('xOuter', '只保留外轮廓', false) +
      window.TUI.chk('xSmooth', '先做 3×3 平滑（降噪）', true) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="xGo">重新生成</button><button class="btn-ghost btn-sm" id="xDown" disabled>下载 DXF</button></div>' +
      '<div class="resultbox" id="xRes"><div class="row"><span>状态</span><b>等待图片</b></div></div>';
    const hs = s => $h(host, s);
    let img = null, dxfText = null, loops = null, gw = 0, gh = 0;
    hs('#xPick').addEventListener('click', e => { e.stopPropagation(); hs('#xFile').click(); });
    wireDrop(host, '#xDrop', '#xFile', files => load(files[0]));
    hs('#xDown').addEventListener('click', () => { if (dxfText) dl(new Blob([dxfText], { type: 'application/dxf' }), (img ? 'contour' : 'contour') + '.dxf'); });
    hs('#xGo').addEventListener('click', generate);
    function val(id, d) { const e = hs('#' + id); return e ? (parseFloat(e.value) || d) : d; }
    async function load(file) {
      if (!file) return;
      try {
        img = await loadImageFile(file);
        hs('#xDrop').classList.add('hide'); hs('#xWrap').classList.remove('hide');
        hs('#xName').textContent = file.name + ' · ' + img.naturalWidth + '×' + img.naturalHeight;
        generate();
      } catch (e) { console.error(e); toast(e.message); }
    }
    async function generate() {
      if (!img) return;
      const prog = hs('#xProg');
      window.TUI.prog(prog, 10);
      await waitTick();
      try {
        const size = clamp(Math.round(val('xSize', 700)), 120, 1600);
        const gray = grayFromImage(img, size);
        window.TUI.prog(prog, 45);
        await waitTick();
        const res = contoursFromGray(gray, {
          threshold: val('xThr', 0.35), tolerance: val('xTol', 1.4),
          minPoints: Math.round(val('xMin', 24)), onlyOuter: hs('#xOuter').classList.contains('on'),
          blur: hs('#xSmooth').classList.contains('on')
        });
        loops = res.loops; gw = res.w; gh = res.h;
        window.TUI.prog(prog, 80);
        await waitTick();
        dxfText = loopsToDxf(loops, { scale: val('xScale', 0.2), height: gh });
        hs('#xDown').disabled = !loops.length;
        hs('#xRes').innerHTML = [
          ['轮廓数', fmtN(loops.length)],
          ['顶点总数', fmtN(loops.reduce((a, l) => a + l.length, 0))],
          ['处理分辨率', gw + '×' + gh],
          ['DXF 体积', window.fmtSize(new Blob([dxfText]).size)]
        ].map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
        previewLoops(hs('#xCanvas'), loops, gw, gh);
        window.TUI.prog(prog, 100);
        setTimeout(() => { prog.style.display = 'none'; }, 400);
      } catch (e) { console.error(e); toast(e.message); prog.style.display = 'none'; }
    }
  }

  /* ======================================================================
     14. 文字 → DXF
     ====================================================================== */
  async function textToDxfTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div class="canvaswrap" style="flex:1;min-height:360px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center">' +
      '<canvas id="tCanvas" width="900" height="360" style="max-width:100%;max-height:100%"></canvas></div>' +
      '<div class="pdesc">文字 → 描边轮廓 → DXF（LWPOLYLINE）。锥形/雕刻机可直接用。</div></div>';
    pane.innerHTML = window.TUI.head('文字 → DXF', '用 Canvas 绘制文字后提取轮廓。') +
      window.TUI.field('文字内容', window.TUI.input('tText', 'LASER', '')) +
      window.TUI.field('字高 (mm)', window.TUI.input('tH', '40', '', 'number')) +
      '<div class="plabel">字体</div><select id="tFont"><option value="sans-serif">无衬线 Sans</option><option value="serif">衬线 Serif</option><option value="monospace">等宽 Mono</option></select>' +
      window.TUI.chk('tBold', '加粗', true) +
      window.TUI.chk('tSingle', '单线（描边近似）', false) +
      '<div class="plabel">简化容差</div>' + window.TUI.range('tTol', 0.3, 6, 1.2, 0.1) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="tGo">生成 DXF</button><button class="btn-ghost btn-sm" id="tDown" disabled>下载 DXF</button></div>' +
      '<div class="resultbox" id="tRes"><div class="row"><span>状态</span><b>点击「生成 DXF」</b></div></div>' +
      '<div class="warnbox" id="tWarn">浏览器内置字体没有真正的单线字形，「单线」模式使用 strokeText 轮廓近似（线宽约为字高的 6%）。</div>';
    const hs = s => $h(host, s);
    let dxfText = null;
    hs('#tGo').addEventListener('click', generate);
    hs('#tDown').addEventListener('click', () => { if (dxfText) dl(new Blob([dxfText], { type: 'application/dxf' }), 'text.dxf'); });
    hs('#tText').addEventListener('keydown', e => { if (e.key === 'Enter') generate(); });
    function val(id, d) { const e = hs('#' + id); return e ? (parseFloat(e.value) || d) : d; }
    function generate() {
      try {
        const text = hs('#tText').value || 'LASER';
        const fontSize = 300;
        const bold = hs('#tBold').classList.contains('on');
        const font = (bold ? 'bold ' : '') + fontSize + 'px ' + hs('#tFont').value;
        const meas = document.createElement('canvas').getContext('2d');
        meas.font = font;
        const tw = Math.ceil(meas.measureText(text).width) + 40;
        const th = Math.ceil(fontSize * 1.5);
        const c = document.createElement('canvas');
        c.width = Math.min(4096, Math.max(64, tw));
        c.height = th;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.font = font;
        if (hs('#tSingle').classList.contains('on')) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = fontSize * 0.06;
          ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          ctx.strokeText(text, 20, fontSize * 1.1);
        } else {
          ctx.fillStyle = '#fff';
          ctx.fillText(text, 20, fontSize * 1.1);
        }
        const gimg = ctx.getImageData(0, 0, c.width, c.height);
        const w = c.width, h = c.height;
        const gray = { w: w, h: h, g: new Float32Array(w * h) };
        for (let i = 0, j = 0; i < gimg.data.length; i += 4, j++) gray.g[j] = gimg.data[i] / 255;
        // 二值化直接走轮廓（无需 Sobel，字形本身即为实心区域）
        const bin = new Uint8Array(w * h);
        for (let i = 0; i < bin.length; i++) bin[i] = gray.g[i] > 0.5 ? 1 : 0;
        let loops = traceContours(bin, w, h).map(lp => {
          const closed = lp[0][0] === lp[lp.length - 1][0] && lp[0][1] === lp[lp.length - 1][1] ? lp.slice(0, -1) : lp;
          return dpSimplifyClosed(closed, val('tTol', 1.2));
        }).filter(lp => lp.length >= 3);
        const targetH = val('tH', 40);
        const scale = targetH / fontSize;
        dxfText = loopsToDxf(loops, { scale: scale, height: h });
        hs('#tDown').disabled = !loops.length;
        hs('#tRes').innerHTML = [
          ['轮廓数', fmtN(loops.length)],
          ['顶点数', fmtN(loops.reduce((a, l) => a + l.length, 0))],
          ['成品字高', targetH + ' mm'],
          ['DXF 体积', window.fmtSize(new Blob([dxfText]).size)]
        ].map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
        // 预览
        const pv = hs('#tCanvas');
        const pvx = pv.getContext('2d');
        pvx.fillStyle = '#0d0d0d'; pvx.fillRect(0, 0, pv.width, pv.height);
        const sc = Math.min((pv.width - 20) / w, (pv.height - 20) / h);
        const ox = (pv.width - w * sc) / 2, oy = (pv.height - h * sc) / 2;
        pvx.strokeStyle = '#d7f452'; pvx.lineWidth = 1.2;
        loops.forEach(lp => {
          pvx.beginPath();
          lp.forEach((p, i) => { const X = ox + p[0] * sc, Y = oy + p[1] * sc; if (i) pvx.lineTo(X, Y); else pvx.moveTo(X, Y); });
          pvx.closePath(); pvx.stroke();
        });
      } catch (e) { console.error(e); toast(e.message || '生成失败'); }
    }
    generate();
  }

  /* ======================================================================
     15. SVG → DXF / DXF → SVG
     ====================================================================== */
  async function svgToDxfTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="vDrop" style="flex:1"><div class="ic">' + window.icon('image', 30) + '</div>' +
      '<h3>拖入 SVG 或粘贴源码</h3><p>path（M/L/H/V/C/S/Q/T/A/Z）/ line / rect / circle / ellipse / polyline / polygon</p>' +
      '<button class="btn-lime" id="vPick">选择 SVG 文件 <span>→</span></button>' +
      '<div class="fmts"><b>SVG</b> → <b>DXF</b> · 本地转换</div>' +
      '<input type="file" id="vFile" accept=".svg" hidden>' +
      '<textarea id="vPaste" rows="3" placeholder="&lt;svg ...&gt; ... &lt;/svg&gt;" style="align-self:stretch;width:100%;margin-top:14px"></textarea>' +
      '<button class="btn-ghost btn-sm" id="vGo" style="margin-top:8px">用粘贴内容转换</button></div>' +
      '<div id="vWrap" class="hide" style="position:relative;flex:1;min-height:400px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#0d0d0d;display:flex;align-items:center;justify-content:center">' +
      '<div id="vPrev" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center"></div></div>';
    pane.innerHTML = window.TUI.head('SVG → DXF', '贝塞尔与圆弧采样为折线，输出 LWPOLYLINE / LINE / CIRCLE。') +
      '<div class="plabel">曲线采样精度</div>' + window.TUI.range('vSamp', 4, 64, 16, 1) +
      window.TUI.chk('vFlip', '上下翻转 Y 轴', true) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="vRun">转换</button><button class="btn-ghost btn-sm" id="vDown" disabled>下载 DXF</button></div>' +
      '<div class="resultbox" id="vRes"><div class="row"><span>状态</span><b>等待 SVG</b></div></div>' +
      '<div class="warnbox hide" id="vWarn"></div>';
    const hs = s => $h(host, s);
    let svgText = null, dxfText = null;
    hs('#vPick').addEventListener('click', e => { e.stopPropagation(); hs('#vFile').click(); });
    wireDrop(host, '#vDrop', '#vFile', async files => { svgText = await window.TUI.readText(files[0]); run(files[0].name); });
    hs('#vGo').addEventListener('click', () => { const t = hs('#vPaste').value; if (t.trim()) { svgText = t; run('pasted.svg'); } else toast('先粘贴 SVG 源码'); });
    hs('#vRun').addEventListener('click', () => svgText && run('svg'));
    hs('#vDown').addEventListener('click', () => { if (dxfText) dl(new Blob([dxfText], { type: 'application/dxf' }), 'svg.dxf'); });
    function run(name) {
      try {
        const out = svgToDxfText(svgText, Math.round(parseFloat(hs('#vSamp').value) || 16));
        dxfText = out.dxf;
        hs('#vDown').disabled = false;
        hs('#vDrop').classList.add('hide'); hs('#vWrap').classList.remove('hide');
        const prev = hs('#vPrev');
        prev.innerHTML = '';
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        img.style.maxWidth = '92%'; img.style.maxHeight = '92%';
        prev.appendChild(img);
        const parsed = parseDXF(dxfText);
        const b = parsed.bounds;
        hs('#vRes').innerHTML = [
          ['图元数', fmtN(out.count)],
          ['DXF 图元', fmtN(parsed.entities.length)],
          ['范围', (b.maxX - b.minX).toFixed(1) + ' × ' + (b.maxY - b.minY).toFixed(1)],
          ['DXF 体积', window.fmtSize(new Blob([dxfText]).size)]
        ].map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
        const w = hs('#vWarn');
        if (out.unsupportedTransforms.length) { w.classList.remove('hide'); w.textContent = '注意：检测到 ' + out.unsupportedTransforms.length + ' 个 transform 属性未应用（简化实现只读取基础坐标）。'; }
        else w.classList.add('hide');
      } catch (e) { console.error(e); toast(e.message || 'SVG 转换失败'); }
    }
  }

  async function dxfToSvgTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.innerHTML =
      '<div class="drop" id="wDrop" style="flex:1"><div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>拖入 DXF → SVG</h3><p>LINE / CIRCLE / ARC / LWPOLYLINE / TEXT，viewBox 自动适配</p>' +
      '<button class="btn-lime" id="wPick">选择 DXF 文件 <span>→</span></button>' +
      '<div class="fmts"><b>DXF</b> → <b>SVG</b> · 本地转换</div>' +
      '<input type="file" id="wFile" accept=".dxf" hidden></div>' +
      '<div id="wWrap" class="hide" style="flex:1;display:flex;flex-direction:column;gap:10px">' +
      '<div id="wPrev" style="flex:1;min-height:380px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#0b0b0b;display:flex;align-items:center;justify-content:center"></div></div>';
    pane.innerHTML = window.TUI.head('DXF → SVG', '输出带 viewBox 的矢量 SVG。') +
      '<div class="plabel">线宽</div>' + window.TUI.range('wLw', 0, 40, 4, 1) +
      window.TUI.chk('wMono', '单色（lime）', false) +
      '<div class="plabel">背景</div><select id="wBg"><option value="#0b0b0b">深色</option><option value="#ffffff">白色</option><option value="none">透明</option></select>' +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap"><button class="btn-lime btn-sm" id="wRun">转换</button><button class="btn-ghost btn-sm" id="wDown" disabled>下载 SVG</button></div>' +
      '<div class="resultbox" id="wRes"><div class="row"><span>状态</span><b>等待 DXF</b></div></div>';
    const hs = s => $h(host, s);
    let src = null, svg = null;
    hs('#wPick').addEventListener('click', e => { e.stopPropagation(); hs('#wFile').click(); });
    wireDrop(host, '#wDrop', '#wFile', async files => { src = await window.TUI.readText(files[0]); run(files[0].name); });
    hs('#wRun').addEventListener('click', () => src && run('dxf'));
    hs('#wDown').addEventListener('click', () => { if (svg) dl(new Blob([svg], { type: 'image/svg+xml' }), 'drawing.svg'); });
    function run() {
      try {
        const lw = parseFloat(hs('#wLw').value);
        const out = dxfToSvgText(src, {
          mono: hs('#wMono').classList.contains('on'), monoColor: '#d7f452',
          bg: hs('#wBg').value,
          strokeWidth: lw ? undefined : 0.5
        });
        svg = out.svg;
        hs('#wDown').disabled = false;
        hs('#wDrop').classList.add('hide'); hs('#wWrap').classList.remove('hide');
        const prev = hs('#wPrev');
        prev.innerHTML = '';
        const img = new Image();
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        img.style.maxWidth = '94%'; img.style.maxHeight = '94%';
        prev.appendChild(img);
        const keys = Object.keys(out.stats);
        hs('#wRes').innerHTML = keys.slice(0, 8).map(k => '<div class="row"><span>' + esc(k) + '</span><b>' + esc(String(out.stats[k])) + '</b></div>').join('');
      } catch (e) { console.error(e); toast(e.message || 'DXF 转换失败'); }
    }
  }

  /* ======================================================================
     16. 3D 照片（视差仿 3D）
     ====================================================================== */
  async function photo3DTool(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '560px';
    stage.innerHTML =
      '<div class="drop" id="pDrop" style="flex:1"><div class="ic">' + window.icon('image', 30) + '</div>' +
      '<h3>拖入一张图片做视差 3D</h3><p>鼠标 / 触摸 / 陀螺仪控制视角倾斜，可导出 PNG</p>' +
      '<button class="btn-lime" id="pPick">选择图片 <span>→</span></button>' +
      '<div class="fmts"><b>PNG · JPG · WebP</b> · 本地处理</div>' +
      '<input type="file" id="pFile" accept="image/*" hidden></div>' +
      '<div id="pWrap" class="hide" style="flex-direction:column;gap:10px;flex:1">' +
      '<div id="pHolder" style="flex:1;min-height:420px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010;display:flex;align-items:center;justify-content:center;cursor:crosshair">' +
      '<canvas id="pCanvas" width="900" height="600" style="max-width:100%;max-height:100%"></canvas></div>' +
      '<div class="filebar"><b id="pName"></b></div></div>';
    pane.innerHTML = window.TUI.head('3D 照片（视差仿 3D）', '把图片按明暗分成前中后三层，随视角位移形成立体视差。') +
      '<div class="warnbox">这是<b>视差仿 3D</b>，不是真实深度重建。分层来自亮度阈值，没有 AI 深度估计，因此遮挡关系是近似的。</div>' +
      '<div class="plabel">视差强度</div>' + window.TUI.range('pDepth', 0, 60, 22, 1) +
      '<div class="plabel">层数</div><select id="pLayers"><option value="3">3 层</option><option value="2">2 层</option><option value="4">4 层</option></select>' +
      window.TUI.chk('pAuto', '自动缓慢摆动', true) +
      '<div class="shapes" style="margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn-lime btn-sm" id="pPng">导出 PNG</button>' +
      '<button class="btn-ghost btn-sm" id="pGyro">启用陀螺仪</button></div>' +
      '<div class="resultbox" id="pRes"><div class="row"><span>状态</span><b>等待图片</b></div></div>';
    const hs = s => $h(host, s);
    let img = null, layers = [], tx = 0, ty = 0, autoT = 0, raf = 0, running = false;
    registerCleanup(() => { running = false; cancelAnimationFrame(raf); });
    hs('#pPick').addEventListener('click', e => { e.stopPropagation(); hs('#pFile').click(); });
    wireDrop(host, '#pDrop', '#pFile', files => load(files[0]));
    const holder = hs('#pHolder');
    holder.addEventListener('pointermove', e => {
      const r = holder.getBoundingClientRect();
      tx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
      ty = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
      if (!hs('#pAuto').classList.contains('on')) draw();
    });
    holder.addEventListener('pointerleave', () => { if (!hs('#pAuto').classList.contains('on')) { tx = 0; ty = 0; draw(); } });
    hs('#pDepth').addEventListener('input', () => { hs('#pDepthV').textContent = hs('#pDepth').value; if (!running) draw(); });
    hs('#pLayers').addEventListener('change', buildLayers);
    hs('#pAuto').addEventListener('click', () => setTimeout(() => { const on = hs('#pAuto').classList.contains('on'); on ? start() : (running = false); }, 0));
    hs('#pPng').addEventListener('click', () => { hs('#pCanvas').toBlob(b => dl(b, '3d-photo.png'), 'image/png'); });
    hs('#pGyro').addEventListener('click', async () => {
      try {
        if (typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) {
          const p = await DeviceOrientationEvent.requestPermission();
          if (p !== 'granted') { toast('陀螺仪权限被拒绝'); return; }
        }
        window.addEventListener('deviceorientation', e => {
          if (e.gamma == null) return;
          tx = clamp(e.gamma / 30, -1, 1);
          ty = clamp((e.beta - 45) / 30, -1, 1);
          if (!running) draw();
        });
        toast('陀螺仪已启用');
      } catch (e) { toast('该设备不支持陀螺仪'); }
    });
    function buildLayers() {
      if (!img) return;
      const n = parseInt(hs('#pLayers').value, 10) || 3;
      const maxDim = 700;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const sc = Math.min(1, maxDim / Math.max(iw, ih));
      const w = Math.max(2, Math.round(iw * sc)), h = Math.max(2, Math.round(ih * sc));
      const base = document.createElement('canvas'); base.width = w; base.height = h;
      const bx = base.getContext('2d'); bx.drawImage(img, 0, 0, w, h);
      const data = bx.getImageData(0, 0, w, h).data;
      layers = [];
      for (let k = 0; k < n; k++) {
        const lo = k / n, hi = (k + 1) / n;
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const cc = c.getContext('2d');
        const out = cc.createImageData(w, h);
        for (let i = 0; i < data.length; i += 4) {
          const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
          // 越暗越靠前（k 越大越近）
          const d = 1 - lum;
          let a = 0;
          if (d >= lo && d < hi) a = 255;
          else if (d === hi) a = 255;
          // 平滑过渡，避免硬边
          const center = (lo + hi) / 2, half = (hi - lo) / 2;
          const t = 1 - Math.min(1, Math.abs(d - center) / (half || 1));
          a = Math.round(clamp(t, 0, 1) * 255);
          out.data[i] = data[i]; out.data[i + 1] = data[i + 1]; out.data[i + 2] = data[i + 2];
          out.data[i + 3] = a;
        }
        cc.putImageData(out, 0, 0);
        layers.push({ canvas: c, depth: (k + 1) / n });
      }
      hs('#pCanvas').width = w * 2; hs('#pCanvas').height = h * 2;
      draw();
      hs('#pRes').innerHTML = [['图层数', String(n)], ['分辨率', w + '×' + h], ['状态', '视差已就绪']]
        .map(r => '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('');
    }
    function draw() {
      const cv = hs('#pCanvas');
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#0e0e0e'; ctx.fillRect(0, 0, cv.width, cv.height);
      if (!layers.length) return;
      const W = layers[0].canvas.width, H = layers[0].canvas.height;
      const sc = Math.min(cv.width / W, cv.height / H) * 1.12;
      const dw = W * sc, dh = H * sc;
      const amp = parseFloat(hs('#pDepth').value) || 0;
      const cx = (cv.width - dw) / 2, cy = (cv.height - dh) / 2;
      layers.forEach(L => {
        const off = (L.depth - 0.5) * amp * 2;
        const dx = cx - tx * off * 0.6 - L.depth * (dw - W * sc) / 2;
        const dy = cy - ty * off * 0.6 - L.depth * (dh - H * sc) / 2;
        const s = 1 + L.depth * 0.03;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(L.canvas, cx + (dw - dw * s) / 2 - tx * off, cy + (dh - dh * s) / 2 - ty * off, dw * s, dh * s);
        ctx.restore();
      });
    }
    function start() {
      if (running) return;
      running = true;
      const step = () => {
        if (!running) return;
        raf = requestAnimationFrame(step);
        autoT += 0.012;
        tx = Math.sin(autoT) * 0.8;
        ty = Math.cos(autoT * 0.7) * 0.5;
        draw();
      };
      step();
    }
    async function load(file) {
      if (!file) return;
      try {
        img = await loadImageFile(file);
        hs('#pDrop').classList.add('hide'); hs('#pWrap').classList.remove('hide');
        hs('#pName').textContent = file.name + ' · ' + img.naturalWidth + '×' + img.naturalHeight;
        buildLayers();
        if (hs('#pAuto').classList.contains('on')) start();
      } catch (e) { console.error(e); toast(e.message); }
    }
  }

  /* ======================================================================
     17. STEP 查看器（尽力而为 + 诚实降级）
     ====================================================================== */
  async function stepViewer(host) {
    const { stage, pane } = window.TUI.shell(host, true);
    stage.style.minHeight = '540px';
    stage.innerHTML =
      '<div class="drop" id="qDrop" style="flex:1"><div class="ic">' + window.icon('cube', 30) + '</div>' +
      '<h3>拖入 STEP（.step / .stp）</h3><p>尽力解析 CARTESIAN_POINT / POLY_LOOP / ADVANCED_FACE / CLOSED_SHELL</p>' +
      '<button class="btn-lime" id="qPick">选择文件 <span>→</span></button>' +
      '<div class="fmts"><b>ISO-10303-21</b> · 浏览器端简化解析（无 CAD 内核）</div>' +
      '<input type="file" id="qFile" accept=".step,.stp" hidden></div>' +
      '<div id="qWrap" class="hide" style="position:relative;flex:1;min-height:460px;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;background:#101010">' +
      '<div id="qCanvasHost" style="position:absolute;inset:0"></div>' +
      '<div class="filebar" style="position:absolute;left:10px;right:10px;bottom:8px;background:rgba(0,0,0,.55);border-radius:8px;padding:6px 10px;font-size:12.5px"><b id="qName"></b> <span id="qMeta"></span></div></div>';
    pane.innerHTML = window.TUI.head('STEP 查看器', '浏览器端简化解析：能解就渲染，解不出来就如实告知。') +
      '<div class="shapes" style="flex-wrap:wrap"><button class="btn-ghost btn-sm" id="qStl" disabled>导出 STL</button><button class="btn-ghost btn-sm" id="qObj" disabled>导出 OBJ</button></div>' +
      '<div class="statgrid" id="qStats"></div>' +
      '<div class="warnbox hide" id="qWarn"></div>';
    const hs = s => $h(host, s);
    let sc = null, mesh = null;
    const cleanup = () => { if (sc) { try { sc.dispose(); } catch (e) { } sc = null; } };
    registerCleanup(cleanup);
    hs('#qPick').addEventListener('click', e => { e.stopPropagation(); hs('#qFile').click(); });
    wireDrop(host, '#qDrop', '#qFile', files => run(files[0]));
    hs('#qStl').addEventListener('click', () => { if (mesh) dl(new Blob([meshToSTLBinary(mesh, 'step')], { type: 'model/stl' }), 'step.stl'); });
    hs('#qObj').addEventListener('click', () => { if (mesh) dl(new Blob([meshToOBJ(mesh, 'step')], { type: 'text/plain' }), 'step.obj'); });
    async function run(file) {
      if (!file) return;
      try {
        const text = await window.TUI.readText(file);
        const parsed = parseSTEP(text);
        if (!parsed.isStep && parsed.stats.entities < 5) throw new Error('这不是可识别的 STEP 文件');
        hs('#qDrop').classList.add('hide'); hs('#qWrap').classList.remove('hide');
        hs('#qName').textContent = file.name;
        hs('#qMeta').textContent = parsed.stats.entities + ' 实体 · ' + parsed.stats.points + ' 点';
        const rows = {
          '实体总数': fmtN(parsed.stats.entities),
          'CARTESIAN_POINT': fmtN(parsed.stats.points),
          '可解三角面': fmtN(parsed.stats.tris),
          'ADVANCED_FACE': fmtN(parsed.faceCount),
          '边界': fmtN(parsed.boundCount),
          '引用边': fmtN(parsed.stats.edges)
        };
        hs('#qStats').innerHTML = Object.keys(rows).map(k => '<div class="stat"><b>' + esc(rows[k]) + '</b><span>' + esc(k) + '</span></div>').join('');
        if (sc) { try { sc.dispose(); } catch (e) { } sc = null; }
        hs('#qCanvasHost').innerHTML = '';
        mesh = meshFromSTEP(parsed);
        if (mesh.tris.length) {
          sc = await makeScene3D(hs('#qCanvasHost'), { bg: 'dark', showGrid: true });
          registerCleanup(() => { if (sc) sc.dispose(); });
          const geo = meshToThreeGeometry(sc.THREE, mesh);
          sc.add(new sc.THREE.Mesh(geo, new sc.THREE.MeshStandardMaterial({ color: 0xc2cbd6, metalness: 0.15, roughness: 0.62, side: sc.THREE.DoubleSide })));
          sc.fit(sc.root);
          hs('#qWarn').classList.add('hide');
          hs('#qStl').disabled = false; hs('#qObj').disabled = false;
        } else {
          // 诚实降级：显示可解析的点 / 边
          mesh = null;
          sc = await makeScene3D(hs('#qCanvasHost'), { bg: 'dark', showGrid: true });
          registerCleanup(() => { if (sc) sc.dispose(); });
          const pts = parsed.allPts;
          if (pts.length) {
            const arr = new Float32Array(pts.length * 3);
            pts.forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2] || 0; });
            const g = new sc.THREE.BufferGeometry();
            g.setAttribute('position', new sc.THREE.BufferAttribute(arr, 3));
            const pm = new sc.THREE.PointsMaterial({ color: 0xd7f452, size: Math.max(0.05, 2) });
            sc.add(new sc.THREE.Points(g, pm));
          }
          parsed.edges.forEach(list => {
            if (list.length < 2) return;
            const arr = new Float32Array(list.length * 3);
            list.forEach((p, i) => { arr[i * 3] = p[0]; arr[i * 3 + 1] = p[1]; arr[i * 3 + 2] = p[2] || 0; });
            const g = new sc.THREE.BufferGeometry();
            g.setAttribute('position', new sc.THREE.BufferAttribute(arr, 3));
            sc.add(new sc.THREE.Line(g, new sc.THREE.LineBasicMaterial({ color: 0x5b8def })));
          });
          sc.fit(sc.root, 1.9);
          const names = (parsed.unsupported || []).slice(0, 5).map(u => u.type + '×' + u.n).join('、') || '未知实体';
          hs('#qWarn').classList.remove('hide');
          hs('#qWarn').textContent = '该 STEP 使用了 ' + names + ' 实体，浏览器端简化解析器尚不支持（需要真正的 CAD 内核如 OpenCASCADE）。已为你显示可解析的 ' + parsed.stats.points + ' 个点 / ' + parsed.stats.edges + ' 条边，未生成三角面。';
          hs('#qStl').disabled = true; hs('#qObj').disabled = true;
        }
      } catch (err) { console.error(err); toast(err.message || 'STEP 解析失败'); }
    }
  }

  /* ======================================================================
     18. 挂载分发
     ====================================================================== */
  const T = {};
  T['3d-model-viewer'] = (h, c, s) => viewer(h, s, c);
  T['stl-viewer'] = (h, c, s) => viewer(h, s, c);
  T['obj-viewer'] = (h, c, s) => viewer(h, s, c);
  T['glb-viewer'] = (h, c, s) => viewer(h, s, c);
  T['gltf-viewer'] = (h, c, s) => viewer(h, s, c);
  T['dxf-viewer'] = h => dxfViewer(h);
  T['gerber-viewer'] = (h, c, s) => gerberViewer(h, s);
  T['pcb-viewer'] = (h, c, s) => gerberViewer(h, s);
  T['gerber-to-svg'] = h => gerberToSvgTool(h);
  T['excellon-drill-viewer'] = h => excellonViewer(h);
  T['molecule-viewer'] = (h, c, s) => moleculeViewer(h, s);
  T['pdb-viewer'] = (h, c, s) => moleculeViewer(h, s);
  T['smiles-to-structure'] = h => smilesTool(h);
  T['image-to-stl'] = (h, c, s) => imageMeshTool(h, s);
  T['png-to-stl'] = (h, c, s) => imageMeshTool(h, 'image-to-stl');
  T['jpg-to-stl'] = (h, c, s) => imageMeshTool(h, 'image-to-stl');
  T['lithophane-maker'] = (h, c, s) => imageMeshTool(h, s);
  T['image-to-dxf'] = (h, c, s) => imageToDxfTool(h, s);
  T['png-to-dxf'] = (h, c, s) => imageToDxfTool(h, s);
  T['jpg-to-dxf'] = (h, c, s) => imageToDxfTool(h, s);
  T['text-to-dxf'] = h => textToDxfTool(h);
  T['svg-to-dxf'] = h => svgToDxfTool(h);
  T['dxf-to-svg'] = h => dxfToSvgTool(h);
  T['3d-photo-maker'] = h => photo3DTool(h);
  T['step-viewer'] = h => stepViewer(h);
  ['stl-to-obj', 'obj-to-stl', 'glb-to-obj', 'glb-to-stl', 'obj-to-glb', 'stl-to-3mf', '3mf-to-stl',
    'fbx-to-stl', 'fbx-to-glb', 'step-to-stl', 'step-to-obj'].forEach(k => { T[k] = (h, c, s) => converter(h, s, c); });

  E.mount = function (host, cfg, slug) {
    let h = host;
    try {
      if (typeof host === 'string') h = document.querySelector(host);
      if (!h) return;
      if (!window.TUI) { h.innerHTML = '<div class="soon">界面构件库未加载（TUI 缺失）。</div>'; return; }
      const fn = T[slug];
      if (!fn) { window.TUI.soon(h, '该 3D / CAD 工具（' + slug + '）尚未接入本引擎，敬请期待下一批。'); return; }
      const r = fn(h, cfg || {}, slug);
      if (r && typeof r.catch === 'function') {
        r.catch(e => {
          console.error(e);
          window.TUI.soon(h, (e && e.message) ? e.message : '该工具初始化失败。');
        });
      }
    } catch (e) {
      console.error(e);
      try { window.TUI.soon(h, (e && e.message) ? e.message : '该工具初始化失败。'); } catch (e2) { }
    }
  };

  /* ======================================================================
     19. 纯函数导出（供 Node 端单测直接调用）
     ====================================================================== */
  E.pure = {
    crc32: crc32, zipWrite: zipWrite, unzip: unzip, concatU8: concatU8,
    parseSTL: parseSTL, parseSTLBinary: parseSTLBinary, parseSTLAscii: parseSTLAscii,
    meshToSTLBinary: meshToSTLBinary, meshToSTLAscii: meshToSTLAscii,
    computeVertexNormals: computeVertexNormals, triNormal: triNormal, meshStats: meshStats,
    meshToOBJ: meshToOBJ, meshFromOBJ: meshFromOBJ, parseOBJFull: parseOBJFull,
    parseGLB: parseGLB, meshFromGLB: meshFromGLB, meshToGLB: meshToGLB, buildGLB: buildGLB,
    meshTo3MF: meshTo3MF, meshFrom3MF: meshFrom3MF, meshFrom3MFModel: meshFrom3MFModel,
    parseGerber: parseGerber, gerberToSvgText: gerberToSvgText,
    parseExcellon: parseExcellon, parseDXF: parseDXF, dxfToSvgText: dxfToSvgText,
    aciToRgb: aciToRgb, parsePDB: parsePDB, parseSMILES: parseSMILES, smilesFormula: smilesFormula,
    layoutSMILES: layoutSMILES, findRings: findRings,
    sobel: sobel, traceContours: traceContours, dpSimplify: dpSimplify, dpSimplifyClosed: dpSimplifyClosed, loopsToDxf: loopsToDxf,
    buildHeightMesh: buildHeightMesh, buildLithophaneMesh: buildLithophaneMesh,
    parseSTEP: parseSTEP, meshFromSTEP: meshFromSTEP, parseFBX: parseFBX,
    svgPathToSubpaths: svgPathToSubpaths, extOf: extOf
  };

  window.TOOL_ENGINES.viewer3d = E;
})();
