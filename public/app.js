import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword,
  setPersistence, browserSessionPersistence, updatePassword, EmailAuthProvider, reauthenticateWithCredential
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit,
  getDocs, onSnapshot, serverTimestamp, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig, ADMIN_EMAILS, DOMINIO_USUARIOS, REGION_FUNCIONES } from "./config.js";

const MOTIVOS = ["Fin de jornada","Almuerzo","Diligencia personal","Cita médica","Comisión de trabajo","Calamidad doméstica","Otro"];
const SIN_DETALLE = new Set(["Fin de jornada","Almuerzo"]);
const $ = s => document.querySelector(s);
const st = {
  rol:null, user:null, sel:null, ultima:null,
  empleados:[], empLoaded:false, ajustes:{},
  marcas:[], marcasLoaded:false, marcasSlow:false, marcasErr:null, modalId:null,
  unsubs:[], unsubMarcas:null,
  permisos:[], misPermisos:[], celadores:[]
};
const MOTIVOS_PERMISO = MOTIVOS.filter(m => m !== "Fin de jornada");
const PREFIJO_QR = "PIC";
/** Código secreto único de cada empleado (se guarda en su ficha y va dentro del QR) */
function nuevoToken(){
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(36).padStart(2,"0")).join("").slice(0,24);
}
const contenidoQR = (uid, token) => `${PREFIJO_QR}|${uid}|${token}`;
function qrDataUrl(texto){
  if(typeof qrcode !== "function") return null;
  const q = qrcode(0, "M"); q.addData(texto); q.make();
  return q.createDataURL(8, 2);
}

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
}
setInterval(tick,1000); tick();

