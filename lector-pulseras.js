import {
  PORTAL_CONFIG
} from "./config.js";

const $ = (id) =>
  document.getElementById(id);

const state = {
  selectedGroup: null,
  sessionToken: "",
  activeGroup: null,

  groupResults: [],
  groupPassengerList: [],
  lastGroupResponse: null,

  reading: false
};

init();

function init() {
  bindEvents();
  comprobarNfc();
  restaurarSesion();
}

function bindEvents() {
  $("btnBuscarGrupo")
    ?.addEventListener(
      "click",
      buscarGrupos
    );

  $("buscarGrupoInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          buscarGrupos();
        }
      }
    );

  $("resultadosGrupos")
    ?.addEventListener(
      "click",
      (event) => {
        const button =
          event.target.closest(
            "[data-group-index]"
          );

        if (!button) {
          return;
        }

        seleccionarGrupo(
          Number(
            button.dataset.groupIndex
          )
        );
      }
    );

  $("btnCambiarSeleccion")
    ?.addEventListener(
      "click",
      volverABusqueda
    );

  $("btnValidarClave")
    ?.addEventListener(
      "click",
      validarNumeroNegocio
    );

  $("numeroNegocioInput")
    ?.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key ===
          "Enter"
        ) {
          validarNumeroNegocio();
        }
      }
    );

  $("btnCerrarGrupo")
    ?.addEventListener(
      "click",
      cerrarSesionGrupo
    );

  $("btnLeerPulsera")
    ?.addEventListener(
      "click",
      leerPulseraNfc
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
          passengerButton.dataset
            .inscriptionId
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
}

async function buscarGrupos() {
  const texto =
    String(
      $("buscarGrupoInput")
        ?.value ||
      ""
    ).trim();

  if (
    texto.length < 2
  ) {
    setState(
      "buscarGrupoEstado",
      "Escribe al menos dos caracteres.",
      true
    );

    return;
  }

  setDisabled(
    "btnBuscarGrupo",
    true
  );

  setState(
    "buscarGrupoEstado",
    "Buscando grupos..."
  );

  try {
    const response =
      await callApiPublic(
        "buscarGrupos",
        {
          texto
        }
      );

    state.groupResults =
      Array.isArray(
        response.grupos
      )
        ? response.grupos
        : [];

    renderGroupResults();

    setState(
      "buscarGrupoEstado",
      state.groupResults.length
        ? `${state.groupResults.length} grupo(s) encontrado(s).`
        : "No se encontraron grupos.",
      false,
      state.groupResults.length > 0
    );
  } catch (error) {
    state.groupResults =
      [];

    $("resultadosGrupos")
      .classList
      .add("hidden");

    setState(
      "buscarGrupoEstado",
      error.message ||
      "No fue posible buscar grupos.",
      true
    );
  } finally {
    setDisabled(
      "btnBuscarGrupo",
      false
    );
  }
}

function renderGroupResults() {
  const container =
    $("resultadosGrupos");

  if (
    !state.groupResults.length
  ) {
    container.innerHTML =
      "";

    container.classList
      .add("hidden");

    return;
  }

  container.innerHTML =
    state.groupResults
      .map(
        (
          group,
          index
        ) => `
          <button
            class="group-result"
            type="button"
            data-group-index="${index}"
          >
            <span>
              <strong>
                ${esc(
                  group.nombre ||
                  group.colegio ||
                  `Grupo ${group.idGrupo || ""}`
                )}
              </strong>

              <span>
                ${esc(
                  [
                    group.colegio,
                    group.curso,
                    group.destino,
                    group.anoViaje
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </span>
            </span>

            <em>
              Seleccionar
            </em>
          </button>
        `
      )
      .join("");

  container.classList
    .remove("hidden");
}

function seleccionarGrupo(
  index
) {
  const group =
    state.groupResults[
      index
    ];

  if (!group) {
    return;
  }

  state.selectedGroup =
    group;

  renderSelectedGroup(
    group
  );

  $("buscarGrupoPanel")
    .classList
    .add("hidden");

  $("validarClavePanel")
    .classList
    .remove("hidden");

  $("numeroNegocioInput")
    .value =
    "";

  setState(
    "validarClaveEstado",
    "Ingresa el número de negocio del grupo seleccionado."
  );

  window.setTimeout(
    () =>
      $("numeroNegocioInput")
        ?.focus(),
    80
  );
}

function renderSelectedGroup(
  group
) {
  $("grupoSeleccionadoTitulo")
    .textContent =
    group.nombre ||
    group.colegio ||
    "Grupo seleccionado";

  $("grupoSeleccionadoDetalle")
    .textContent =
    [
      group.colegio,
      group.curso,
      group.destino,
      group.anoViaje
    ]
      .filter(Boolean)
      .join(" · ") ||
    "—";
}

