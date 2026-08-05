import {
  PORTAL_CONFIG
} from "./config.js";

const $ = (id) =>
  document.getElementById(id);

const state = {
  sessionToken: "",
  numeroNegocio: "",
  grupo: null,
  leyendo: false,
  listaGrupal: []
};

init();

function init() {
  bindEvents();
  comprobarCompatibilidadNfc();
  restaurarSesion();
}

function bindEvents() {
  $("btnIngresarGrupo")
    ?.addEventListener(
      "click",
      ingresarGrupo
    );

  $("numeroNegocio")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          ingresarGrupo();
        }
      }
    );

  $("btnCambiarGrupo")
    ?.addEventListener(
      "click",
      cerrarGrupo
    );

  $("btnLeerPulsera")
    ?.addEventListener(
      "click",
      leerPulsera
    );

  $("btnMostrarManual")
    ?.addEventListener(
      "click",
      toggleManual
    );

  $("btnBuscarManual")
    ?.addEventListener(
      "click",
      buscarCodigoManual
    );

  $("codigoManual")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") {
          buscarCodigoManual();
        }
      }
    );

  $("resultadoContenido")
    ?.addEventListener(
      "input",
      (event) => {
        if (
          event.target.id ===
          "buscarPasajeroGrupo"
        ) {
          renderListaGrupal(
            event.target.value
          );
        }
      }
    );

  $("resultadoContenido")
    ?.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-inscripcion-id]"
          );

        if (!button) {
          return;
        }

        cargarPasajeroGrupal(
          button.dataset.inscripcionId
        );
      }
    );
}

async function restaurarSesion() {
  const token =
    sessionStorage.getItem(
      PORTAL_CONFIG.sessionStorageKey
    ) || "";

  const negocio =
    sessionStorage.getItem(
      PORTAL_CONFIG.negocioStorageKey
    ) || "";

  if (
    !token ||
    !negocio
  ) {
    return;
  }

  state.sessionToken =
    token;

  state.numeroNegocio =
    negocio;

  setAccesoEstado(
    "Restaurando acceso..."
  );

  try {
    const response =
      await llamarApi(
        "estadoSesion",
        {}
      );

    aplicarGrupoAutorizado(
      response.grupo
    );

    setLectorEstado(
      "Sesión restaurada. Ya puedes leer una pulsera.",
      false,
      true
    );
  } catch {
    limpiarSesionLocal();
  }
}

async function ingresarGrupo() {
  const numeroNegocio =
    sanitizarNegocio(
      $("numeroNegocio")
        ?.value
    );

  if (!numeroNegocio) {
    setAccesoEstado(
      "Ingresa el número de negocio.",
      true
    );

    return;
  }

  bloquearIngreso(
    true
  );

  setAccesoEstado(
    "Validando el grupo..."
  );

  try {
    const response =
      await llamarApiSinSesion(
        "iniciarSesion",
        {
          numeroNegocio
        }
      );

    state.sessionToken =
      response.sessionToken;

    state.numeroNegocio =
      numeroNegocio;

    sessionStorage.setItem(
      PORTAL_CONFIG.sessionStorageKey,
      state.sessionToken
    );

    sessionStorage.setItem(
      PORTAL_CONFIG.negocioStorageKey,
      state.numeroNegocio
    );

    aplicarGrupoAutorizado(
      response.grupo
    );

    setLectorEstado(
      "Acceso habilitado. Presiona “Leer pulsera NFC”.",
      false,
      true
    );
  } catch (error) {
    setAccesoEstado(
      error.message ||
      "No se pudo validar el grupo.",
      true
    );
  } finally {
    bloquearIngreso(
      false
    );
  }
}

function aplicarGrupoAutorizado(
  grupo = {}
) {
  state.grupo =
    grupo;

  $("grupoTitulo")
    .textContent =
    grupo.numeroNegocio
      ? `Grupo ${grupo.numeroNegocio}`
      : "Grupo autorizado";

  $("grupoDetalle")
    .textContent =
    [
      grupo.nombre ||
      grupo.colegio ||
      "",
      grupo.curso ||
      "",
      grupo.destino ||
      ""
    ]
      .filter(Boolean)
      .join(" · ") ||
    "Acceso autorizado";

  $("accesoPanel")
    .classList
    .add("hidden");

  $("grupoPanel")
    .classList
    .remove("hidden");

  $("resultadoPanel")
    .classList
    .add("hidden");
}

function cerrarGrupo() {
  limpiarSesionLocal();

  state.grupo =
    null;

  state.listaGrupal =
    [];

  $("numeroNegocio")
    .value =
    "";

  $("codigoManual")
    .value =
    "";

  $("grupoPanel")
    .classList
    .add("hidden");

  $("resultadoPanel")
    .classList
    .add("hidden");

  $("accesoPanel")
    .classList
    .remove("hidden");

  setAccesoEstado(
    "Ingresa el número de negocio para comenzar."
  );
}