/* ---------- vistas ---------- */
function vista(v){ // "login" | "empleado" | "celador" | "admin"
  show($("#heroKiosk"), v!=="admin"); show($("#heroAdmin"), v==="admin");
  show($("#vKiosk"), v==="login" || v==="empleado"); show($("#vAdmin"), v==="admin");
  show($("#vGuard"), v==="celador");
  if(v!=="celador") detenerCamara();
  show($("#userBox"), v!=="login");
  if(v==="login"){ show($("#loginForm"),true); show($("#seleccion"),false); show($("#stepForm"),true); }
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

async function salir(){ clearTimeout(inactividad); if(auth) await signOut(auth); }
$("#logout").onclick = salir;
$("#cambiar").onclick = salir;

function limpiarSuscripciones(){
  st.unsubs.forEach(u=>{ try{u();}catch{} }); st.unsubs = [];
  if(st.unsubMarcas){ st.unsubMarcas(); st.unsubMarcas = null; }
  st.marcas = []; st.empleados = []; st.empLoaded = false;
  st.permisos = []; st.misPermisos = []; st.celadores = [];
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
    if(!s.exists()){
      const c = await getDoc(doc(db,"celadores",user.uid)).catch(()=>null);
      if(c && c.exists()){
        const cel = {id:c.id, ...c.data()};
        if(cel.activo === false){ await signOut(auth); return loginMsg("Su usuario está desactivado. Hable con el administrador."); }
        st.rol = "celador"; $("#userName").textContent = cel.nombre; st.guard = cel;
        vista("celador"); iniciarPorteria(); return;
      }
      await signOut(auth); return loginMsg("Este usuario no está registrado. Hable con el administrador.");
    }
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
  if(st.rol==="empleado") inactividad = setTimeout(salir, 120000);
}
["pointerdown","keydown"].forEach(ev => document.addEventListener(ev, vigilarInactividad));

async function seleccionar(e){
  st.sel = e; st.ultima = null;
  show($("#loginForm"),false); show($("#stepForm"),true);
  $("#selNombre").textContent = e.nombre; $("#selDoc").textContent = "C.C. "+e.cedula; $("#selCargo").textContent = e.cargo || "Sin cargo";
  $("#selUltima").textContent = "";
  $("#selAvatar").textContent = e.nombre.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
  const est = $("#selEstado"); est.className = "status"; est.textContent = "Consultando…";
  $("#histList").replaceChildren(mk("span","muted","Cargando…")); $("#historial").open = false; $("#miClave").open = false;
  show($("#seleccion"),true); vigilarInactividad();
  prepararQrYPermisos(e);
  let hist = [];
  try{
    // Sin orderBy para no requerir un índice compuesto: se ordena aquí.
    const q = query(collection(db,"marcas"), where("empleadoId","==",e.id));
    hist = (await getDocs(q)).docs.map(marcaDe).sort((x,y)=>y.ts-x.ts).slice(0,6);
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
}

/* ---------- empleado: mi código QR y permisos de salida ---------- */
const ESTADO_PERMISO = {
  pendiente:["pend","Pendiente"], aprobado:["apro","Aprobado"], rechazado:["rech","Rechazado"], usado:["usado","Usado"]
};
function prepararQrYPermisos(e){
  const img = $("#miQrImg"), txt = $("#miQrTxt");
  const url = e.qr ? qrDataUrl(contenidoQR(e.id, e.qr)) : null;
  if(url){ img.src = url; show(img,true); txt.textContent = "Muestre este código al celador al entrar y al salir."; }
  else{ show(img,false); txt.textContent = e.qr ? "No se pudo generar el código. Revise su conexión y recargue." : "Su código QR aún no está listo. Pídale al administrador que lo genere."; }

  const sel = $("#pMotivo"); sel.replaceChildren(); MOTIVOS_PERMISO.forEach(m => sel.append(new Option(m,m)));
  $("#pDetalle").value = ""; show($("#pErr"),false);
  st.misPermisos = []; renderMisPermisos();
  st.unsubs.push(onSnapshot(query(collection(db,"permisos"), where("empleadoId","==",e.id)), snap=>{
    st.misPermisos = snap.docs.map(d=>{ const x = d.data({serverTimestamps:"estimate"}); return {id:d.id, ...x,
      creado: x.creado && x.creado.toMillis ? x.creado.toMillis() : Date.now()}; }).sort((a,b)=>b.creado-a.creado).slice(0,8);
    renderMisPermisos();
  }, ()=>{}));
}
function renderMisPermisos(){
  const box = $("#permLista"); box.replaceChildren();
  const pend = st.misPermisos.filter(p=>p.estado==="pendiente").length, apro = st.misPermisos.filter(p=>p.estado==="aprobado").length;
  const b = $("#permBadge");
  b.textContent = apro ? "Autorizado" : pend ? "Pendiente" : ""; b.className = "pill " + (apro ? "apro" : "pend"); show(b, !!(apro||pend));
  st.misPermisos.forEach(p=>{
    const [cls, lbl] = ESTADO_PERMISO[p.estado] || ["usado", p.estado];
    const it = mk("div","perm-item"); const top = mk("div","top");
    top.append(mk("b",null,p.motivo), mk("span","pill "+cls,lbl));
    it.append(top);
    if(p.detalle) it.append(mk("span","muted",p.detalle));
    it.append(mk("span","muted num",`${fmtFecha(p.creado)} · ${fmtHora(p.creado)}`));
    box.append(it);
  });
}
$("#formPermiso").addEventListener("submit", async ev=>{
  ev.preventDefault();
  const err = $("#pErr"); show(err,false);
  const bad = m => { err.textContent = m; show(err,true); };
  const e = st.sel; if(!e || st.rol!=="empleado") return bad("Inicie sesión primero.");
  const motivo = $("#pMotivo").value, detalle = $("#pDetalle").value.trim();
  if(!SIN_DETALLE.has(motivo) && detalle.length < 4) return bad("Escriba el detalle del permiso.");
  if(st.misPermisos.some(p=>p.estado==="pendiente")) return bad("Ya tiene una solicitud pendiente. Espere la respuesta del administrador.");
  const btn = ev.submitter || $("#formPermiso button[type=submit]"); btn.disabled = true;
  try{
    await addDoc(collection(db,"permisos"), {empleadoId:auth.currentUser.uid, nombre:e.nombre, cedula:String(e.cedula),
      motivo, detalle, estado:"pendiente", creado:serverTimestamp()});
    $("#pDetalle").value = "";
  }catch(x){ bad(errText(x)); }
  finally{ btn.disabled = false; }
});

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

/* ---------- administración ---------- */
document.querySelectorAll(".sub").forEach(b => b.onclick = () => {
  document.querySelectorAll(".sub").forEach(x => x.classList.toggle("on", x===b));
  ["Reg","Res","Perm","Per","Aj"].forEach(k => show($("#sub"+k), b.dataset.sub===k));
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
  st.unsubs.push(onSnapshot(query(collection(db,"permisos"), orderBy("creado","desc"), limit(200)), snap=>{
    st.permisos = snap.docs.map(d=>{ const x = d.data({serverTimestamps:"estimate"}); return {id:d.id, ...x,
      creado: x.creado && x.creado.toMillis ? x.creado.toMillis() : Date.now()}; });
    st.permisosLoaded = true; renderPermisosAdmin();
  }, err=>{ st.permisosErr = err; renderPermisosAdmin(); }));
  st.unsubs.push(onSnapshot(collection(db,"celadores"), snap=>{
    st.celadores = snap.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.nombre||"").localeCompare(b.nombre||"","es"));
    st.celErr = null; st.celLoaded = true; renderCeladores();
  }, err=>{ st.celErr = err; renderCeladores(); }));
  suscribirMarcas();
}

/* ---------- administración: permisos de salida ---------- */
function renderPermisosAdmin(){
  const box = $("#permAdmin"), msg = $("#permMsg"); box.replaceChildren();
  const pend = st.permisos.filter(p=>p.estado==="pendiente");
  const n = $("#subPermN"); n.textContent = pend.length; show(n, pend.length>0);
  $("#permCount").textContent = pend.length ? `${pend.length} pendiente${pend.length>1?"s":""}` : "";
  let m = "";
  if(st.permisosErr) m = errText(st.permisosErr);
  else if(!st.permisosLoaded) m = "Cargando…";
  else if(!st.permisos.length) m = "Todavía no hay solicitudes de permiso.";
  msg.textContent = m; show(msg, !!m);
  if(!st.permisos.length) return;
  const wrap = mk("div","table-wrap"); const t = mk("table"); t.style.minWidth = "640px";
  t.innerHTML = "<thead><tr><th>Fecha</th><th>Persona</th><th>Motivo</th><th>Estado</th><th></th></tr></thead>";
  const tb = mk("tbody");
  // pendientes primero, luego el resto por fecha
  [...pend, ...st.permisos.filter(p=>p.estado!=="pendiente")].forEach(p=>{
    const tr = mk("tr"); tr.style.cursor = "default";
    const per = mk("td"); per.append(mk("div",null,p.nombre), mk("small","num muted",p.cedula));
    const mot = mk("td","just"); mot.append(mk("b",null,p.motivo)); if(p.detalle) mot.append(mk("small",null,p.detalle));
    const [cls, lbl] = ESTADO_PERMISO[p.estado] || ["usado", p.estado];
    const est = mk("td"); est.append(mk("span","pill "+cls,lbl));
    const acc = mk("td"); const ro = mk("div","perm-actions");
    const decidir = async (estado, btn) => {
      btn.disabled = true;
      try{ await updateDoc(doc(db,"permisos",p.id), {estado, resuelto:serverTimestamp(), resueltoPor:auth.currentUser.email}); }
      catch(e){ btn.textContent = "Error"; btn.disabled = false; }
    };
    if(p.estado==="pendiente"){
      const ok = mk("button","btn ok-b","Aprobar"); ok.type = "button"; ok.onclick = () => decidir("aprobado", ok);
      const no = mk("button","btn no-b","Rechazar"); no.type = "button"; no.onclick = () => decidir("rechazado", no);
      ro.append(ok, no);
    }else if(p.estado==="aprobado"){
      const no = mk("button","btn no-b","Revocar"); no.type = "button"; no.onclick = () => decidir("rechazado", no);
      ro.append(no);
    }
    acc.append(ro);
    tr.append(mk("td","num",`${fmtFecha(p.creado)} · ${fmtHora(p.creado)}`), per, mot, est, acc);
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); box.append(wrap);
}

/* ---------- administración: código QR de cada empleado ---------- */
function abrirQr(e){
  const url = e.qr ? qrDataUrl(contenidoQR(e.id, e.qr)) : null;
  if(!url) return;
  $("#qTitulo").textContent = e.nombre; $("#qSub").textContent = `C.C. ${e.cedula}${e.cargo ? " · "+e.cargo : ""}`;
  st.qrEmp = e; $("#qImg").src = url; show($("#qModal"),true); $("#qCerrar").focus();
}
function cerrarQr(){ show($("#qModal"),false); st.qrEmp = null; }
$("#qNuevo").onclick = async () => {
  const e = st.qrEmp; if(!e) return;
  if(!confirm(`Se creará un código nuevo para ${e.nombre} y el anterior dejará de funcionar. ¿Continuar?`)) return;
  const b = $("#qNuevo"); b.disabled = true;
  try{ const qr = nuevoToken(); await updateDoc(doc(db,"empleados",e.id), {qr}); abrirQr({...e, qr}); }
  catch{ b.textContent = "Error"; setTimeout(()=>b.textContent="Generar nuevo",2000); }
  b.disabled = false;
};
$("#qCerrar").onclick = cerrarQr;
$("#qModal").addEventListener("click", e => { if(e.target.id==="qModal") cerrarQr(); });
$("#qImprimir").onclick = () => {
  document.body.classList.add("imprimiendo");
  const fin = () => { document.body.classList.remove("imprimiendo"); window.removeEventListener("afterprint", fin); };
  window.addEventListener("afterprint", fin); window.print();
};
async function generarQr(e){ await updateDoc(doc(db,"empleados",e.id), {qr:nuevoToken()}); }

/* ---------- administración: celadores ---------- */
function renderCeladores(){
  const box = $("#celList"); box.replaceChildren();
  $("#celCount").textContent = st.celadores.length ? String(st.celadores.length) : "";
  if(st.celErr){ box.append(mk("div","err","No se pudo cargar la lista de celadores. " + errText(st.celErr) + " Si acaba de publicar las reglas, recargue la página (Ctrl+F5).")); return; }
  if(!st.celadores.length){ box.append(mk("div","empty", st.celLoaded ? "Aún no hay celadores. Agregue al primero con el formulario." : "Cargando…")); return; }
  const wrap = mk("div","table-wrap"); const t = mk("table"); t.style.minWidth = "420px";
  t.innerHTML = "<thead><tr><th>Nombre</th><th>Usuario</th><th>Estado</th><th></th></tr></thead>";
  const tb = mk("tbody");
  st.celadores.forEach(c=>{
    const tr = mk("tr"); tr.style.cursor = "default";
    const b = mk("button","btn", c.activo===false ? "Activar" : "Desactivar"); b.type = "button";
    b.onclick = async () => { b.disabled = true; try{ await updateDoc(doc(db,"celadores",c.id), {activo: c.activo===false}); }catch{ b.textContent = "Error"; } b.disabled = false; };
    const tdE = mk("td"); tdE.append(mk("span","pill "+(c.activo===false?"off":"in"), c.activo===false?"Inactivo":"Activo"));
    const tdB = mk("td"); tdB.append(b);
    tr.append(mk("td",null,c.nombre), mk("td","num",c.usuario||"—"), tdE, tdB);
    tb.append(tr);
  });
  t.append(tb); wrap.append(t); box.append(wrap);
}
$("#formCel").addEventListener("submit", async ev=>{
  ev.preventDefault();
  const err = $("#cErr"), ok = $("#cOk"); show(err,false); show(ok,false);
  const bad = m => { err.textContent = m; show(err,true); };
  const nombre = $("#cNombre").value.trim().replace(/\s+/g," ");
  const usuario = normUser($("#cUsuario").value), clave = $("#cClave").value;
  if(nombre.length < 3) return bad("Escriba el nombre del celador.");
  if(usuario.length < 3) return bad("El usuario debe tener al menos 3 caracteres (letras, números, punto o guion).");
  if(clave.length < 6) return bad("La contraseña debe tener al menos 6 caracteres.");
  if(st.empleados.some(e=>e.usuario===usuario) || st.celadores.some(c=>c.usuario===usuario)) return bad(`El usuario «${usuario}» ya está en uso. Elija otro.`);
  const btn = ev.submitter || $("#formCel button[type=submit]"); btn.disabled = true;
  const sec = initializeApp(firebaseConfig, "alta-cel-"+Date.now());
  try{
    const secAuth = getAuth(sec);
    const cred = await createUserWithEmailAndPassword(secAuth, `${usuario}@${DOMINIO_USUARIOS}`, clave);
    await setDoc(doc(db,"celadores",cred.user.uid), {nombre, usuario, activo:true, creado:serverTimestamp()});
    await signOut(secAuth);
    ["#cNombre","#cUsuario","#cClave"].forEach(s => $(s).value = "");
    ok.textContent = `${nombre} quedó agregado(a) como celador con el usuario «${usuario}».`; show(ok,true);
  }catch(e){
    if(e.code==="auth/email-already-in-use") bad(`El usuario «${usuario}» ya existe en Firebase. Elija otro.`);
    else bad(errText(e));
  }finally{ btn.disabled = false; deleteApp(sec).catch(()=>{}); }
});

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
    else if(r.registradoPor) tdF.append(mk("span","pill off","QR portería"));
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
  if(r.registradoPor) add("Registrado por", "Celador (código QR)");
  $("#mFirma").src = r.firma || ""; show($("#mFirma"), !!r.firma);
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
    const qb = mk("button","btn", e.qr ? "Ver QR" : "Generar QR"); qb.type = "button";
    qb.onclick = async () => {
      if(e.qr) return abrirQr(e);
      qb.disabled = true;
      try{ const qr = nuevoToken(); await updateDoc(doc(db,"empleados",e.id), {qr}); abrirQr({...e, qr}); }
      catch{ qb.textContent = "Error"; }
      qb.disabled = false;
    };
    const tdB = mk("td"); const acc = mk("div","row-actions"); acc.append(qb, r, b); tdB.append(acc);
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
  box.append(mk("p","foot-note","Desactivar impide que la persona marque, sin borrar su historial. «Ver QR» muestra el código para imprimirlo o enviarlo al empleado."));
  const sinQr = st.empleados.filter(e=>!e.qr);
  if(sinQr.length){
    const g = mk("button","btn",`Generar QR para ${sinQr.length} persona${sinQr.length>1?"s":""} sin código`); g.type = "button";
    g.onclick = async () => { g.disabled = true; try{ for(const e of sinQr) await generarQr(e); }catch{ g.textContent = "Error"; g.disabled = false; } };
    box.append(g);
  }
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
    await setDoc(doc(db,"empleados",cred.user.uid), {nombre, cedula, cargo, usuario, activo:true, qr:nuevoToken(), creado:serverTimestamp()});
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

/* ---------- portería: el celador escanea el QR del empleado ---------- */
const cam = {stream:null, raf:0, on:false, modo:"normal"};
const gHist = [];
function iniciarPorteria(){
  gHist.length = 0; renderGHist(); limpiarResultado(); show($("#gErr"),false);
  show($("#gIniciar"),true); show($("#gPermiso"),true); show($("#gParar"),false); show($("#gScan"),false);
}
function detenerCamara(){
  cam.on = false; cancelAnimationFrame(cam.raf);
  if(cam.stream){ cam.stream.getTracks().forEach(t=>t.stop()); cam.stream = null; }
  const v = $("#gVideo"); if(v){ v.srcObject = null; }
  show($("#gScan"),false); show($("#gParar"),false); show($("#gIniciar"),true); show($("#gPermiso"),true);
}
function limpiarResultado(){ show($("#gRes"),false); }
async function iniciarCamara(modo){
  if(modo==="normal" || modo==="permiso") cam.modo = modo;   // los botones «Escanear siguiente» conservan el modo anterior
  const err = $("#gErr"); show(err,false); limpiarResultado();
  if(typeof jsQR !== "function"){ err.textContent = "No se pudo cargar el lector de QR. Revise la conexión y recargue la página."; return show(err,true); }
  if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ err.textContent = "Este navegador no permite usar la cámara. Abra la página con HTTPS en Chrome o Safari."; return show(err,true); }
  try{
    cam.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}}, audio:false});
  }catch(e){
    err.textContent = e && e.name==="NotAllowedError" ? "Permita el acceso a la cámara en el navegador para poder escanear." : "No se pudo abrir la cámara.";
    return show(err,true);
  }
  const v = $("#gVideo"); v.srcObject = cam.stream; await v.play().catch(()=>{});
  show($("#gScan"),true); show($("#gParar"),true); show($("#gIniciar"),false); show($("#gPermiso"),false);
  cam.on = true; bucleEscaneo();
}
function bucleEscaneo(){
  if(!cam.on) return;
  const v = $("#gVideo");
  if(v.readyState >= 2 && v.videoWidth){
    const c = $("#gCanvas"), ctx = c.getContext("2d", {willReadFrequently:true});
    const w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth);
    c.width = w; c.height = h; ctx.drawImage(v, 0, 0, w, h);
    const code = jsQR(ctx.getImageData(0,0,w,h).data, w, h, {inversionAttempts:"dontInvert"});
    if(code && code.data){
      detenerCamara();
      if(navigator.vibrate) navigator.vibrate(60);
      procesarQr(code.data); return;
    }
  }
  cam.raf = requestAnimationFrame(bucleEscaneo);
}
$("#gIniciar").onclick = () => iniciarCamara("normal");
$("#gPermiso").onclick = () => iniciarCamara("permiso");
$("#gParar").onclick = detenerCamara;

