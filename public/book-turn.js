// 将同一本书的真实纸面纹理绘到可弯曲的网格上；书脊固定，页角先起，纸页最后落下。
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (x) => x * x * (3 - 2 * x);

function linesFor(ctx, text, width, spacing) {
  const lines = []; let line = '', used = 0;
  for (const char of Array.from(text)) {
    const n = ctx.measureText(char).width + spacing;
    if (char === '\n' || (line && used + n > width)) { lines.push(line); line = ''; used = 0; }
    if (char !== '\n') { line += char; used += n; }
  }
  if (line) lines.push(line);
  return lines;
}
function inkLine(ctx, text, x, y, width, spacing, align) {
  const chars = Array.from(text), measured = chars.reduce((n, c) => n + ctx.measureText(c).width, 0) + Math.max(0, chars.length - 1) * spacing;
  let pen = x + (align === 'center' ? (width - measured) / 2 : 0);
  for (const c of chars) { ctx.fillText(c, pen, y); pen += ctx.measureText(c).width + spacing; }
}
function pageTexture(prop, image, w, h, side = '.book-copy') {
  const texture = document.createElement('canvas'); texture.width = w; texture.height = h;
  const ctx = texture.getContext('2d'); ctx.drawImage(image, 0, 0, w, h);
  const copy = prop.querySelector(side), sx = w / prop.clientWidth, sy = h / prop.clientHeight;
  for (const node of copy.children) {
    const style = getComputedStyle(node); if (style.display === 'none' || !node.textContent.trim()) continue;
    const x = (copy.offsetLeft + node.offsetLeft) * sx, y = (copy.offsetTop + node.offsetTop) * sy;
    const width = node.clientWidth * sx, size = parseFloat(style.fontSize) * sx;
    const leading = (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.7) * sy;
    const spacing = (parseFloat(style.letterSpacing) || 0) * sx;
    ctx.font = `${style.fontWeight} ${size}px ${style.fontFamily}`; ctx.fillStyle = style.color; ctx.textBaseline = 'middle';
    const lines = linesFor(ctx, node.innerText.trim(), width, spacing);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, node.clientHeight * sy + 2); ctx.clip();
    lines.forEach((line, i) => inkLine(ctx, line, x, y + leading * (i + .5), width, spacing, style.textAlign));
    ctx.restore();
  }
  return texture;
}
function triangle(ctx, texture, source, dest, shade) {
  const [s0,s1,s2] = source, [d0,d1,d2] = dest;
  const a = s1.x-s0.x, b = s1.y-s0.y, c = s2.x-s0.x, d = s2.y-s0.y, determinant = a*d-c*b;
  if (Math.abs(determinant) < .001) return;
  const ex = d1.x-d0.x, ey = d1.y-d0.y, fx = d2.x-d0.x, fy = d2.y-d0.y;
  const m0=(ex*d-fx*b)/determinant, m1=(ey*d-fy*b)/determinant;
  const m2=(fx*a-ex*c)/determinant, m3=(fy*a-ey*c)/determinant;
  const m4=d0.x-m0*s0.x-m2*s0.y, m5=d0.y-m1*s0.x-m3*s0.y;
  const center = { x:(d0.x+d1.x+d2.x)/3, y:(d0.y+d1.y+d2.y)/3 };
  const expanded = dest.map((p) => { const dx=p.x-center.x,dy=p.y-center.y,n=Math.hypot(dx,dy)||1; return {x:p.x+dx/n*.65,y:p.y+dy/n*.65}; });
  ctx.save(); ctx.beginPath(); expanded.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.clip();
  ctx.transform(m0,m1,m2,m3,m4,m5); ctx.drawImage(texture,0,0); ctx.restore();
  if (shade > .005) { ctx.save(); ctx.beginPath(); expanded.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fillStyle=`rgba(48,25,8,${shade})`; ctx.fill(); ctx.restore(); }
}
export async function turnBookPage(prop, { signal, duration = 1650, direction = 'next', onReveal } = {}) {
  const image = prop.querySelector('img');
  if (signal?.aborted || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  try { if (!image.complete) await image.decode(); } catch { return; }
  if (!image.naturalWidth || signal?.aborted) return;
  const w = image.naturalWidth, h = image.naturalHeight;
  const sign = direction === 'previous' ? -1 : 1;
  const oldRight = pageTexture(prop,image,w,h);
  const front = sign === 1 ? oldRight : pageTexture(prop,image,w,h,'.book-left-copy');
  let back = pageTexture(prop,image,w,h,sign === 1 ? '.book-left-copy' : '.book-copy');
  const canvas = document.createElement('canvas'); canvas.className = 'book-turn-canvas'; canvas.setAttribute('aria-hidden','true');
  const resolution = Math.min(devicePixelRatio || 1, 1.5) * prop.clientWidth / w;
  canvas.width = Math.round(w*resolution*1.24); canvas.height = Math.round(h*resolution*1.33);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  prop.append(canvas); prop.classList.add('book-turning'); prop.classList.toggle('book-turning-reveal',Boolean(onReveal));
  const columns = 32, rows = 8, width = w*.415, spine = w*.5, middle = h*.5, camera = w*2.8;
  function point(u,v,t) {
    // 上页角比下页角先卷起；曲率在半程最大，落纸时回到平面。
    const theta = Math.PI*smooth(t), lift = Math.sin(Math.PI*t);
    const k = 1.8*lift*(.72+.28*(1-v)), angle = theta-.5*k+.31*(.5-v)*lift;
    const x = Math.abs(k)>.0001 ? width*(Math.sin(angle+k*u)-Math.sin(angle))/k : width*u*Math.cos(angle);
    const z = Math.abs(k)>.0001 ? width*(Math.cos(angle)-Math.cos(angle+k*u))/k : width*u*Math.sin(angle);
    const top = h*(.075-.048*u), bottom = h*(.912-.057*u), baseY = top+(bottom-top)*v;
    const scale = camera/(camera-z);
    return {x:spine+sign*x*scale,y:middle+(baseY-middle-z*.29)*scale,z,phi:angle+k*u,u,v,baseY};
  }
  function source(p, backFace) { return {x:spine+(backFace?-sign:sign)*width*p.u,y:p.baseY}; }
  function draw(t) {
    ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height); ctx.scale(resolution,resolution); ctx.translate(w*.12,h*.25);
    const lift = Math.sin(Math.PI*t), theta = Math.PI*smooth(t);
    if(sign===-1)ctx.drawImage(oldRight,w*.5,0,w*.5,h,w*.5,0,w*.5,h);
    // 投到纸面上的移动阴影，比浮起的纸页更贴近书脊。
    if (lift>.01) {
      ctx.save(); ctx.filter=`blur(${8+lift*12}px)`; ctx.fillStyle=`rgba(42,20,5,${lift*.24})`;
      ctx.beginPath(); ctx.ellipse(spine+sign*Math.cos(theta)*width*.34,h*.52,width*(.06+.31*Math.abs(Math.cos(theta))),h*.39,0,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
    const mesh=Array.from({length:rows+1},(_,y)=>Array.from({length:columns+1},(_,x)=>point(x/columns,y/rows,t)));
    const faces=[];
    for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
      const a=mesh[y][x],b=mesh[y][x+1],c=mesh[y+1][x+1],d=mesh[y+1][x];
      for(const points of [[a,b,c],[a,c,d]])faces.push({points,z:points.reduce((n,p)=>n+p.z,0)/3});
    }
    faces.sort((a,b)=>a.z-b.z);
    for(const face of faces){
      const p=face.points,area=(p[1].x-p[0].x)*(p[2].y-p[0].y)-(p[1].y-p[0].y)*(p[2].x-p[0].x);
      if(Math.abs(area)<.015)continue;
      const backFace=area*sign<0,phi=p.reduce((n,p)=>n+p.phi,0)/3;
      const shade=(1-Math.abs(Math.cos(phi)))*.22+lift*.035;
      triangle(ctx,backFace?back:front,p.map(v=>source(v,backFace)),p,shade);
    }
    // 页口的薄亮边随卷曲消失，保留纸张厚度而不画生硬的边框。
    if(lift>.02){ctx.save();ctx.strokeStyle=`rgba(255,234,188,${lift*.55})`;ctx.lineWidth=1.3;ctx.beginPath();for(let i=0;i<=rows;i++){const p=mesh[i][columns];i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)}ctx.stroke();ctx.restore()}
    canvas.dataset.progress=t.toFixed(3);
  }
  return new Promise((resolve,reject)=>{
    let frame=0,settle=0,ended=false,began=0;
    const cleanup=()=>{cancelAnimationFrame(frame);clearTimeout(settle);canvas.remove();prop.classList.remove('book-turning','book-turning-reveal');signal?.removeEventListener('abort',finish)};
    const finish=()=>{if(ended)return;ended=true;cleanup();resolve()};
    signal?.addEventListener('abort',finish,{once:true});
    const tick=(now)=>{if(signal?.aborted)return finish();const t=clamp((now-began)/duration);draw(t);if(t<1)frame=requestAnimationFrame(tick);else settle=setTimeout(finish,170)};
    draw(0);
    Promise.resolve().then(()=>onReveal?.()).then(()=>{
      if(signal?.aborted)return finish();
      back=pageTexture(prop,image,w,h,sign===1?'.book-left-copy':'.book-copy');
      began=performance.now();frame=requestAnimationFrame(tick);
    }).catch(e=>{if(ended)return;ended=true;cleanup();reject(e)});
  });
}
