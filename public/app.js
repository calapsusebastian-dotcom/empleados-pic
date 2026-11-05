import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  setPersistence, browserSessionPersistence, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit,
  getDocs, onSnapshot, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig, ADMIN_EMAILS, DOMINIO_USUARIOS, REGION_FUNCIONES } from "./config.js";

const MOTIVOS = ["Fin de jornada","Almuerzo","Diligencia personal","Cita médica","Comisión de trabajo","Calamidad doméstica","Otro"];
const SIN_DETALLE = new Set(["Fin de jornada","Almuerzo"]);
const $ = s => document.querySelector(s);
const st = {
  rol:null, user:null, sel:null, ultima:null, tipo:"ingreso", motivo:null, strokes:[], saving:false,
  empleados:[], empLoaded:false, ajustes:{},
  marcas:[], marcasLoaded:false, marcasSlow:false, marcasErr:null, modalId:null,
  unsubs:[], unsubMarcas:null
};

/* ---------- utilidades ---------- */
const z = n => String(n).padStart(2,"0");
const ymd = d => d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());
const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y,m-1,d); };
const fmtHora = ts => new Date(ts).toLocaleTimeString("es-CO",{hour:"numeric",minute:"2-digit",hour12:true});
const fmtFecha = ts => new Date(ts).toLocaleDateString("es-CO",{weekday:"short",day:"numeric",month:"short"});
const fmtFechaLarga = ts => new Date(ts).toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const norm = s => (s||"").toString().normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const normUser = s => norm(s).replace(/[^a-z0-9._-]/g,"");
function dur(ms){ const m = Math.max(0,Math.round(ms/60000)); const h = Math.floor(m/60); return h ? `${h} h ${z(m%60)} min` : `${m} min`; }
function mk(tag, cls, text){ const e = document.createElement(tag); if(cls) e.className = cls; if(text!=null) e.textContent = text; return e; }
function show(el, on){ el.hidden = !on; }
function banner(msg){ $("#bannerText").textContent = msg; show($("#banner"), !!msg); }
const esAdminEmail = email => !!email && ADMIN_EMAILS.map(x=>x.toLowerCase()).includes(email.toLowerCase());
/** Convierte un documento de marca a objeto plano con ts en milisegundos */
function marcaDe(snap){
  const d = snap.data({serverTimestamps:"estimate"});
  const ts = d.ts && d.ts.toMillis ? d.ts.toMillis() : Date.now();
  return {id:snap.id, ...d, ts};
}
function errText(e){
  const c = (e && e.code) || "";
  if(c==="permission-denied") return "No tiene permiso para esta acción. Si es empleado, verifique que su usuario esté activo.";
  if(c==="unavailable") return "Sin conexión con el servidor. Revise internet e intente de nuevo.";
  if(c==="resource-exhausted") return "Se alcanzó el límite de uso de Firebase por hoy.";
  if(c==="failed-precondition") return "Falta crear un índice en Firestore. Despliegue firestore.indexes.json (vea la guía).";
  return "Ocurrió un error: " + (e && e.message ? e.message : "desconocido");
}

/* ---------- Firebase ---------- */
const configLista = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PEGUE");
let app, auth, db, fns;
if(configLista){
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  try{ fns = getFunctions(app, REGION_FUNCIONES); }catch{}
  setPersistence(auth, browserSessionPersistence).catch(()=>{});
}else{
  banner("Falta configurar Firebase: edite public/config.js con los datos de su proyecto y vuelva a desplegar.");
}

/* ---------- reloj ---------- */
function tick(){
  const d = new Date();
  let h = d.getHours(); const ampm = h<12 ? "a. m." : "p. m."; h = h%12 || 12;
  $("#clock").textContent = z(h)+":"+z(d.getMinutes());
  $("#clockSec").textContent = z(d.getSeconds());
  $("#clockAmpm").textContent = ampm;
  $("#date").textContent = fmtFechaLarga(d);
  $("#secBar").style.transform = `scaleX(${d.getSeconds()/59})`;
  if(st.sel && !st.saving) $("#confirmar").textContent = (st.tipo==="ingreso"?"Registrar ingreso":"Registrar salida")+" · "+fmtHora(d);
}
setInterval(tick,1000); tick();

/* ---------- vistas ---------- */
function vista(v){ // "login" | "empleado" | "admin"
  show($("#heroKiosk"), v!=="admin"); show($("#heroAdmin"), v==="admin");
  show($("#vKiosk"), v!=="admin"); show($("#vAdmin"), v==="admin");
  show($("#userBox"), v!=="login");
  if(v==="login"){ show($("#loginForm"),true); show($("#seleccion"),false); show($("#pasoTipo"),false); show($("#stepOk"),false); show($("#stepForm"),true); }
  requestAnimationFrame(padSize);
}

/* ---------- ajustes (nombre de la empresa, lectura pública) ---------- */
if(db){
  onSnapshot(doc(db,"ajustes","general"), s=>{
    st.ajustes = s.exists() ? s.data() : {};
    $("#empresaNombre").textContent = st.ajustes.empresa || "Control de personal";
    if(st.rol==="admin" && document.activeElement!==$("#aEmpresa")) $("#aEmpresa").value = st.ajustes.empresa || "";
  }, ()=>{});
}

