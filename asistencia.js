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

  const token =
    localStorage.getItem(
      PORTAL_CONFIG.sessionTokenKey
    ) ||
    "";

  if (!token) {
    mostrarSinSesion();
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

    $("asistenciaPanel")
      ?.classList
      .remove("hidden");

    await recuperarUbicacion();

    await cargarOCrearAsistencia();

    await procesarNfcDesdeUrl();
  } catch (error) {
    console.error(
      "[asistencia] init",
      error
    );

    mostrarSinSesion();
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

function mostrarSinSesion() {
  $("asistenciaPanel")
    ?.classList
    .add("hidden");

  $("finalizadaPanel")
    ?.classList
    .add("hidden");

  $("sinSesionPanel")
    ?.classList
    .remove("hidden");
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
  const asistenciaId =
    localStorage.getItem(
      PORTAL_CONFIG.activeAttendanceKey
    ) ||
    "";

  if (asistenciaId) {
    const restaurada =
      await restaurarAsistencia(
        asistenciaId
      );

    if (restaurada) {
      return;
    }
  }

  await crearNuevaAsistencia();
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

    localStorage.setItem(
      PORTAL_CONFIG.activeAttendanceKey,
      state.asistencia.id
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
  } catch (error) {
    setState(
      "estadoLectura",
      error.message ||
      "No fue posible crear la lista.",
      true
    );
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

  const totalLeidos =
    Number(
      state.asistencia
        ?.totalLeidos ??
      state.leidos.size
    );

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
          Leídos (${presentes.length})
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
          Pendientes (${pendientes.length})
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

async function registrarCodigo(
  codigoRaw
) {
  if (
    !state.asistencia?.id ||
    state.processing
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
    Evita múltiples eventos de lectura seguidos
    mientras la pulsera sigue apoyada en el teléfono.
  */
  const ahora =
    Date.now();

  if (
    codigo ===
      state.ultimoCodigo &&
    ahora -
      state.ultimaLecturaAt <
      1500
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
    const ubicacion =
      await obtenerUbicacionLectura();

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

    if (
      response.inscripcionId
    ) {
      state.leidos.set(
        response.inscripcionId,
        response
      );
    }

    if (
      response.asistencia
    ) {
      state.asistencia = {
        ...state.asistencia,
        ...response.asistencia
      };
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

  if (
    !("NDEFReader" in window)
  ) {
    setState(
      "estadoLectura",
      "En iPhone acerca la pulsera a la parte superior del teléfono y toca la notificación NFC.",
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

    $("btnIniciarLectura")
      ?.classList
      .add("hidden");

    $("btnDetenerLectura")
      ?.classList
      .remove("hidden");

    setState(
      "estadoLectura",
      "Lectura activa. Acerca las pulseras una tras otra.",
      false,
      true
    );

    state.ndef.addEventListener(
      "reading",
      async (event) => {
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

        await registrarCodigo(
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

  const response =
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

  if (
    response.status ===
    401
  ) {
    localStorage.removeItem(
      PORTAL_CONFIG.sessionTokenKey
    );

    throw new Error(
      "La sesión venció. Vuelve a ingresar."
    );
  }

  return parseApiResponse(
    response
  );
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