/** Muestra el resultado del escaneo. Sin botones propios, ofrece «Escanear siguiente». */
function resultado(tipo, icono, titulo, nombre, sub, botones){
  const r = $("#gRes"); r.className = "res " + tipo;
  $("#gIco").textContent = icono; $("#gTit").textContent = titulo; $("#gNom").textContent = nombre || ""; $("#gSub").textContent = sub || "";
  const acc = $("#gAcc");
  if(botones === null) acc.replaceChildren();                       // cargando: sin botones
  else if(botones && botones.length) acc.replaceChildren(...botones);
  else acc.replaceChildren(botonG("Escanear siguiente","primary big",iniciarCamara));
  show(r,true); r.scrollIntoView({block:"nearest", behavior:"smooth"});
}
function botonG(txt, cls, fn){ const b = mk("button","btn "+cls,txt); b.type = "button"; b.onclick = fn; return b; }
function anotarG(tipo, nombre, extra){
  gHist.unshift({tipo, nombre, extra, ts:Date.now()}); gHist.length = Math.min(gHist.length, 8); renderGHist();
}
function renderGHist(){
  const box = $("#gHistList"); box.replaceChildren(); show($("#gHist"), gHist.length>0);
  gHist.forEach(h=>{
    const row = mk("div","g-item");
    row.append(mk("span","pill "+(h.tipo==="ingreso"?"in":h.tipo==="salida"?"out":"rech"), h.tipo==="ingreso"?"Ingreso":h.tipo==="salida"?"Salida":"Rechazado"),
      mk("b",null,h.nombre), mk("span","muted num",fmtHora(h.ts)));
    if(h.extra) row.append(mk("span","muted",h.extra));
    box.append(row);
  });
}