/* ---------- inicio de sesión ---------- */
function loginMsg(m){ const e = $("#loginMsg"); e.textContent = m; show(e, !!m); }
$("#loginForm").addEventListener("submit", async ev=>{
  ev.preventDefault(); loginMsg("");
  if(!auth) return loginMsg("Firebase no está configurado todavía.");
  const raw = $("#lUsuario").value.trim(), clave = $("#lClave").value;
  if(!raw || !clave) return loginMsg("Escriba su usuario y su contraseña.");
  const email = raw.includes("@") ? raw.toLowerCase() : `${normUser(raw)}@${DOMINIO_USUARIOS}`;
  const btn = $("#loginBtn"); btn.disabled = true; btn.textContent = "Entrando…";
  try{
    await signInWithEmailAndPassword(auth, email, clave);
    $("#lClave").value = ""; $("#lUsuario").value = "";
  }catch(e){
    const c = e.code || "";
    if(c==="auth/too-many-requests") loginMsg("Demasiados intentos fallidos. Espere unos minutos e intente de nuevo.");
    else if(c==="auth/network-request-failed") loginMsg("Sin conexión a internet.");
    else if(c==="auth/user-disabled") loginMsg("Su usuario está deshabilitado. Hable con el administrador.");
    else loginMsg("Usuario o contraseña incorrectos.");
  }finally{ btn.disabled = false; btn.textContent = "Entrar"; }
});

async function salir(){ clearInterval(cuenta); clearTimeout(inactividad); if(auth) await signOut(auth); }
$("#logout").onclick = salir;
$("#cambiar").onclick = salir;
$("#nuevo").onclick = salir;

function limpiarSuscripciones(){
  st.unsubs.forEach(u=>{ try{u();}catch{} }); st.unsubs = [];
  if(st.unsubMarcas){ st.unsubMarcas(); st.unsubMarcas = null; }
  st.marcas = []; st.empleados = []; st.empLoaded = false;
}

if(auth) onAuthStateChanged(auth, async user=>{
  limpiarSuscripciones(); cerrarModal();
  st.user = user; st.rol = null; st.sel = null;
  if(!user){ $("#userName").textContent = ""; vista("login"); return; }
  if(esAdminEmail(user.email)){
    st.rol = "admin"; $("#userName").textContent = user.email;
    vista("admin"); abrirPanel(); return;
  }
  // empleado
  try{
    const s = await getDoc(doc(db,"empleados",user.uid));
    if(!s.exists()){ await signOut(auth); return loginMsg("Este usuario no está registrado como empleado. Hable con el administrador."); }
    const e = {id:s.id, ...s.data()};
    if(e.activo === false){ await signOut(auth); return loginMsg("Su usuario está desactivado. Hable con el administrador."); }
    st.rol = "empleado"; $("#userName").textContent = e.nombre;
    vista("empleado"); seleccionar(e);
  }catch(err){ await signOut(auth); loginMsg(errText(err)); }
});

/* ---------- empleado: sesión ---------- */
let inactividad = null;
function vigilarInactividad(){
  clearTimeout(inactividad);
  if(st.rol==="empleado") inactividad = setTimeout(()=>{ if(!st.saving) salir(); }, 120000);
}
["pointerdown","keydown"].forEach(ev => document.addEventListener(ev, vigilarInactividad));

async function seleccionar(e){
  st.sel = e; st.ultima = null; st.motivo = null; st.strokes = []; $("#detalle").value = "";
  show($("#loginForm"),false); show($("#stepOk"),false); show($("#stepForm"),true);
  $("#selNombre").textContent = e.nombre; $("#selDoc").textContent = "C.C. "+e.cedula; $("#selCargo").textContent = e.cargo || "Sin cargo";
  $("#selUltima").textContent = "";
  $("#selAvatar").textContent = e.nombre.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  const est = $("#selEstado"); est.className = "status"; est.textContent = "Consultando…";
  $("#histList").replaceChildren(mk("span","muted","Cargando…")); $("#historial").open = false; $("#miClave").open = false;
  show($("#seleccion"),true); show($("#pasoTipo"),true); show($("#error"),false);
  setTipo("ingreso"); requestAnimationFrame(padSize); vigilarInactividad();
  let hist = [];
  try{
    const q = query(collection(db,"marcas"), where("empleadoId","==",e.id), orderBy("ts","desc"), limit(6));
    hist = (await getDocs(q)).docs.map(marcaDe);
  }catch(err){
    if(st.sel !== e) return;
    $("#histList").replaceChildren(mk("span","muted",errText(err)));
  }
  if(st.sel !== e) return;
  st.ultima = hist[0] || null;
  const u = st.ultima;
  const dentro = u && u.tipo==="ingreso" && (Date.now()-u.ts) < 20*3600e3;
  est.className = "status " + (dentro ? "in" : "out");
  est.textContent = dentro ? "Dentro" : "Fuera";
  $("#selUltima").textContent = u ? `${u.tipo==="ingreso"?"Ingresó":"Salió"} ${fmtFecha(u.ts)} · ${fmtHora(u.ts)}` : "Aún no tiene registros";
  const hl = $("#histList"); hl.replaceChildren();
  if(!hist.length) hl.append(mk("span","muted","Sin registros todavía."));
  hist.forEach(m=>{
    const row = mk("div"); row.style.cssText = "display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14px";
    row.append(mk("span","pill "+(m.tipo==="ingreso"?"in":"out"), m.tipo==="ingreso"?"Ingreso":"Salida"), mk("span","num",`${fmtFecha(m.ts)} · ${fmtHora(m.ts)}`));
    if(m.tipo==="salida" && m.motivo) row.append(mk("span","muted",m.motivo));
    hl.append(row);
  });
  setTipo(dentro ? "salida" : "ingreso");
}

