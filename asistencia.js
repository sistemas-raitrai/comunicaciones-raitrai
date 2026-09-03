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
  bindEvents();

  comprobarNfc();

  localStorage.setItem(
    PORTAL_CONFIG.modeKey,
    "asistencia"
  );

  localStorage.setItem(
    PORTAL_CONFIG.attendanceModeKey,
    "active"
  );

  const params =
    new URLSearchParams(
      window.location.search
    );

  const asistenciaIdUrl =
    String(
      params.get("asistenciaId") ||
      ""
    ).trim();

  const token =
    String(
      localStorage.getItem(
        PORTAL_CONFIG.sessionTokenKey
      ) ||
      ""
    ).trim();

  if (!token) {
    mostrarSinSesion(
      "No se encontró una sesión guardada en este navegador. Abre el lector de pulseras e ingresa al grupo una vez desde este mismo navegador."
    );

    return;
  }

  state.sessionToken =
    token;

  try {
    const response =
      await callApiSession(
        "estadoSesion",
        {}
      );

    state.activeGroup =
      response.grupo;

    renderGrupo();

    $("sinSesionPanel")
      ?.classList
      .add("hidden");

    $("asistenciaPanel")
      ?.classList
      .remove("hidden");

    $("finalizadaPanel")
      ?.classList
      .add("hidden");

    /*
      IMPORTANTE:

      NO esperamos ubicación aquí.

      Primero dejamos operativa la asistencia.
    */

    const asistenciaDisponible =
      await cargarOCrearAsistencia(
        asistenciaIdUrl
      );

    if (!asistenciaDisponible) {
      return;
    }

    /*
      Si iPhone abrió la página por NFC,
      registramos primero la pulsera.
    */

    await procesarNfcDesdeUrl();

    /*
      La ubicación se obtiene después,
      en segundo plano.
    */

    void recuperarUbicacion();

  } catch (error) {
    console.error(
      "[asistencia] init",
      error
    );

    if (
      Number(error?.status) ===
      401
    ) {
      mostrarSinSesion(
        error.message ||
        "La sesión guardada ya no es válida. Ingresa nuevamente al grupo."
      );

      return;
    }

    mostrarSinSesion(
      `Existe una sesión guardada, pero no fue posible validarla en este momento.${
        error?.message
          ? ` Detalle: ${error.message}`
          : ""
      }`
    );
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

  $("btnNuevaLista")
    ?.addEventListener(
      "click",
      crearNuevaAsistencia
    );

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

async function cargarOCrearAsistencia(
  asistenciaIdPreferida = ""
) {
  const asistenciaIdLocal =
    String(
      localStorage.getItem(
        PORTAL_CONFIG.activeAttendanceKey
      ) ||
      ""
    ).trim();

  const asistenciaIdUrl =
    String(
      asistenciaIdPreferida ||
      ""
    ).trim();

  /*
    =========================================================
    1. PRIORIDAD: ASISTENCIA RECIBIDA DESDE EL NFC
    =========================================================

    En iPhone index.html incluye explícitamente
    el ID de la asistencia en la URL.
  */

  if (asistenciaIdUrl) {
    const restaurada =
      await restaurarAsistencia(
        asistenciaIdUrl
      );

    if (restaurada) {
      /*
        Volvemos a persistir el ID localmente
        para reforzar la continuidad de las
        siguientes lecturas.
      */

      localStorage.setItem(
        PORTAL_CONFIG.activeAttendanceKey,
        asistenciaIdUrl
      );

      localStorage.setItem(
        PORTAL_CONFIG.attendanceModeKey,
        "active"
      );

      localStorage.setItem(
        PORTAL_CONFIG.modeKey,
        "asistencia"
      );

      return true;
    }

    /*
      Si la URL decía explícitamente que debíamos
      utilizar una asistencia y ésta ya no existe
      o no está ACTIVA, NO creamos silenciosamente
      una asistencia nueva.

      Eso evitaría que una lectura de iPhone
      termine accidentalmente en otra lista.
    */

    setState(
      "estadoLectura",
      "La lista de asistencia asociada a esta lectura ya no está activa. Vuelve a iniciar Pasar Lista.",
      true
    );

    return false;
  }

  /*
    =========================================================
    2. ASISTENCIA GUARDADA LOCALMENTE
    =========================================================
  */

  if (asistenciaIdLocal) {
    const restaurada =
      await restaurarAsistencia(
        asistenciaIdLocal
      );

    if (restaurada) {
      localStorage.setItem(
        PORTAL_CONFIG.attendanceModeKey,
        "active"
      );

      localStorage.setItem(
        PORTAL_CONFIG.modeKey,
        "asistencia"
      );

      return true;
    }
  }

  /*
    =========================================================
    3. NO HABÍA NINGUNA ASISTENCIA
    =========================================================

    Esto corresponde al ingreso normal al módulo
    Pasar Lista.

    Creamos una nueva asistencia.
  */

  await crearNuevaAsistencia();

  return Boolean(
    state.asistencia?.id
  );
}

async function crearNuevaAsistencia() {
  detenerLectura();

  setState(
    "estadoLectura",
    "Creando nueva lista..."
  );

  const ubicacion =
    await obtenerUbicacionLectura();

  const nombre =
    generarNombreAsistencia();

  try {
    const response =
      await callApiSession(
        "crearAsistencia",
        {
          nombre,
          ubicacion
        }
      );

    state.asistencia =
      response.asistencia;

    state.pasajeros =
      Array.isArray(
        response.pasajeros
      )
        ? response.pasajeros
        : [];

    state.leidos =
      new Map();

    /*
      Dejamos sincronizadas todas las marcas
      necesarias para que iPhone pueda volver
      a esta misma lista con cada nueva lectura.
    */

    localStorage.setItem(
      PORTAL_CONFIG.activeAttendanceKey,
      state.asistencia.id
    );

    localStorage.setItem(
      PORTAL_CONFIG.attendanceModeKey,
      "active"
    );

    localStorage.setItem(
      PORTAL_CONFIG.modeKey,
      "asistencia"
    );

    $("asistenciaPanel")
      ?.classList
      .remove("hidden");

    $("finalizadaPanel")
      ?.classList
      .add("hidden");

    renderAsistencia();

    setState(
      "estadoLectura",
      "Lista preparada. Comienza a leer pulseras.",
      false,
      true
    );

    return true;

  } catch (error) {
    console.error(
      "[asistencia] crearNuevaAsistencia",
      error
    );

    setState(
      "estadoLectura",
      error.message ||
      "No fue posible crear la lista.",
      true
    );

    return false;
  }
}

async function restaurarAsistencia(
  asistenciaId
) {
  try {
    const response =
      await callApiSession(
        "estadoAsistencia",
        {
          asistenciaId
        }
      );

    if (
      response.asistencia?.estado !==
      "ACTIVA"
    ) {
      localStorage.removeItem(
        PORTAL_CONFIG.activeAttendanceKey
      );

      return false;
    }

    state.asistencia =
      response.asistencia;

    state.pasajeros =
      Array.isArray(
        response.pasajeros
      )
        ? response.pasajeros
        : [];

    state.leidos =
      new Map(
        (
          response.leidos ||
          []
        ).map(
          (item) => [
            item.inscripcionId,
            item
          ]
        )
      );

    renderAsistencia();

    setState(
      "estadoLectura",
      "Lista recuperada. Puedes continuar leyendo.",
      false,
      true
    );

    return true;
  } catch (error) {
    console.warn(
      "[asistencia] restaurar",
      error
    );

    localStorage.removeItem(
      PORTAL_CONFIG.activeAttendanceKey
    );

    return false;
  }
}

function renderAsistencia() {
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

    void recuperarUbicacion();

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
  if (
    !state.asistencia?.id
  ) {
    return;
  }

  detenerLectura();

  const confirmar =
    window.confirm(
      "¿Finalizar esta lista de asistencia?"
    );

  if (!confirmar) {
    return;
  }

  setDisabled(
    "btnFinalizar",
    true
  );

  try {
    const ubicacion =
      await obtenerUbicacionLectura();

    const response =
      await callApiSession(
        "finalizarAsistencia",
        {
          asistenciaId:
            state.asistencia.id,

          ubicacion
        }
      );

    state.asistencia = {
      ...state.asistencia,
      ...response.asistencia
    };

    localStorage.removeItem(
      PORTAL_CONFIG.activeAttendanceKey
    );

    localStorage.removeItem(
      PORTAL_CONFIG.attendanceModeKey
    );

    $("asistenciaPanel")
      ?.classList
      .add("hidden");

    $("finalizadaPanel")
      ?.classList
      .remove("hidden");

    renderResultadoFinal();
  } catch (error) {
    setState(
      "estadoLectura",
      error.message ||
      "No fue posible finalizar la lista.",
      true
    );
  } finally {
    setDisabled(
      "btnFinalizar",
      false
    );
  }
}

function renderResultadoFinal() {
  const total =
    Number(
      state.asistencia
        ?.totalEsperado ||
      0
    );

  const leidos =
    Number(
      state.asistencia
        ?.totalLeidos ||
      state.leidos.size ||
      0
    );

  if (
    state.asistencia
      ?.modalidad ===
    "grupal"
  ) {
    $("resultadoFinal")
      .innerHTML = `
        <div class="info-section">
          <h3>
            Resultado
          </h3>

          <div class="empty-box">
            ${
              state.asistencia.grupoRegistrado
                ? `✓ Pulsera grupal registrada. Total asociado: ${total} pasajero(s).`
                : `La lista fue finalizada sin registrar la pulsera grupal.`
            }
          </div>
        </div>
      `;

    return;
  }

  const idsLeidos =
    new Set(
      state.leidos.keys()
    );

  const pendientes =
    state.pasajeros
      .filter(
        (item) =>
          !idsLeidos.has(
            item.inscripcionId
          )
      );

  $("resultadoFinal")
    .innerHTML = `
      <div class="person-header">
        <h3>
          ${leidos} / ${total}
        </h3>

        <p>
          ${
            pendientes.length
              ? `${pendientes.length} pasajero(s) no fueron leídos.`
              : "Todos los pasajeros fueron registrados."
          }
        </p>
      </div>

      ${
        pendientes.length
          ? `
            <div class="info-section">
              <h3>
                No leídos
              </h3>

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
                        </span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
    `;
}

function procesarManual() {
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
