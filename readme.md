# Comunicaciones Rai Trai

Portal móvil para leer pulseras NFC y consultar información operativa de pasajeros.

## Flujo

1. Buscar y seleccionar un grupo.
2. Ingresar el número de negocio del grupo como clave.
3. Leer el código NFC.
4. Si es individual, mostrar la ficha del pasajero.
5. Si es grupal, mostrar la nómina y permitir seleccionar un pasajero.

## Importante

La pulsera contiene únicamente texto:

```text
10661-001-JP
```

o:

```text
10661-GRUPO
```

Toda la información se obtiene mediante la Cloud Function y Firestore.

## Archivos

- `index.html`
- `estilos.css`
- `lector-pulseras.js`
- `config.js`
- `vercel.json`

## Configuración

En `config.js`, reemplaza:

```text
PEGAR_URL_CLOUD_FUNCTION_AQUI
```

por la URL de `consultarPulseraPublica`.