function setTipo(t){
  st.tipo = t;
  $("#tIngreso").classList.toggle("on", t==="ingreso"); $("#tSalida").classList.toggle("on", t==="salida");
  $("#tIngreso").setAttribute("aria-pressed", t==="ingreso"); $("#tSalida").setAttribute("aria-pressed", t==="salida");
  show($("#bloqueSalida"), t==="salida");
  $("#numFirma").textContent = t==="salida" ? "04" : "03";
  const u = st.ultima, av = $("#aviso");
  let msg = "";
  if(t==="ingreso" && u && u.tipo==="ingreso") msg = `Ya tiene un ingreso abierto desde el ${fmtFecha(u.ts)} a las ${fmtHora(u.ts)}. Si olvidó marcar la salida, informe al administrador.`;
  if(t==="salida" && (!u || u.tipo==="salida")) msg = "No tiene un ingreso abierto. Verifique que eligió el tipo correcto.";
  av.textContent = msg; show(av, !!msg);
  renderMotivos(); tick(); requestAnimationFrame(padSize);
}
$("#tIngreso").onclick = () => setTipo("ingreso");
$("#tSalida").onclick = () => setTipo("salida");

function renderMotivos(){
  const box = $("#motivos"); box.replaceChildren();
  MOTIVOS.forEach(m=>{
    const b = mk("button","chip"+(st.motivo===m?" on":""), m); b.type="button"; b.setAttribute("aria-pressed", st.motivo===m);
    b.onclick = () => { st.motivo = m; renderMotivos(); };
    box.append(b);
  });
  $("#detReq").textContent = st.motivo && SIN_DETALLE.has(st.motivo) ? "(opcional)" : "(obligatorio)";
}

/* cambiar mi contraseña */
$("#formMiClave").addEventListener("submit", async ev=>{
  ev.preventDefault();
  const err = $("#mcErr"), ok = $("#mcOk"); show(err,false); show(ok,false);
  const bad = m => { err.textContent = m; show(err,true); };
  const actual = $("#mcActual").value, nueva = $("#mcNueva").value;
  if(nueva.length < 6) return bad("La contraseña nueva debe tener al menos 6 caracteres.");
  if(nueva !== $("#mcNueva2").value) return bad("Las contraseñas nuevas no coinciden.");
  try{
    await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, actual));
    await updatePassword(auth.currentUser, nueva);
    ["#mcActual","#mcNueva","#mcNueva2"].forEach(s=>$(s).value="");
    ok.textContent = "Contraseña cambiada."; show(ok,true);
  }catch(e){
    bad(e.code==="auth/invalid-credential"||e.code==="auth/wrong-password" ? "La contraseña actual no es correcta." : errText(e));
  }
});

/* ---------- firma ---------- */
const pad = $("#firma"), pctx = pad.getContext("2d");
let trazo = null;
function inkColor(){ return getComputedStyle(document.documentElement).getPropertyValue("--ink").trim() || "#111"; }
function drawStrokes(ctx, w, h, color, lw){
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.lineCap = "round"; ctx.lineJoin = "round";
  for(const s of st.strokes){
    if(s.length===1){ ctx.beginPath(); ctx.arc(s[0][0]*w, s[0][1]*h, lw/2, 0, Math.PI*2); ctx.fill(); continue; }
    ctx.beginPath(); ctx.moveTo(s[0][0]*w, s[0][1]*h);
    for(let i=1;i<s.length-1;i++){
      const mx = (s[i][0]+s[i+1][0])/2*w, my = (s[i][1]+s[i+1][1])/2*h;
      ctx.quadraticCurveTo(s[i][0]*w, s[i][1]*h, mx, my);
    }
    const l = s[s.length-1]; ctx.lineTo(l[0]*w, l[1]*h); ctx.stroke();
  }
}
function padSize(){
  const r = pad.getBoundingClientRect(); if(!r.width) return;
  const dpr = window.devicePixelRatio || 1;
  pad.width = Math.round(r.width*dpr); pad.height = Math.round(r.height*dpr);
  pctx.setTransform(dpr,0,0,dpr,0,0); drawPad();
}
function drawPad(){ const r = pad.getBoundingClientRect(); pctx.clearRect(0,0,r.width,r.height); drawStrokes(pctx, r.width, r.height, inkColor(), 2.4); }
function pt(e){ const r = pad.getBoundingClientRect(); return [Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)), Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))]; }
pad.addEventListener("pointerdown", e=>{ e.preventDefault(); try{pad.setPointerCapture(e.pointerId);}catch{} trazo=[pt(e)]; st.strokes.push(trazo); drawPad(); });
pad.addEventListener("pointermove", e=>{ if(!trazo) return; e.preventDefault(); trazo.push(pt(e)); drawPad(); });
["pointerup","pointercancel","pointerleave"].forEach(ev => pad.addEventListener(ev, ()=>{ trazo=null; }));
$("#limpiar").onclick = () => { st.strokes = []; drawPad(); };
window.addEventListener("resize", padSize);
try{ matchMedia("(prefers-color-scheme: dark)").addEventListener("change", drawPad); }catch{}
const puntosFirma = () => st.strokes.reduce((a,s)=>a+s.length,0);
function exportFirma(){
  const c = document.createElement("canvas"); c.width = 480; c.height = 160;
  const x = c.getContext("2d"); x.fillStyle = "#FFFFFF"; x.fillRect(0,0,480,160);
  drawStrokes(x, 480, 160, "#111111", 2.6);
  return c.toDataURL("image/png");
}

