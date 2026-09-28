/*
  rifa-raitrai.js

  Contrato esperado de la Cloud Function:

  POST API_URL
  { accion: "listarGruposRifa" }

  Respuesta:
  {
    ok: true,
    grupos: [
      {
        idGrupo: "10655",
        colegio: "San Ignacio",
        curso: "3A",
        anoViaje: 2026
      }
    ]
  }

  POST API_URL
  {
    accion: "registrarReservaRifa",
    idGrupo: "10655",
    contacto: {
      nombres: "...",
      apellidos: "...",
      telefono: "+56912345678",
      correo: "...",
      relacion: "apoderado",
      otraRelacion: "",
      asiste: true
    },
    asistentesAdicionales: [
      {
        nombres: "...",
        apellidos: "...",
        relacion: "estudiante",
        otraRelacion: ""
      }
    ]
  }

  Respuesta:
  {
    ok: true,
    reservaId: "...",
    totalAsistentes: 2
  }
*/

const API_URL =
  "https://southamerica-west1-sist-op-rt.cloudfunctions.net/rifaRaiTraiPublica";

const $ = (id) =>
  document.getElementById(id);

const state = {
  grupos: [],
  grupoSeleccionado: null,
  enviando: false,
  siguienteAsistenteId: 1
};

const RELACIONES = {
  estudiante: "Estudiante",
  apoderado: "Apoderado(a)",
  profesor: "Profesor(a)",
  otro: "Otro"
};

const MAX_ASISTENTES_ADICIONALES = 20;

iniciar();

function iniciar() {
  $("grupoBusqueda").addEventListener(
    "input",
    manejarBusquedaGrupo
  );

  $("contactoRelacion").addEventListener(
    "change",
    () => {
      actualizarOtraRelacionContacto();
      actualizarResumen();
    }
  );

  $("contactoNoAsiste").addEventListener(
    "change",
    actualizarResumen
  );

  $("btnAgregarAsistente").addEventListener(
    "click",
    agregarAsistente
  );

  $("reservaForm").addEventListener(
    "input",
    actualizarResumen
  );

  $("reservaForm").addEventListener(
    "change",
    actualizarResumen
  );

  $("reservaForm").addEventListener(
    "submit",
    confirmarReserva
  );

  $("btnNuevaReserva").addEventListener(
    "click",
    reiniciarFormulario
  );

  cargarGrupos();
}

async function solicitarApi(datos) {
  if (
    !API_URL ||
    API_URL.includes("PEGAR_URL")
  ) {
    throw new Error(
      "Falta configurar la URL de la Cloud Function en rifa-raitrai.js."
    );
  }

  let respuesta;

  try {
    respuesta = await fetch(
      API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(datos)
      }
    );
  } catch {
    throw new Error(
      "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo nuevamente."
    );
  }

  let contenido;

  try {
    contenido = await respuesta.json();
  } catch {
    throw new Error(
      "El servidor devolvió una respuesta inesperada."
    );
  }

  if (
    !respuesta.ok ||
    contenido?.ok === false
  ) {
    throw new Error(
      contenido?.error ||
      contenido?.mensaje ||
      "No pudimos completar la solicitud."
    );
  }

  return contenido;
}

async function cargarGrupos() {
  const resultados = $("grupoResultados");

  resultados.textContent =
    "Cargando grupos disponibles...";

  try {
    const respuesta = await solicitarApi({
      accion: "listarGruposRifa"
    });

    if (!Array.isArray(respuesta.grupos)) {
      throw new Error(
        "La lista de grupos tiene un formato incorrecto."
      );
    }

    state.grupos = respuesta.grupos
      .map(normalizarGrupo)
      .filter((grupo) =>
        grupo.idGrupo &&
        grupo.colegio &&
        grupo.curso &&
        grupo.anoViaje === 2026
      );

    manejarBusquedaGrupo();
  } catch (error) {
    resultados.textContent =
      error.message ||
      "No pudimos cargar los grupos.";

    mostrarEstado(
      "No pudimos cargar los grupos. Recarga la página para intentar nuevamente.",
      true
    );
  }
}

function normalizarGrupo(grupo) {
  return {
    idGrupo: String(
      grupo?.idGrupo ?? ""
    ).trim(),

    colegio: String(
      grupo?.colegio ?? ""
    ).trim(),

    curso: String(
      grupo?.curso ?? ""
    ).trim(),

    anoViaje: Number(
      grupo?.anoViaje
    )
  };
}

