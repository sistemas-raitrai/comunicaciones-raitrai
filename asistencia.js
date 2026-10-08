import {
  PORTAL_CONFIG
} from "./config.js";

const $ = (id) =>
  document.getElementById(id);

const state = {
  sessionToken:
    "",

  activeGroup:
    null,

  asistencia:
    null,

  pasajeros:
    [],

  leidos:
    new Map(),

  ubicacion:
    null,

  reading:
    false,

  processing:
    false,

  /*
    Cola de lecturas NFC.

    Esto permite que Android pueda seguir
    capturando pulseras aunque la anterior
    todavía esté viajando al servidor.
  */
  colaCodigos:
    [],

  procesandoCola:
    false,

  ndef:
    null,

  controller:
    null,

  ultimoCodigo:
    "",

  ultimaLecturaAt:
    0
};

init();

async function init() {
  const canonical = new URL(PORTAL_CONFIG.portalUrl);
  if (location.origin !== canonical.origin) {
    location.replace(new URL(location.pathname + location.search, canonical.origin).href);
    return;
  }
  $("cargandoListaPanel")?.classList.remove("hidden");
  $("asistenciaPanel")?.classList.add("hidden");
  mostrarAvisoIphone();
  let etapa = "preparar pantalla";
  try {
    bindEvents();
    prepararEventosAusencias();
    comprobarNfc();
    state.sessionToken = localStorage.getItem(PORTAL_CONFIG.sessionTokenKey) || "";
    if (!state.sessionToken) return mostrarSinSesion("Ingresa al grupo desde este navegador en navegación normal.");
    localStorage.setItem(PORTAL_CONFIG.modeKey, "asistencia");
    localStorage.setItem("raitrai_nfc_intencion_v2", "asistencia");
    etapa = "validar sesión";
    const response = await callApiSession("estadoSesion", {});
    state.activeGroup = response.grupo;
    localStorage.setItem(PORTAL_CONFIG.activeGroupKey, JSON.stringify(response.grupo));
    renderGrupo();
    etapa = "consultar lista abierta";
    await cargarOCrearAsistencia();
    $("sinSesionPanel")?.classList.add("hidden");
    $("asistenciaPanel")?.classList.remove("hidden");
    etapa = "registrar pulsera";
    await procesarNfcDesdeUrl();
    void cargarHistorialAsistencias();
    iniciarSincronizacionCompartida();
  } catch (error) {
    console.error("[asistencia]", etapa, error);
    $("sinSesionPanel")?.querySelector("h2") &&
      ($("sinSesionPanel").querySelector("h2").textContent = "No fue posible cargar");
    mostrarSinSesion(`${etapa} · ${error.status ? "HTTP " + error.status : "Sin código HTTP"}: ${error.message}`);
  } finally {
    $("cargandoListaPanel")?.classList.add("hidden");
  }
}

function bindEvents() {
  $("btnIrLogin")
    ?.addEventListener(
      "click",
      volverAlLector
    );

  $("btnVolverLector")
    ?.addEventListener(
      "click",
      volverAlLector
    );

  $("btnVolverFinal")
    ?.addEventListener(
      "click",
      volverAlLector
    );

  $("btnNuevaLista")?.addEventListener("click", () => {
    $("finalizadaPanel")?.classList.add("hidden");
    $("asistenciaPanel")?.classList.add("hidden");
    $("cargandoListaPanel")?.classList.remove("hidden");
    void cargarOCrearAsistencia().then(() => {
      $("asistenciaPanel")?.classList.remove("hidden");
    }).catch((error) => mostrarSinSesion(error.message)).finally(() => {
      $("cargandoListaPanel")?.classList.add("hidden");
    });
  });
  $("btnEmpezarLista")?.addEventListener("click", () => void crearNuevaAsistencia());

  $("btnIniciarLectura")
    ?.addEventListener(
      "click",
      iniciarLecturaContinua
    );

  $("btnDetenerLectura")
    ?.addEventListener(
      "click",
      detenerLectura
    );

  $("btnFinalizar")
    ?.addEventListener(
      "click",
      finalizarAsistencia
    );

  $("btnToggleManual")
    ?.addEventListener(
      "click",
      toggleManual
    );

  $("btnProcesarManual")
    ?.addEventListener(
      "click",
      procesarManual
    );

  $("codigoManualInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          procesarManual();
        }
      }
    );
}

function volverAlLector() {
  detenerLectura();

  /*
    Salimos expresamente del modo asistencia.
  */
  localStorage.removeItem(
    PORTAL_CONFIG.attendanceModeKey
  );

  localStorage.setItem(
    PORTAL_CONFIG.modeKey,
    "ficha_medica"
  );

  window.location.href =
    "index.html";
}

function mostrarSinSesion(
  mensaje =
    "Debes ingresar primero al lector de pulseras."
) {
  $("asistenciaPanel")
    ?.classList
    .add("hidden");

  $("finalizadaPanel")
    ?.classList
    .add("hidden");

  $("sinSesionPanel")
    ?.classList
    .remove("hidden");

  /*
    No necesitamos modificar el HTML.

    Buscamos directamente el texto descriptivo
    que ya existe dentro del panel.
  */

  const texto =
    $("sinSesionPanel")
      ?.querySelector(
        ".section-copy"
      );

  if (texto) {
    texto.textContent =
      mensaje;
  }
}

function renderGrupo() {
  const group =
    state.activeGroup ||
    {};

  $("grupoTitulo")
    .textContent =
    group.nombre ||
    group.colegio ||
    `Grupo ${group.idGrupo || ""}`;

  $("grupoDetalle")
    .textContent =
    [
      group.idGrupo
        ? `ID ${group.idGrupo}`
        : "",
      group.colegio,
      group.curso,
      group.destino,
      group.anoViaje
    ]
      .filter(Boolean)
      .join(" · ") ||
    "Grupo activo";
}

async function cargarOCrearAsistencia() {
  const response = await callApiSession("estadoAsistencia", {});
  if (response.asistencia?.estado === "ACTIVA") {
    aplicarListaCompartida(response);
    return true;
  }
  state.listaAnteriorId = response.listaAnteriorId || "";
  state.ausenciasAnteriores = response.ausenciasAnteriores || [];
  state.revisionAusencias = new Map();
  mostrarPreparacionLista();
  renderRevisionAnterior();
  return false;
}

