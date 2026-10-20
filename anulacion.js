const API_URL = "https://southamerica-west1-sist-op-rt.cloudfunctions.net/solicitudesAnulacionPublica";
const $ = id => document.getElementById(id);
const val = id => $(id).value.trim();
const state = { grupo: null, reto: "", session: null, busy: false, revisado: "", pending: null, seleccionCorreo: "" };
function mensaje(text, error = false, enfocar = true) {
  $("estado").textContent = text;
  $("estado").className = `notice ${error ? "error" : ""}`;
  if (enfocar) $("estado").focus({ preventScroll: true });
}
async function api(accion, payload = {}) {
  let r;
  try { r = await fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion, ...payload }) }); }
  catch { throw new Error("No pudimos conectar. Si estabas enviando, reintenta con los mismos datos para recuperar el folio sin duplicar la solicitud."); }
  let d; try { d = await r.json(); } catch { throw new Error("El servidor devolvió una respuesta inesperada. Reintenta."); }
  if (!r.ok || !d.ok) { const e = new Error(d.error || "No pudimos completar la operación."); e.campo = d.campo || ""; throw e; }
  return d;
}
async function accion(fn) {
  if (state.busy) return;
  state.busy = true;
  const buttons = [...document.querySelectorAll("button, #identificacion input, #identificacion select")].map(b => [b, b.disabled]);
  buttons.forEach(([b]) => b.disabled = true);
  let error;
  try { await fn(); } catch(e) { error = e; }
  finally { state.busy = false; buttons.forEach(([b, disabled]) => b.disabled = disabled); $("pedirCodigo").disabled = !state.grupo; }
  if (error) presentarError(error);
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
function limpiarGrupoSeleccionado() {
  state.grupo = null;
  reiniciarVerificacion();
  $("grupoDetalle").textContent = "";
  $("grupoDetalle").classList.add("hidden");
  $("codigoBloque").classList.add("hidden");
  $("codigo").value = "";
  $("pedirCodigo").disabled = true;
}
function seleccionarGrupo(grupo) {
  if (state.busy) return;
  limpiarGrupoSeleccionado();
  state.grupo = grupo;
  $("grupoDetalle").textContent = `Grupo seleccionado: ${etiqueta(grupo)}`;
  $("grupoDetalle").classList.remove("hidden");
  $("grupoResultados").replaceChildren();
  $("pedirCodigo").disabled = false;
  mensaje("Grupo seleccionado. Ingresa el RUT de la persona que viaja, con guion y dígito verificador.");
  $("rutPasajero").focus();
}
async function buscarGrupos() {
  await accion(async () => {
    limpiarGrupoSeleccionado();
    const resultados = $("grupoResultados");
    resultados.replaceChildren();
    const query = val("idGrupo");
    if (query.length < 2) throw new Error("Escribe al menos dos letras del colegio o el ID del grupo.");
    const year = val("anoBusqueda");
    if (year && !$("anoBusqueda").checkValidity()) errorCampo("anoBusqueda", "El año debe ser el actual o uno futuro; déjalo vacío para buscar en todos los años habilitados.");
    mensaje("Buscando grupos. La primera consulta puede tardar unos segundos.");
    const d = await api("buscarGrupos", { busqueda: query, anoViaje: year });
    if (!Array.isArray(d.grupos)) throw new Error("No pudimos interpretar los resultados. Intenta nuevamente.");
    if (!d.grupos.length) {
      resultados.textContent = "No encontramos coincidencias. Prueba con una parte del nombre del colegio o revisa el año ingresado.";
      mensaje("No encontramos grupos con esa búsqueda.");
      return;
    }
    const aviso = document.createElement("p");
    aviso.textContent = d.hayMas
      ? "Hay más de 25 coincidencias. Se muestran las primeras 25. Agrega curso o año para acotar la búsqueda y selecciona tu grupo."
      : "Selecciona tu grupo y comprueba el curso y año del viaje:";
    resultados.append(aviso);
    for (const grupo of d.grupos) {
      const boton = document.createElement("button");
      boton.type = "button";
      boton.className = "resultado-grupo";
      boton.textContent = etiqueta(grupo);
      boton.addEventListener("click", () => seleccionarGrupo(grupo));
      resultados.append(boton);
    }
    mensaje("Selecciona el grupo correcto entre los resultados.");
  });
}
$("buscar").addEventListener("click", buscarGrupos);
for (const id of ["idGrupo", "anoBusqueda"]) {
  $(id).addEventListener("input", () => {
    limpiarGrupoSeleccionado();
    $("grupoResultados").replaceChildren();
  });
  $(id).addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); buscarGrupos(); }
  });
}
function reiniciarVerificacion() {
  state.reto = "";
  state.seleccionCorreo = "";
  $("codigoBloque").classList.add("hidden");
  $("destinosCorreo").replaceChildren(); $("destinosCorreo").classList.add("hidden");
  $("avisoCorreo").textContent = ""; $("avisoCorreo").classList.add("hidden");
  $("codigo").value = "";
}
function mostrarRetoCorreo(d) {
  state.reto = d.verificacionId;
  $("destinosCorreo").classList.add("hidden");
  $("avisoCorreo").textContent = d.mensaje;
  $("avisoCorreo").classList.remove("hidden");
  $("codigo").value = "";
  $("codigoBloque").classList.remove("hidden");
  mensaje(d.mensaje, false, false);
}
$("rutPasajero").addEventListener("input", () => { reiniciarVerificacion(); limpiarErrorCampo("rutPasajero"); });
$("pedirCodigo").addEventListener("click", () => accion(async () => {
  if (!state.grupo) errorCampo("idGrupo", "Busca y selecciona tu grupo antes de continuar.");
  if (!rutConGuion(val("rutPasajero"))) errorCampo("rutPasajero", "Ingresa el RUT de la persona que viaja con guion y dígito verificador, por ejemplo 12345678-5.");
  if (!rut(val("rutPasajero"))) errorCampo("rutPasajero", "El dígito verificador del RUT no es correcto. Compruébalo antes de continuar.");
  limpiarErrorCampo("rutPasajero");
  reiniciarVerificacion();
  const d = await api("prepararVerificacion", { idGrupo: state.grupo.groupDocId, rutPasajero: rut(val("rutPasajero")) });
  if (d.verificacionId) { mostrarRetoCorreo(d); return; }
  if (!d.seleccionId || !Array.isArray(d.destinos) || !d.destinos.length) throw new Error("No encontramos un correo disponible. Contacta a anulaciones@raitrai.cl.");
  state.seleccionCorreo = d.seleccionId;
  const box = $("destinosCorreo"); box.replaceChildren(); box.classList.remove("hidden");
  const p = document.createElement("p"); p.textContent = d.mensaje; box.append(p);
  for (const destino of d.destinos) {
    const boton = document.createElement("button"); boton.type = "button"; boton.className = "resultado-grupo";
    boton.textContent = `Enviar código a ${destino.correoOculto}`;
    boton.addEventListener("click", () => accion(async () => {
      const result = await api("enviarCodigoSeleccionado", { seleccionId: state.seleccionCorreo, destino: destino.id });
      mostrarRetoCorreo(result);
    }));
    box.append(boton);
  }
  mensaje(d.mensaje, false, false);
}));
$("rutPasajero").addEventListener("keydown", event => {
  if (event.key === "Enter") { event.preventDefault(); if (!state.busy) $("pedirCodigo").click(); }
});
$("verificar").addEventListener("click", () => accion(async () => {
  if (!state.reto) errorCampo("rutPasajero", "Consulta el RUT para solicitar un código al correo registrado.");
  if (!/^\d{6}$/.test(val("codigo"))) errorCampo("codigo", "Ingresa los seis dígitos del código recibido por correo.");
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
function rutConGuion(value) {
  return /^\d{7,8}-[0-9kK]$/.test(String(value || "").trim().replace(/\./g, ""));
}
function limpiarErrorCampo(id) {
  const campo = $(id);
  if (!campo) return;
  campo.removeAttribute("aria-invalid");
  const errorId = `error_${id}`;
  $(errorId)?.remove();
  const described = (campo.getAttribute("aria-describedby") || "").split(/\s+/).filter(v => v && v !== errorId);
  if (described.length) campo.setAttribute("aria-describedby", described.join(" "));
  else campo.removeAttribute("aria-describedby");
  for (const item of $("erroresFormulario").querySelectorAll("[data-error-campo]")) {
    if (item.dataset.errorCampo === id) item.remove();
  }
  if (!$("erroresFormulario").querySelector("[data-error-campo]")) $("erroresFormulario").classList.add("hidden");
}
function limpiarErrores() {
  for (const el of document.querySelectorAll('[aria-invalid="true"]')) limpiarErrorCampo(el.id);
  $("erroresFormulario").replaceChildren();
  $("erroresFormulario").classList.add("hidden");
}
function marcarError(id, texto) {
  const el = $(id);
  if (!el) return;
  limpiarErrorCampo(id);
  el.setAttribute("aria-invalid", "true");
  const error = document.createElement("p"); error.id = `error_${id}`; error.className = "campo-error"; error.textContent = texto;
  const anchor = el.type === "checkbox" ? el.closest("label") : el;
  anchor.after(error);
  el.setAttribute("aria-describedby", [el.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
}
function enfocarCampo(id) {
  const el = $(id); if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus({ preventScroll: true });
}
function errorCampo(id, texto) { const e = new Error(texto); e.campo = id; throw e; }
function presentarError(e) {
  mensaje(e.message, true, false);
  if (e.errores) {
    const box = $("erroresFormulario"); box.replaceChildren();
    const intro = document.createElement("p"); intro.textContent = "Revisa lo siguiente para continuar:"; box.append(intro);
    const lista = document.createElement("ul");
    for (const item of e.errores) {
      marcarError(item.id, item.texto);
      const li = document.createElement("li"); li.dataset.errorCampo = item.id;
      const link = document.createElement("a"); link.href = `#${item.id}`; link.textContent = item.texto;
      link.addEventListener("click", event => { event.preventDefault(); enfocarCampo(item.id); });
      li.append(link); lista.append(li);
    }
    box.append(lista); box.classList.remove("hidden"); enfocarCampo(e.errores[0].id);
  } else if (e.campo && $(e.campo)) { marcarError(e.campo, e.message); enfocarCampo(e.campo); }
  else $("estado").scrollIntoView({ behavior: "smooth", block: "center" });
}
function erroresDatosFormulario() {
  const errores = new Map();
  const add = (id, texto) => { if (!errores.has(id)) errores.set(id, { id, texto }); };
  for (const el of $("solicitud").querySelectorAll("input, select, textarea")) {
    if (el.disabled || el.type === "file" || !el.id) continue;
    const label = document.querySelector(`label[for="${el.id}"]`);
    const nombre = (label?.textContent || el.id).replace(/\s*\*\s*$/, "").trim();
    const value = String(el.value || "").trim();
    if (el.type === "checkbox") {
      if (el.required && !el.checked) {
        const textos = { solicita: "Debes confirmar que solicitas formalmente la anulación.", representa: "Debes aceptar la declaración de representación y veracidad de los datos.", transferencia: "Debes aceptar la declaración de titularidad y uso de la cuenta bancaria.", tratamiento: "Debes autorizar el uso de los datos para tramitar la solicitud." };
        add(el.id, textos[el.id.replace("decl_", "")] || "Debes aceptar esta declaración para continuar.");
      }
      continue;
    }
    if (el.required && !value) { add(el.id, `Completa ${nombre.toLowerCase()}.`); continue; }
    const min = Number(el.getAttribute("minlength") || 0);
    if (min && value.length < min) add(el.id, `${nombre}: escribe al menos ${min} caracteres; llevas ${value.length}.`);
    const max = Number(el.getAttribute("maxlength") || 0);
    if (max && value.length > max) add(el.id, `${nombre}: usa como máximo ${max} caracteres.`);
    if (el.validity.typeMismatch) add(el.id, `${nombre}: ingresa un correo válido, por ejemplo nombre@gmail.com.`);
    if (el.validity.patternMismatch) add(el.id, el.id === "telefono"
      ? "Celular: ingresa +569 seguido de ocho dígitos, por ejemplo +56912345678."
      : el.id === "numeroCuenta" ? "Número de cuenta: ingresa entre 3 y 30 dígitos, sin puntos, espacios ni guiones."
      : `Revisa el formato de ${nombre.toLowerCase()}.`);
  }
  for (const [id, nombre] of [["rutSolicitante", "RUT del solicitante"], ["rutTitular", "RUT del titular"]]) {
    if (val(id) && !rutConGuion(val(id))) add(id, `${nombre}: usa guion y dígito verificador, por ejemplo 12345678-5.`);
    else if (val(id) && !rut(val(id))) add(id, `${nombre}: el dígito verificador no es correcto.`);
  }
  const normal = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLowerCase();
  if (rut(val("rutSolicitante")) && rut(val("rutTitular")) && rut(val("rutSolicitante")) !== rut(val("rutTitular"))) add("rutTitular", "La cuenta debe pertenecer al solicitante: el RUT del titular debe ser igual al del solicitante.");
  if (val("nombre") && val("nombreTitular") && normal(val("nombre")) !== normal(val("nombreTitular"))) add("nombreTitular", "El nombre del titular debe coincidir con el del solicitante. Puedes usar el botón Usar mis datos como titular.");
  const files = [...$("adjuntos").files];
  if (files.length > 3) add("adjuntos", "Puedes adjuntar como máximo tres archivos. Retira los adicionales.");
  for (const f of files) {
    if (f.size > 600 * 1024) add("adjuntos", `El archivo ${f.name} pesa más de 600 KB. Reduce su tamaño antes de adjuntarlo.`);
    if (!["application/pdf", "image/png", "image/jpeg"].includes(f.type)) add("adjuntos", `El archivo ${f.name} no es PDF, JPG ni PNG. Usa uno de esos formatos.`);
  }
  return [...errores.values()];
}
function validar() {
  if (!state.session) throw new Error("Primero verifica tu correo.");
  limpiarErrores();
  const errores = erroresDatosFormulario();
  if (errores.length) {
    const e = new Error(errores[0].texto); e.errores = errores; throw e;
  }
  return datos();
}

function invalidarRevision() {
  state.revisado = ""; $("revision").classList.add("hidden");
}
$("solicitud").addEventListener("input", event => { invalidarRevision(); if (event.target.id) limpiarErrorCampo(event.target.id); });
$("solicitud").addEventListener("change", event => { invalidarRevision(); if (event.target.id) limpiarErrorCampo(event.target.id); });
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
  } catch(e) { presentarError(e); }
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
    // Congelar los campos mientras se leen adjuntos y se registra la solicitud.
    $("campos").disabled = true;
    try {
      state.pending = { ...d, adjuntos: await Promise.all([...$("adjuntos").files].map(leerArchivo)) };
      mensaje("Registrando tu solicitud. Espera la confirmación con el folio.");
      const result = await api("registrarSolicitud", state.pending);
      $("solicitud").classList.add("hidden"); $("confirmacion").classList.remove("hidden");
      $("recibo").textContent = `${result.yaExistia ? "Ya existía una solicitud recibida para este pasajero.\n" : ""}Folio: ${result.folio}\nRecepción: ${new Date(result.recibidoEn).toLocaleString("es-CL", { timeZone: "America/Santiago" })} (Chile)`;
      state.pending = null; state.session = null;
      $("solicitud").reset(); $("adjuntos").value = "";
      $("estado").classList.add("hidden"); $("confirmacion").focus();
    } finally { $("campos").disabled = false; }
  });
});

const anoMinimo = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Santiago", year: "numeric" }).format(new Date()));
$("anoBusqueda").min = String(anoMinimo);
for (const id of ["rutPasajero", "rutSolicitante", "rutTitular"]) $(id).addEventListener("blur", () => {
  const normal = rut(val(id)); if (normal && rutConGuion(val(id))) $(id).value = normal;
});
$("codigo").addEventListener("input", () => limpiarErrorCampo("codigo"));