async function procesarQr(texto){
  const partes = String(texto).split("|");
  if(partes.length !== 3 || partes[0] !== PREFIJO_QR){
    return resultado("bad","✕","Código no válido","","Este QR no pertenece al sistema de la empresa.");
  }
  const [, uid, token] = partes;
  resultado("","…","Verificando…","","",null);
  try{
    const s = await getDoc(doc(db,"empleados",uid));
    if(!s.exists() || !s.data().qr || s.data().qr !== token){
      anotarG("rechazado","QR inválido");
      return resultado("bad","✕","Código no válido","","El código no coincide con ningún empleado o fue reemplazado.");
    }
    const e = {id:s.id, ...s.data()};
    if(e.activo === false){
      anotarG("rechazado", e.nombre, "desactivado");
      return resultado("bad","✕","Empleado desactivado", e.nombre, "No puede ingresar ni salir. Informe al administrador.");
    }
    // Marcas de las últimas 20 h (solo ordena por hora: no necesita índice compuesto); se filtra por empleado aquí.
    const desde = Timestamp.fromMillis(Date.now() - 20*3600e3);
    const recientes = (await getDocs(query(collection(db,"marcas"), where("ts",">=",desde), orderBy("ts","desc"), limit(1000)))).docs.map(marcaDe);
    const ult = recientes.find(m => m.empleadoId === e.id);
    const dentro = !!ult && ult.tipo==="ingreso";
    // Escáner normal: ingreso o salida, sin permisos.
    if(cam.modo!=="permiso") return fichaPorteria({e, dentro});

    // Escáner de permisos: se busca un permiso aprobado hoy
    const hoy = ymd(new Date());
    const ps = (await getDocs(query(collection(db,"permisos"), where("empleadoId","==",e.id)))).docs
      .map(d=>{ const x = d.data({serverTimestamps:"estimate"}); return {id:d.id, ...x,
        resuelto: x.resuelto && x.resuelto.toMillis ? x.resuelto.toMillis() : 0}; })
      .filter(p => p.estado==="aprobado" || p.estado==="pendiente");
    const aprobado = ps.filter(p=>p.estado==="aprobado" && ymd(new Date(p.resuelto))===hoy).sort((x,y)=>x.resuelto-y.resuelto)[0] || null;
    const pend = ps.some(p=>p.estado==="pendiente");
    return permisoPorteria({e, dentro, aprobado, pend});
  }catch(err){
    resultado("bad","!","No se pudo verificar","",errText(err),[botonG("Escanear de nuevo","primary",iniciarCamara)]);
  }
}

