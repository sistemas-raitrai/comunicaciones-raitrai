const API_URL = "https://southamerica-west1-sist-op-rt.cloudfunctions.net/solicitudesAnulacionPublica";
const $ = id => document.getElementById(id);
const val = id => $(id).value.trim();
const state = { grupo: null, reto: "", session: null, busy: false, revisado: "", pending: null };
function mensaje(text, error = false) {
  $("estado").textContent = text;
  $("estado").className = `notice ${error ? "error" : ""}`;
  $("estado").focus({ preventScroll: true });
}
async function api(accion, payload = {}) {
  let r;
  try { r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, ...payload }) }); }
  catch { throw new Error("No pudimos conectar. Si estabas enviando, reintenta con los mismos datos para recuperar el folio sin duplicar la solicitud."); }
  let d; try { d = await r.json(); } catch { throw new Error("El servidor devolvió una respuesta inesperada. Reintenta."); }
  if (!r.ok || !d.ok) throw new Error(d.error || "No pudimos completar la operación.");
  return d;
}
async function accion(fn) {
  if (state.busy) return;
  state.busy = true;
  const buttons = [...document.querySelectorAll("button, #identificacion input")].map(b => [b, b.disabled]);
  buttons.forEach(([b]) => b.disabled = true);
  try { await fn(); } catch(e) { mensaje(e.message, true); }
  finally { state.busy = false; buttons.forEach(([b, disabled]) => b.disabled = disabled); $("pedirCodigo").disabled = !state.grupo; }
}
function rut(v) {
  const s = String(v).toUpperCase().replace(/[^0-9K]/g, "");
  if (!/^\d{7,8}[0-9K]$/.test(s)) return "";
  let sum = 0, m = 2; const n = s.slice(0, -1);
  for (let i = n.length - 1; i >= 0; i--) { sum += Number(n[i]) * m; m = m === 7 ? 2 : m + 1; }
  const d = 11 - sum % 11;
  return (d === 11 ? "0" : d === 10 ? "K" : String(d)) === s.slice(-1) ? `${n}-${s.slice(-1)}` : "";
}
function etiqueta(g) { return `${g.colegio} · ${g.curso} · ${g.anoViaje} · ${g.destino} · ID ${g.idGrupo}`; }
$("buscar").addEventListener("click", () => accion(async () => {
  const d = await api("consultarGrupo", { idGrupo: val("idGrupo") });
  state.grupo = d.grupo; $("grupoDetalle").textContent = etiqueta(d.grupo); $("grupoDetalle").classList.remove("hidden");
  mensaje("Confirma que este es el grupo correcto y solicita tu código.");
}));
for (const id of ["idGrupo", "rutPasajero", "correoVerificacion"]) $(id).addEventListener("input", () => {
  state.reto = ""; $("codigoBloque").classList.add("hidden");
  if (id === "idGrupo") { state.grupo = null; $("grupoDetalle").classList.add("hidden"); $("pedirCodigo").disabled = true; }
});
$("pedirCodigo").addEventListener("click", () => accion(async () => {
  if (!state.grupo) throw new Error("Consulta y confirma el grupo.");
  if (!rut(val("rutPasajero"))) throw new Error("Revisa el RUT de la persona que viaja.");
  if (!val("correoVerificacion") || !$("correoVerificacion").reportValidity()) throw new Error("Revisa el correo registrado.");
  const d = await api("iniciarVerificacion", { idGrupo: state.grupo.groupDocId, rutPasajero: rut(val("rutPasajero")), correo: val("correoVerificacion") });
  state.reto = d.verificacionId; $("codigo").value = ""; $("codigoBloque").classList.remove("hidden"); mensaje(d.mensaje);
}));
$("verificar").addEventListener("click", () => accion(async () => {
  if (!state.reto) throw new Error("Solicita primero un código.");
  const d = await api("verificarCodigo", { verificacionId: state.reto, codigo: val("codigo") });
  state.session = d;
  $("viaje").textContent = `${etiqueta(d.grupo)}\nPasajero: ${d.pasajero.nombre} · RUT ${d.pasajero.rut}`;
  $("correo").value = d.correo;
  $("condiciones").replaceChildren();
  for (const text of d.condiciones) { const p = document.createElement("p"); p.textContent = text; $("condiciones").append(p); }
  $("declaraciones").replaceChildren();
  for (const [key, text] of Object.entries(d.declaraciones)) {
    const label = document.createElement("label"); label.className = "check";
    const check = document.createElement("input"); check.type = "checkbox"; check.id = `decl_${key}`; check.required = true;
    const span = document.createElement("span"); span.textContent = text;
    label.append(check, span); $("declaraciones").append(label);
  }
  $("identificacion").classList.add("hidden"); $("solicitud").classList.remove("hidden");
  mensaje("Correo verificado. Completa los datos y revisa la solicitud antes de enviarla.");
  $("solicitud").scrollIntoView({ behavior: "smooth" });
}));
$("usarDatos").addEventListener("click", () => { $("nombreTitular").value = val("nombre"); $("rutTitular").value = val("rutSolicitante"); invalidarRevision(); });
function datos() {
  const declarations = Object.fromEntries(Object.keys(state.session.declaraciones).map(k => [k, $(`decl_${k}`).checked]));
  return { sessionToken: state.session.sessionToken, version: state.session.version,
    solicitante: { nombre: val("nombre"), rut: rut(val("rutSolicitante")), relacion: val("relacion"), telefono: val("telefono"), correo: val("correo") },
    transferencia: { nombreTitular: val("nombreTitular"), rutTitular: rut(val("rutTitular")), banco: val("banco"), tipoCuenta: val("tipoCuenta"), numeroCuenta: val("numeroCuenta") },
    motivo: val("motivo"), detalle: val("detalle"), declaraciones: declarations };
}
function validar() {
  if (!state.session) throw new Error("Primero verifica tu correo.");
  if (!$("solicitud").reportValidity()) throw new Error("Completa todos los campos y declaraciones obligatorias.");
  const d = datos();
  if (!d.solicitante.rut || !d.transferencia.rutTitular) throw new Error("Revisa los RUT del solicitante y del titular.");
  const normal = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
  if (d.solicitante.rut !== d.transferencia.rutTitular || normal(d.solicitante.nombre) !== normal(d.transferencia.nombreTitular)) throw new Error("La cuenta bancaria debe estar a nombre del solicitante.");
  const files = [...$("adjuntos").files];
  if (files.length > 3 || files.some(f => f.size > 600 * 1024 || !["application/pdf", "image/png", "image/jpeg"].includes(f.type))) throw new Error("Adjunta como máximo tres PDF, JPG o PNG de hasta 600 KB cada uno.");
  return d;
}
function invalidarRevision() {
  state.revisado = ""; $("revision").classList.add("hidden");
}
$("solicitud").addEventListener("input", invalidarRevision);
$("solicitud").addEventListener("change", invalidarRevision);
$("revisar").addEventListener("click", () => {
  try {
    const d = validar(); state.revisado = JSON.stringify(d);
    $("resumen").textContent = [etiqueta(state.session.grupo),
      `Pasajero: ${state.session.pasajero.nombre} · ${state.session.pasajero.rut}`,
      `Solicitante: ${d.solicitante.nombre} · ${d.solicitante.rut} · ${$("relacion").selectedOptions[0].textContent}`,
      `Contacto: ${d.solicitante.telefono} · ${d.solicitante.correo}`,
      `Titular: ${d.transferencia.nombreTitular} · ${d.transferencia.rutTitular}`,
      `Banco: ${d.transferencia.banco} · ${$("tipoCuenta").selectedOptions[0].textContent} · Cuenta ${d.transferencia.numeroCuenta}`,
      `Motivo: ${$("motivo").selectedOptions[0].textContent}`, d.detalle,
      `Adjuntos: ${[...$("adjuntos").files].map(f => f.name).join(", ") || "Ninguno"}`].join("\n\n");
    $("revision").classList.remove("hidden"); $("revision").scrollIntoView({ behavior: "smooth" });
  } catch(e) { mensaje(e.message, true); }
});
function leerArchivo(f) {
  return new Promise((resolve, reject) => {
    const r = new FileReader(); r.onerror = () => reject(new Error("No pudimos leer el archivo."));
    r.onload = () => resolve({ nombre: f.name, tipo: f.type, base64: String(r.result).split(",")[1] }); r.readAsDataURL(f);
  });
}
$("solicitud").addEventListener("submit", event => {
  event.preventDefault();
  accion(async () => {
    const d = validar();
    if (JSON.stringify(d) !== state.revisado) throw new Error("Revisa nuevamente tus datos antes de enviar.");
    // Copia completa en memoria para que un fallo de conexión permita reintentar.
    state.pending = { ...d, adjuntos: await Promise.all([...$("adjuntos").files].map(leerArchivo)) };
    $("campos").disabled = true; mensaje("Registrando tu solicitud. Espera la confirmación con el folio.");
    try {
      const result = await api("registrarSolicitud", state.pending);
      $("solicitud").classList.add("hidden"); $("confirmacion").classList.remove("hidden");
      $("recibo").textContent = `${result.yaExistia ? "Ya existía una solicitud recibida para este pasajero.\n" : ""}Folio: ${result.folio}\nRecepción: ${new Date(result.recibidoEn).toLocaleString("es-CL", { timeZone: "America/Santiago" })} (Chile)`;
      state.pending = null; state.session = null;
      $("solicitud").reset(); $("adjuntos").value = "";
      $("estado").classList.add("hidden"); $("confirmacion").focus();
    } finally { $("campos").disabled = false; }
  });
});