function volverABusqueda() {
  state.selectedGroup =
    null;

  $("validarClavePanel")
    .classList
    .add("hidden");

  $("buscarGrupoPanel")
    .classList
    .remove("hidden");

  $("numeroNegocioInput")
    .value =
    "";
}

async function validarNumeroNegocio() {
  if (
    !state.selectedGroup
  ) {
    setState(
      "validarClaveEstado",
      "Primero selecciona un grupo.",
      true
    );

    return;
  }

  const numeroNegocio =
    String(
      $("numeroNegocioInput")
        ?.value ||
      ""
    ).trim();

  if (
    normalizarNumeroNegocio(
      numeroNegocio
    ).length < 4
  ) {
    setState(
      "validarClaveEstado",
      "Ingresa el número de negocio completo.",
      true
    );

    return;
  }

  setDisabled(
    "btnValidarClave",
    true
  );

  setState(
    "validarClaveEstado",
    "Validando número de negocio..."
  );

  try {
    const response =
      await callApiPublic(
        "iniciarSesion",
        {
          groupDocId:
            state.selectedGroup
              .groupDocId,

          numeroNegocio
        }
      );

    state.sessionToken =
      response.sessionToken;

    state.activeGroup =
      response.grupo;

    sessionStorage.setItem(
      PORTAL_CONFIG.sessionTokenKey,
      state.sessionToken
    );

    sessionStorage.setItem(
      PORTAL_CONFIG.selectedGroupKey,
      JSON.stringify(
        state.activeGroup
      )
    );

    abrirLector();
  } catch (error) {
    setState(
      "validarClaveEstado",
      error.message ||
      "El número de negocio no coincide con el grupo.",
      true
    );
  } finally {
    setDisabled(
      "btnValidarClave",
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
    group.colegio ||
    "Grupo autorizado";

  $("grupoActivoDetalle")
    .textContent =
    [
      group.colegio,
      group.curso,
      group.destino,
      group.anoViaje
    ]
      .filter(Boolean)
      .join(" · ") ||
    "Acceso autorizado";

  $("buscarGrupoPanel")
    .classList
    .add("hidden");

  $("validarClavePanel")
    .classList
    .add("hidden");

  $("lectorPanel")
    .classList
    .remove("hidden");

  $("resultadoPanel")
    .classList
    .add("hidden");

  setState(
    "lectorEstado",
    "Acceso habilitado. Presiona “Leer pulsera NFC”.",
    false,
    true
  );
}

async function restaurarSesion() {
  const token =
    sessionStorage.getItem(
      PORTAL_CONFIG.sessionTokenKey
    ) ||
    "";

  if (!token) {
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
  } catch {
    limpiarSesion();
  }
}

function cerrarSesionGrupo() {
  limpiarSesion();

  state.selectedGroup =
    null;

  state.activeGroup =
    null;

  state.groupPassengerList =
    [];

  state.lastGroupResponse =
    null;

  $("lectorPanel")
    .classList
    .add("hidden");

  $("resultadoPanel")
    .classList
    .add("hidden");

  $("validarClavePanel")
    .classList
    .add("hidden");

  $("buscarGrupoPanel")
    .classList
    .remove("hidden");

  $("buscarGrupoInput")
    .value =
    "";

  $("numeroNegocioInput")
    .value =
    "";

  $("codigoManualInput")
    .value =
    "";

  $("resultadosGrupos")
    .classList
    .add("hidden");

  setState(
    "buscarGrupoEstado",
    "Escribe al menos dos caracteres para buscar."
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

  updateReadButton();

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
          extractTextCode(
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

        updateReadButton();
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

    updateReadButton();

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
    const response =
      await callApiSession(
        "consultarPulsera",
        {
          codigo
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
            inscriptionId
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

  if (
    "NDEFReader" in window
  ) {
    box.textContent =
      "Web NFC disponible. Usa Chrome en Android, mantén NFC activado y acerca la pulsera a la parte posterior del teléfono.";

    return;
  }

  box.textContent =
    "Web NFC no está disponible aquí. Usa Chrome en Android o prueba escribiendo el código manualmente.";
}

function updateReadButton() {
  $("btnLeerPulsera")
    .disabled =
    state.reading;

  $("btnLeerPulsera")
    .textContent =
    state.reading
      ? "ACERCA LA PULSERA..."
      : "LEER PULSERA NFC";
}

function extractTextCode(
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
      return sanitizeCode(
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
  sessionStorage.removeItem(
    PORTAL_CONFIG.sessionTokenKey
  );

  sessionStorage.removeItem(
    PORTAL_CONFIG.selectedGroupKey
  );

  state.sessionToken =
    "";
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