async function leerPulsera() {
  if (
    !state.sessionToken
  ) {
    setLectorEstado(
      "Primero debes ingresar al grupo.",
      true
    );

    return;
  }

  if (
    !("NDEFReader" in window)
  ) {
    setLectorEstado(
      "Este navegador no soporta Web NFC. Usa Chrome en un teléfono Android o prueba escribiendo el código manualmente.",
      true
    );

    return;
  }

  if (
    state.leyendo
  ) {
    return;
  }

  state.leyendo =
    true;

  actualizarBotonLectura();

  setLectorEstado(
    "Acerca la pulsera a la parte posterior del teléfono..."
  );

  try {
    const ndef =
      new NDEFReader();

    const controller =
      new AbortController();

    await ndef.scan({
      signal:
        controller.signal
    });

    ndef.addEventListener(
      "readingerror",
      () => {
        setLectorEstado(
          "No se pudo leer la pulsera. Inténtalo nuevamente.",
          true
        );
      },
      {
        signal:
          controller.signal
      }
    );

    ndef.addEventListener(
      "reading",
      async (
        event
      ) => {
        const codigo =
          extraerCodigoNdef(
            event.message
          );

        if (!codigo) {
          setLectorEstado(
            "La pulsera no contiene un código de texto válido.",
            true
          );

          return;
        }

        controller.abort();

        await consultarCodigo(
          codigo
        );

        state.leyendo =
          false;

        actualizarBotonLectura();
      },
      {
        signal:
          controller.signal
      }
    );
  } catch (error) {
    console.error(
      "[lector-pulseras] leerPulsera",
      error
    );

    state.leyendo =
      false;

    actualizarBotonLectura();

    setLectorEstado(
      traducirErrorNfc(
        error
      ),
      true
    );
  }
}

async function buscarCodigoManual() {
  const codigo =
    sanitizarCodigo(
      $("codigoManual")
        ?.value
    );

  if (!codigo) {
    setLectorEstado(
      "Escribe un código para probar.",
      true
    );

    return;
  }

  await consultarCodigo(
    codigo
  );
}

async function consultarCodigo(
  codigo
) {
  setLectorEstado(
    `Consultando ${codigo}...`
  );

  try {
    const response =
      await llamarApi(
        "consultarPulsera",
        {
          codigo
        }
      );

    renderResultado(
      response
    );

    setLectorEstado(
      "Pulsera identificada correctamente.",
      false,
      true
    );

    navigator.vibrate?.(
      [100, 60, 100]
    );
  } catch (error) {
    $("resultadoPanel")
      .classList
      .add("hidden");

    setLectorEstado(
      error.message ||
      "No se pudo consultar la pulsera.",
      true
    );

    navigator.vibrate?.(
      [250, 100, 250]
    );
  }
}

function renderResultado(
  response
) {
  const modalidad =
    response.modalidad;

  $("resultadoTipo")
    .textContent =
    modalidad === "individual"
      ? "Pulsera individual"
      : "Pulsera grupal";

  $("resultadoCodigo")
    .textContent =
    response.codigo ||
    "—";

  if (
    modalidad ===
    "individual"
  ) {
    renderPasajeroIndividual(
      response.pasajero,
      response.grupo
    );
  } else {
    state.listaGrupal =
      Array.isArray(
        response.pasajeros
      )
        ? response.pasajeros
        : [];

    renderGrupoCompleto(
      response.grupo
    );
  }

  $("resultadoPanel")
    .classList
    .remove("hidden");

  $("resultadoPanel")
    .scrollIntoView({
      behavior:
        "smooth",
      block:
        "start"
    });
}

function renderPasajeroIndividual(
  pasajero = {},
  grupo = {}
) {
  $("resultadoContenido")
    .innerHTML = `
      ${crearCabeceraPasajero(
        pasajero,
        grupo
      )}

      ${crearDatosBasicos(
        pasajero
      )}

      ${crearSeccionMedica(
        pasajero
      )}
    `;
}

function renderGrupoCompleto(
  grupo = {}
) {
  $("resultadoContenido")
    .innerHTML = `
      <div class="result-header">
        <h3 class="result-name">
          ${esc(
            grupo.nombre ||
            grupo.colegio ||
            `Grupo ${grupo.numeroNegocio || ""}`
          )}
        </h3>

        <p class="result-subtitle">
          ${esc(
            [
              grupo.curso || "",
              grupo.destino || ""
            ]
              .filter(Boolean)
              .join(" · ") ||
            "Pulsera general del grupo"
          )}
        </p>
      </div>

      <div class="passenger-search">
        <label
          class="field-label"
          for="buscarPasajeroGrupo"
        >
          Buscar pasajero
        </label>

        <input
          id="buscarPasajeroGrupo"
          class="reader-input"
          type="search"
          autocomplete="off"
          placeholder="Nombre, apellido o RUT"
        />

        <div
          id="listaPasajerosGrupo"
          class="passenger-list"
        ></div>
      </div>
    `;

  renderListaGrupal();
}