/** Escáner normal: ficha del empleado; el celador elige ingreso o salida. */
function fichaPorteria(c){
  const {e, dentro} = c;
  const sub = (e.cargo ? e.cargo+" · " : "") + (dentro ? "Está dentro" : "Está fuera");
  resultado("", (e.nombre||"?")[0].toUpperCase(), "¿Qué desea registrar?", e.nombre, sub, [
    botonG("Registrar ingreso", dentro ? "" : "primary", ()=>registrarPorteria(e,"ingreso",null)),
    botonG("Registrar salida", dentro ? "primary" : "", ()=>registrarPorteria(e,"salida",null)),
    botonG("Cancelar","",limpiarResultado)
  ]);
}

/** Modo «salida con permiso»: solo deja salir si hay un permiso aprobado hoy. */
function permisoPorteria(c){
  const {e, dentro, aprobado, pend} = c;
  if(!aprobado){
    anotarG("rechazado", e.nombre, "sin permiso");
    return resultado("bad","✕","Sin permiso aprobado", e.nombre,
      pend ? "Tiene una solicitud pendiente: el administrador aún no la aprueba." : "No tiene un permiso aprobado para salir hoy.");
  }
  const det = aprobado.motivo + (aprobado.detalle ? " · " + aprobado.detalle : "");
  const botones = [botonG("Confirmar salida con permiso","primary",()=>registrarPorteria(e,"salida",aprobado)), botonG("Cancelar","",limpiarResultado)];
  if(!dentro) return resultado("warn","!","Figura fuera de la empresa", e.nombre, "Tiene permiso aprobado (" + det + "), pero no tiene un ingreso abierto.", botones);
  return resultado("ok","✓","Permiso aprobado", e.nombre, det, botones);
}

