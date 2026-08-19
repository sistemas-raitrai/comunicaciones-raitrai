import {
  PORTAL_CONFIG
} from "./config.js";

const $ = (id) =>
  document.getElementById(id);

const state = {
  sessionToken: "",
  activeGroup: null,

  groupPassengerList: [],
  lastGroupResponse: null,

  reading: false,

  modo: "",

  pendingNfcCode: "",

  ubicacion: null,
  ubicacionSolicitada: false
};

init();

async function init() {
  bindEvents();

  comprobarNfc();

  capturarNfcDesdeUrl();

  await restaurarSesion();
}

function bindEvents() {
  $("btnCerrarGrupo")
    ?.addEventListener(
      "click",
      cerrarSesionGrupo
    );

  $("btnToggleManual")
    ?.addEventListener(
      "click",
      toggleManual
    );

  $("btnBuscarCodigoManual")
    ?.addEventListener(
      "click",
      buscarCodigoManual
    );

  $("codigoManualInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
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
          "buscarPasajeroInput"
        ) {
          renderPassengerList(
            event.target.value
          );
        }
      }
    );

  $("resultadoContenido")
    ?.addEventListener(
      "click",
      (event) => {
        const passengerButton =
          event.target.closest(
            "[data-inscription-id]"
          );

        if (!passengerButton) {
          return;
        }

        cargarPasajeroGrupo(
          passengerButton.dataset.inscriptionId
        );
      }
    );

  $("btnVolverNomina")
    ?.addEventListener(
      "click",
      () => {
        if (
          state.lastGroupResponse
        ) {
          renderGroupResult(
            state.lastGroupResponse
          );
        }
      }
    );

  $("btnIngresar")
    ?.addEventListener(
      "click",
      iniciarSesion
    );

  $("idGrupoInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          $("numeroNegocioInput")
            ?.focus();
        }
      }
    );

  $("numeroNegocioInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          iniciarSesion();
        }
      }
    );

  $("btnModoFicha")
    ?.addEventListener(
      "click",
      activarModoFicha
    );

  $("btnIrAsistencia")
    ?.addEventListener(
      "click",
      irAAsistencia
    );

}

async function iniciarSesion() {
  const idGrupo =
    String(
      $("idGrupoInput")?.value ||
      ""
    )
      .trim()
      .replace(/\D/g, "");

  const numeroNegocio =
    normalizarNumeroNegocio(
      $("numeroNegocioInput")?.value ||
      ""
    );

  if (!idGrupo) {
    setState(
      "loginEstado",
      "Ingresa el ID del grupo.",
      true
    );

    return;
  }

  if (numeroNegocio.length < 4) {
    setState(
      "loginEstado",
      "Ingresa el número de negocio completo.",
      true
    );

    return;
  }

  setDisabled(
    "btnIngresar",
    true
  );

  setState(
    "loginEstado",
    "Validando acceso..."
  );

  try {
    const response =
      await callApiPublic(
        "iniciarSesionV2",
        {
          idGrupo,
          numeroNegocio
        }
      );

    state.sessionToken =
      response.sessionToken;

    state.activeGroup =
      response.grupo;

    localStorage.setItem(
      PORTAL_CONFIG.sessionTokenKey,
      state.sessionToken
    );

    localStorage.setItem(
      PORTAL_CONFIG.activeGroupKey,
      JSON.stringify(
        state.activeGroup
      )
    );

    abrirLector();

    await solicitarUbicacionInicial();

    await restaurarModo();

    await procesarNfcPendiente();
  } catch (error) {
    setState(
      "loginEstado",
      error.message ||
      "ID de grupo o clave incorrectos.",
      true
    );
  } finally {
    setDisabled(
      "btnIngresar",
      false
    );
  }
}