async function crearNuevaAsistencia() {
  if (state.iniciandoLista || state.cerrandoLista) return false;
  const nombre = String($("nombreListaInput")?.value || "").trim();
  if (!nombre) {
    mostrarPreparacionLista();
    $("nombreListaInput")?.focus();
    setState("estadoLectura", "Escribe un nombre para empezar la lista.", true);
    return false;
  }
  state.iniciandoLista = true;
  setDisabled("btnEmpezarLista", true);
  try {
    const anteriores = state.ausenciasAnteriores || [];
    if (anteriores.some((p) => !state.revisionAusencias?.has(p.inscripcionId))) {
      setState("estadoLectura", "Revisa si cada persona sigue ausente o ya se reincorporó.", true);
      return false;
    }
    const response = await callApiSession("crearAsistencia", { nombre,
      listaAnteriorId: state.listaAnteriorId || "",
      revisionAusencias: [...(state.revisionAusencias || new Map()).values()] });
    aplicarListaCompartida(response);
    $("finalizadaPanel")?.classList.add("hidden");
    $("asistenciaPanel")?.classList.remove("hidden");
    setState("estadoLectura", response.reutilizada
      ? "Te incorporaste a la lista abierta del grupo."
      : "Lista abierta. Ya puedes leer pulseras.", false, true);
    return true;
  } catch (error) {
    setState("estadoLectura", error.message, true);
    return false;
  } finally {
    state.iniciandoLista = false;
    setDisabled("btnEmpezarLista", false);
  }
}

async function restaurarAsistencia(asistenciaId) {
  const response = await callApiSession("estadoAsistencia", { asistenciaId });
  if (response.asistencia?.estado !== "ACTIVA") return false;
  aplicarListaCompartida(response);
  return true;
}

function renderAsistencia() {
  if ($("listaActivaNombre")) $("listaActivaNombre").textContent = state.asistencia?.nombre || "";
  if (
    state.asistencia?.modalidad ===
    "grupal"
  ) {
    renderAsistenciaGrupal();
    return;
  }

  renderAsistenciaIndividual();
}

function renderAsistenciaGrupal() {
  const total =
    Number(
      state.asistencia
        ?.totalEsperado ||
      0
    );

  const registrada =
    state.asistencia
      ?.grupoRegistrado ===
    true;

  $("contadorPrincipal")
    .textContent =
    registrada
      ? "GRUPO REGISTRADO"
      : `${total} PASAJEROS`;

  $("contadorDetalle")
    .textContent =
    registrada
      ? `Pulsera grupal registrada · ${total} pasajeros asociados`
      : "Lee la pulsera grupal para registrar la asistencia.";

  $("resumenAsistencia")
    .innerHTML = `
      <div class="info-section">
        <h3>
          Modalidad grupal
        </h3>

        <div class="empty-box">
          ${
            registrada
              ? `✓ La pulsera grupal ya fue leída. Total asociado al grupo: ${total}.`
              : `Este grupo utiliza una sola pulsera grupal. No se registran pasajeros individualmente.`
          }
        </div>
      </div>
    `;
}