/* ---------- empleado: guardar marca ---------- */
function fallo(msg){ const e = $("#error"); e.textContent = msg; show(e,true); }
$("#confirmar").onclick = async () => {
  show($("#error"),false);
  if(!st.sel || st.rol!=="empleado") return fallo("Inicie sesión primero.");
  const detalle = $("#detalle").value.trim();
  if(st.tipo==="salida"){
    if(!st.motivo) return fallo("Elija el motivo de la salida.");
    if(!SIN_DETALLE.has(st.motivo) && detalle.length < 4) return fallo("Escriba el detalle de la salida.");
  }
  if(puntosFirma() < 8) return fallo("Falta la firma. Firme en el recuadro.");
  st.saving = true; const btn = $("#confirmar"); btn.disabled = true; btn.textContent = "Guardando…";
  const e = st.sel;
  const data = {
    empleadoId:auth.currentUser.uid, nombre:e.nombre, cedula:String(e.cedula), cargo:e.cargo||"",
    tipo:st.tipo, ts:serverTimestamp(),
    motivo: st.tipo==="salida" ? st.motivo : "", detalle: st.tipo==="salida" ? detalle : "",
    firma: exportFirma(), dispositivo: navigator.userAgent.slice(0,180)
  };
  try{
    await addDoc(collection(db,"marcas"), data);
    exito({...data, ts:Date.now()});
  }catch(err){ fallo(errText(err)); }
  finally{ st.saving = false; btn.disabled = false; tick(); }
};

let cuenta = null;
function exito(d){
  show($("#stepForm"),false); show($("#stepOk"),true);
  const b = $("#okBadge"); b.className = "ok-badge "+(d.tipo==="ingreso"?"in":"out"); b.textContent = d.tipo==="ingreso" ? "→" : "←";
  $("#okTitulo").textContent = d.tipo==="ingreso" ? "Ingreso registrado" : "Salida registrada";
  $("#okHora").textContent = fmtHora(d.ts);
  $("#okNombre").textContent = d.nombre;
  let extra = d.tipo==="salida" ? `Motivo: ${d.motivo}` : "Bienvenido(a). Que tenga una buena jornada.";
  if(d.tipo==="salida" && st.ultima && st.ultima.tipo==="ingreso" && d.ts - st.ultima.ts < 20*3600e3) extra += ` · Permanencia: ${dur(d.ts - st.ultima.ts)}`;
  $("#okExtra").textContent = extra;
  let n = 8; $("#okCuenta").textContent = `(${n})`;
  clearInterval(cuenta);
  cuenta = setInterval(()=>{ n--; $("#okCuenta").textContent = `(${n})`; if(n<=0) salir(); }, 1000);
}

/* ---------- administración ---------- */
document.querySelectorAll(".sub").forEach(b => b.onclick = () => {
  document.querySelectorAll(".sub").forEach(x => x.classList.toggle("on", x===b));
  ["Reg","Res","Per","Aj"].forEach(k => show($("#sub"+k), b.dataset.sub===k));
  if(b.dataset.sub==="Res") renderResumen();
});

function abrirPanel(){
  const hoy = ymd(new Date());
  if(!$("#fDesde").value){ $("#fDesde").value = $("#rDesde").value = hoy; $("#fHasta").value = $("#rHasta").value = hoy; }
  $("#aEmpresa").value = st.ajustes.empresa || "";
  st.unsubs.push(onSnapshot(collection(db,"empleados"), snap=>{
    st.empleados = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"","es"));
    st.empLoaded = true; renderPersonal(); fillEmpSelect();
  }, err=>{ $("#perList").replaceChildren(mk("div","empty",errText(err))); }));
  suscribirMarcas();
}

function suscribirMarcas(){
  if(st.unsubMarcas) st.unsubMarcas();
  let d = $("#fDesde").value, h = $("#fHasta").value;
  if(!d || !h) return;
  if(d > h){ [d,h] = [h,d]; }
  $("#fDesde").value = $("#rDesde").value = d; $("#fHasta").value = $("#rHasta").value = h;
  const t0 = Timestamp.fromMillis(parseYmd(d).getTime()), t1 = Timestamp.fromMillis(parseYmd(h).getTime() + 86400e3);
  st.marcas = []; st.marcasLoaded = false; st.marcasSlow = false; st.marcasErr = null; renderRegistros();
  const timer = setTimeout(()=>{ if(!st.marcasLoaded){ st.marcasSlow = true; renderRegistros(); } }, 10000);
  const q = query(collection(db,"marcas"), where("ts",">=",t0), where("ts","<",t1), orderBy("ts","desc"), limit(1000));
  st.unsubMarcas = onSnapshot(q, snap=>{
    st.marcas = snap.docs.map(marcaDe);
    st.marcasLoaded = true; st.marcasSlow = false; clearTimeout(timer);
    renderRegistros();
    if(st.modalId && !st.marcas.find(m=>m.id===st.modalId)) cerrarModal();
  }, err=>{ clearTimeout(timer); st.marcasErr = err; renderRegistros(); });
}
["#fDesde","#fHasta"].forEach(s => $(s).addEventListener("change", suscribirMarcas));
["#rDesde","#rHasta"].forEach(s => $(s).addEventListener("change", ()=>{ $("#fDesde").value = $("#rDesde").value; $("#fHasta").value = $("#rHasta").value; suscribirMarcas(); }));
["#fEmp","#fTipo"].forEach(s => $(s).addEventListener("change", renderRegistros));
$("#rEmp").addEventListener("change", renderResumen);