function renderListaGrupal(
  filtro = ""
) {
  const contenedor =
    $("listaPasajerosGrupo");

  if (!contenedor) {
    return;
  }

  const criterio =
    normalizarBusqueda(
      filtro
    );

  const filtrados =
    state.listaGrupal
      .filter(
        (
          item
        ) => {
          if (!criterio) {
            return true;
          }

          const texto =
            normalizarBusqueda(
              [
                item.nombreCompleto,
                item.rut,
                item.tipo
              ].join(" ")
            );

          return texto.includes(
            criterio
          );
        }
      )
      .slice(
        0,
        100
      );

  if (!filtrados.length) {
    contenedor.innerHTML = `
      <div style="padding:15px">
        No se encontraron pasajeros.
      </div>
    `;

    return;
  }

  contenedor.innerHTML =
    filtrados
      .map(
        (
          item
        ) => `
          <button
            class="passenger-row"
            type="button"
            data-inscripcion-id="${escAtributo(
              item.inscripcionId
            )}"
          >
            <span>
              <strong>
                ${esc(
                  item.nombreCompleto ||
                  "Sin nombre"
                )}
              </strong>

              <span>
                ${esc(
                  [
                    item.rut || "",
                    item.tipo || ""
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </span>
            </span>

            <em>
              Ver ficha
            </em>
          </button>
        `
      )
      .join("");
}

async function cargarPasajeroGrupal(
  inscripcionId
) {
  if (!inscripcionId) {
    return;
  }

  setLectorEstado(
    "Cargando ficha del pasajero..."
  );

  try {
    const response =
      await llamarApi(
        "consultarPasajeroGrupo",
        {
          inscripcionId
        }
      );

    renderPasajeroIndividual(
      response.pasajero,
      response.grupo
    );

    $("resultadoTipo")
      .textContent =
      "Pasajero del grupo";

    setLectorEstado(
      "Ficha cargada correctamente.",
      false,
      true
    );
  } catch (error) {
    setLectorEstado(
      error.message ||
      "No se pudo cargar el pasajero.",
      true
    );
  }
}

function crearCabeceraPasajero(
  pasajero = {},
  grupo = {}
) {
  return `
    <div class="result-header">
      <h3 class="result-name">
        ${esc(
          pasajero.nombreCompleto ||
          "Pasajero"
        )}
      </h3>

      <p class="result-subtitle">
        ${esc(
          [
            pasajero.tipo || "",
            grupo.nombre ||
            grupo.colegio ||
            "",
            grupo.destino || ""
          ]
            .filter(Boolean)
            .join(" · ")
        )}
      </p>
    </div>
  `;
}

function crearDatosBasicos(
  pasajero = {}
) {
  const datos = [
    [
      "RUT",
      pasajero.rut
    ],
    [
      "Correo",
      pasajero.correo
    ],
    [
      "Teléfono",
      pasajero.telefono
    ],
    [
      "Ficha médica",
      pasajero.fichaCompleta
        ? "Completa"
        : "Pendiente"
    ],
    [
      "Contacto de emergencia",
      pasajero.contactoEmergencia
    ],
    [
      "Teléfono de emergencia",
      pasajero.telefonoEmergencia
    ]
  ];

  return `
    <div class="data-grid">
      ${datos
        .filter(
          (
            [
              _,
              valor
            ]
          ) =>
            valor !== undefined &&
            valor !== null &&
            valor !== ""
        )
        .map(
          (
            [
              label,
              value
            ]
          ) => `
            <div class="data-card">
              <span>
                ${esc(label)}
              </span>

              <strong>
                ${esc(value)}
              </strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function crearSeccionMedica(
  pasajero = {}
) {
  const datos = [
    [
      "Alergias",
      pasajero.alergias
    ],
    [
      "Medicamentos",
      pasajero.medicamentos
    ],
    [
      "Dieta o alimentación",
      pasajero.dieta
    ],
    [
      "Previsión de salud",
      pasajero.previsionSalud
    ],
    [
      "Observaciones médicas",
      pasajero.observacionesMedicas
    ]
  ]
    .filter(
      (
        [
          _,
          valor
        ]
      ) =>
        valor !== undefined &&
        valor !== null &&
        String(valor).trim() !== ""
    );

  if (!datos.length) {
    return "";
  }

  return `
    <section class="medical-section">
      <h3>
        Información médica
      </h3>

      <p class="medical-warning">
        Información de uso operativo. Tratar de manera confidencial.
      </p>

      <div class="data-grid">
        ${datos
          .map(
            (
              [
                label,
                value
              ]
            ) => `
              <div class="data-card">
                <span>
                  ${esc(label)}
                </span>

                <strong>
                  ${esc(value)}
                </strong>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

async function llamarApiSinSesion(
  accion,
  datos
) {
  validarApiConfigurada();

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
            ...datos
          })
      }
    );

  return procesarRespuesta(
    response
  );
}