function renderAsistenciaIndividual() {
  const total =
    Number(
      state.asistencia
        ?.totalEsperado ||
      state.pasajeros.length ||
      0
    );

  /*
    No permitimos que un total viejo
    devuelto por Firestore haga retroceder
    el contador mostrado.
  */

  const totalLeidos =
    Math.max(
      state.leidos.size,

      Number(
        state.asistencia
          ?.totalLeidos ||
        0
      )
    );

  if (
    state.asistencia
  ) {
    state.asistencia.totalLeidos =
      totalLeidos;
  }

  $("contadorPrincipal")
    .textContent =
    `${totalLeidos} / ${total}`;

  $("contadorDetalle")
    .textContent =
    `${Math.max(
      0,
      total - totalLeidos
    )} pendiente(s)`;

  const idsLeidos =
    new Set(
      state.leidos.keys()
    );

  const presentes =
    state.pasajeros
      .filter(
        (item) =>
          idsLeidos.has(
            item.inscripcionId
          )
      );

  const pendientes =
    state.pasajeros
      .filter(
        (item) =>
          !idsLeidos.has(
            item.inscripcionId
          )
      );

  $("resumenAsistencia")
    .innerHTML = `
      <div class="info-section">
        <h3>
          Leídos (${Math.max(
            presentes.length,
            totalLeidos
          )})
        </h3>

        ${
          presentes.length
            ? `
              <div class="passenger-list">
                ${presentes
                  .map(
                    (item) => `
                      <div class="passenger-row">
                        <span>
                          <strong>
                            ✓ ${esc(
                              item.nombreCompleto ||
                              "Sin nombre"
                            )}
                          </strong>

                          <span>
                            ${esc(
                              item.documento ||
                              ""
                            )}
                          </span>
                        </span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="empty-box">
                Todavía no hay pasajeros registrados.
              </div>
            `
        }
      </div>

      <div class="info-section">
        <h3>
          Pendientes (${Math.max(
            0,
            total - totalLeidos
          )})
        </h3>

        ${
          pendientes.length
            ? `
              <div class="passenger-list">
                ${pendientes
                  .map(
                    (item) => `
                      <div class="passenger-row">
                        <span>
                          <strong>
                            ${esc(
                              item.nombreCompleto ||
                              "Sin nombre"
                            )}
                          </strong>

                          <span>
                            ${esc(
                              item.documento ||
                              ""
                            )}
                          </span>
                          ${(() => { const j = (state.ausentes || []).find((p) => p.inscripcionId === item.inscripcionId); return j?.motivo ? `<span class="ausencia-detalle">${esc(j.motivo)}${j.detalle ? ": " + esc(j.detalle) : ""}</span>` : ""; })()}
                        </span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            `
            : `
              <div class="empty-box">
                ✓ Todos los pasajeros fueron registrados.
              </div>
            `
        }
      </div>
    `;
}

function encolarCodigoAsistencia(
  codigoRaw
) {
  if (state.cerrandoLista || state.asistencia?.estado !== "ACTIVA") return;
  const codigo =
    sanitizeCode(
      codigoRaw
    );

  if (!codigo) {
    return;
  }

  /*
    Evitamos que el mismo evento NFC
    se agregue varias veces seguidas
    mientras la pulsera sigue apoyada.
  */

  const ultimoEnCola =
    state.colaCodigos[
      state.colaCodigos.length - 1
    ];

  if (
    ultimoEnCola ===
    codigo
  ) {
    return;
  }

  state.colaCodigos.push(
    codigo
  );

  /*
    No esperamos aquí.

    Web NFC puede seguir capturando
    nuevas pulseras inmediatamente.
  */

  void procesarColaAsistencia();
}

async function procesarColaAsistencia() {
  if (
    state.procesandoCola
  ) {
    return;
  }

  state.procesandoCola =
    true;

  try {
    while (
      state.colaCodigos.length
    ) {
      const codigo =
        state.colaCodigos.shift();

      await registrarCodigo(
        codigo
      );
    }
  } finally {
    state.procesandoCola =
      false;
  }
}

async function registrarCodigo(
  codigoRaw
) {
  if (state.asistencia?.estado !== "ACTIVA") return;
  if (
    !state.asistencia?.id
  ) {
    return;
  }

  const codigo =
    sanitizeCode(
      codigoRaw
    );

  if (!codigo) {
    return;
  }

  /*
    Evita rebote de la misma pulsera
    mientras permanece físicamente apoyada.
  */

  const ahora =
    Date.now();

  if (
    codigo ===
      state.ultimoCodigo &&
    ahora -
      state.ultimaLecturaAt <
      1200
  ) {
    return;
  }

  state.ultimoCodigo =
    codigo;

  state.ultimaLecturaAt =
    ahora;

  state.processing =
    true;

  setState(
    "estadoLectura",
    `Registrando ${codigo}...`
  );

  try {
    /*
      =========================================================
      CAMINO RÁPIDO
      =========================================================

      Ya NO pedimos una ubicación nueva antes
      de registrar cada pulsera.

      Usamos la última ubicación disponible.
    */

    const ubicacion =
      state.ubicacion ||
      null;

    const listaIdEnviada = state.asistencia.id;
    const response =
      await callApiSession(
        "registrarAsistencia",
        {
          asistenciaId:
            state.asistencia.id,

          codigo,

          ubicacion
        }
      );

    if (state.asistencia?.id !== listaIdEnviada || state.asistencia.estado !== "ACTIVA") return;
    if (
      response.otroGrupo ===
      true
    ) {
      setState(
        "estadoLectura",
        `⚠ Esta pulsera pertenece a otro grupo (${response.grupoPulsera || "otro grupo"}). No fue agregada.`,
        true
      );

      navigator.vibrate?.(
        [250, 100, 250]
      );

      return;
    }

    if (
      response.modalidad ===
      "grupal"
    ) {
      state.asistencia = {
        ...state.asistencia,
        ...response.asistencia,

        estado:
          "ACTIVA",

        grupoRegistrado:
          true
      };

      renderAsistencia();

      setState(
        "estadoLectura",
        response.duplicada
          ? "La pulsera grupal ya estaba registrada."
          : "✓ Grupo registrado correctamente.",
        false,
        true
      );

      navigator.vibrate?.(
        [100, 60, 100]
      );

      return;
    }

    /*
      Cada pasajero ocupa una única
      inscripción dentro del Map.
    */

    if (
      response.inscripcionId
    ) {
      state.leidos.set(
        response.inscripcionId,
        {
          inscripcionId:
            response.inscripcionId,

          nombreCompleto:
            response.nombrePasajero ||
            "",

          documento:
            response.documento ||
            "",

          codigo,

          ...response
        }
      );
    }

    if (
      response.asistencia
    ) {
      state.asistencia = {
        ...state.asistencia,
        ...response.asistencia,

        estado:
          "ACTIVA"
      };
    }

    /*
      Evitamos que un contador antiguo
      vuelva a bajar el número visible.
    */

    if (
      state.asistencia
    ) {
      state.asistencia.totalLeidos =
        Math.max(
          Number(
            state.asistencia.totalLeidos ||
            0
          ),
          state.leidos.size
        );
    }

    renderAsistencia();

    setState(
      "estadoLectura",
      response.duplicada
        ? `${response.nombrePasajero || "Pasajero"} ya estaba registrado.`
        : `✓ ${response.nombrePasajero || "Pasajero"} registrado.`,
      false,
      true
    );

    navigator.vibrate?.(
      [100, 60, 100]
    );

    /*
      La ubicación se refresca después,
      sin frenar esta lectura.
    */



  } catch (error) {
    setState(
      "estadoLectura",
      error.message ||
      "No fue posible registrar la pulsera.",
      true
    );

    navigator.vibrate?.(
      [250, 100, 250]
    );

  } finally {
    state.processing =
      false;
  }
}

async function iniciarLecturaContinua() {
  if (!state.asistencia?.id || state.asistencia.estado !== "ACTIVA" || state.cerrandoLista) {
    setState("estadoLectura", "Primero empieza una lista o continúa la abierta del grupo.", true);
    return;
  }
  if (
    state.reading
  ) {
    return;
  }

  /*
    iPhone no tiene el mismo Web NFC continuo.

    En iPhone:
    pulsera → notificación → tocar enlace.
  */

  if (
    !("NDEFReader" in window)
  ) {
    setState(
      "estadoLectura",
      "En iPhone acerca cada pulsera a la parte superior del teléfono y toca la notificación NFC.",
      false,
      true
    );

    return;
  }

  try {
    state.controller =
      new AbortController();

    state.ndef =
      new NDEFReader();

    await state.ndef.scan({
      signal:
        state.controller.signal
    });

    state.reading =
      true;

    /*
      Partimos con una cola limpia.
    */

    state.colaCodigos =
      [];

    $("btnIniciarLectura")
      ?.classList
      .add("hidden");

    $("btnDetenerLectura")
      ?.classList
      .remove("hidden");

    setState(
      "estadoLectura",
      "Lectura continua activa. Acerca las pulseras una tras otra.",
      false,
      true
    );

    state.ndef.addEventListener(
      "reading",
      (event) => {
        const codigo =
          extractNfcCode(
            event.message
          );

        if (!codigo) {
          setState(
            "estadoLectura",
            "La pulsera no contiene un código válido.",
            true
          );

          return;
        }

        /*
          MUY IMPORTANTE:

          No hacemos:

          await registrarCodigo(...)

          La lectura siguiente queda libre
          inmediatamente.

          El servidor se procesa por cola.
        */

        encolarCodigoAsistencia(
          codigo
        );
      },
      {
        signal:
          state.controller.signal
      }
    );

    state.ndef.addEventListener(
      "readingerror",
      () => {
        setState(
          "estadoLectura",
          "No fue posible leer esa pulsera. Inténtalo nuevamente.",
          true
        );
      },
      {
        signal:
          state.controller.signal
      }
    );

  } catch (error) {
    state.reading =
      false;

    setState(
      "estadoLectura",
      translateNfcError(
        error
      ),
      true
    );
  }
}

function detenerLectura() {
  try {
    state.controller
      ?.abort();
  } catch {
    // nada
  }

  state.controller =
    null;

  state.ndef =
    null;

  state.reading =
    false;

  $("btnIniciarLectura")
    ?.classList
    .remove("hidden");

  $("btnDetenerLectura")
    ?.classList
    .add("hidden");
}

async function procesarNfcDesdeUrl() {
  const params =
    new URLSearchParams(
      window.location.search
    );

  const codigo =
    sanitizeCode(
      params.get("nfc") ||
      ""
    );

  if (!codigo) {
    return;
  }

  /*
    Nunca procesamos una lectura recibida
    por URL si todavía no tenemos una
    asistencia activa restaurada.
  */

  if (
    !state.asistencia?.id ||
    state.asistencia?.estado !== "ACTIVA"
  ) {
    setState(
      "estadoLectura",
      "No hay una lista de asistencia activa para registrar esta pulsera.",
      true
    );

    return;
  }

  /*
    Antes de registrar limpiamos la URL.

    Así, si Safari recarga manualmente la página,
    no vuelve a registrar accidentalmente el mismo
    parámetro ?nfc=...
  */

  const cleanUrl =
    `${window.location.origin}${window.location.pathname}`;

  window.history.replaceState(
    {},
    document.title,
    cleanUrl
  );

  await registrarCodigo(
    codigo
  );
}

async function finalizarAsistencia() {
  if (!state.asistencia?.id || state.cerrandoLista || state.iniciandoLista || state.guardandoMotivo) return;
  state.cerrandoLista = true;
  const id = state.asistencia.id;
  setDisabled("btnFinalizar", true);
  detenerLectura();
  try {
    while (state.processing || state.procesandoCola) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const actual = await callApiSession("estadoAsistencia", { asistenciaId: id });
    if (actual.asistencia?.estado === "FINALIZADA") return mostrarListaCerrada(actual);
    if (actual.asistencia?.estado !== "ACTIVA") throw new Error("La lista ya no está abierta.");
    aplicarListaCompartida(actual);
    const ausentes = actual.ausentes || [];
    if (ausentes.length && !state.revisandoCierre) {
      state.revisandoCierre = true;
      renderAusentesCierre();
      $("revisionCierreBox")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (ausentes.some((p) => !p.motivo)) {
      state.revisandoCierre = true;
      renderAusentesCierre();
      setState("estadoLectura", "Justifica a cada ausente o marca Sin justificación.", true);
      return;
    }
    if (!window.confirm(ausentes.length
      ? `¿Cerrar para todos con ${ausentes.length} ausentes y sus motivos registrados?`
      : "¿Cerrar esta lista para todos los coordinadores del grupo?")) return;
    const ubicacion = await ubicacionActualDeCierre();
    const response = await callApiSession("finalizarAsistencia", { asistenciaId: id, ubicacion });
    mostrarListaCerrada(response);
  } catch (error) {
    setState("estadoLectura", error.message || "No fue posible cerrar la lista.", true);
  } finally {
    state.cerrandoLista = false;
    setDisabled("btnFinalizar", false);
  }
}

function renderResultadoFinal() {
  const data = state.resultadoCierre || {};
  const a = state.asistencia || {};
  $("resultadoFinal").innerHTML = `
    <h3>${esc(a.nombre || "Lista de asistencia")}</h3>
    <p>${esc(fechaHistorial(a.finalizadaAt))}</p>
    ${ubicacionHistorialHtml(a.ubicacionFin, "Ubicación")}
    ${detallePersonasHtml(data)}`;
}

function procesarManual() {
  if (state.cerrandoLista) return;
  const codigo =
    sanitizeCode(
      $("codigoManualInput")
        ?.value ||
      ""
    );

  if (!codigo) {
    setState(
      "estadoLectura",
      "Escribe un código válido.",
      true
    );

    return;
  }

  registrarCodigo(
    codigo
  );
}

function toggleManual() {
  const panel =
    $("manualPanel");

  const hidden =
    panel.classList
      .toggle("hidden");

  $("btnToggleManual")
    .textContent =
    hidden
      ? "Ingresar código manualmente"
      : "Ocultar ingreso manual";
}

function comprobarNfc() {
  const box =
    $("compatibilidadNfc");

  if (!box) {
    return;
  }

  if (
    "NDEFReader" in window
  ) {
    box.textContent =
      "Android: inicia la lectura y acerca las pulseras una tras otra.";

    return;
  }

  box.textContent =
    "iPhone: acerca cada pulsera a la parte superior del teléfono y toca la notificación NFC.";
}

async function recuperarUbicacion() {
  if (
    !navigator.geolocation
  ) {
    actualizarEstadoUbicacion(
      "Este dispositivo no permite obtener ubicación."
    );

    return;
  }

  /*
    Preguntamos al navegador cuál es
    el permiso REAL de ubicación.
  */
  if (
    navigator.permissions?.query
  ) {
    try {
      const permission =
        await navigator.permissions.query({
          name:
            "geolocation"
        });

      if (
        permission.state ===
        "granted"
      ) {
        localStorage.setItem(
          PORTAL_CONFIG.locationPreferenceKey,
          "allowed"
        );

        await obtenerUbicacionLectura();

        return;
      }

      if (
        permission.state ===
        "denied"
      ) {
        localStorage.setItem(
          PORTAL_CONFIG.locationPreferenceKey,
          "denied"
        );

        actualizarEstadoUbicacion(
          "Ubicación bloqueada en el navegador."
        );

        return;
      }

      /*
        permission.state === "prompt"

        No está denegada.
        Intentamos obtenerla para que
        el navegador pregunte al usuario.
      */
      await solicitarUbicacionAsistencia();

      return;
    } catch (error) {
      console.warn(
        "[asistencia] permiso ubicación",
        error
      );
    }
  }

  /*
    Navegadores donde Permissions API
    no esté disponible.
  */
  await solicitarUbicacionAsistencia();
}

function solicitarUbicacionAsistencia() {
  return new Promise(
    (resolve) => {
      navigator.geolocation
        .getCurrentPosition(
          (position) => {
            state.ubicacion = {
              lat:
                position.coords.latitude,

              lng:
                position.coords.longitude,

              accuracy:
                position.coords.accuracy,

              timestamp:
                Date.now()
            };

            localStorage.setItem(
              PORTAL_CONFIG.locationPreferenceKey,
              "allowed"
            );

            actualizarEstadoUbicacion(
              `Ubicación habilitada · precisión aproximada ${Math.round(
                position.coords.accuracy
              )} m`
            );

            resolve(
              state.ubicacion
            );
          },

          (error) => {
            state.ubicacion =
              null;

            if (
              error?.code ===
              error.PERMISSION_DENIED
            ) {
              localStorage.setItem(
                PORTAL_CONFIG.locationPreferenceKey,
                "denied"
              );

              actualizarEstadoUbicacion(
                "Ubicación no autorizada en este navegador."
              );
            } else {
              /*
                Si fue timeout o GPS temporalmente
                no disponible, NO lo tratamos
                como permiso rechazado.
              */
              actualizarEstadoUbicacion(
                "No fue posible obtener la ubicación en este momento."
              );
            }

            resolve(
              null
            );
          },

          {
            enableHighAccuracy:
              true,

            timeout:
              10000,

            maximumAge:
              30000
          }
        );
    }
  );
}

function obtenerUbicacionLectura() {
  if (
    !navigator.geolocation
  ) {
    return Promise.resolve(
      null
    );
  }

  return new Promise(
    (resolve) => {
      navigator.geolocation
        .getCurrentPosition(
          (position) => {
            state.ubicacion = {
              lat:
                position.coords.latitude,

              lng:
                position.coords.longitude,

              accuracy:
                position.coords.accuracy,

              timestamp:
                Date.now()
            };

            localStorage.setItem(
              PORTAL_CONFIG.locationPreferenceKey,
              "allowed"
            );

            actualizarEstadoUbicacion(
              `Ubicación habilitada · precisión aproximada ${Math.round(
                position.coords.accuracy
              )} m`
            );

            resolve(
              state.ubicacion
            );
          },

          (error) => {
            state.ubicacion =
              null;

            if (
              error?.code ===
              error.PERMISSION_DENIED
            ) {
              localStorage.setItem(
                PORTAL_CONFIG.locationPreferenceKey,
                "denied"
              );

              actualizarEstadoUbicacion(
                "Ubicación no autorizada en este navegador."
              );
            } else {
              actualizarEstadoUbicacion(
                "No fue posible actualizar la ubicación."
              );
            }

            resolve(
              null
            );
          },

          {
            enableHighAccuracy:
              true,

            timeout:
              10000,

            maximumAge:
              30000
          }
        );
    }
  );
}

function actualizarEstadoUbicacion(
  texto
) {
  if (
    $("ubicacionEstado")
  ) {
    $("ubicacionEstado")
      .textContent =
      texto;
  }
}

var historialAsistenciasState = {
  registros: [],
  siguienteId: "",
  hayMas: false,
  cargando: false,
  eventosPreparados: false
};

function escaparHistorial(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function fechaHistorial(value) {
  if (!value) {
    return "Sin registro";
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Sin registro";
  }

  return date.toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function ubicacionHistorialHtml(ubicacion, etiqueta = "Ubicación") {
  if (!ubicacion || ubicacion.lat == null || ubicacion.lng == null) {
    return "<p>Ubicación no disponible.</p>";
  }
  const lat = Number(ubicacion.lat), lng = Number(ubicacion.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) return "<p>Ubicación no disponible.</p>";
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const coords = encodeURIComponent(`${lat},${lng}`);
  const url = apple ? `https://maps.apple.com/?ll=${coords}&q=Ubicacion` :
    `https://www.google.com/maps/search/?api=1&query=${coords}`;
  return `<p><a href="${url}" target="_blank" rel="noopener noreferrer">📍 Ubicación</a></p>`;
}

function prepararEventosHistorial() {
  if (historialAsistenciasState.eventosPreparados) return;
  historialAsistenciasState.eventosPreparados = true;
  $("btnActualizarHistorial")?.addEventListener("click", () => void cargarHistorialAsistencias());
  $("btnMasHistorial")?.addEventListener("click", () => void cargarHistorialAsistencias(true));
  $("historialAsistenciasContenido")?.addEventListener("click", (event) => {
    const detail = event.target.closest("button[data-detalle-asistencia]");
    const archive = event.target.closest("button[data-archivar-asistencia]");
    if (detail) void mostrarDetalleHistorial(detail);
    if (archive) void archivarListaHistorial(archive);
  });
}

async function cargarHistorialAsistencias(continuar = false) {
  if (
    !state.sessionToken ||
    !state.activeGroup ||
    historialAsistenciasState.cargando
  ) {
    return;
  }

  prepararEventosHistorial();

  $("historialAsistenciasPanel")?.classList.remove("hidden");

  const estado = $("historialAsistenciasEstado");

  historialAsistenciasState.cargando = true;

  $("btnActualizarHistorial").disabled = true;
  $("btnMasHistorial").disabled = true;
  estado.textContent = "Cargando historial...";

  try {
    const response = await callApiSession(
      "historialAsistencias",
      {
        desdeId: continuar
          ? historialAsistenciasState.siguienteId
          : ""
      }
    );

    const nuevos = Array.isArray(response.asistencias)
      ? response.asistencias
      : [];

    const registros = continuar
      ? [...historialAsistenciasState.registros, ...nuevos]
      : nuevos;

    historialAsistenciasState.registros = [
      ...new Map(registros.map((item) => [item.id, item])).values()
    ];

    historialAsistenciasState.siguienteId =
      response.siguienteId || "";

    historialAsistenciasState.hayMas =
      response.hayMas === true;

    renderHistorialAsistencias();

    estado.textContent = "";
  } catch (error) {
    estado.textContent =
      error.message || "No fue posible cargar el historial.";
  } finally {
    historialAsistenciasState.cargando = false;

    $("btnActualizarHistorial").disabled = false;
    $("btnMasHistorial").disabled = false;
  }
}

function renderHistorialAsistencias() {
  const container = $("historialAsistenciasContenido");
  $("btnMasHistorial")?.classList.toggle("hidden", !historialAsistenciasState.hayMas);
  const listas = historialAsistenciasState.registros.filter(
    (item) => item.estado === "FINALIZADA" && item.archivada !== true
  );
  if (!listas.length) {
    container.innerHTML = '<div class="empty-box">No hay listas cerradas para mostrar.</div>';
    return;
  }
  container.innerHTML = listas.map((item) => `
    <article class="info-section historial-lista">
      <h3>${escaparHistorial(item.nombre)}</h3>
      <p>${escaparHistorial(fechaHistorial(item.finalizadaAt))}</p>
      ${ubicacionHistorialHtml(item.ubicacionFin)}
      <p>${item.modalidad === "grupal" ?
        (item.grupoRegistrado ? "Pulsera grupal registrada" : "Pulsera grupal no registrada") :
        `Presentes: ${Number(item.totalLeidos || 0)} de ${Number(item.totalEsperado || 0)} · Ausentes: ${Math.max(0, Number(item.totalEsperado || 0) - Number(item.totalLeidos || 0))}`}</p>
      <div class="lista-acciones">
        <button type="button" class="portal-button compact secondary"
          data-detalle-asistencia="${escaparHistorial(item.id)}">VER DETALLE</button>
        <button type="button" class="text-button" data-archivar-asistencia="${escaparHistorial(item.id)}">Archivar lista</button>
      </div>
      <div class="hidden" data-contenido-detalle></div>
    </article>`).join("");
}

async function mostrarDetalleHistorial(button) {
  const container = button.closest("article")?.querySelector("[data-contenido-detalle]");
  if (!container) return;
  if (!container.classList.contains("hidden")) {
    container.classList.add("hidden");
    button.textContent = "VER DETALLE";
    return;
  }
  button.disabled = true;
  try {
    const response = await callApiSession("detalleAsistenciaHistorial", {
      asistenciaId: button.dataset.detalleAsistencia
    });
    container.innerHTML = detallePersonasHtml(response);
    container.classList.remove("hidden");
    button.textContent = "OCULTAR DETALLE";
  } catch (error) {
    $("historialAsistenciasEstado").textContent = error.message;
  } finally { button.disabled = false; }
}

function generarNombreAsistencia() {
  const fecha =
    new Date();

  return [
    "Asistencia",
    String(
      fecha.getDate()
    ).padStart(
      2,
      "0"
    ) +
    "-" +
    String(
      fecha.getMonth() +
      1
    ).padStart(
      2,
      "0"
    ) +
    "-" +
    fecha.getFullYear(),
    String(
      fecha.getHours()
    ).padStart(
      2,
      "0"
    ) +
    ":" +
    String(
      fecha.getMinutes()
    ).padStart(
      2,
      "0"
    )
  ].join(
    " "
  );
}

function extractNfcCode(
  message
) {
  for (
    const record
    of message.records ||
    []
  ) {
    try {
      if (
        record.recordType ===
        "text"
      ) {
        const text =
          new TextDecoder(
            record.encoding ||
            "utf-8"
          ).decode(
            record.data
          );

        const codigo =
          extraerCodigoDesdeValor(
            text
          );

        if (codigo) {
          return codigo;
        }
      }

      if (
        record.recordType ===
          "url" ||
        record.recordType ===
          "absolute-url"
      ) {
        const url =
          new TextDecoder()
            .decode(
              record.data
            );

        const codigo =
          extraerCodigoDesdeValor(
            url
          );

        if (codigo) {
          return codigo;
        }
      }
    } catch {
      // continuar
    }
  }

  return "";
}

function extraerCodigoDesdeValor(
  value = ""
) {
  const raw =
    String(
      value ||
      ""
    ).trim();

  if (!raw) {
    return "";
  }

  try {
    const url =
      new URL(
        raw
      );

    const codigo =
      url.searchParams
        .get(
          "nfc"
        );

    if (codigo) {
      return sanitizeCode(
        codigo
      );
    }
  } catch {
    // texto normal
  }

  return sanitizeCode(
    raw
  );
}

async function callApiSession(
  accion,
  payload
) {
  validateApiUrl();

  let response;

  try {
    response =
      await fetch(
        PORTAL_CONFIG.apiUrl,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              accion,

              sessionToken:
                state.sessionToken,

              ...payload
            })
        }
      );

  } catch (networkError) {
    /*
      IMPORTANTE:

      Un error de red NO significa que
      la sesión haya vencido.

      No borramos absolutamente nada.
    */

    const error =
      new Error(
        "No fue posible conectar con el servidor."
      );

    error.status =
      0;

    error.cause =
      networkError;

    throw error;
  }

  let responsePayload = {};

  try {
    responsePayload =
      await response.json();
  } catch {
    responsePayload = {};
  }

  /*
    Solo un 401 confirmado por el servidor
    invalida el token almacenado.
  */

  if (
    response.status ===
    401
  ) {
    localStorage.removeItem(
      PORTAL_CONFIG.sessionTokenKey
    );

    const error =
      new Error(
        responsePayload.error ||
        "La sesión venció. Vuelve a ingresar."
      );

    error.status =
      401;

    throw error;
  }

  if (
    !response.ok ||
    responsePayload.ok !== true
  ) {
    const error =
      new Error(
        responsePayload.error ||
        `Error de consulta (${response.status})`
      );

    error.status =
      response.status;

    throw error;
  }

  return responsePayload;
}

async function parseApiResponse(
  response
) {
  let payload = {};

  try {
    payload =
      await response.json();
  } catch {
    payload = {};
  }

  if (
    !response.ok ||
    payload.ok !== true
  ) {
    throw new Error(
      payload.error ||
      `Error de consulta (${response.status})`
    );
  }

  return payload;
}

function validateApiUrl() {
  if (
    !PORTAL_CONFIG.apiUrl
  ) {
    throw new Error(
      "Falta configurar la URL de la Cloud Function."
    );
  }
}

function sanitizeCode(
  value = ""
) {
  return String(
    value
  )
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .trim()
    .toUpperCase()
    .replace(
      /[^A-Z0-9-]/g,
      ""
    )
    .slice(
      0,
      100
    );
}

function translateNfcError(
  error
) {
  if (
    error?.name ===
    "NotAllowedError"
  ) {
    return "Permiso NFC rechazado o lectura cancelada.";
  }

  if (
    error?.name ===
    "NotSupportedError"
  ) {
    return "El teléfono o navegador no es compatible con Web NFC.";
  }

  if (
    error?.name ===
    "AbortError"
  ) {
    return "Lectura detenida.";
  }

  return error?.message ||
    "No fue posible iniciar la lectura NFC.";
}

function setState(
  id,
  message,
  error = false,
  ok = false
) {
  const element =
    $(id);

  if (!element) {
    return;
  }

  element.textContent =
    message;

  element.classList
    .toggle(
      "error",
      error
    );

  element.classList
    .toggle(
      "ok",
      ok
    );
}

function setDisabled(
  id,
  disabled
) {
  if (
    $(id)
  ) {
    $(id).disabled =
      disabled;
  }
}

function esc(
  value = ""
) {
  return String(
    value
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function mostrarPreparacionLista() {
  state.revisandoCierre = false;
  $("revisionCierreBox")?.classList.add("hidden");
  state.asistencia = null;
  state.pasajeros = [];
  state.leidos = new Map();
  localStorage.removeItem(PORTAL_CONFIG.activeAttendanceKey);
  localStorage.removeItem(PORTAL_CONFIG.attendanceModeKey);
  $("prepararListaBox")?.classList.remove("hidden");
  $("listaActivaBox")?.classList.add("hidden");
  $("btnFinalizar")?.classList.add("hidden");
  $("btnIniciarLectura")?.classList.add("hidden");
  $("resumenAsistencia").innerHTML = "";
  $("contadorPrincipal").textContent = "Sin lista abierta";
  $("contadorDetalle").textContent = "Pon un nombre y pulsa Empezar lista.";
  actualizarEstadoUbicacion("La ubicación se registra al cerrar la lista.");
}

function aplicarListaCompartida(response) {
  const anteriores = state.asistencia?.id === response.asistencia?.id
    ? state.leidos : new Map();
  state.asistencia = response.asistencia;
  state.ausentes = response.ausentes || [];
  state.pasajeros = response.pasajeros || [];
  state.leidos = new Map([...anteriores, ...(response.leidos || []).filter((p) => p.inscripcionId)
    .map((p) => [p.inscripcionId, p])]);
  localStorage.setItem(PORTAL_CONFIG.activeAttendanceKey, state.asistencia.id);
  localStorage.setItem(PORTAL_CONFIG.attendanceModeKey, "active");
  $("prepararListaBox")?.classList.add("hidden");
  $("listaActivaBox")?.classList.remove("hidden");
  $("btnFinalizar")?.classList.remove("hidden");
  if (!state.reading) $("btnIniciarLectura")?.classList.remove("hidden");
  actualizarEstadoUbicacion("La ubicación se registra al cerrar la lista.");
  renderAsistencia();
  renderAusentesCierre();
}

function mostrarListaCerrada(response) {
  state.revisandoCierre = false;
  $("revisionCierreBox")?.classList.add("hidden");
  detenerLectura();
  state.asistencia = response.asistencia;
  state.resultadoCierre = response;
  state.pasajeros = response.pasajeros || [];
  state.leidos = new Map((response.leidos || []).filter((p) => p.inscripcionId)
    .map((p) => [p.inscripcionId, p]));
  localStorage.removeItem(PORTAL_CONFIG.activeAttendanceKey);
  localStorage.removeItem(PORTAL_CONFIG.attendanceModeKey);
  $("asistenciaPanel")?.classList.add("hidden");
  $("finalizadaPanel")?.classList.remove("hidden");
  renderResultadoFinal();
  void cargarHistorialAsistencias();
}

function iniciarSincronizacionCompartida() {
  // Solo consultar cuando esta pestaña está visible; nunca crear desde el timer.
  const actualizar = async () => {
    if (document.hidden || state.actualizandoLista || state.processing ||
        state.procesandoCola || state.cerrandoLista || state.iniciandoLista || state.guardandoMotivo ||
        state.asistencia?.estado === "FINALIZADA") return;
    state.actualizandoLista = true;
    const id = state.asistencia?.id || "";
    try {
      const response = await callApiSession("estadoAsistencia", id ? { asistenciaId: id } : {});
      if (state.processing || state.procesandoCola || state.cerrandoLista || state.iniciandoLista || state.guardandoMotivo) return;
      if (id && state.asistencia?.id !== id) return;
      if (response.asistencia?.estado === "FINALIZADA") mostrarListaCerrada(response);
      else if (response.asistencia?.estado === "ACTIVA") aplicarListaCompartida(response);
      else if (id) { detenerLectura(); mostrarPreparacionLista(); }
      else if (!state.asistencia && state.listaAnteriorId !== (response.listaAnteriorId || "")) {
        state.listaAnteriorId = response.listaAnteriorId || "";
        state.ausenciasAnteriores = response.ausenciasAnteriores || [];
        state.revisionAusencias = new Map();
        renderRevisionAnterior();
      }
    } catch (error) {
      if (error.status === 401) { detenerLectura(); mostrarSinSesion(error.message); }
    } finally { state.actualizandoLista = false; }
  };
  setInterval(() => void actualizar(), 6000);
  document.addEventListener("visibilitychange", () => void actualizar());
}

function ubicacionActualDeCierre() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude,
      accuracy: p.coords.accuracy }),
    () => resolve(null),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
  ));
}