function permanencias(lista){
  const out = {}, porEmp = {};
  [...lista].sort((a,b)=>a.ts-b.ts).forEach(m=>{
    const k = m.empleadoId;
    if(m.tipo==="ingreso") porEmp[k] = m;
    else { if(porEmp[k]) out[m.id] = m.ts - porEmp[k].ts; porEmp[k] = null; }
  });
  return {out, abiertos:porEmp};
}
function filtradas(){
  const emp = $("#fEmp").value, tipo = $("#fTipo").value;
  return st.marcas.filter(m =>
    (!emp || m.empleadoId===emp) &&
    (!tipo || (tipo==="justificada" ? (m.tipo==="salida" && m.motivo!=="Fin de jornada") : m.tipo===tipo)));
}
function renderRegistros(){
  const msg = $("#regMsg"), tb = $("#tbody");
  const lista = filtradas();
  const {out:perm, abiertos} = permanencias(st.marcas);
  $("#sTotal").textContent = lista.length;
  $("#sIn").textContent = lista.filter(m=>m.tipo==="ingreso").length;
  $("#sOut").textContent = lista.filter(m=>m.tipo==="salida").length;
  $("#sJust").textContent = lista.filter(m=>m.tipo==="salida" && m.motivo!=="Fin de jornada").length;

  const hoy = ymd(new Date());
  const dentro = Object.values(abiertos).filter(Boolean).filter(m => Date.now()-m.ts < 20*3600e3);
  const verDentro = $("#fHasta").value >= hoy && st.marcasLoaded;
  show($("#inside"), verDentro);
  if(verDentro){
    $("#insideN").textContent = `(${dentro.length})`;
    const box = $("#insideList"); box.replaceChildren();
    if(!dentro.length) box.append(mk("span","muted","Nadie tiene un ingreso abierto."));
    dentro.sort((a,b)=>a.ts-b.ts).forEach(m=>{ const t = mk("span","tag"); t.append(mk("b",null,m.nombre), mk("span","num muted","desde "+fmtHora(m.ts))); box.append(t); });
  }

  tb.replaceChildren();
  let m = "";
  if(st.marcasErr) m = errText(st.marcasErr);
  else if(!st.marcasLoaded) m = st.marcasSlow ? "Los registros no se han podido cargar todavía. Revise la conexión." : "Cargando registros…";
  else if(!lista.length) m = st.marcas.length ? "Ningún registro coincide con los filtros." : "No hay registros en estas fechas. Aparecerán aquí en cuanto el personal marque ingreso o salida.";
  msg.textContent = m; show(msg, !!m); show($("#tablaWrap"), lista.length>0);

  lista.forEach(r=>{
    const tr = mk("tr");
    const tdP = mk("td"); tdP.append(mk("div",null,r.nombre), mk("small","num muted",r.cedula));
    const tdT = mk("td"); tdT.append(mk("span","pill "+(r.tipo==="ingreso"?"in":"out"), r.tipo==="ingreso"?"Ingreso":"Salida"));
    const tdJ = mk("td","just");
    if(r.tipo==="salida"){ tdJ.append(mk("b",null,r.motivo||"—")); if(r.detalle) tdJ.append(mk("small",null,r.detalle)); } else tdJ.append(mk("span","muted","—"));
    const tdD = mk("td","num", r.tipo==="salida" && perm[r.id]!=null ? dur(perm[r.id]) : "—");
    const tdF = mk("td"); if(r.firma){ const im = mk("img","sig"); im.src = r.firma; im.alt = "Firma de "+r.nombre; tdF.append(im); }
    tr.append(mk("td",null,fmtFecha(r.ts)), mk("td","num",fmtHora(r.ts)), tdP, tdT, tdJ, tdD, tdF);
    tr.tabIndex = 0;
    tr.onclick = () => abrirModal(r.id, perm[r.id]);
    tr.onkeydown = e => { if(e.key==="Enter") abrirModal(r.id, perm[r.id]); };
    tb.append(tr);
  });
  renderResumen();
  $("#regFoot").textContent = st.marcas.length>=1000 ? "Se muestran los 1.000 registros más recientes del rango. Acorte las fechas para ver el resto." : (lista.length ? "Toque una fila para ver la firma en grande o eliminar un registro." : "");
}

function fillEmpSelect(){
  ["#fEmp","#rEmp"].forEach(sel=>{
    const s = $(sel), v = s.value; s.replaceChildren(new Option("Todo el personal",""));
    st.empleados.forEach(e => s.append(new Option(e.nombre + (e.activo===false?" (inactivo)":""), e.id)));
    s.value = v;
  });
}