async function llamarApi(
  accion,
  datos
) {
  validarApiConfigurada();

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
            ...datos
          })
      }
    );

  if (
    response.status === 401
  ) {
    limpiarSesionLocal();
  }

  return procesarRespuesta(
    response
  );
}

async function procesarRespuesta(
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

function validarApiConfigurada() {
  if (
    !PORTAL_CONFIG.apiUrl ||
    PORTAL_CONFIG.apiUrl.includes(
      "PEGAR_URL"
    )
  ) {
    throw new Error(
      "Falta configurar la URL de la Cloud Function en config.js."
    );
  }
}

function extraerCodigoNdef(
  message
) {
  for (
    const record
    of message.records ||
    []
  ) {
    if (
      record.recordType !==
      "text"
    ) {
      continue;
    }

    try {
      return sanitizarCodigo(
        new TextDecoder(
          record.encoding ||
          "utf-8"
        ).decode(
          record.data
        )
      );
    } catch {
      return "";
    }
  }

  return "";
}

function comprobarCompatibilidadNfc() {
  const box =
    $("compatibilidadNfc");

  if (
    "NDEFReader" in window
  ) {
    box.textContent =
      "Web NFC disponible. Usa Chrome en Android, NFC activado y acerca la pulsera a la parte posterior del teléfono.";

    return;
  }

  box.textContent =
    "Web NFC no está disponible en este navegador. Usa Chrome en Android o prueba ingresando el código manualmente.";
}

function toggleManual() {
  const panel =
    $("manualPanel");

  const oculta =
    panel.classList
      .toggle("hidden");

  $("btnMostrarManual")
    .textContent =
    oculta
      ? "Probar escribiendo un código"
      : "Ocultar prueba manual";
}

function bloquearIngreso(
  bloqueado
) {
  $("btnIngresarGrupo")
    .disabled =
    bloqueado;

  $("numeroNegocio")
    .disabled =
    bloqueado;
}

function actualizarBotonLectura() {
  $("btnLeerPulsera")
    .disabled =
    state.leyendo;

  $("btnLeerPulsera")
    .textContent =
    state.leyendo
      ? "ACERCA LA PULSERA..."
      : "LEER PULSERA NFC";
}

function limpiarSesionLocal() {
  sessionStorage.removeItem(
    PORTAL_CONFIG.sessionStorageKey
  );

  sessionStorage.removeItem(
    PORTAL_CONFIG.negocioStorageKey
  );

  state.sessionToken =
    "";

  state.numeroNegocio =
    "";
}

function setAccesoEstado(
  mensaje,
  error = false,
  ok = false
) {
  setEstado(
    $("accesoEstado"),
    mensaje,
    error,
    ok
  );
}

function setLectorEstado(
  mensaje,
  error = false,
  ok = false
) {
  setEstado(
    $("lectorEstado"),
    mensaje,
    error,
    ok
  );
}

function setEstado(
  elemento,
  mensaje,
  error,
  ok
) {
  if (!elemento) {
    return;
  }

  elemento.textContent =
    mensaje;

  elemento.classList
    .toggle(
      "error",
      error
    );

  elemento.classList
    .toggle(
      "ok",
      ok
    );
}

function sanitizarNegocio(
  valor = ""
) {
  return String(
    valor
  )
    .trim()
    .replace(
      /[^0-9A-Za-z_-]/g,
      ""
    )
    .slice(
      0,
      30
    );
}

function sanitizarCodigo(
  valor = ""
) {
  return String(
    valor
  )
    .normalize("NFD")
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
      80
    );
}

function normalizarBusqueda(
  valor = ""
) {
  return String(
    valor
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
}

function traducirErrorNfc(
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
    return "El dispositivo o la pulsera no son compatibles con Web NFC.";
  }

  if (
    error?.name ===
    "AbortError"
  ) {
    return "La lectura NFC fue cancelada.";
  }

  return error?.message ||
    "No se pudo iniciar la lectura NFC.";
}

function esc(
  valor = ""
) {
  return String(
    valor
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

function escAtributo(
  valor = ""
) {
  return esc(
    valor
  );
}