function detallePersonasHtml(response) {
  if (response.asistencia?.modalidad === "grupal") {
    return '<p>La pulsera grupal no identifica presentes y ausentes individualmente.</p>';
  }
  const bloque = (titulo, items = [], motivos = false) => `<h4>${titulo} (${items.length})</h4>
    ${items.length ? `<ul class="lista-nombres">${items.map((p) =>
      `<li>${esc(p.nombreCompleto || "Sin nombre")}${motivos
        ? `<span class="ausencia-detalle">${esc(p.motivo || "Sin justificación registrada")}${p.detalle ? ": " + esc(p.detalle) : ""}</span>` : ""}</li>`).join("")}</ul>` : "<p>Ninguno.</p>"}`;
  return `${response.nominaHistorica === false ?
    '<p class="section-copy">Lista anterior: nombres y ausentes calculados con la nómina actual.</p>' : ""}
    ${bloque("Presentes", response.presentes)}${bloque("Ausentes", response.ausentes, true)}`;
}

async function archivarListaHistorial(button) {
  if (!confirm("¿Archivar esta lista y quitarla del historial del grupo?")) return;
  button.disabled = true;
  try {
    await callApiSession("archivarAsistencia", { asistenciaId: button.dataset.archivarAsistencia });
    historialAsistenciasState.registros = historialAsistenciasState.registros.filter(
      (item) => item.id !== button.dataset.archivarAsistencia
    );
    renderHistorialAsistencias();
  } catch (error) {
    $("historialAsistenciasEstado").textContent = error.message;
  } finally { button.disabled = false; }
}