async function registrarPorteria(e, tipo, permiso){
  $("#gAcc").querySelectorAll("button").forEach(b=>b.disabled = true);
  try{
    const ref = doc(collection(db,"marcas"));
    const data = {
      empleadoId:e.id, nombre:e.nombre, cedula:String(e.cedula), cargo:e.cargo||"", tipo, ts:serverTimestamp(),
      motivo: tipo==="salida" ? (permiso ? permiso.motivo : "Fin de jornada") : "",
      detalle: tipo==="salida" && permiso ? (permiso.detalle||"") : "",
      firma:"", dispositivo:navigator.userAgent.slice(0,180), registradoPor:auth.currentUser.uid
    };
    const batch = writeBatch(db);
    batch.set(ref, data);
    if(permiso) batch.update(doc(db,"permisos",permiso.id), {estado:"usado", usadoEn:serverTimestamp()});
    await batch.commit();
    const hora = fmtHora(Date.now());
    if(tipo==="ingreso"){
      anotarG("ingreso", e.nombre);
      resultado("ok","→","Ingreso registrado", e.nombre, `${e.cargo ? e.cargo+" · " : ""}${hora}`);
    }else{
      anotarG("salida", e.nombre, permiso ? permiso.motivo : "fin de jornada");
      resultado("ok","←", permiso ? "Salida autorizada" : "Salida registrada", e.nombre,
        permiso ? `Permiso aprobado: ${permiso.motivo} · ${hora}` : `Fin de jornada · ${hora}`);
    }
  }catch(err){
    resultado("bad","!","No se pudo registrar", e.nombre, errText(err),
      [botonG("Reintentar","primary",()=>registrarPorteria(e,tipo,permiso)), botonG("Escanear otro","",iniciarCamara)]);
  }
}

vista("login");