function abrirLector() {
  const group =
    state.activeGroup ||
    {};

  $("grupoActivoTitulo")
    .textContent =
    group.nombre ||
    group.aliasGrupo ||
    group.colegio ||
    `Grupo ${group.idGrupo || ""}`;

  $("grupoActivoDetalle")
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
    "Acceso autorizado";

  $("loginPanel")
    ?.classList
    .add("hidden");

  $("lectorPanel")
    ?.classList
    .remove("hidden");

  $("resultadoPanel")
    ?.classList
    .add("hidden");

  setState(
    "lectorEstado",
    "Acceso habilitado. Selecciona una acción.",
    false,
    true
  );
}

async function restaurarModo() {
  const modoGuardado =
    localStorage.getItem(
      PORTAL_CONFIG.modeKey
    ) ||
    "";

  if (
    modoGuardado ===
    "ficha_medica"
  ) {
    state.modo =
      "ficha_medica";

    setState(
      "lectorEstado",
      "Modo ficha médica activo. Acerca una pulsera o presiona LEER FICHA MÉDICA.",
      false,
      true
    );

    return;
  }

  state.modo =
    "";
}

async function restaurarSesion() {
  const token =
    localStorage.getItem(
      PORTAL_CONFIG.sessionTokenKey
    ) ||
    "";

  if (!token) {
    mostrarLogin();
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

    abrirLector();

    await recuperarUbicacionSilenciosa();

    await restaurarModo();

    await procesarNfcPendiente();
  } catch {
    limpiarSesion();
    mostrarLogin();
  }
}

function mostrarLogin() {
  $("loginPanel")
    ?.classList
    .remove("hidden");

  $("lectorPanel")
    ?.classList
    .add("hidden");

  $("resultadoPanel")
    ?.classList
    .add("hidden");
}

function cerrarSesionGrupo() {
  limpiarSesion();

  state.groupPassengerList =
    [];

  state.lastGroupResponse =
    null;

  state.ubicacion =
    null;

  $("lectorPanel")
    ?.classList
    .add("hidden");

  $("resultadoPanel")
    ?.classList
    .add("hidden");

  $("loginPanel")
    ?.classList
    .remove("hidden");

  if (
    $("idGrupoInput")
  ) {
    $("idGrupoInput").value =
      "";
  }

  if (
    $("numeroNegocioInput")
  ) {
    $("numeroNegocioInput").value =
      "";
  }

  if (
    $("codigoManualInput")
  ) {
    $("codigoManualInput").value =
      "";
  }

  if (
    $("nombreAsistenciaInput")
  ) {
    $("nombreAsistenciaInput").value =
      "";

    $("nombreAsistenciaInput").disabled =
      false;
  }

  setState(
    "loginEstado",
    "Ingresa tus datos de acceso."
  );

  window.setTimeout(
    () =>
      $("idGrupoInput")
        ?.focus(),
    100
  );
}