function mostrarAvisoIphone() {
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  $("avisoIphone")?.classList.toggle("hidden", !iphone);
}

function prepararEventosAusencias() {
  $("btnAplicarMotivoCierre")?.addEventListener("click", () => void aplicarMotivoCierre());
  $("btnConfirmarCierre")?.addEventListener("click", () => void finalizarAsistencia());
  $("btnCancelarCierre")?.addEventListener("click", () => {
    state.revisandoCierre = false;
    $("revisionCierreBox")?.classList.add("hidden");
  });
  $("btnSiguenAusentes")?.addEventListener("click", () => aplicarRevisionAnterior(true));
  $("btnReincorporados")?.addEventListener("click", () => aplicarRevisionAnterior(false));
}

function motivosHtml() {
  return '<option value="">Selecciona un motivo</option>' +
    ["Enfermedad", "Acompañamiento", "Otro", "Sin justificación"]
      .map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
}

function renderRevisionAnterior() {
  const items = state.ausenciasAnteriores || [];
  $("revisionAnteriorBox")?.classList.toggle("hidden", !items.length);
  if (!$("ausenciasAnterioresContenido")) return;
  $("ausenciasAnterioresContenido").innerHTML = items.map((p) => {
    const r = state.revisionAusencias?.get(p.inscripcionId);
    return `<label class="ausencia-fila"><input type="checkbox" data-ausencia-anterior="${esc(p.inscripcionId)}">
      <span><strong>${esc(p.nombreCompleto)}</strong>
      <span class="ausencia-detalle">Anterior: ${esc(p.motivo)}${p.detalle ? ": " + esc(p.detalle) : ""}</span>
      <span class="ausencia-detalle">${!r ? "Pendiente de revisar" : r.sigueAusente
        ? "Sigue ausente: " + esc(r.motivo) + (r.detalle ? ": " + esc(r.detalle) : "")
        : "Ya se reincorporó · pendiente de leer pulsera"}</span></span></label>`;
  }).join("");
  if ($("motivoAnteriorInput") && !$("motivoAnteriorInput").options.length) {
    $("motivoAnteriorInput").innerHTML = '<option value="">Mantener el motivo anterior de cada persona</option>' +
      motivosHtml().replace('<option value="">Selecciona un motivo</option>', "");
  }
}