/* modal */
function abrirModal(id, permMs){
  const r = st.marcas.find(m=>m.id===id); if(!r) return;
  st.modalId = id;
  $("#mTitulo").textContent = (r.tipo==="ingreso"?"Ingreso":"Salida")+" · "+r.nombre;
  const dl = $("#mDatos"); dl.replaceChildren();
  const add = (k,v) => { dl.append(mk("dt",null,k), mk("dd",null,v)); };
  add("Fecha", fmtFechaLarga(r.ts)); add("Hora (servidor)", fmtHora(r.ts)); add("Documento", r.cedula); add("Cargo", r.cargo||"—");
  if(r.tipo==="salida"){ add("Motivo", r.motivo||"—"); add("Detalle", r.detalle||"—"); add("Permanencia", permMs!=null?dur(permMs):"Sin ingreso en el rango"); }
  $("#mFirma").src = r.firma || "";
  show($("#mConfirm"),false); show($("#mBorrar"),true); show($("#mErr"),false);
  show($("#modal"),true); $("#mCerrar").focus();
}
function cerrarModal(){ st.modalId = null; show($("#modal"),false); }
$("#mCerrar").onclick = cerrarModal;
$("#modal").addEventListener("click", e => { if(e.target.id==="modal") cerrarModal(); });
document.addEventListener("keydown", e => { if(e.key==="Escape" && !$("#modal").hidden) cerrarModal(); });
$("#mDel").onclick = () => { show($("#mBorrar"),false); show($("#mConfirm"),true); };
$("#mDelNo").onclick = () => { show($("#mConfirm"),false); show($("#mBorrar"),true); };
$("#mDelSi").onclick = async () => {
  const id = st.modalId; if(!id) return;
  try{ await deleteDoc(doc(db,"marcas",id)); cerrarModal(); }
  catch(e){ $("#mErr").textContent = errText(e); show($("#mErr"),true); }
};