async function leerPulseraNfc() {
  if (
    !state.sessionToken
  ) {
    setState(
      "lectorEstado",
      "La sesión del grupo no está activa.",
      true
    );

    return;
  }

  if (
    !("NDEFReader" in window)
  ) {
    setState(
      "lectorEstado",
      "Web NFC no está disponible. Usa Chrome en Android o prueba escribiendo el código.",
      true
    );

    return;
  }

  if (
    state.reading
  ) {
    return;
  }

  state.reading =
    true;

  setState(
    "lectorEstado",
    "Acerca la pulsera a la parte posterior del teléfono..."
  );

  try {
    const controller =
      new AbortController();

    const ndef =
      new NDEFReader();

    await ndef.scan({
      signal:
        controller.signal
    });

    ndef.addEventListener(
      "readingerror",
      () => {
        setState(
          "lectorEstado",
          "No fue posible leer la pulsera. Inténtalo nuevamente.",
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
          extractNfcCode(
            event.message
          );

        if (!codigo) {
          setState(
            "lectorEstado",
            "La pulsera no contiene un código de texto válido.",
            true
          );

          return;
        }

        controller.abort();

        await consultarCodigo(
          codigo
        );

        state.reading =
          false;

      },
      {
        signal:
          controller.signal
      }
    );
  } catch (error) {
    console.error(
      "[lector-pulseras] NFC",
      error
    );

    state.reading =
      false;

    setState(
      "lectorEstado",
      translateNfcError(
        error
      ),
      true
    );
  }
}

async function buscarCodigoManual() {
  const codigo =
    sanitizeCode(
      $("codigoManualInput")
        ?.value
    );

  if (!codigo) {
    setState(
      "lectorEstado",
      "Escribe un código válido.",
      true
    );

    return;
  }

  await consultarCodigo(
    codigo
  );
}

async function consultarCodigo(
  codigoRaw
) {
  const codigo =
    sanitizeCode(
      codigoRaw
    );

  setState(
    "lectorEstado",
    `Consultando ${codigo}...`
  );

  try {
    const ubicacion =
      await obtenerUbicacionLectura();
    
    const response =
      await callApiSession(
        "consultarPulsera",
        {
          codigo,
    
          modo:
            "ficha_medica",
    
          ubicacion
        }
      );

    if (
      response.modalidad ===
      "grupal"
    ) {
      state.lastGroupResponse =
        response;

      state.groupPassengerList =
        Array.isArray(
          response.pasajeros
        )
          ? response.pasajeros
          : [];

      renderGroupResult(
        response
      );
    } else {
      renderIndividualResult(
        response
      );
    }

    setState(
      "lectorEstado",
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

    setState(
      "lectorEstado",
      error.message ||
      "No fue posible consultar la pulsera.",
      true
    );

    navigator.vibrate?.(
      [250, 100, 250]
    );
  }
}

function capturarNfcDesdeUrl() {
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
    Si existe una asistencia activa, esta pulsera
    debe ir al módulo de asistencia.

    Esto es especialmente importante en iPhone,
    porque iOS siempre abrirá la URL grabada
    en la pulsera.
  */
  const modoGuardado =
    localStorage.getItem(
      PORTAL_CONFIG.modeKey
    ) ||
    "";

  const asistenciaId =
    localStorage.getItem(
      PORTAL_CONFIG.activeAttendanceKey
    ) ||
    "";

  if (
    modoGuardado ===
      "asistencia" &&
    asistenciaId
  ) {
    window.location.replace(
      `asistencia.html?nfc=${encodeURIComponent(
        codigo
      )}`
    );

    return;
  }

  state.pendingNfcCode =
    codigo;

  sessionStorage.setItem(
    PORTAL_CONFIG.pendingNfcKey,
    codigo
  );

  const cleanUrl =
    `${window.location.origin}${window.location.pathname}`;

  window.history.replaceState(
    {},
    document.title,
    cleanUrl
  );
}

async function procesarNfcPendiente() {
  const codigo =
    state.pendingNfcCode ||
    sessionStorage.getItem(
      PORTAL_CONFIG.pendingNfcKey
    ) ||
    "";

  if (!codigo) {
    return;
  }

  if (
    !state.sessionToken
  ) {
    return;
  }

  state.pendingNfcCode =
    "";

  sessionStorage.removeItem(
    PORTAL_CONFIG.pendingNfcKey
  );

  state.modo =
    "ficha_medica";

  localStorage.setItem(
    PORTAL_CONFIG.modeKey,
    state.modo
  );

  await consultarCodigo(
    codigo
  );
}

function renderIndividualResult(
  response
) {
  const passenger =
    response.pasajero ||
    {};

  $("resultadoTipo")
    .textContent =
    "Pulsera individual";

  $("resultadoCodigo")
    .textContent =
    response.codigo ||
    "—";

  $("btnVolverNomina")
    .classList.toggle(
      "hidden",
      !state.lastGroupResponse
    );

  $("resultadoContenido")
    .innerHTML =
    buildPassengerHtml(
      passenger,
      response.grupo ||
      state.activeGroup ||
      {}
    );

  showResult();
}

function renderGroupResult(
  response
) {
  const group =
    response.grupo ||
    state.activeGroup ||
    {};

  $("resultadoTipo")
    .textContent =
    "Pulsera grupal";

  $("resultadoCodigo")
    .textContent =
    response.codigo ||
    "GRUPO";

  $("btnVolverNomina")
    .classList
    .add("hidden");

  $("resultadoContenido")
    .innerHTML = `
      <div class="person-header">
        <h3>
          ${esc(
            group.nombre ||
            group.colegio ||
            "Grupo"
          )}
        </h3>

        <p>
          ${esc(
            [
              group.curso,
              group.destino,
              group.anoViaje
            ]
              .filter(Boolean)
              .join(" · ")
          )}
        </p>

        <div class="status-row">
          <span class="status-pill ok">
            ${state.groupPassengerList.length} pasajero(s)
          </span>
        </div>
      </div>

      <div class="passenger-search">
        <label
          class="field-label"
          for="buscarPasajeroInput"
        >
          Buscar pasajero
        </label>

        <input
          id="buscarPasajeroInput"
          class="portal-input"
          type="search"
          autocomplete="off"
          placeholder="Nombre, apellido o RUT"
        />

        <div
          id="listaPasajeros"
          class="passenger-list"
        ></div>
      </div>
    `;

  renderPassengerList();

  showResult();
}

function renderPassengerList(
  filter = ""
) {
  const container =
    $("listaPasajeros");

  if (!container) {
    return;
  }

  const query =
    normalizeSearch(
      filter
    );

  const rows =
    state.groupPassengerList
      .filter(
        (
          item
        ) => {
          if (!query) {
            return true;
          }

          return normalizeSearch(
            [
              item.nombreCompleto,
              item.documento,
              item.tipo
            ]
              .filter(Boolean)
              .join(" ")
          ).includes(
            query
          );
        }
      )
      .slice(
        0,
        150
      );

  if (!rows.length) {
    container.innerHTML = `
      <div class="empty-box">
        No se encontraron pasajeros.
      </div>
    `;

    return;
  }

  container.innerHTML =
    rows
      .map(
        (
          item
        ) => `
          <button
            class="passenger-row"
            type="button"
            data-inscription-id="${escAttribute(
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
                    item.documento,
                    item.tipo,
                    item.fichaCompleta
                      ? "Ficha completa"
                      : "Ficha pendiente"
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

async function cargarPasajeroGrupo(
  inscriptionId
) {
  if (!inscriptionId) {
    return;
  }

  setState(
    "lectorEstado",
    "Cargando ficha del pasajero..."
  );

  try {
    const response =
      await callApiSession(
        "consultarPasajeroGrupo",
        {
          inscripcionId:
            inscriptionId,
    
          codigo:
            state.lastGroupResponse
              ?.codigo ||
            ""
        }
      );

    $("resultadoTipo")
      .textContent =
      "Pasajero del grupo";

    $("resultadoCodigo")
      .textContent =
      state.lastGroupResponse
        ?.codigo ||
      "GRUPO";

    $("btnVolverNomina")
      .classList
      .remove("hidden");

    $("resultadoContenido")
      .innerHTML =
      buildPassengerHtml(
        response.pasajero ||
        {},
        response.grupo ||
        state.activeGroup ||
        {}
      );

    showResult();

    setState(
      "lectorEstado",
      "Ficha cargada correctamente.",
      false,
      true
    );
  } catch (error) {
    setState(
      "lectorEstado",
      error.message ||
      "No fue posible cargar la ficha.",
      true
    );
  }
}

function buildPassengerHtml(
  passenger,
  group
) {
  const identity =
    passenger.identificacion ||
    {};

  const contact =
    passenger.contactoPrincipal ||
    {};

  const secondaryContact =
    passenger.contactoSecundario ||
    {};

  const emergency =
    passenger.emergencia ||
    {};

  const secondaryEmergency =
    passenger.emergenciaSecundaria ||
    {};

  const health =
    passenger.salud ||
    {};

  const alerts =
    Array.isArray(
      passenger.alertasMedicas
    )
      ? passenger.alertasMedicas
      : [];

  const statusClass =
    passenger.anulado
      ? "danger"
      : passenger.fichaCompleta
        ? "ok"
        : "warn";

  return `
    <div class="person-header">
      <h3>
        ${esc(
          identity.nombreCompleto ||
          passenger.nombreCompleto ||
          "Pasajero"
        )}
      </h3>

      <p>
        ${esc(
          [
            passenger.tipo,
            group.nombre ||
            group.colegio,
            group.destino
          ]
            .filter(Boolean)
            .join(" · ")
        )}
      </p>

      <div class="status-row">
        <span class="status-pill ${statusClass}">
          ${
            passenger.anulado
              ? "Anulado / no viaja"
              : passenger.fichaCompleta
                ? "Ficha médica completa"
                : "Ficha médica pendiente"
          }
        </span>

        ${
          alerts.length
            ? `
              <span class="status-pill danger">
                ${alerts.length} alerta(s)
              </span>
            `
            : `
              <span class="status-pill ok">
                Sin alertas detectadas
              </span>
            `
        }
      </div>
    </div>

    ${
      alerts.length
        ? `
          <div class="alerts-box">
            <h4>
              Alertas médicas
            </h4>

            <ul>
              ${alerts
                .map(
                  (
                    alert
                  ) => `
                    <li>
                      ${esc(alert)}
                    </li>
                  `
                )
                .join("")}
            </ul>
          </div>
        `
        : ""
    }

    ${buildSection(
      "Identificación",
      [
        [
          "Documento",
          identity.documento ||
          passenger.documento
        ],
        [
          "Fecha de nacimiento",
          identity.fechaNacimiento
        ],
        [
          "Edad",
          identity.edad
        ],
        [
          "Género",
          identity.genero
        ],
        [
          "Nacionalidad",
          identity.nacionalidad
        ],
        [
          "Tipo de viajante",
          passenger.tipoViajante
        ]
      ]
    )}

    ${buildSection(
      "Contacto principal",
      [
        [
          "Nombre",
          contact.nombre
        ],
        [
          "Relación",
          contact.relacion
        ],
        [
          "Teléfono",
          contact.telefono
        ],
        [
          "Correo",
          contact.correo
        ]
      ]
    )}

    ${buildSection(
      "Contacto secundario",
      [
        [
          "Nombre",
          secondaryContact.nombre
        ],
        [
          "Relación",
          secondaryContact.relacion
        ],
        [
          "Teléfono",
          secondaryContact.telefono
        ],
        [
          "Correo",
          secondaryContact.correo
        ]
      ]
    )}

    ${buildSection(
      "Contacto de emergencia",
      [
        [
          "Nombre",
          emergency.nombre
        ],
        [
          "Relación",
          emergency.relacion
        ],
        [
          "Teléfono",
          emergency.telefono
        ],
        [
          "Correo",
          emergency.correo
        ]
      ]
    )}

    ${buildSection(
      "Emergencia secundaria",
      [
        [
          "Nombre",
          secondaryEmergency.nombre
        ],
        [
          "Relación",
          secondaryEmergency.relacion
        ],
        [
          "Teléfono",
          secondaryEmergency.telefono
        ]
      ]
    )}

    ${buildMedicalSection(
      health
    )}
  `;
}

function buildMedicalSection(
  health
) {
  const rows = [
    [
      "Grupo sanguíneo",
      health.grupoSanguineo
    ],
    [
      "Discapacidad",
      health.discapacidad
    ],
    [
      "Ayudas técnicas",
      health.ayudasTecnicas
    ],
    [
      "Apoyos de autonomía",
      health.apoyosAutonomia
    ],
    [
      "Neurodivergencia",
      health.neurodivergencia
    ],
    [
      "Factores de sobrecarga",
      health.neuroFactores
    ],
    [
      "Estrategias de regulación",
      health.neuroEstrategias
    ],
    [
      "Apoyos neurodivergencia",
      health.neuroApoyos
    ],
    [
      "Salud mental",
      health.saludMental
    ],
    [
      "Enfermedad de base",
      health.enfermedadBase
    ],
    [
      "Salud general",
      health.saludGeneral
    ],
    [
      "Cirugías previas",
      health.cirugiasPrevias
    ],
    [
      "Emergencias médicas",
      health.emergenciaMedica
    ],
    [
      "Medicamentos",
      health.medicamentos
    ],
    [
      "Medicamentos prohibidos",
      health.medicamentosProhibidos
    ],
    [
      "Alergias",
      health.alergias
    ],
    [
      "Alergias alimentarias",
      health.alergiasAlimentarias
    ],
    [
      "Dieta principal",
      health.dietaPrincipal
    ],
    [
      "Restricciones alimentarias",
      health.dietaRestricciones
    ],
    [
      "Dieta especial",
      health.dieta
    ],
    [
      "Otros antecedentes",
      health.otrosAntecedentes
    ]
  ];

  return buildSection(
    "Ficha médica",
    rows,
    {
      medical:
        true,

      note:
        "Información confidencial para uso operativo durante el viaje."
    }
  );
}

function buildSection(
  title,
  rows,
  options = {}
) {
  const visible =
    rows.filter(
      (
        [
          _,
          value
        ]
      ) =>
        value !== undefined &&
        value !== null &&
        String(
          value
        ).trim() !== ""
    );

  if (!visible.length) {
    return "";
  }

  return `
    <section class="info-section ${
      options.medical
        ? "medical"
        : ""
    }">
      <h3>
        ${esc(title)}
      </h3>

      ${
        options.note
          ? `
            <p class="section-note">
              ${esc(options.note)}
            </p>
          `
          : ""
      }

      <div class="data-grid">
        ${visible
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

function showResult() {
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

function toggleManual() {
  const panel =
    $("manualPanel");

  const hidden =
    panel.classList
      .toggle("hidden");

  $("btnToggleManual")
    .textContent =
    hidden
      ? "Probar escribiendo el código"
      : "Ocultar prueba manual";
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
      "Android compatible: presiona el botón y acerca la pulsera.";
    return;
  }

  box.textContent =
    "iPhone: acerca la pulsera a la parte superior del teléfono y toca la notificación NFC.";
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
        .get("nfc");

    if (codigo) {
      return sanitizeCode(
        codigo
      );
    }
  } catch {
    // no era URL
  }

  return sanitizeCode(
    raw
  );
}

async function callApiPublic(
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
            ...payload
          })
      }
    );

  return parseApiResponse(
    response
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
    limpiarSesion();
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

function limpiarSesion() {
  localStorage.removeItem(
    PORTAL_CONFIG.sessionTokenKey
  );

  localStorage.removeItem(
    PORTAL_CONFIG.activeGroupKey
  );

  sessionStorage.removeItem(
    PORTAL_CONFIG.pendingNfcKey
  );

  sessionStorage.removeItem(
    PORTAL_CONFIG.pendingModeKey
  );

  localStorage.removeItem(
    PORTAL_CONFIG.modeKey
  );
  
  localStorage.removeItem(
    PORTAL_CONFIG.activeAttendanceKey
  );

  localStorage.removeItem(
    PORTAL_CONFIG.activeAttendanceKey
  );

  state.sessionToken =
    "";

  state.activeGroup =
    null;

  state.pendingNfcCode =
    "";

  state.modo =
    "";
}

async function solicitarUbicacionInicial() {
  if (
    !navigator.geolocation
  ) {
    actualizarEstadoUbicacion(
      "Ubicación no disponible en este dispositivo."
    );

    return;
  }

  const preference =
    localStorage.getItem(
      PORTAL_CONFIG.locationPreferenceKey
    );

  if (
    preference ===
    "denied"
  ) {
    actualizarEstadoUbicacion(
      "Ubicación desactivada. Las lecturas seguirán funcionando."
    );

    return;
  }

  await obtenerUbicacion({
    inicial:
      true
  });
}

async function recuperarUbicacionSilenciosa() {
  if (
    !navigator.geolocation
  ) {
    return;
  }

  const preference =
    localStorage.getItem(
      PORTAL_CONFIG.locationPreferenceKey
    );

  if (
    preference !==
    "allowed"
  ) {
    return;
  }

  await obtenerUbicacion({
    inicial:
      false
  });
}

function obtenerUbicacion({
  inicial = false
} = {}) {
  return new Promise(
    (
      resolve
    ) => {
      navigator.geolocation
        .getCurrentPosition(
          (
            position
          ) => {
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
          () => {
            state.ubicacion =
              null;

            if (inicial) {
              localStorage.setItem(
                PORTAL_CONFIG.locationPreferenceKey,
                "denied"
              );
            }

            actualizarEstadoUbicacion(
              "Ubicación no autorizada. Las lecturas seguirán funcionando."
            );

            resolve(
              null
            );
          },
          {
            enableHighAccuracy:
              true,

            timeout:
              8000,

            maximumAge:
              30000
          }
        );
    }
  );
}

async function activarModoFicha() {
  state.modo =
    "ficha_medica";

  localStorage.setItem(
    PORTAL_CONFIG.modeKey,
    state.modo
  );

  $("asistenciaPanel")
    ?.classList
    .add("hidden");

  setState(
    "lectorEstado",
    "Modo ficha médica activo. Acerca una pulsera.",
    false,
    true
  );

  /*
    En Android podemos iniciar Web NFC
    inmediatamente al tocar LEER FICHA MÉDICA.
    En iPhone la pulsera abre la URL directamente.
  */
  if (
    "NDEFReader" in window
  ) {
    await leerPulseraNfc();
  }
}

function irAAsistencia() {
  if (
    !state.sessionToken
  ) {
    setState(
      "lectorEstado",
      "La sesión del grupo no está activa.",
      true
    );

    return;
  }

  localStorage.setItem(
    PORTAL_CONFIG.modeKey,
    "asistencia"
  );

  window.location.href =
    "asistencia.html";
}

async function obtenerUbicacionLectura() {
  const preference =
    localStorage.getItem(
      PORTAL_CONFIG.locationPreferenceKey
    );

  if (
    preference !==
    "allowed"
  ) {
    return null;
  }

  return obtenerUbicacion({
    inicial:
      false
  });
}

function actualizarEstadoUbicacion(
  texto
) {
  const box =
    $("ubicacionEstado");

  if (box) {
    box.textContent =
      texto;
  }
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
  const element =
    $(id);

  if (element) {
    element.disabled =
      disabled;
  }
}

function normalizarNumeroNegocio(
  value = ""
) {
  return String(
    value
  ).replace(
    /\D/g,
    ""
  );
}

function sanitizeCode(
  value = ""
) {
  return String(
    value
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
      100
    );
}

function normalizeSearch(
  value = ""
) {
  return String(
    value
  )
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .trim();
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
    return "El teléfono, el navegador o la pulsera no son compatibles con Web NFC.";
  }

  if (
    error?.name ===
    "AbortError"
  ) {
    return "La lectura NFC fue cancelada.";
  }

  return error?.message ||
    "No fue posible iniciar la lectura NFC.";
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

function escAttribute(
  value = ""
) {
  return esc(
    value
  );
}