function aplicarRevisionAnterior(sigueAusente) {
  const seleccionados = [...document.querySelectorAll("[data-ausencia-anterior]:checked")]
    .map((el) => el.dataset.ausenciaAnterior);
  if (!seleccionados.length) return setState("estadoLectura", "Selecciona una o más personas.", true);
  const motivo = $("motivoAnteriorInput")?.value || "";
  const detalle = String($("detalleAnteriorInput")?.value || "").trim();
  if (sigueAusente && motivo && motivo !== "Sin justificación" && !detalle) {
    return setState("estadoLectura", "Describe el nuevo motivo antes de aplicarlo.", true);
  }
  state.revisionAusencias ||= new Map();
  for (const p of state.ausenciasAnteriores || []) {
    if (!seleccionados.includes(p.inscripcionId)) continue;
    state.revisionAusencias.set(p.inscripcionId, { inscripcionId: p.inscripcionId, sigueAusente,
      motivo: motivo || p.motivo, detalle: motivo ? detalle : p.detalle || "" });
  }
  renderRevisionAnterior();
  setState("estadoLectura", "Revisión aplicada. Puedes continuar con las demás personas.", false, true);
}

function renderAusentesCierre() {
  const box = $("revisionCierreBox");
  if (!box) return;
  box.classList.toggle("hidden", !state.revisandoCierre);
  if (!state.revisandoCierre) return;
  const checked = new Set([...document.querySelectorAll("[data-ausente-cierre]:checked")]
    .map((el) => el.dataset.ausenteCierre));
  const items = state.ausentes || [];
  $("ausentesCierreTitulo").textContent = `Revisa ${items.length} ausentes antes de cerrar`;
  $("ausentesCierreContenido").innerHTML = items.map((p) =>
    `<label class="ausencia-fila"><input type="checkbox" data-ausente-cierre="${esc(p.inscripcionId)}" ${checked.has(p.inscripcionId) ? "checked" : ""}>
      <span><strong>${esc(p.nombreCompleto)}</strong><span class="ausencia-detalle">${esc(p.motivo || "Pendiente de justificar")}${p.detalle ? ": " + esc(p.detalle) : ""}</span></span></label>`).join("");
  if (!$("motivoCierreInput").options.length) $("motivoCierreInput").innerHTML = motivosHtml();
}