/* descarga de archivos CSV */
function descargar(nombre, texto){
  const blob = new Blob(["﻿"+texto], {type:"text/csv;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre;
  document.body.append(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const q = v => `"${String(v??"").replace(/"/g,'""')}"`;
$("#exportar").onclick = () => {
  const lista = filtradas(); const btn = $("#exportar");
  if(!lista.length){ btn.textContent = "Sin datos"; setTimeout(()=>btn.textContent="Exportar CSV",1500); return; }
  const {out:perm} = permanencias(st.marcas);
  const filas = [["Fecha","Hora","Documento","Nombre","Cargo","Tipo","Motivo","Detalle","Permanencia (min)"].map(q).join(";")];
  [...lista].sort((a,b)=>a.ts-b.ts).forEach(r => filas.push([
    ymd(new Date(r.ts)), new Date(r.ts).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit",hour12:false}),
    r.cedula, r.nombre, r.cargo, r.tipo, r.motivo, r.detalle, perm[r.id]!=null ? Math.round(perm[r.id]/60000) : ""
  ].map(q).join(";")));
  descargar(`registros_${$("#fDesde").value}_a_${$("#fHasta").value}.csv`, filas.join("\r\n"));
};

/* ---------- resumen diario: horas trabajadas ---------- */
function calcularResumen(){
  const emp = $("#rEmp").value, ahora = Date.now(), hoy = ymd(new Date());
  const lista = st.marcas.filter(m => !emp || m.empleadoId===emp).sort((a,b)=>a.ts-b.ts);
  const dias = {}, abierto = {};
  const dia = (m, ts) => {
    const f = ymd(new Date(ts)), k = m.empleadoId+"|"+f;
    return dias[k] || (dias[k] = {empleadoId:m.empleadoId, nombre:m.nombre, cedula:m.cedula, fecha:f,
      primer:null, ultima:null, trabajado:0, fuera:0, salidasJornada:0, sinSalida:false, enCurso:false, ultSalida:null});
  };
  for(const m of lista){
    const k = m.empleadoId;
    if(m.tipo==="ingreso"){
      if(abierto[k]) dia(abierto[k], abierto[k].ts).sinSalida = true;
      const d = dia(m, m.ts);
      if(d.primer==null) d.primer = m.ts;
      if(d.ultSalida!=null){ d.fuera += m.ts - d.ultSalida; d.ultSalida = null; }
      abierto[k] = m;
    }else{
      const ing = abierto[k];
      if(ing){
        const d = dia(ing, ing.ts);
        d.trabajado += m.ts - ing.ts; d.ultima = m.ts; d.ultSalida = m.ts;
        if(m.motivo && m.motivo!=="Fin de jornada") d.salidasJornada++;
        abierto[k] = null;
      }else{ dia(m, m.ts).ultima = m.ts; }
    }
  }
  Object.values(abierto).filter(Boolean).forEach(ing=>{
    const d = dia(ing, ing.ts);
    if(d.fecha===hoy && ahora-ing.ts < 20*3600e3){ d.enCurso = true; d.trabajado += ahora - ing.ts; }
    else d.sinSalida = true;
  });
  const filas = Object.values(dias).sort((a,b)=> b.fecha.localeCompare(a.fecha) || a.nombre.localeCompare(b.nombre,"es"));
  const tot = {};
  filas.forEach(d=>{
    const t = tot[d.empleadoId] || (tot[d.empleadoId] = {nombre:d.nombre, cedula:d.cedula, dias:0, ms:0, sinSalida:0, salidas:0});
    if(d.primer!=null) t.dias++;
    t.ms += d.trabajado; t.salidas += d.salidasJornada; if(d.sinSalida) t.sinSalida++;
  });
  return {filas, totales:Object.values(tot).sort((a,b)=>a.nombre.localeCompare(b.nombre,"es"))};
}
const horasDec = ms => (ms/3600e3).toFixed(2).replace(".",",");

function renderResumen(){
  const msg = $("#resMsg"), body = $("#resBody"), tw = $("#resTotales");
  body.replaceChildren(); tw.replaceChildren();
  let m = "";
  if(st.marcasErr) m = errText(st.marcasErr);
  else if(!st.marcasLoaded) m = st.marcasSlow ? "Los registros no se han podido cargar todavía. Revise la conexión." : "Calculando…";
  const {filas, totales} = calcularResumen();
  if(!m && !filas.length) m = "No hay ingresos ni salidas en estas fechas. Amplíe el rango para ver el resumen.";
  msg.textContent = m; show(msg, !!m);
  show($("#resWrap"), filas.length>0); show($("#resDiaTitulo"), filas.length>0);
  if(!filas.length) return;

  const wrap = mk("div","table-wrap"); const t = mk("table"); t.style.minWidth = "560px";
  t.innerHTML = "<thead><tr><th>Persona</th><th>Días trabajados</th><th>Horas totales</th><th>Promedio por día</th><th>Salidas en jornada</th><th>Días sin salida</th></tr></thead>";
  const tb = mk("tbody");
  totales.forEach(x=>{
    const tr = mk("tr"); tr.style.cursor = "default";
    const p = mk("td"); p.append(mk("div",null,x.nombre), mk("small","num muted",x.cedula));
    const h = mk("td","num"); h.append(mk("b",null,dur(x.ms)));
    const s = mk("td","num"); s.append(x.sinSalida ? mk("span","pill out",x.sinSalida) : mk("span","muted","0"));
    tr.append(p, mk("td","num",x.dias), h, mk("td","num", x.dias ? dur(x.ms/x.dias) : "—"), mk("td","num",x.salidas), s);
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); tw.append(wrap);

  filas.forEach(d=>{
    const tr = mk("tr"); tr.style.cursor = "default";
    const p = mk("td"); p.append(mk("div",null,d.nombre), mk("small","num muted",d.cedula));
    const hrs = mk("td","num");
    if(d.enCurso){ hrs.append(mk("b",null,dur(d.trabajado)), document.createTextNode(" "), mk("span","pill in","En curso")); }
    else if(d.sinSalida){ if(d.trabajado) hrs.append(mk("b",null,dur(d.trabajado)), document.createTextNode(" ")); hrs.append(mk("span","pill out","Sin salida")); }
    else hrs.append(mk("b",null, d.trabajado ? dur(d.trabajado) : "—"));
    tr.append(
      mk("td",null, fmtFecha(parseYmd(d.fecha).getTime())), p,
      mk("td","num", d.primer!=null ? fmtHora(d.primer) : "—"),
      mk("td","num", d.ultima!=null ? fmtHora(d.ultima) : "—"),
      mk("td","num", d.salidasJornada),
      mk("td","num", d.fuera ? dur(d.fuera) : "—"),
      hrs);
    body.append(tr);
  });
}

$("#rExportar").onclick = () => {
  const btn = $("#rExportar"); const {filas} = calcularResumen();
  if(!filas.length){ btn.textContent = "Sin datos"; setTimeout(()=>btn.textContent="Exportar CSV",1500); return; }
  const h24 = ts => ts==null ? "" : new Date(ts).toLocaleTimeString("es-CO",{hour:"2-digit",minute:"2-digit",hour12:false});
  const out = [["Fecha","Documento","Nombre","Primer ingreso","Última salida","Salidas en jornada","Tiempo fuera (h)","Horas trabajadas","Horas trabajadas (decimal)","Estado"].map(q).join(";")];
  [...filas].sort((a,b)=>a.fecha.localeCompare(b.fecha)||a.nombre.localeCompare(b.nombre,"es")).forEach(d => out.push([
    d.fecha, d.cedula, d.nombre, h24(d.primer), h24(d.ultima), d.salidasJornada, horasDec(d.fuera),
    dur(d.trabajado), horasDec(d.trabajado), d.enCurso ? "En curso" : d.sinSalida ? "Sin salida" : "Completo"
  ].map(q).join(";")));
  descargar(`horas_trabajadas_${$("#rDesde").value}_a_${$("#rHasta").value}.csv`, out.join("\r\n"));
};

/* ---------- personal ---------- */
function activos(){ return st.empleados.filter(e => e.activo !== false); }
function renderPersonal(){
  const box = $("#perList"); box.replaceChildren();
  $("#perCount").textContent = st.empleados.length ? `${activos().length} activos de ${st.empleados.length}` : "";
  if(!st.empleados.length){ box.append(mk("div","empty", st.empLoaded ? "Aún no hay nadie. Agregue a la primera persona con el formulario." : "Cargando…")); return; }
  const wrap = mk("div","table-wrap"); const t = mk("table"); t.style.minWidth = "640px";
  t.innerHTML = "<thead><tr><th>Nombre</th><th>Usuario</th><th>Documento</th><th>Cargo</th><th>Estado</th><th></th></tr></thead>";
  const tb = mk("tbody");
  st.empleados.forEach(e=>{
    const tr = mk("tr"); tr.style.cursor = "default";
    const b = mk("button","btn", e.activo===false ? "Activar" : "Desactivar"); b.type = "button";
    b.onclick = async () => { b.disabled = true; try{ await updateDoc(doc(db,"empleados",e.id), {activo: e.activo===false}); }catch(err){ b.textContent = "Error"; } b.disabled = false; };
    const r = mk("button","btn","Nueva contraseña"); r.type = "button";
    const tdE = mk("td"); tdE.append(mk("span","pill "+(e.activo===false?"off":"in"), e.activo===false?"Inactivo":"Activo"));
    const tdB = mk("td"); const acc = mk("div","row-actions"); acc.append(r, b); tdB.append(acc);
    r.onclick = () => {
      acc.replaceChildren();
      const inp = mk("input"); inp.type = "text"; inp.placeholder = "Nueva contraseña"; inp.maxLength = 40; inp.style.maxWidth = "170px"; inp.id = "reset-"+e.id;
      const ok = mk("button","btn primary","Guardar"); ok.type = "button";
      const no = mk("button","btn","Cancelar"); no.type = "button"; no.onclick = renderPersonal;
      const msg = mk("span","muted"); msg.style.fontSize = "13px";
      ok.onclick = async () => {
        const v = inp.value;
        if(v.length < 6){ inp.value = ""; inp.placeholder = "Mínimo 6 caracteres"; return; }
        if(!fns){ msg.textContent = "Función no disponible."; return; }
        ok.disabled = true; msg.textContent = "Guardando…";
        try{
          await httpsCallable(fns, "cambiarClaveEmpleado")({uid:e.id, clave:v});
          acc.replaceChildren(mk("span","ok-msg","Contraseña cambiada")); setTimeout(renderPersonal, 2500);
        }catch(err){
          ok.disabled = false;
          msg.textContent = (err.code||"").includes("not-found") || (err.code||"").includes("internal")
            ? "La función opcional no está desplegada (vea la guía, paso 7)."
            : (err.message || "No se pudo cambiar.");
        }
      };
      acc.append(inp, ok, no, msg); inp.focus();
    };
    tr.append(mk("td",null,e.nombre), mk("td","num",e.usuario||"—"), mk("td","num",e.cedula), mk("td",null,e.cargo||"—"), tdE, tdB);
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); box.append(wrap);
  box.append(mk("p","foot-note","Desactivar impide que la persona marque, sin borrar su historial."));
}

$("#formEmp").addEventListener("submit", async ev=>{
  ev.preventDefault();
  const err = $("#eErr"), ok = $("#eOk"); show(err,false); show(ok,false);
  const bad = m => { err.textContent = m; show(err,true); };
  const nombre = $("#eNombre").value.trim().replace(/\s+/g," ");
  const cedula = $("#eDoc").value.replace(/\D/g,"");
  const cargo = $("#eCargo").value.trim();
  const usuario = normUser($("#eUsuario").value), clave = $("#eClave").value;
  if(nombre.length < 3) return bad("Escriba el nombre completo.");
  if(cedula.length < 5) return bad("Escriba un número de documento válido (solo dígitos).");
  if(usuario.length < 3) return bad("El usuario debe tener al menos 3 caracteres (letras, números, punto o guion).");
  if(clave.length < 6) return bad("La contraseña debe tener al menos 6 caracteres.");
  if(st.empleados.some(e=>String(e.cedula)===cedula)) return bad("Ya existe una persona con ese documento.");
  if(st.empleados.some(e=>e.usuario===usuario)) return bad(`El usuario «${usuario}» ya está en uso. Elija otro.`);
  const btn = ev.submitter || $("#formEmp button[type=submit]"); btn.disabled = true;
  // Se crea la cuenta con una instancia secundaria para no cerrar la sesión del administrador.
  const sec = initializeApp(firebaseConfig, "alta-"+Date.now());
  try{
    const secAuth = getAuth(sec);
    const cred = await createUserWithEmailAndPassword(secAuth, `${usuario}@${DOMINIO_USUARIOS}`, clave);
    await setDoc(doc(db,"empleados",cred.user.uid), {nombre, cedula, cargo, usuario, activo:true, creado:serverTimestamp()});
    await signOut(secAuth);
    ["#eNombre","#eDoc","#eCargo","#eUsuario","#eClave"].forEach(s => $(s).value = "");
    ok.textContent = `${nombre} quedó agregado(a) con el usuario «${usuario}».`; show(ok,true); $("#eNombre").focus();
  }catch(e){
    if(e.code==="auth/email-already-in-use") bad(`El usuario «${usuario}» ya existe en Firebase. Elija otro o elimínelo en la consola (Authentication).`);
    else if(e.code==="auth/operation-not-allowed") bad("Active el inicio de sesión con correo y contraseña en Firebase Authentication (vea la guía).");
    else bad(errText(e));
  }finally{ btn.disabled = false; deleteApp(sec).catch(()=>{}); }
});

/* ---------- ajustes ---------- */
$("#formEmpresa").addEventListener("submit", async ev=>{
  ev.preventDefault(); const ok = $("#aEmpOk"); show(ok,false);
  try{ await setDoc(doc(db,"ajustes","general"), {empresa: $("#aEmpresa").value.trim()}, {merge:true}); ok.textContent = "Guardado."; show(ok,true); }
  catch(e){ ok.textContent = errText(e); show(ok,true); }
});

vista("login");