function textoBuscable(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coincideGrupo(grupo, busqueda) {
  const terminos = textoBuscable(busqueda)
    .split(/\s+/)
    .filter(Boolean);

  const conjunto = textoBuscable(
    [
      grupo.idGrupo,
      grupo.colegio,
      grupo.curso,
      grupo.anoViaje
    ].join(" ")
  );

  return terminos.every(
    (termino) =>
      conjunto.includes(termino)
  );
}

function manejarBusquedaGrupo() {
  const input = $("grupoBusqueda");
  const resultados = $("grupoResultados");
  const busqueda = input.value.trim();

  resultados.replaceChildren();

  /*
    Si alguien modifica la búsqueda después de seleccionar,
    debe seleccionar nuevamente una coincidencia.
  */
  if (
    state.grupoSeleccionado &&
    busqueda !==
      etiquetaGrupo(
        state.grupoSeleccionado
      )
  ) {
    state.grupoSeleccionado = null;
    $("grupoSeleccionado")
      .classList.add("hidden");
  }

  if (!state.grupos.length) {
    resultados.textContent =
      "No hay grupos disponibles para mostrar.";

    input.setAttribute(
      "aria-expanded",
      "false"
    );

    actualizarResumen();
    return;
  }

  if (!busqueda) {
    resultados.textContent =
      "Escribe el ID, colegio o curso para buscar.";

    input.setAttribute(
      "aria-expanded",
      "false"
    );

    actualizarResumen();
    return;
  }

  if (state.grupoSeleccionado) {
    input.setAttribute(
      "aria-expanded",
      "false"
    );

    actualizarResumen();
    return;
  }

  const coincidencias = state.grupos
    .filter(
      (grupo) =>
        coincideGrupo(
          grupo,
          busqueda
        )
    )
    .slice(0, 12);

  if (!coincidencias.length) {
    resultados.textContent =
      "No encontramos grupos con esa búsqueda.";

    input.setAttribute(
      "aria-expanded",
      "false"
    );

    actualizarResumen();
    return;
  }

  for (const grupo of coincidencias) {
    const boton =
      document.createElement("button");

    boton.type = "button";
    boton.className = "search-result";
    boton.textContent =
      etiquetaGrupo(grupo);

    boton.addEventListener(
      "click",
      () => seleccionarGrupo(grupo)
    );

    resultados.appendChild(boton);
  }

  input.setAttribute(
    "aria-expanded",
    "true"
  );

  actualizarResumen();
}

function etiquetaGrupo(grupo) {
  return [
    grupo.idGrupo,
    grupo.colegio,
    grupo.curso,
    grupo.anoViaje
  ].join(" · ");
}

function seleccionarGrupo(grupo) {
  state.grupoSeleccionado = grupo;

  $("grupoBusqueda").value =
    etiquetaGrupo(grupo);

  $("grupoResultados")
    .replaceChildren();

  $("grupoBusqueda").setAttribute(
    "aria-expanded",
    "false"
  );

  const seleccionado =
    $("grupoSeleccionado");

  seleccionado.textContent =
    `Grupo seleccionado: ${etiquetaGrupo(grupo)}`;

  seleccionado.classList.remove(
    "hidden"
  );

  actualizarResumen();
}

function actualizarOtraRelacionContacto() {
  const esOtro =
    $("contactoRelacion").value === "otro";

  $("contactoOtraRelacionCampo")
    .classList.toggle(
      "hidden",
      !esOtro
    );

  $("contactoOtraRelacion").required =
    esOtro;

  if (!esOtro) {
    $("contactoOtraRelacion").value = "";
  }
}

function agregarAsistente() {
  const contenedor =
    $("asistentesAdicionales");

  if (
    contenedor.children.length >=
    MAX_ASISTENTES_ADICIONALES
  ) {
    mostrarEstado(
      `Puedes agregar hasta ${MAX_ASISTENTES_ADICIONALES} personas adicionales en una reserva.`,
      true
    );

    return;
  }

  const id =
    state.siguienteAsistenteId++;

  const tarjeta =
    document.createElement("div");

  tarjeta.className = "attendee";
  tarjeta.dataset.asistenteId =
    String(id);

  tarjeta.innerHTML = `
    <div class="attendee-top">
      <h3>Persona adicional</h3>

      <button
        class="button text"
        type="button"
        data-accion="eliminar"
      >
        Quitar
      </button>
    </div>

    <div class="grid">
      <div class="field">
        <label for="asistenteNombres${id}">
          Nombre(s)
        </label>

        <input
          id="asistenteNombres${id}"
          data-campo="nombres"
          autocomplete="off"
          required
        >
      </div>

      <div class="field">
        <label for="asistenteApellidos${id}">
          Apellidos
        </label>

        <input
          id="asistenteApellidos${id}"
          data-campo="apellidos"
          autocomplete="off"
          required
        >
      </div>
    </div>

    <div class="field">
      <label for="asistenteRelacion${id}">
        Relación con el grupo
      </label>

      <select
        id="asistenteRelacion${id}"
        data-campo="relacion"
        required
      >
        <option value="">
          Selecciona una opción
        </option>

        <option value="estudiante">
          Estudiante
        </option>

        <option value="apoderado">
          Apoderado(a)
        </option>

        <option value="profesor">
          Profesor(a)
        </option>

        <option value="otro">
          Otro
        </option>
      </select>
    </div>

    <div
      class="field hidden"
      data-bloque-otra-relacion
    >
      <label for="asistenteOtraRelacion${id}">
        Especifica su relación
      </label>

      <input
        id="asistenteOtraRelacion${id}"
        data-campo="otraRelacion"
        maxlength="80"
      >
    </div>
  `;

  tarjeta
    .querySelector(
      '[data-accion="eliminar"]'
    )
    .addEventListener(
      "click",
      () => {
        tarjeta.remove();
        actualizarResumen();
      }
    );

  tarjeta
    .querySelector(
      '[data-campo="relacion"]'
    )
    .addEventListener(
      "change",
      () => {
        actualizarOtraRelacionAsistente(
          tarjeta
        );

        actualizarResumen();
      }
    );

  contenedor.appendChild(tarjeta);

  tarjeta
    .querySelector(
      '[data-campo="nombres"]'
    )
    .focus();

  actualizarResumen();
}

function actualizarOtraRelacionAsistente(
  tarjeta
) {
  const relacion =
    tarjeta.querySelector(
      '[data-campo="relacion"]'
    ).value;

  const bloque =
    tarjeta.querySelector(
      "[data-bloque-otra-relacion]"
    );

  const campo =
    tarjeta.querySelector(
      '[data-campo="otraRelacion"]'
    );

  const esOtro =
    relacion === "otro";

  bloque.classList.toggle(
    "hidden",
    !esOtro
  );

  campo.required =
    esOtro;

  if (!esOtro) {
    campo.value = "";
  }
}

function obtenerAsistentesAdicionales() {
  return Array.from(
    $("asistentesAdicionales")
      .querySelectorAll(".attendee")
  ).map((tarjeta) => {
    const valor = (campo) =>
      tarjeta.querySelector(
        `[data-campo="${campo}"]`
      ).value.trim();

    return {
      nombres: valor("nombres"),
      apellidos: valor("apellidos"),
      relacion: valor("relacion"),

      otraRelacion:
        valor("relacion") === "otro"
          ? valor("otraRelacion")
          : ""
    };
  });
}

function obtenerContacto() {
  const relacion =
    $("contactoRelacion").value;

  return {
    nombres:
      $("contactoNombres")
        .value.trim(),

    apellidos:
      $("contactoApellidos")
        .value.trim(),

    telefono:
      normalizarCelular(
        $("contactoTelefono").value
      ),

    correo:
      $("contactoCorreo")
        .value.trim()
        .toLowerCase(),

    relacion,

    otraRelacion:
      relacion === "otro"
        ? $("contactoOtraRelacion")
            .value.trim()
        : "",

    asiste:
      !$("contactoNoAsiste")
        .checked
  };
}

function normalizarCelular(valor) {
  const digitos =
    String(valor || "")
      .replace(/\D/g, "");

  if (
    /^9\d{8}$/.test(digitos)
  ) {
    return `+56${digitos}`;
  }

  if (
    /^569\d{8}$/.test(digitos)
  ) {
    return `+${digitos}`;
  }

  return "";
}

function validarFormulario() {
  if (!state.grupoSeleccionado) {
    $("grupoBusqueda").focus();

    throw new Error(
      "Busca y selecciona un grupo de la lista."
    );
  }

  if (
    !$("reservaForm")
      .reportValidity()
  ) {
    throw new Error(
      "Completa todos los campos obligatorios."
    );
  }

  const contacto =
    obtenerContacto();

  if (!contacto.telefono) {
    $("contactoTelefono")
      .focus();

    throw new Error(
      "Ingresa un celular chileno válido, por ejemplo +56 9 1234 5678."
    );
  }

  if (
    !RELACIONES[
      contacto.relacion
    ]
  ) {
    throw new Error(
      "Selecciona tu relación con el grupo."
    );
  }

  if (
    contacto.relacion ===
      "otro" &&
    !contacto.otraRelacion
  ) {
    throw new Error(
      "Especifica tu relación con el grupo."
    );
  }

  const adicionales =
    obtenerAsistentesAdicionales();

  for (
    const persona of adicionales
  ) {
    if (
      !RELACIONES[
        persona.relacion
      ]
    ) {
      throw new Error(
        "Selecciona la relación con el grupo de cada asistente."
      );
    }

    if (
      persona.relacion ===
        "otro" &&
      !persona.otraRelacion
    ) {
      throw new Error(
        "Especifica la relación de cada asistente marcado como «Otro»."
      );
    }
  }

  const totalAsistentes =
    adicionales.length +
    (contacto.asiste ? 1 : 0);

  if (
    totalAsistentes < 1
  ) {
    throw new Error(
      "Agrega al menos una persona que asistirá."
    );
  }

  return {
    accion:
      "registrarReservaRifa",

    idGrupo:
      state.grupoSeleccionado
        .idGrupo,

    contacto,

    asistentesAdicionales:
      adicionales
  };
}

function actualizarResumen() {
  const contacto =
    obtenerContacto();

  const adicionales =
    obtenerAsistentesAdicionales();

  const total =
    adicionales.length +
    (contacto.asiste ? 1 : 0);

  const grupo =
    state.grupoSeleccionado
      ? etiquetaGrupo(
          state.grupoSeleccionado
        )
      : "Aún no seleccionado";

  $("resumenReserva").textContent =
    `Grupo: ${grupo}. ` +
    `Personas que asistirán: ${total}. ` +
    (
      contacto.asiste
        ? "Quien realiza la reserva también asistirá."
        : "Quien realiza la reserva quedará solo como contacto."
    );
}

async function confirmarReserva(evento) {
  evento.preventDefault();

  if (state.enviando) {
    return;
  }

  let datos;

  try {
    datos =
      validarFormulario();
  } catch (error) {
    mostrarEstado(
      error.message,
      true
    );

    return;
  }

  state.enviando = true;

  $("btnConfirmar").disabled =
    true;

  mostrarEstado(
    "Guardando tu reserva...",
    false
  );

  try {
    const respuesta =
      await solicitarApi(datos);

    if (
      respuesta?.ok !== true ||
      !respuesta?.reservaId
    ) {
      throw new Error(
        "El servidor no confirmó que la reserva se haya guardado."
      );
    }

    mostrarConfirmacion(
      datos,
      respuesta
    );
  } catch (error) {
    mostrarEstado(
      error.message ||
      "No pudimos guardar la reserva. Inténtalo nuevamente.",
      true
    );
  } finally {
    state.enviando = false;

    $("btnConfirmar").disabled =
      false;
  }
}

function mostrarConfirmacion(
  datos,
  respuesta
) {
  const totalLocal =
    datos.asistentesAdicionales
      .length +
    (
      datos.contacto.asiste
        ? 1
        : 0
    );

  const total =
    Number.isInteger(
      respuesta.totalAsistentes
    )
      ? respuesta.totalAsistentes
      : totalLocal;

  const detalle =
    $("confirmacionDetalle");

  detalle.replaceChildren();

  const grupo =
    document.createElement("p");

  grupo.textContent =
    `Grupo: ${etiquetaGrupo(
      state.grupoSeleccionado
    )}`;

  const cupos =
    document.createElement("p");

  cupos.textContent =
    total === 1
      ? "Confirmaste 1 persona."
      : `Confirmaste ${total} personas.`;

  const codigo =
    document.createElement("p");

  codigo.textContent =
    `Número de reserva: ${respuesta.reservaId}`;

  detalle.append(
    grupo,
    cupos,
    codigo
  );

  $("reservaForm")
    .classList.add("hidden");

  $("confirmacionPanel")
    .classList.remove("hidden");

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  $("confirmacionPanel")
    .focus();
}

function mostrarEstado(
  mensaje,
  esError
) {
  const estado =
    $("estadoFormulario");

  estado.textContent =
    mensaje;

  estado.className =
    `notice ${
      esError
        ? "error"
        : "success"
    }`;

  estado.classList.remove(
    "hidden"
  );
}

function reiniciarFormulario() {
  $("reservaForm").reset();

  $("asistentesAdicionales")
    .replaceChildren();

  $("grupoResultados")
    .replaceChildren();

  $("grupoSeleccionado")
    .classList.add("hidden");

  $("estadoFormulario")
    .classList.add("hidden");

  $("confirmacionPanel")
    .classList.add("hidden");

  $("reservaForm")
    .classList.remove("hidden");

  state.grupoSeleccionado =
    null;

  actualizarOtraRelacionContacto();
  manejarBusquedaGrupo();
  actualizarResumen();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

  $("grupoBusqueda").focus();
}