async function aplicarMotivoCierre() {
  if (state.guardandoMotivo || state.cerrandoLista) return;
  const seleccionados = [...document.querySelectorAll("[data-ausente-cierre]:checked")]
    .map((el) => el.dataset.ausenteCierre);
  if (!seleccionados.length) return setState("estadoLectura", "Selecciona una o más personas.", true);
  const motivo = $("motivoCierreInput")?.value || "";
  const detalle = String($("detalleCierreInput")?.value || "").trim();
  if (!motivo || (motivo !== "Sin justificación" && !detalle)) {
    return setState("estadoLectura", "Selecciona un motivo y describe la situación.", true);
  }
  state.guardandoMotivo = true;
  setDisabled("btnAplicarMotivoCierre", true);
  setDisabled("btnConfirmarCierre", true);
  try {
    const response = await callApiSession("justificarAusencias", {
      asistenciaId: state.asistencia.id,
      justificaciones: seleccionados.map((inscripcionId) => ({ inscripcionId, motivo, detalle }))
    });
    aplicarListaCompartida(response);
    document.querySelectorAll("[data-ausente-cierre]:checked").forEach((el) => { el.checked = false; });
    setState("estadoLectura", "Motivo guardado y compartido con los demás coordinadores.", false, true);
  } catch (error) {
    setState("estadoLectura", error.message, true);
  } finally {
    state.guardandoMotivo = false;
    setDisabled("btnAplicarMotivoCierre", false);
    setDisabled("btnConfirmarCierre", false);
  }
}
